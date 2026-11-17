alter table public.torneos add column if not exists inicia_el date;
alter table public.torneos add column if not exists termina_el date;
alter table public.torneos add column if not exists premio1 text;
alter table public.torneos add column if not exists premio2 text;
alter table public.torneos add column if not exists premio3 text;
create or replace function public.revisar_retos()
returns void language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  update public.retos set estado = 'activo' where estado = 'programado' and inicia_en <= now();
  delete from public.retos where estado = 'propuesto' and propuesta_expira <= now();
  delete from public.retos r using public.torneos t
   where r.torneo_id = t.id and r.estado = 'propuesto'
     and t.termina_el < (now() at time zone (select zona_horaria from public.admin_config where id = 1))::date;
  for v in select id from public.retos where estado = 'activo' and termina_en <= now() loop
    perform public._cerrar_reto(v, 'tiempo', null);
  end loop;
end $$;
drop function if exists public.admin_guardar_torneo(text, uuid, text, uuid[]);
create or replace function public.admin_guardar_torneo(p_clave text, p_id uuid, p_nombre text, p_participantes uuid[],
  p_inicio date, p_fin date, p_premio1 text, p_premio2 text, p_premio3 text)
returns public.torneos language plpgsql security definer set search_path = public as $$
declare t public.torneos;
begin
  perform public._admin_ok(p_clave);
  if char_length(trim(coalesce(p_nombre, ''))) not between 1 and 60 then raise exception 'nombre_invalido'; end if;
  if (select count(*) from public.usuarios where id = any(coalesce(p_participantes, '{}'))) < 2 then raise exception 'pocos_participantes'; end if;
  if p_inicio is null or p_fin is null or p_fin < p_inicio then raise exception 'fechas_invalidas'; end if;
  if char_length(trim(coalesce(p_premio1, ''))) not between 1 and 100 then raise exception 'premio_invalido'; end if;
  if char_length(coalesce(p_premio2, '')) > 100 or char_length(coalesce(p_premio3, '')) > 100 then raise exception 'premio_invalido'; end if;
  if p_id is null then
    insert into public.torneos (nombre, inicia_el, termina_el, premio1, premio2, premio3)
    values (trim(p_nombre), p_inicio, p_fin, trim(p_premio1), nullif(trim(p_premio2), ''), nullif(trim(p_premio3), '')) returning * into t;
  else
    update public.torneos set nombre = trim(p_nombre), inicia_el = p_inicio, termina_el = p_fin, premio1 = trim(p_premio1),
           premio2 = nullif(trim(p_premio2), ''), premio3 = nullif(trim(p_premio3), '')
     where id = p_id returning * into t;
    if t.id is null then raise exception 'torneo_no_existe'; end if;
    delete from public.torneo_participantes where torneo_id = t.id;
  end if;
  insert into public.torneo_participantes (torneo_id, usuario_id)
  select t.id, id from public.usuarios where id = any(p_participantes);
  return t;
