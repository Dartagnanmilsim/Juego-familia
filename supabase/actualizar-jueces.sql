alter table public.torneos add column if not exists max_juez int default 2;
drop function if exists public.admin_guardar_torneo(text, uuid, text, uuid[]);
drop function if exists public.admin_guardar_torneo(text, uuid, text, uuid[], date, date, text, text, text);
create or replace function public.admin_guardar_torneo(p_clave text, p_id uuid, p_nombre text, p_participantes uuid[],
  p_inicio date, p_fin date, p_premio1 text, p_premio2 text, p_premio3 text, p_max_juez int)
returns public.torneos language plpgsql security definer set search_path = public as $$
declare t public.torneos;
begin
  perform public._admin_ok(p_clave);
  if char_length(trim(coalesce(p_nombre, ''))) not between 1 and 60 then raise exception 'nombre_invalido'; end if;
  if (select count(*) from public.usuarios where id = any(coalesce(p_participantes, '{}'))) < 2 then raise exception 'pocos_participantes'; end if;
  if p_inicio is null or p_fin is null or p_fin < p_inicio then raise exception 'fechas_invalidas'; end if;
  if char_length(trim(coalesce(p_premio1, ''))) not between 1 and 100 then raise exception 'premio_invalido'; end if;
  if char_length(coalesce(p_premio2, '')) > 100 or char_length(coalesce(p_premio3, '')) > 100 then raise exception 'premio_invalido'; end if;
  if p_max_juez is not null and p_max_juez not between 1 and 50 then raise exception 'max_juez_invalido'; end if;
  if p_id is null then
    insert into public.torneos (nombre, inicia_el, termina_el, premio1, premio2, premio3, max_juez)
    values (trim(p_nombre), p_inicio, p_fin, trim(p_premio1), nullif(trim(p_premio2), ''), nullif(trim(p_premio3), ''), p_max_juez) returning * into t;
  else
    update public.torneos set nombre = trim(p_nombre), inicia_el = p_inicio, termina_el = p_fin, premio1 = trim(p_premio1),
           premio2 = nullif(trim(p_premio2), ''), premio3 = nullif(trim(p_premio3), ''), max_juez = p_max_juez
     where id = p_id returning * into t;
    if t.id is null then raise exception 'torneo_no_existe'; end if;
    delete from public.torneo_participantes where torneo_id = t.id;
  end if;
  insert into public.torneo_participantes (torneo_id, usuario_id)
  select t.id, id from public.usuarios where id = any(p_participantes);
  return t;
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
  if (select count(*) from public.retos x where x.torneo_id = p_torneo and coalesce(x.juez_id, x.creado_por) = v_juez and x.estado <> 'cancelado')
     >= coalesce((select max_juez from public.torneos where id = p_torneo), 1000000) then raise exception 'juez_limite'; end if;
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
create or replace function public.admin_cambiar_juez(p_clave text, p_reto uuid, p_juez uuid)
returns public.retos language plpgsql security definer set search_path = public as $$
declare r public.retos; viejo uuid;
begin
  perform public._admin_ok(p_clave);
  select * into r from public.retos where id = p_reto for update;
  if r.id is null then raise exception 'reto_no_existe'; end if;
  if r.estado not in ('propuesto', 'programado', 'activo') then raise exception 'no_editable'; end if;
  if not exists (select 1 from public.usuarios where id = p_juez) then raise exception 'juez_no_existe'; end if;
  if r.torneo_id is not null and not exists (select 1 from public.torneo_participantes where torneo_id = r.torneo_id and usuario_id = p_juez) then
    raise exception 'juez_no_es_del_torneo';
  end if;
  if exists (select 1 from public.fotos where reto_id = r.id and usuario_id = p_juez) then raise exception 'juez_tiene_fotos'; end if;
  viejo := coalesce(r.juez_id, r.creado_por);
  update public.retos set juez_id = p_juez where id = p_reto returning * into r;
  delete from public.participantes where reto_id = r.id and usuario_id = p_juez;
  if r.torneo_id is not null and viejo <> p_juez
     and exists (select 1 from public.torneo_participantes where torneo_id = r.torneo_id and usuario_id = viejo) then
    insert into public.participantes (reto_id, usuario_id) values (r.id, viejo) on conflict do nothing;
  end if;
  return r;
end $$;
create or replace function public.admin_aceptar_foto(p_clave text, p_foto uuid)
returns json language plpgsql security definer set search_path = public as $$
declare f public.fotos; r public.retos; a int;
begin
  perform public._admin_ok(p_clave);
  select * into f from public.fotos where id = p_foto;
  if f.id is null then raise exception 'foto_no_existe'; end if;
  select * into r from public.retos where id = f.reto_id for update;
  if r.estado <> 'activo' then raise exception 'reto_cerrado'; end if;
  update public.fotos set estado = 'aceptada', aceptada_en = now() where id = p_foto and estado <> 'aceptada';
  select count(*) into a from public.fotos where reto_id = r.id and usuario_id = f.usuario_id and estado = 'aceptada';
  if a >= r.meta then
    perform public._cerrar_reto(r.id, 'meta', f.usuario_id);
    return json_build_object('aceptadas', a, 'gano', true);
  end if;
  return json_build_object('aceptadas', a, 'gano', false);
end $$;
grant execute on function public.admin_cambiar_juez(text, uuid, uuid), public.admin_aceptar_foto(text, uuid) to anon, authenticated;
grant execute on function public.admin_guardar_torneo(text, uuid, text, uuid[], date, date, text, text, text, int), public.proponer_reto(uuid, uuid, text, text, int, int, uuid) to anon, authenticated;
