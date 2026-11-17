alter table public.retos drop constraint if exists retos_estado_check;
alter table public.retos add constraint retos_estado_check check (estado in ('propuesto', 'programado', 'activo', 'terminado', 'cancelado'));
alter table public.retos add column if not exists duracion_min int;
alter table public.retos add column if not exists propuesta_expira timestamptz;
create table if not exists public.torneos (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null check (char_length(nombre) between 1 and 60),
  creado_en timestamptz not null default now()
);
create table if not exists public.torneo_participantes (
  torneo_id  uuid not null references public.torneos(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  primary key (torneo_id, usuario_id)
);
alter table public.retos add column if not exists torneo_id uuid references public.torneos(id) on delete set null;
create index if not exists retos_torneo_idx on public.retos(torneo_id);
create table if not exists public.votos_retos (
  reto_id    uuid not null references public.retos(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  creado_en  timestamptz not null default now(),
  primary key (reto_id, usuario_id)
);
alter table public.torneos enable row level security;
alter table public.torneo_participantes enable row level security;
alter table public.votos_retos enable row level security;
drop policy if exists "leer torneos" on public.torneos;
drop policy if exists "leer torneo_participantes" on public.torneo_participantes;
drop policy if exists "leer votos_retos" on public.votos_retos;
create policy "leer torneos" on public.torneos for select to anon, authenticated using (true);
create policy "leer torneo_participantes" on public.torneo_participantes for select to anon, authenticated using (true);
create policy "leer votos_retos" on public.votos_retos for select to anon, authenticated using (true);
grant select on public.torneos, public.torneo_participantes, public.votos_retos to anon, authenticated;
revoke insert, update, delete on public.torneos, public.torneo_participantes, public.votos_retos from anon, authenticated;
create or replace function public.revisar_retos()
returns void language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  update public.retos set estado = 'activo' where estado = 'programado' and inicia_en <= now();
  delete from public.retos where estado = 'propuesto' and propuesta_expira <= now();
  for v in select id from public.retos where estado = 'activo' and termina_en <= now() loop
    perform public._cerrar_reto(v, 'tiempo', null);
  end loop;
end $$;
create or replace function public.admin_guardar_torneo(p_clave text, p_id uuid, p_nombre text, p_participantes uuid[])
returns public.torneos language plpgsql security definer set search_path = public as $$
declare t public.torneos;
begin
  perform public._admin_ok(p_clave);
  if char_length(trim(coalesce(p_nombre, ''))) not between 1 and 60 then raise exception 'nombre_invalido'; end if;
  if (select count(*) from public.usuarios where id = any(coalesce(p_participantes, '{}'))) < 2 then raise exception 'pocos_participantes'; end if;
  if p_id is null then
    insert into public.torneos (nombre) values (trim(p_nombre)) returning * into t;
  else
    update public.torneos set nombre = trim(p_nombre) where id = p_id returning * into t;
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
declare v uuid := public._usuario_de(p_token); r public.retos; n int; z text; h0 int; dia date; ini timestamptz;
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
  dia := (now() at time zone z)::date;
  while exists (select 1 from public.retos x where x.torneo_id = r.torneo_id and x.id <> r.id
                  and x.estado in ('programado', 'activo', 'terminado')
                  and (x.inicia_en at time zone z)::date = dia) loop
    dia := dia + 1;
  end loop;
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
create or replace function public.retirar_propuesta(p_token uuid, p_reto uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.retos where id = p_reto and estado = 'propuesto' and creado_por = public._usuario_de(p_token);
  if not found then raise exception 'reto_no_existe'; end if;
end $$;
grant execute on function
  public.admin_guardar_torneo(text, uuid, text, uuid[]),
  public.admin_eliminar_torneo(text, uuid),
  public.proponer_reto(uuid, uuid, text, text, int, int, uuid),
  public.votar_propuesta(uuid, uuid, boolean),
  public.retirar_propuesta(uuid, uuid)
to anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['torneos', 'torneo_participantes', 'votos_retos'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
