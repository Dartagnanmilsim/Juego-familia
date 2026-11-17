create extension if not exists pgcrypto;
set search_path = public, extensions;
create table if not exists public.usuarios (
  id        uuid primary key default gen_random_uuid(),
  usuario   text not null unique check (usuario ~ '^[a-z0-9._-]{3,20}$'),
  nombre    text not null check (char_length(nombre) between 1 and 30),
  avatar    text not null default '🙂' check (char_length(avatar) <= 16),
  creado_en timestamptz not null default now()
);
create table if not exists public.credenciales (
  usuario_id uuid primary key references public.usuarios(id) on delete cascade,
  clave_hash text not null
);
create table if not exists public.sesiones (
  token      uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  creado_en  timestamptz not null default now(),
  expira_en  timestamptz not null default now() + interval '180 days'
);
create index if not exists sesiones_usuario_idx on public.sesiones(usuario_id);
create table if not exists public.admin_config (
  id         int primary key default 1 check (id = 1),
  clave_hash text not null
);
alter table public.admin_config add column if not exists hora_inicio int not null default 8;
alter table public.admin_config add column if not exists hora_fin int not null default 18;
alter table public.admin_config add column if not exists zona_horaria text not null default 'America/Bogota';
create table if not exists public.retos (
  id          uuid primary key default gen_random_uuid(),
  creado_por  uuid references public.usuarios(id) on delete set null,
  que_buscar  text not null check (char_length(que_buscar) between 1 and 60),
  emoji       text not null default '🎯' check (char_length(emoji) <= 16),
  meta        int  not null check (meta between 1 and 100),
  inicia_en   timestamptz not null default now(),
  termina_en  timestamptz not null,
  estado      text not null default 'activo' check (estado in ('activo', 'terminado', 'cancelado')),
  motivo      text check (motivo in ('meta', 'tiempo', 'cancelado')),
  ganador_id  uuid references public.usuarios(id) on delete set null,
  cerrado_en  timestamptz,
  check (termina_en > inicia_en)
);
create index if not exists retos_inicio_idx on public.retos(inicia_en desc);
alter table public.retos drop constraint if exists retos_estado_check;
alter table public.retos add constraint retos_estado_check check (estado in ('propuesto', 'programado', 'activo', 'terminado', 'cancelado'));
alter table public.retos add column if not exists duracion_min int;
alter table public.retos add column if not exists propuesta_expira timestamptz;
drop index if exists public.retos_un_activo;
create table if not exists public.fotos (
  id         uuid primary key default gen_random_uuid(),
  reto_id    uuid not null references public.retos(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  ruta       text not null,
  creado_en  timestamptz not null default now()
);
create index if not exists fotos_reto_idx on public.fotos(reto_id, usuario_id);
alter table public.retos add column if not exists para_todos boolean not null default true;
alter table public.retos add column if not exists juez_id uuid references public.usuarios(id) on delete set null;
alter table public.fotos add column if not exists estado text not null default 'pendiente';
alter table public.fotos add column if not exists aceptada_en timestamptz;
alter table public.fotos drop constraint if exists fotos_estado_check;
alter table public.fotos add constraint fotos_estado_check check (estado in ('pendiente', 'aceptada'));
create table if not exists public.votos (
  foto_id    uuid not null references public.fotos(id) on delete cascade,
  reto_id    uuid not null references public.retos(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  tipo       text not null check (tipo in ('acepta', 'denuncia')),
  creado_en  timestamptz not null default now(),
  primary key (foto_id, usuario_id)
);
create index if not exists votos_reto_idx on public.votos(reto_id);
alter table public.votos add column if not exists motivo text;
alter table public.votos drop constraint if exists votos_motivo_check;
alter table public.votos add constraint votos_motivo_check check (motivo is null or char_length(motivo) <= 200);
create table if not exists public.participantes (
  reto_id    uuid not null references public.retos(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  primary key (reto_id, usuario_id)
);
create table if not exists public.campeonatos (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null check (char_length(nombre) between 1 and 60),
  creado_en timestamptz not null default now()
);
create table if not exists public.campeonato_retos (
  campeonato_id uuid not null references public.campeonatos(id) on delete cascade,
  reto_id       uuid not null references public.retos(id) on delete cascade,
  primary key (campeonato_id, reto_id)
);
create table if not exists public.presos (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references public.usuarios(id) on delete cascade,
  motivo       text not null check (char_length(motivo) between 1 and 200),
  desde        timestamptz not null default now(),
  hasta        timestamptz not null,
  por_juez     uuid references public.usuarios(id) on delete set null,
  reto_id      uuid references public.retos(id) on delete set null,
  liberado_en  timestamptz
);
create index if not exists presos_usuario_idx on public.presos(usuario_id, hasta desc);
alter table public.presos add column if not exists votacion_inicio timestamptz;
alter table public.presos add column if not exists votacion_fin timestamptz;
alter table public.presos add column if not exists liberado_por text;
alter table public.presos drop constraint if exists presos_liberado_por_check;
alter table public.presos add constraint presos_liberado_por_check check (liberado_por is null or liberado_por in ('juez', 'admin', 'pueblo', 'anulada'));
update public.presos set liberado_en = now(), liberado_por = 'anulada'
 where reto_id is null and liberado_en is null and hasta > now();
create table if not exists public.votos_presos (
  preso_id   uuid not null references public.presos(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  a_favor    boolean not null,
  creado_en  timestamptz not null default now(),
  primary key (preso_id, usuario_id)
);
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
alter table public.torneos add column if not exists inicia_el date;
alter table public.torneos add column if not exists termina_el date;
alter table public.torneos add column if not exists premio1 text;
alter table public.torneos add column if not exists premio2 text;
alter table public.torneos add column if not exists premio3 text;
create table if not exists public.votos_retos (
  reto_id    uuid not null references public.retos(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  creado_en  timestamptz not null default now(),
  primary key (reto_id, usuario_id)
);
create table if not exists public.puntajes (
  reto_id    uuid not null references public.retos(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  puesto     int  not null,
  fotos      int  not null,
  puntos     int  not null,
  primary key (reto_id, usuario_id)
);
create table if not exists public.denuncias (
  foto_id     uuid not null,
  reto_id     uuid not null references public.retos(id) on delete cascade,
  usuario_id  uuid not null references public.usuarios(id) on delete cascade,
  denunciante uuid not null references public.usuarios(id) on delete cascade,
  creado_en   timestamptz not null default now(),
  primary key (foto_id, denunciante)
);
create index if not exists denuncias_reto_idx on public.denuncias(reto_id, usuario_id);
alter table public.puntajes add column if not exists denuncias int not null default 0;
insert into public.denuncias (foto_id, reto_id, usuario_id, denunciante)
select v.foto_id, v.reto_id, f.usuario_id, v.usuario_id from public.votos v join public.fotos f on f.id = v.foto_id
 where v.tipo = 'denuncia'
on conflict do nothing;
update public.puntajes p set denuncias = (select count(*) from public.denuncias d where d.reto_id = p.reto_id and d.usuario_id = p.usuario_id);
insert into public.admin_config (id, clave_hash) values (1, crypt('1234', gen_salt('bf')))
on conflict (id) do nothing;
alter table public.usuarios     enable row level security;
alter table public.credenciales enable row level security;
alter table public.sesiones     enable row level security;
alter table public.denuncias    enable row level security;
alter table public.admin_config enable row level security;
alter table public.retos        enable row level security;
alter table public.fotos        enable row level security;
alter table public.puntajes     enable row level security;
alter table public.votos        enable row level security;
alter table public.participantes enable row level security;
alter table public.campeonatos enable row level security;
alter table public.campeonato_retos enable row level security;
alter table public.presos enable row level security;
alter table public.votos_presos enable row level security;
alter table public.torneos enable row level security;
alter table public.torneo_participantes enable row level security;
alter table public.votos_retos enable row level security;
drop policy if exists "leer usuarios" on public.usuarios;
drop policy if exists "leer retos"    on public.retos;
drop policy if exists "leer fotos"    on public.fotos;
drop policy if exists "leer puntajes" on public.puntajes;
drop policy if exists "leer votos"    on public.votos;
drop policy if exists "leer participantes" on public.participantes;
drop policy if exists "leer campeonatos" on public.campeonatos;
drop policy if exists "leer campeonato_retos" on public.campeonato_retos;
drop policy if exists "leer presos" on public.presos;
drop policy if exists "leer votos_presos" on public.votos_presos;
drop policy if exists "leer torneos" on public.torneos;
drop policy if exists "leer torneo_participantes" on public.torneo_participantes;
drop policy if exists "leer votos_retos" on public.votos_retos;
create policy "leer usuarios" on public.usuarios for select to anon, authenticated using (true);
create policy "leer retos"    on public.retos    for select to anon, authenticated using (true);
create policy "leer fotos"    on public.fotos    for select to anon, authenticated using (true);
create policy "leer puntajes" on public.puntajes for select to anon, authenticated using (true);
create policy "leer votos"    on public.votos    for select to anon, authenticated using (true);
create policy "leer participantes" on public.participantes for select to anon, authenticated using (true);
create policy "leer campeonatos" on public.campeonatos for select to anon, authenticated using (true);
create policy "leer campeonato_retos" on public.campeonato_retos for select to anon, authenticated using (true);
create policy "leer presos" on public.presos for select to anon, authenticated using (true);
create policy "leer votos_presos" on public.votos_presos for select to anon, authenticated using (true);
create policy "leer torneos" on public.torneos for select to anon, authenticated using (true);
create policy "leer torneo_participantes" on public.torneo_participantes for select to anon, authenticated using (true);
create policy "leer votos_retos" on public.votos_retos for select to anon, authenticated using (true);
grant select on public.usuarios, public.retos, public.fotos, public.puntajes, public.votos, public.participantes,
  public.campeonatos, public.campeonato_retos, public.presos, public.votos_presos,
  public.torneos, public.torneo_participantes, public.votos_retos to anon, authenticated;
revoke insert, update, delete on public.usuarios, public.retos, public.fotos, public.puntajes, public.votos, public.participantes,
  public.campeonatos, public.campeonato_retos, public.presos, public.votos_presos,
  public.torneos, public.torneo_participantes, public.votos_retos from anon, authenticated;
revoke all on public.credenciales, public.sesiones, public.admin_config, public.denuncias from anon, authenticated;
create or replace function public._usuario_de(p_token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select usuario_id into v from public.sesiones where token = p_token and expira_en > now();
  if v is null then raise exception 'sesion_invalida'; end if;
  return v;
end $$;
create or replace function public._admin_ok(p_clave text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare h text;
begin
  select clave_hash into h from public.admin_config where id = 1;
  if h is null or h <> crypt(coalesce(p_clave, ''), h) then raise exception 'clave_admin_incorrecta'; end if;
end $$;
create or replace function public._cerrar_reto(p_reto uuid, p_motivo text, p_ganador uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.retos;
  v_ganador uuid := p_ganador;
begin
  select * into r from public.retos where id = p_reto for update;
  if r.id is null or r.estado <> 'activo' then return; end if;
  if p_motivo = 'cancelado' then
    update public.retos set estado = 'cancelado', motivo = 'cancelado', cerrado_en = now() where id = p_reto;
    return;
  end if;
  insert into public.puntajes (reto_id, usuario_id, puesto, fotos, puntos, denuncias)
  select p_reto, usuario_id, puesto, n, case puesto when 1 then 3 when 2 then 2 when 3 then 1 else 0 end,
         (select count(*) from public.denuncias d where d.reto_id = p_reto and d.usuario_id = t.usuario_id)
    from (
      select usuario_id, count(*)::int as n,
             row_number() over (order by (usuario_id = p_ganador) desc, count(*) desc, max(creado_en) asc)::int as puesto
        from public.fotos where reto_id = p_reto and estado = 'aceptada' group by usuario_id
    ) t;
  if v_ganador is null then
    select usuario_id into v_ganador from public.puntajes where reto_id = p_reto and puesto = 1;
  end if;
  update public.retos set estado = 'terminado', motivo = p_motivo, ganador_id = v_ganador, cerrado_en = now()
   where id = p_reto;
end $$;
revoke all on function public._usuario_de(uuid) from public, anon, authenticated;
revoke all on function public._admin_ok(text) from public, anon, authenticated;
revoke all on function public._cerrar_reto(uuid, text, uuid) from public, anon, authenticated;
create or replace function public.registrar_usuario(p_usuario text, p_clave text, p_nombre text, p_avatar text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare u public.usuarios; v_token uuid; v_usuario text := lower(trim(p_usuario));
begin
  if v_usuario !~ '^[a-z0-9._-]{3,20}$' then raise exception 'usuario_invalido'; end if;
  if char_length(coalesce(p_clave, '')) < 4 then raise exception 'clave_corta'; end if;
  if exists (select 1 from public.usuarios where usuario = v_usuario) then raise exception 'usuario_existe'; end if;
  insert into public.usuarios (usuario, nombre, avatar)
  values (v_usuario, trim(p_nombre), coalesce(nullif(p_avatar, ''), '🙂')) returning * into u;
  insert into public.credenciales (usuario_id, clave_hash) values (u.id, crypt(p_clave, gen_salt('bf')));
  insert into public.sesiones (usuario_id) values (u.id) returning token into v_token;
  return json_build_object('token', v_token, 'usuario', row_to_json(u));
end $$;
create or replace function public.iniciar_sesion(p_usuario text, p_clave text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare u public.usuarios; h text; v_token uuid;
begin
  select * into u from public.usuarios where usuario = lower(trim(p_usuario));
  select clave_hash into h from public.credenciales where usuario_id = u.id;
  if u.id is null or h is null or h <> crypt(coalesce(p_clave, ''), h) then
    raise exception 'credenciales_incorrectas';
  end if;
  delete from public.sesiones where usuario_id = u.id and expira_en <= now();
  insert into public.sesiones (usuario_id) values (u.id) returning token into v_token;
  return json_build_object('token', v_token, 'usuario', row_to_json(u));
end $$;
create or replace function public.cerrar_sesion(p_token uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.sesiones where token = p_token;
$$;
create or replace function public.yo(p_token uuid)
returns public.usuarios language plpgsql security definer set search_path = public as $$
declare u public.usuarios;
begin
  select * into u from public.usuarios where id = public._usuario_de(p_token);
  return u;
end $$;
create or replace function public.editar_perfil(p_token uuid, p_nombre text, p_avatar text)
returns public.usuarios language plpgsql security definer set search_path = public as $$
declare u public.usuarios;
begin
  update public.usuarios set nombre = trim(p_nombre), avatar = coalesce(nullif(p_avatar, ''), avatar)
   where id = public._usuario_de(p_token) returning * into u;
  return u;
end $$;
create or replace function public.cambiar_clave(p_token uuid, p_actual text, p_nueva text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := public._usuario_de(p_token); h text;
begin
  select clave_hash into h from public.credenciales where usuario_id = v;
  if h <> crypt(coalesce(p_actual, ''), h) then raise exception 'credenciales_incorrectas'; end if;
  if char_length(coalesce(p_nueva, '')) < 4 then raise exception 'clave_corta'; end if;
  update public.credenciales set clave_hash = crypt(p_nueva, gen_salt('bf')) where usuario_id = v;
end $$;
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
drop function if exists public._esta_preso(uuid);
create or replace function public._esta_preso(p_usuario uuid, p_reto uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.presos
                  where usuario_id = p_usuario and reto_id = p_reto and liberado_en is null and hasta > now());
$$;
revoke all on function public._esta_preso(uuid, uuid) from public, anon, authenticated;
create or replace function public.reglas_juego()
returns json language sql security definer set search_path = public as $$
  select json_build_object(
    'hora_inicio', hora_inicio, 'hora_fin', hora_fin, 'zona_horaria', zona_horaria,
    'hora_local', to_char(now() at time zone zona_horaria, 'HH24:MI'),
    'abierto', extract(hour from now() at time zone zona_horaria) >= hora_inicio
           and extract(hour from now() at time zone zona_horaria) < hora_fin)
  from public.admin_config where id = 1;
$$;
drop function if exists public.crear_reto(uuid, text, text, int, int);
drop function if exists public.crear_reto(uuid, text, text, int, int, uuid);
drop function if exists public.borrar_foto(uuid, uuid);
drop function if exists public.cancelar_reto(uuid, uuid);
drop function if exists public.admin_cancelar_reto(text, uuid);
create or replace function public._juez_de(p_reto uuid)
returns uuid language sql security definer set search_path = public as $$
  select coalesce(juez_id, creado_por) from public.retos where id = p_reto;
$$;
revoke all on function public._juez_de(uuid) from public, anon, authenticated;
create or replace function public._compite(p_reto uuid, p_usuario uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.retos r
     where r.id = p_reto and p_usuario <> coalesce(r.juez_id, r.creado_por)
       and (r.para_todos or exists (select 1 from public.participantes x where x.reto_id = r.id and x.usuario_id = p_usuario))
  );
$$;
revoke all on function public._compite(uuid, uuid) from public, anon, authenticated;
create or replace function public.crear_reto(p_token uuid, p_que text, p_emoji text, p_meta int, p_minutos int,
                                             p_juez uuid, p_para_todos boolean, p_participantes uuid[])
returns public.retos language plpgsql security definer set search_path = public as $$
declare v uuid := public._usuario_de(p_token); r public.retos; v_juez uuid := coalesce(p_juez, v);
        v_todos boolean := coalesce(p_para_todos, true); n int;
begin
  if p_minutos is null or p_minutos < 1 or p_minutos > 60 * 24 * 30 then raise exception 'duracion_invalida'; end if;
  if not coalesce((public.reglas_juego()->>'abierto')::boolean, true) then raise exception 'fuera_de_horario'; end if;
  if not exists (select 1 from public.usuarios where id = v_juez) then raise exception 'juez_no_existe'; end if;
  if not v_todos then
    select count(*) into n from public.usuarios
     where id = any(coalesce(p_participantes, '{}')) and id <> v_juez;
    if n = 0 then raise exception 'sin_participantes'; end if;
  end if;
  perform public.revisar_retos();
  insert into public.retos (creado_por, juez_id, para_todos, que_buscar, emoji, meta, termina_en)
  values (v, v_juez, v_todos, trim(p_que), coalesce(nullif(p_emoji, ''), '🎯'), p_meta, now() + make_interval(mins => p_minutos))
  returning * into r;
  if not v_todos then
    insert into public.participantes (reto_id, usuario_id)
    select r.id, id from public.usuarios where id = any(p_participantes) and id <> v_juez;
  end if;
  return r;
end $$;
create or replace function public.registrar_foto(p_token uuid, p_reto uuid, p_ruta text)
returns json language plpgsql security definer set search_path = public as $$
declare v uuid := public._usuario_de(p_token); r public.retos; n int; a int;
begin
  select * into r from public.retos where id = p_reto for update;
  if r.id is null then raise exception 'reto_no_existe'; end if;
  if r.estado = 'activo' and r.termina_en <= now() then
    perform public._cerrar_reto(p_reto, 'tiempo', null);
    raise exception 'reto_cerrado';
  end if;
  if r.estado <> 'activo' then raise exception 'reto_cerrado'; end if;
  if v = coalesce(r.juez_id, r.creado_por) then raise exception 'el_juez_no_compite'; end if;
  if not public._compite(p_reto, v) then raise exception 'no_participas'; end if;
  if public._esta_preso(v, p_reto) then raise exception 'estas_preso'; end if;
  insert into public.fotos (reto_id, usuario_id, ruta) values (p_reto, v, p_ruta);
  select count(*), count(*) filter (where estado = 'aceptada') into n, a
    from public.fotos where reto_id = p_reto and usuario_id = v;
  return json_build_object('fotos', n, 'aceptadas', a);
end $$;
drop function if exists public.votar_foto(uuid, uuid, text);
create or replace function public.votar_foto(p_token uuid, p_foto uuid, p_tipo text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := public._usuario_de(p_token); f public.fotos; r public.retos; m text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  select * into f from public.fotos where id = p_foto;
  if f.id is null then raise exception 'foto_no_existe'; end if;
  select * into r from public.retos where id = f.reto_id;
  if r.estado <> 'activo' then raise exception 'reto_cerrado'; end if;
  if f.usuario_id = v then raise exception 'no_puedes_votar_tu_foto'; end if;
  if not public._compite(f.reto_id, v) then raise exception 'no_participas'; end if;
  if public._esta_preso(v, f.reto_id) then raise exception 'estas_preso'; end if;
  delete from public.denuncias where foto_id = p_foto and denunciante = v;
  if p_tipo = 'denuncia' then
    insert into public.denuncias (foto_id, reto_id, usuario_id, denunciante) values (p_foto, f.reto_id, f.usuario_id, v);
  end if;
  if p_tipo is null then
    delete from public.votos where foto_id = p_foto and usuario_id = v;
  elsif p_tipo = 'acepta' then
    insert into public.votos (foto_id, reto_id, usuario_id, tipo, motivo) values (p_foto, f.reto_id, v, 'acepta', null)
    on conflict (foto_id, usuario_id) do update set tipo = 'acepta', motivo = null, creado_en = now();
  elsif p_tipo = 'denuncia' then
    if m is null then raise exception 'falta_motivo'; end if;
    if char_length(m) > 200 then raise exception 'motivo_largo'; end if;
    insert into public.votos (foto_id, reto_id, usuario_id, tipo, motivo) values (p_foto, f.reto_id, v, 'denuncia', m)
    on conflict (foto_id, usuario_id) do update set tipo = 'denuncia', motivo = excluded.motivo, creado_en = now();
  else
    raise exception 'voto_invalido';
  end if;
end $$;
create or replace function public.juez_aceptar_foto(p_token uuid, p_foto uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v uuid := public._usuario_de(p_token); f public.fotos; r public.retos; a int;
begin
  select * into f from public.fotos where id = p_foto;
  if f.id is null then raise exception 'foto_no_existe'; end if;
  select * into r from public.retos where id = f.reto_id for update;
  if v <> coalesce(r.juez_id, r.creado_por) then raise exception 'solo_el_juez'; end if;
  if r.estado <> 'activo' then raise exception 'reto_cerrado'; end if;
  update public.fotos set estado = 'aceptada', aceptada_en = now() where id = p_foto and estado <> 'aceptada';
  select count(*) into a from public.fotos where reto_id = r.id and usuario_id = f.usuario_id and estado = 'aceptada';
  if a >= r.meta then
    perform public._cerrar_reto(r.id, 'meta', f.usuario_id);
    return json_build_object('aceptadas', a, 'gano', true);
  end if;
  return json_build_object('aceptadas', a, 'gano', false);
end $$;
create or replace function public.juez_eliminar_foto(p_token uuid, p_foto uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := public._usuario_de(p_token); f public.fotos; r public.retos;
begin
  select * into f from public.fotos where id = p_foto;
  if f.id is null then raise exception 'foto_no_existe'; end if;
  select * into r from public.retos where id = f.reto_id;
  if v <> coalesce(r.juez_id, r.creado_por) then raise exception 'solo_el_juez'; end if;
  if r.estado <> 'activo' then raise exception 'reto_cerrado'; end if;
  delete from public.fotos where id = p_foto;
end $$;
create or replace function public.admin_entrar(p_clave text)
returns boolean language plpgsql security definer set search_path = public as $$
begin perform public._admin_ok(p_clave); return true; end $$;
create or replace function public.admin_cambiar_clave(p_clave text, p_nueva text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._admin_ok(p_clave);
  if char_length(coalesce(p_nueva, '')) < 4 then raise exception 'clave_corta'; end if;
  update public.admin_config set clave_hash = crypt(p_nueva, gen_salt('bf')) where id = 1;
end $$;
create or replace function public.admin_eliminar_usuario(p_clave text, p_usuario uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_ok(p_clave);
  delete from public.usuarios where id = p_usuario;
end $$;
create or replace function public.admin_restablecer_clave(p_clave text, p_usuario uuid, p_nueva text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._admin_ok(p_clave);
  if char_length(coalesce(p_nueva, '')) < 4 then raise exception 'clave_corta'; end if;
  update public.credenciales set clave_hash = crypt(p_nueva, gen_salt('bf')) where usuario_id = p_usuario;
  if not found then raise exception 'usuario_no_existe'; end if;
  delete from public.sesiones where usuario_id = p_usuario;
end $$;
create or replace function public.admin_eliminar_reto(p_clave text, p_reto uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_ok(p_clave);
  delete from public.retos where id = p_reto;
end $$;
create or replace function public.admin_guardar_campeonato(p_clave text, p_id uuid, p_nombre text, p_retos uuid[])
returns public.campeonatos language plpgsql security definer set search_path = public as $$
declare c public.campeonatos;
begin
  perform public._admin_ok(p_clave);
  if char_length(trim(coalesce(p_nombre, ''))) not between 1 and 60 then raise exception 'nombre_invalido'; end if;
  if not exists (select 1 from public.retos where id = any(coalesce(p_retos, '{}'))) then raise exception 'campeonato_sin_retos'; end if;
  if p_id is null then
    insert into public.campeonatos (nombre) values (trim(p_nombre)) returning * into c;
  else
    update public.campeonatos set nombre = trim(p_nombre) where id = p_id returning * into c;
    if c.id is null then raise exception 'campeonato_no_existe'; end if;
    delete from public.campeonato_retos where campeonato_id = c.id;
  end if;
  insert into public.campeonato_retos (campeonato_id, reto_id)
  select c.id, id from public.retos where id = any(p_retos);
  return c;
end $$;
create or replace function public.admin_guardar_reglas(p_clave text, p_inicio int, p_fin int, p_zona text)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_ok(p_clave);
  if p_inicio is null or p_fin is null or p_inicio < 0 or p_fin > 24 or p_inicio >= p_fin then raise exception 'horario_invalido'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_zona) then raise exception 'zona_invalida'; end if;
  update public.admin_config set hora_inicio = p_inicio, hora_fin = p_fin, zona_horaria = p_zona where id = 1;
  return public.reglas_juego();
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
create or replace function public.retirar_propuesta(p_token uuid, p_reto uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.retos where id = p_reto and estado = 'propuesto' and creado_por = public._usuario_de(p_token);
  if not found then raise exception 'reto_no_existe'; end if;
end $$;
create or replace function public._encarcelar(p_usuario uuid, p_horas int, p_motivo text, p_juez uuid, p_reto uuid)
returns public.presos language plpgsql security definer set search_path = public as $$
declare m text := trim(coalesce(p_motivo, '')); x public.presos;
begin
  if not exists (select 1 from public.usuarios where id = p_usuario) then raise exception 'usuario_no_existe'; end if;
  if m = '' then raise exception 'falta_motivo'; end if;
  if char_length(m) > 200 then raise exception 'motivo_largo'; end if;
  if p_reto is null then raise exception 'reto_no_existe'; end if;
  update public.presos set liberado_en = now(), liberado_por = 'anulada'
   where usuario_id = p_usuario and reto_id = p_reto and liberado_en is null and hasta > now();
  insert into public.presos (usuario_id, motivo, hasta, por_juez, reto_id)
  values (p_usuario, m, now() + make_interval(hours => p_horas), p_juez, p_reto) returning * into x;
  return x;
end $$;
revoke all on function public._encarcelar(uuid, int, text, uuid, uuid) from public, anon, authenticated;
create or replace function public.juez_encarcelar(p_token uuid, p_reto uuid, p_usuario uuid, p_horas int, p_motivo text)
returns public.presos language plpgsql security definer set search_path = public as $$
declare v uuid := public._usuario_de(p_token); r public.retos;
begin
  select * into r from public.retos where id = p_reto;
  if r.id is null then raise exception 'reto_no_existe'; end if;
  if v <> coalesce(r.juez_id, r.creado_por) then raise exception 'solo_el_juez'; end if;
  if r.estado <> 'activo' then raise exception 'reto_cerrado'; end if;
  if not public._compite(p_reto, p_usuario) then raise exception 'no_participas'; end if;
  if p_horas is null or p_horas < 1 or p_horas > 24 * 7 then raise exception 'condena_invalida'; end if;
  return public._encarcelar(p_usuario, p_horas, p_motivo, v, p_reto);
end $$;
drop function if exists public.admin_encarcelar(text, uuid, int, text);
create or replace function public.admin_encarcelar(p_clave text, p_reto uuid, p_usuario uuid, p_horas int, p_motivo text)
returns public.presos language plpgsql security definer set search_path = public as $$
declare r public.retos;
begin
  perform public._admin_ok(p_clave);
  select * into r from public.retos where id = p_reto;
  if r.id is null then raise exception 'reto_no_existe'; end if;
  if r.estado <> 'activo' then raise exception 'reto_cerrado'; end if;
  if not public._compite(p_reto, p_usuario) then raise exception 'no_participas'; end if;
  if p_horas is null or p_horas < 1 or p_horas > 24 * 30 then raise exception 'condena_invalida'; end if;
  return public._encarcelar(p_usuario, p_horas, p_motivo, null, p_reto);
end $$;
create or replace function public.juez_liberar(p_token uuid, p_preso uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := public._usuario_de(p_token);
begin
  update public.presos set liberado_en = now(), liberado_por = 'juez'
   where id = p_preso and liberado_en is null and por_juez = v;
  if not found then raise exception 'solo_quien_encarcelo'; end if;
end $$;
create or replace function public.admin_liberar(p_clave text, p_preso uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_ok(p_clave);
  update public.presos set liberado_en = now(), liberado_por = 'admin' where id = p_preso and liberado_en is null;
end $$;
create or replace function public.pedir_indulto(p_token uuid, p_preso uuid)
returns public.presos language plpgsql security definer set search_path = public as $$
declare v uuid := public._usuario_de(p_token); x public.presos;
begin
  select * into x from public.presos where id = p_preso for update;
  if x.id is null or x.usuario_id <> v then raise exception 'solo_el_preso'; end if;
  if x.liberado_en is not null or x.hasta <= now() then raise exception 'ya_libre'; end if;
  if x.votacion_inicio is not null then raise exception 'ya_pediste_votacion'; end if;
  update public.presos set votacion_inicio = now(), votacion_fin = least(now() + interval '1 hour', hasta)
   where id = p_preso returning * into x;
  return x;
end $$;
create or replace function public.votar_indulto(p_token uuid, p_preso uuid, p_a_favor boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v uuid := public._usuario_de(p_token); x public.presos; si int; no int;
begin
  select * into x from public.presos where id = p_preso for update;
  if x.id is null then raise exception 'preso_no_existe'; end if;
  if x.liberado_en is not null or x.hasta <= now() then raise exception 'ya_libre'; end if;
  if x.votacion_inicio is null or now() >= x.votacion_fin then raise exception 'votacion_cerrada'; end if;
  if v = x.usuario_id then raise exception 'no_puedes_votarte'; end if;
  if v = x.por_juez then raise exception 'el_juez_no_vota'; end if;
  if p_a_favor is null then raise exception 'voto_invalido'; end if;
  insert into public.votos_presos (preso_id, usuario_id, a_favor) values (p_preso, v, p_a_favor)
  on conflict (preso_id, usuario_id) do update set a_favor = excluded.a_favor, creado_en = now();
  select count(*) filter (where a_favor), count(*) filter (where not a_favor) into si, no
    from public.votos_presos where preso_id = p_preso;
  if si >= 5 then
    update public.presos set liberado_en = now(), liberado_por = 'pueblo' where id = p_preso;
  end if;
  return json_build_object('a_favor', si, 'en_contra', no, 'liberado', si >= 5);
end $$;
create or replace function public.fotos_huerfanas()
returns setof text language sql security definer set search_path = public, storage as $$
  select o.name from storage.objects o
   where o.bucket_id = 'retos-fotos'
     and not exists (select 1 from public.fotos f where f.ruta = o.name);
$$;
revoke all on function public.fotos_huerfanas() from public, anon, authenticated;
grant execute on function public.fotos_huerfanas() to service_role;
create or replace function public.admin_almacenamiento(p_clave text)
returns json language plpgsql security definer set search_path = public, storage as $$
declare r json;
begin
  perform public._admin_ok(p_clave);
  select json_build_object(
    'archivos', count(*),
    'bytes', coalesce(sum((o.metadata->>'size')::bigint), 0),
    'huerfanos', count(*) filter (where f.id is null),
    'bytes_huerfanos', coalesce(sum((o.metadata->>'size')::bigint) filter (where f.id is null), 0))
  into r
  from storage.objects o left join public.fotos f on f.ruta = o.name
  where o.bucket_id = 'retos-fotos';
  return r;
end $$;
create or replace function public.admin_eliminar_campeonato(p_clave text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_ok(p_clave);
  delete from public.campeonatos where id = p_id;
end $$;
grant execute on function
  public.registrar_usuario(text, text, text, text),
  public.iniciar_sesion(text, text),
  public.cerrar_sesion(uuid),
  public.yo(uuid),
  public.editar_perfil(uuid, text, text),
  public.cambiar_clave(uuid, text, text),
  public.revisar_retos(),
  public.crear_reto(uuid, text, text, int, int, uuid, boolean, uuid[]),
  public.registrar_foto(uuid, uuid, text),
  public.votar_foto(uuid, uuid, text, text),
  public.juez_aceptar_foto(uuid, uuid),
  public.juez_eliminar_foto(uuid, uuid),
  public.admin_entrar(text),
  public.admin_cambiar_clave(text, text),
  public.admin_eliminar_usuario(text, uuid),
  public.admin_restablecer_clave(text, uuid, text),
  public.admin_eliminar_reto(text, uuid),
  public.admin_guardar_campeonato(text, uuid, text, uuid[]),
  public.admin_eliminar_campeonato(text, uuid),
  public.reglas_juego(),
  public.admin_guardar_reglas(text, int, int, text),
  public.admin_almacenamiento(text),
  public.juez_encarcelar(uuid, uuid, uuid, int, text),
  public.admin_encarcelar(text, uuid, uuid, int, text),
  public.pedir_indulto(uuid, uuid),
  public.votar_indulto(uuid, uuid, boolean),
  public.admin_guardar_torneo(text, uuid, text, uuid[], date, date, text, text, text),
  public.admin_eliminar_torneo(text, uuid),
  public.proponer_reto(uuid, uuid, text, text, int, int, uuid),
  public.votar_propuesta(uuid, uuid, boolean),
  public.retirar_propuesta(uuid, uuid),
  public.juez_liberar(uuid, uuid),
  public.admin_liberar(text, uuid)
to anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['usuarios', 'retos', 'fotos', 'puntajes', 'votos', 'participantes', 'campeonatos', 'campeonato_retos', 'presos', 'votos_presos', 'torneos', 'torneo_participantes', 'votos_retos'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('retos-fotos', 'retos-fotos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "subir fotos de retos" on storage.objects;
create policy "subir fotos de retos" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'retos-fotos');