end $$;
create or replace function public.admin_eliminar_torneo(p_clave text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_ok(p_clave);
  delete from public.retos where torneo_id = p_id and estado in ('propuesto', 'programado');
  delete from public.torneos where id = p_id;
end $$;
create or replace function public.proponer_reto(p_token uuid, p_torneo uuid, p_que text, p_emoji text, p_meta int, p_minutos int, p_juez uuid)
returns public.retos language plpgsql security definer set search_path = public as $$
declare v uuid := public._usuario_de(p_token); r public.retos; v_juez uuid := coalesce(p_juez, v);
begin
  perform public.revisar_retos();
  if not exists (select 1 from public.torneo_participantes where torneo_id = p_torneo and usuario_id = v) then raise exception 'no_eres_del_torneo'; end if;
  if exists (select 1 from public.torneos where id = p_torneo
              and termina_el < (now() at time zone (select zona_horaria from public.admin_config where id = 1))::date) then
    raise exception 'torneo_terminado';
  end if;
  if not exists (select 1 from public.torneo_participantes where torneo_id = p_torneo and usuario_id = v_juez) then raise exception 'juez_no_es_del_torneo'; end if;
  if p_minutos is null or p_minutos < 1 or p_minutos > 60 * 24 * 30 then raise exception 'duracion_invalida'; end if;
  if p_meta is null or p_meta < 1 or p_meta > 100 then raise exception 'meta_invalida'; end if;
  if char_length(trim(coalesce(p_que, ''))) not between 1 and 60 then raise exception 'reto_invalido'; end if;
  if not coalesce((public.reglas_juego()->>'abierto')::boolean, true) then raise exception 'fuera_de_horario'; end if;
  if exists (select 1 from public.retos where torneo_id = p_torneo and creado_por = v and estado <> 'propuesto') then raise exception 'ya_tienes_reto_en_torneo'; end if;
  if exists (select 1 from public.retos where torneo_id = p_torneo and creado_por = v and estado = 'propuesto') then raise exception 'ya_tienes_propuesta'; end if;
  insert into public.retos (creado_por, juez_id, para_todos, que_buscar, emoji, meta, inicia_en, termina_en, estado, torneo_id, duracion_min, propuesta_expira)
  values (v, v_juez, false, trim(p_que), coalesce(nullif(p_emoji, ''), '🎯'), p_meta, now(), now() + make_interval(mins => p_minutos),
          'propuesto', p_torneo, p_minutos, now() + interval '24 hours')
  returning * into r;
  insert into public.participantes (reto_id, usuario_id)
  select r.id, usuario_id from public.torneo_participantes where torneo_id = p_torneo and usuario_id <> v_juez;
  return r;
end $$;
create or replace function public.votar_propuesta(p_token uuid, p_reto uuid, p_si boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v uuid := public._usuario_de(p_token); r public.retos; n int; z text; h0 int; dia date; ini timestamptz; tor public.torneos;
begin
  select * into r from public.retos where id = p_reto for update;
  if r.id is null then raise exception 'reto_no_existe'; end if;
  if r.estado <> 'propuesto' or r.propuesta_expira <= now() then raise exception 'votacion_cerrada'; end if;
  if not exists (select 1 from public.torneo_participantes where torneo_id = r.torneo_id and usuario_id = v) then raise exception 'no_eres_del_torneo'; end if;
  if v = r.creado_por then raise exception 'no_votas_tu_reto'; end if;
  if p_si then
    insert into public.votos_retos (reto_id, usuario_id) values (p_reto, v) on conflict do nothing;
  else
    delete from public.votos_retos where reto_id = p_reto and usuario_id = v;
  end if;
  select count(*) into n from public.votos_retos where reto_id = p_reto;
  if n < 5 then return json_build_object('votos', n, 'aprobado', false); end if;
  perform pg_advisory_xact_lock(hashtext(r.torneo_id::text));
  select zona_horaria, hora_inicio into z, h0 from public.admin_config where id = 1;
  select * into tor from public.torneos where id = r.torneo_id;
  dia := greatest((now() at time zone z)::date, coalesce(tor.inicia_el, (now() at time zone z)::date));
  while exists (select 1 from public.retos x where x.torneo_id = r.torneo_id and x.id <> r.id
                  and x.estado in ('programado', 'activo', 'terminado')
                  and (x.inicia_en at time zone z)::date = dia) loop
    dia := dia + 1;
  end loop;
  if dia > tor.termina_el then raise exception 'torneo_sin_dias'; end if;
  if dia = (now() at time zone z)::date then
    update public.retos set estado = 'activo', inicia_en = now(), termina_en = now() + make_interval(mins => r.duracion_min)
     where id = p_reto returning * into r;
  else
    ini := (dia + make_interval(hours => h0)) at time zone z;
    update public.retos set estado = 'programado', inicia_en = ini, termina_en = ini + make_interval(mins => r.duracion_min)
     where id = p_reto returning * into r;
  end if;
  return json_build_object('votos', n, 'aprobado', true, 'estado', r.estado, 'inicia_en', r.inicia_en);
end $$;
grant execute on function
  public.admin_guardar_torneo(text, uuid, text, uuid[], date, date, text, text, text),
  public.proponer_reto(uuid, uuid, text, text, int, int, uuid),
  public.votar_propuesta(uuid, uuid, boolean),
  public.admin_eliminar_torneo(text, uuid)
to anon, authenticated;
