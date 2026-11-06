-- =====================================================================
--  Retos en familia — base de datos (Supabase / PostgreSQL)
--
--  Cómo usarlo: en tu proyecto de Supabase abre "SQL Editor", pega todo
--  este archivo y pulsa "Run". Se puede ejecutar más de una vez.
--
--  Modelo:
--    familias  -> grupo con un código para unirse (ej. "K7M2QD")
--    jugadores -> miembros de una familia (nombre + avatar; es_admin = administrador)
--    admin_pins -> PIN cifrado de cada administrador (no se puede leer desde la app)
--    retos     -> "el primero que encuentre 10 perros negros"
--    fotos     -> cada foto que sube un jugador durante un reto
--    puntajes  -> puntos que dejó cada reto al cerrarse (1º 3, 2º 2, 3º 1)
--
--  Las tablas solo se leen desde la app; todas las escrituras pasan por
--  funciones (RPC) que validan las reglas y cierran el reto de forma
--  atómica, así dos personas no pueden "ganar" al mismo tiempo.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tablas
create table if not exists public.familias (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null check (char_length(nombre) between 1 and 40),
  codigo    text not null unique,
  creado_en timestamptz not null default now()
);

create table if not exists public.jugadores (
  id         uuid primary key default gen_random_uuid(),
  familia_id uuid not null references public.familias(id) on delete cascade,
  nombre     text not null check (char_length(nombre) between 1 and 30),
  avatar     text not null default '🙂' check (char_length(avatar) <= 16),
  es_admin   boolean not null default false,
  creado_en  timestamptz not null default now()
);
alter table public.jugadores add column if not exists es_admin boolean not null default false;
create index if not exists jugadores_familia_idx on public.jugadores(familia_id);

-- PIN de cada administrador (cifrado). Tabla sin acceso desde la app: solo la usan las funciones.
create table if not exists public.admin_pins (
  jugador_id uuid primary key references public.jugadores(id) on delete cascade,
  pin_hash   text not null
);
alter table public.admin_pins enable row level security;
revoke all on public.admin_pins from anon, authenticated;

create table if not exists public.retos (
  id          uuid primary key default gen_random_uuid(),
  familia_id  uuid not null references public.familias(id) on delete cascade,
  creado_por  uuid references public.jugadores(id) on delete set null,
  que_buscar  text not null check (char_length(que_buscar) between 1 and 60),
  emoji       text not null default '🔎' check (char_length(emoji) <= 16),
  meta        int  not null check (meta between 1 and 100),
  inicia_en   timestamptz not null default now(),
  termina_en  timestamptz not null,
  estado      text not null default 'activo'
              check (estado in ('activo', 'terminado', 'cancelado')),
  motivo      text check (motivo in ('meta', 'tiempo', 'cancelado')),
  ganador_id  uuid references public.jugadores(id) on delete set null,
  cerrado_en  timestamptz,
  check (termina_en > inicia_en)
);
create index if not exists retos_familia_idx on public.retos(familia_id, inicia_en desc);
-- Solo un reto activo por familia a la vez
create unique index if not exists retos_un_activo
  on public.retos(familia_id) where estado = 'activo';

create table if not exists public.fotos (
  id         uuid primary key default gen_random_uuid(),
  reto_id    uuid not null references public.retos(id) on delete cascade,
  familia_id uuid not null references public.familias(id) on delete cascade,
  jugador_id uuid not null references public.jugadores(id) on delete cascade,
  ruta       text not null,
  creado_en  timestamptz not null default now()
);
create index if not exists fotos_reto_idx on public.fotos(reto_id, jugador_id);
create index if not exists fotos_familia_idx on public.fotos(familia_id);

create table if not exists public.puntajes (
  reto_id    uuid not null references public.retos(id) on delete cascade,
  familia_id uuid not null references public.familias(id) on delete cascade,
  jugador_id uuid not null references public.jugadores(id) on delete cascade,
  puesto     int  not null,
  fotos      int  not null,
  puntos     int  not null,
  primary key (reto_id, jugador_id)
);
create index if not exists puntajes_familia_idx on public.puntajes(familia_id);

-- -------------------------------------------- seguridad: solo lectura
alter table public.familias  enable row level security;
alter table public.jugadores enable row level security;
alter table public.retos     enable row level security;
alter table public.fotos     enable row level security;
alter table public.puntajes  enable row level security;

drop policy if exists "leer familias"  on public.familias;
drop policy if exists "leer jugadores" on public.jugadores;
drop policy if exists "leer retos"     on public.retos;
drop policy if exists "leer fotos"     on public.fotos;
drop policy if exists "leer puntajes"  on public.puntajes;
create policy "leer familias"  on public.familias  for select to anon, authenticated using (true);
create policy "leer jugadores" on public.jugadores for select to anon, authenticated using (true);
create policy "leer retos"     on public.retos     for select to anon, authenticated using (true);
create policy "leer fotos"     on public.fotos     for select to anon, authenticated using (true);
create policy "leer puntajes"  on public.puntajes  for select to anon, authenticated using (true);

grant select on public.familias, public.jugadores, public.retos, public.fotos, public.puntajes
  to anon, authenticated;
revoke insert, update, delete on public.familias, public.jugadores, public.retos,
  public.fotos, public.puntajes from anon, authenticated;

-- ------------------------------------------------------------ funciones

-- Cierra un reto y reparte puntos. Uso interno (no se expone a la app).
-- Puestos por número de fotos; en empate gana quien llegó antes a su última foto.
create or replace function public._cerrar_reto(p_reto uuid, p_motivo text, p_ganador uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.retos;
  v_ganador uuid := p_ganador;
begin
  select * into r from public.retos where id = p_reto for update;
  if r.estado <> 'activo' then return; end if;

  if p_motivo = 'cancelado' then
    update public.retos set estado = 'cancelado', motivo = 'cancelado', cerrado_en = now()
     where id = p_reto;
    return;
  end if;

  insert into public.puntajes (reto_id, familia_id, jugador_id, puesto, fotos, puntos)
  select p_reto, r.familia_id, jugador_id, puesto, n,
         case puesto when 1 then 3 when 2 then 2 when 3 then 1 else 0 end
    from (
      select jugador_id, count(*)::int as n,
             row_number() over (
               order by (jugador_id = p_ganador) desc, count(*) desc, max(creado_en) asc
             )::int as puesto
        from public.fotos
       where reto_id = p_reto
       group by jugador_id
    ) t;

  if v_ganador is null then
    select jugador_id into v_ganador from public.puntajes where reto_id = p_reto and puesto = 1;
  end if;

  update public.retos
     set estado = 'terminado', motivo = p_motivo, ganador_id = v_ganador, cerrado_en = now()
   where id = p_reto;
end $$;
revoke all on function public._cerrar_reto(uuid, text, uuid) from public, anon, authenticated;

-- Si el reto activo de la familia ya pasó su hora, ciérralo por tiempo.
create or replace function public.revisar_retos(p_familia uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  for v in select id from public.retos
            where familia_id = p_familia and estado = 'activo' and termina_en <= now()
  loop
    perform public._cerrar_reto(v, 'tiempo', null);
  end loop;
end $$;

-- Crea una familia con un código de 6 letras/números fácil de dictar.
create or replace function public.crear_familia(p_nombre text)
returns public.familias language plpgsql security definer set search_path = public as $$
declare
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_codigo text;
  f public.familias;
begin
  loop
    v_codigo := '';
    for i in 1..6 loop
      v_codigo := v_codigo || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
    end loop;
    exit when not exists (select 1 from public.familias where codigo = v_codigo);
  end loop;
  insert into public.familias (nombre, codigo) values (trim(p_nombre), v_codigo) returning * into f;
  return f;
end $$;

create or replace function public.buscar_familia(p_codigo text)
returns public.familias language sql security definer set search_path = public as $$
  select * from public.familias where codigo = upper(trim(p_codigo));
$$;

create or replace function public.unirse_familia(p_familia uuid, p_nombre text, p_avatar text)
returns public.jugadores language plpgsql security definer set search_path = public as $$
declare j public.jugadores;
begin
  insert into public.jugadores (familia_id, nombre, avatar, es_admin)
  values (p_familia, trim(p_nombre), coalesce(nullif(p_avatar, ''), '🙂'),
          not exists (select 1 from public.jugadores where familia_id = p_familia and es_admin))
  returning * into j;
  return j;
end $$;

create or replace function public.editar_jugador(p_jugador uuid, p_nombre text, p_avatar text)
returns public.jugadores language plpgsql security definer set search_path = public as $$
declare j public.jugadores;
begin
  update public.jugadores set nombre = trim(p_nombre), avatar = coalesce(nullif(p_avatar, ''), avatar)
   where id = p_jugador returning * into j;
  if j.id is null then raise exception 'jugador_no_existe'; end if;
  return j;
end $$;

-- Lanza un reto para toda la familia.
create or replace function public.crear_reto(
  p_jugador uuid, p_que text, p_emoji text, p_meta int, p_minutos int)
returns public.retos language plpgsql security definer set search_path = public as $$
declare
  v_familia uuid;
  r public.retos;
begin
  select familia_id into v_familia from public.jugadores where id = p_jugador;
  if v_familia is null then raise exception 'jugador_no_existe'; end if;
  if p_minutos is null or p_minutos < 1 or p_minutos > 60 * 24 * 30 then
    raise exception 'duracion_invalida';
  end if;

  perform public.revisar_retos(v_familia);
  if exists (select 1 from public.retos where familia_id = v_familia and estado = 'activo') then
    raise exception 'ya_hay_reto_activo';
  end if;

  insert into public.retos (familia_id, creado_por, que_buscar, emoji, meta, termina_en)
  values (v_familia, p_jugador, trim(p_que), coalesce(nullif(p_emoji, ''), '🔎'), p_meta,
          now() + make_interval(mins => p_minutos))
  returning * into r;
  return r;
end $$;

-- Registra una foto. Si con ella el jugador llega a la meta, gana y cierra el reto.
create or replace function public.registrar_foto(p_reto uuid, p_jugador uuid, p_ruta text)
returns json language plpgsql security definer set search_path = public as $$
declare
  r public.retos;
  v_familia uuid;
  v_n int;
begin
  select * into r from public.retos where id = p_reto for update;  -- serializa a los jugadores
  if r.id is null then raise exception 'reto_no_existe'; end if;
  select familia_id into v_familia from public.jugadores where id = p_jugador;
  if v_familia is distinct from r.familia_id then raise exception 'jugador_no_es_de_la_familia'; end if;

  if r.estado = 'activo' and r.termina_en <= now() then
    perform public._cerrar_reto(p_reto, 'tiempo', null);
    raise exception 'reto_cerrado';
  end if;
  if r.estado <> 'activo' then raise exception 'reto_cerrado'; end if;

  insert into public.fotos (reto_id, familia_id, jugador_id, ruta)
  values (p_reto, r.familia_id, p_jugador, p_ruta);

  select count(*) into v_n from public.fotos where reto_id = p_reto and jugador_id = p_jugador;
  if v_n >= r.meta then
    perform public._cerrar_reto(p_reto, 'meta', p_jugador);
    return json_build_object('fotos', v_n, 'ganaste', true);
  end if;
  return json_build_object('fotos', v_n, 'ganaste', false);
end $$;

-- Borrar una foto que no aplica (la propia o la de otro) mientras el reto sigue activo.
-- Puede hacerlo cualquier jugador de la misma familia.
create or replace function public.borrar_foto(p_foto uuid, p_jugador uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.fotos f join public.jugadores j on j.familia_id = f.familia_id
     where f.id = p_foto and j.id = p_jugador
  ) then
    raise exception 'jugador_no_es_de_la_familia';
  end if;
  delete from public.fotos f
   using public.retos r
   where f.id = p_foto and r.id = f.reto_id and r.estado = 'activo';
end $$;

-- Quien creó el reto puede cancelarlo (no reparte puntos).
create or replace function public.cancelar_reto(p_reto uuid, p_jugador uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.retos where id = p_reto and creado_por = p_jugador) then
    raise exception 'solo_quien_creo_el_reto';
  end if;
  perform public._cerrar_reto(p_reto, 'cancelado', null);
end $$;


-- ------------------------------------------------- administrador
-- Comprueba que p_admin es administrador de su familia y que el PIN es correcto.
create or replace function public._admin_ok(p_admin uuid, p_pin text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_familia uuid; v_hash text;
begin
  select j.familia_id, a.pin_hash into v_familia, v_hash
    from public.jugadores j left join public.admin_pins a on a.jugador_id = j.id
   where j.id = p_admin and j.es_admin;
  if v_familia is null then raise exception 'no_eres_admin'; end if;
  if v_hash is null then raise exception 'pin_sin_definir'; end if;
  if v_hash <> crypt(coalesce(p_pin, ''), v_hash) then raise exception 'pin_incorrecto'; end if;
  return v_familia;
end $$;
revoke all on function public._admin_ok(uuid, text) from public, anon, authenticated;

-- ¿Tiene PIN este administrador? (para saber si hay que crearlo)
create or replace function public.admin_tiene_pin(p_admin uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.admin_pins a join public.jugadores j on j.id = a.jugador_id
                  where a.jugador_id = p_admin and j.es_admin);
$$;

-- Crear o cambiar el PIN (para cambiarlo hace falta el actual).
create or replace function public.admin_definir_pin(p_admin uuid, p_pin_actual text, p_pin_nuevo text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.jugadores where id = p_admin and es_admin) then
    raise exception 'no_eres_admin';
  end if;
  if p_pin_nuevo !~ '^[0-9]{4,8}$' then raise exception 'pin_invalido'; end if;
  if exists (select 1 from public.admin_pins where jugador_id = p_admin) then
    perform public._admin_ok(p_admin, p_pin_actual);
  end if;
  insert into public.admin_pins (jugador_id, pin_hash) values (p_admin, crypt(p_pin_nuevo, gen_salt('bf')))
  on conflict (jugador_id) do update set pin_hash = excluded.pin_hash;
end $$;

-- Entrar al modo administrador (solo valida el PIN).
create or replace function public.admin_entrar(p_admin uuid, p_pin text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_ok(p_admin, p_pin);
  return true;
end $$;

-- Cancelar cualquier reto activo de la familia (no reparte puntos).
create or replace function public.admin_cancelar_reto(p_admin uuid, p_pin text, p_reto uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_familia uuid;
begin
  v_familia := public._admin_ok(p_admin, p_pin);
  if not exists (select 1 from public.retos where id = p_reto and familia_id = v_familia) then
    raise exception 'reto_no_existe';
  end if;
  perform public._cerrar_reto(p_reto, 'cancelado', null);
end $$;

-- Eliminar un reto por completo (activo o pasado), con sus fotos y sus puntos.
create or replace function public.admin_eliminar_reto(p_admin uuid, p_pin text, p_reto uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_familia uuid;
begin
  v_familia := public._admin_ok(p_admin, p_pin);
  delete from public.retos where id = p_reto and familia_id = v_familia;
  if not found then raise exception 'reto_no_existe'; end if;
end $$;

-- Dar o quitar el papel de administrador a otro jugador de la familia.
create or replace function public.admin_cambiar_rol(p_admin uuid, p_pin text, p_jugador uuid, p_es_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_familia uuid;
begin
  v_familia := public._admin_ok(p_admin, p_pin);
  if not exists (select 1 from public.jugadores where id = p_jugador and familia_id = v_familia) then
    raise exception 'jugador_no_es_de_la_familia';
  end if;
  if not p_es_admin and (select count(*) from public.jugadores where familia_id = v_familia and es_admin) <= 1 then
    raise exception 'ultimo_admin';
  end if;
  update public.jugadores set es_admin = p_es_admin where id = p_jugador;
  if not p_es_admin then delete from public.admin_pins where jugador_id = p_jugador; end if;
end $$;

grant execute on function
  public.revisar_retos(uuid),
  public.admin_tiene_pin(uuid),
  public.admin_definir_pin(uuid, text, text),
  public.admin_entrar(uuid, text),
  public.admin_cancelar_reto(uuid, text, uuid),
  public.admin_eliminar_reto(uuid, text, uuid),
  public.admin_cambiar_rol(uuid, text, uuid, boolean),
  public.crear_familia(text),
  public.buscar_familia(text),
  public.unirse_familia(uuid, text, text),
  public.editar_jugador(uuid, text, text),
  public.crear_reto(uuid, text, text, int, int),
  public.registrar_foto(uuid, uuid, text),
  public.borrar_foto(uuid, uuid),
  public.cancelar_reto(uuid, uuid)
to anon, authenticated;

-- ----------------------------------------------------- tiempo real
do $$
declare t text;
begin
  foreach t in array array['familias', 'jugadores', 'retos', 'fotos', 'puntajes'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ------------------------------------------- almacenamiento de fotos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('retos-fotos', 'retos-fotos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "subir fotos de retos" on storage.objects;
create policy "subir fotos de retos" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'retos-fotos');
