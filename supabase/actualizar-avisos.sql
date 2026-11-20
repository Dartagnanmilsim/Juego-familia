create table if not exists public.push_subs (
  endpoint   text primary key,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  creado_en  timestamptz not null default now()
);
create index if not exists push_subs_usuario_idx on public.push_subs(usuario_id);
create table if not exists public.push_vapid (
  id      int primary key default 1 check (id = 1),
  publica text not null,
  privada text not null
);
create table if not exists public.avisos (
  id         bigserial primary key,
  reto_id    uuid not null references public.retos(id) on delete cascade,
  tipo       text not null check (tipo in ('propuesta', 'pronto', 'empieza', 'termina')),
  enviar_en  timestamptz not null default now(),
  enviado_en timestamptz,
  unique (reto_id, tipo)
);
create index if not exists avisos_pendientes_idx on public.avisos(enviar_en) where enviado_en is null;
alter table public.push_subs  enable row level security;
alter table public.push_vapid enable row level security;
alter table public.avisos     enable row level security;
revoke all on public.push_subs, public.push_vapid, public.avisos from anon, authenticated;
create or replace function public._avisos_reto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'propuesto' and tg_op = 'INSERT' then
    insert into public.avisos (reto_id, tipo) values (new.id, 'propuesta') on conflict do nothing;
  elsif new.estado = 'programado' then
    insert into public.avisos (reto_id, tipo, enviar_en) values (new.id, 'pronto', new.inicia_en - interval '30 minutes')
    on conflict (reto_id, tipo) do update set enviar_en = excluded.enviar_en where public.avisos.enviado_en is null;
  elsif new.estado = 'activo' and (tg_op = 'INSERT' or old.estado <> 'activo') then
    insert into public.avisos (reto_id, tipo) values (new.id, 'empieza') on conflict do nothing;
  elsif new.estado = 'terminado' and tg_op = 'UPDATE' and old.estado = 'activo' then
    insert into public.avisos (reto_id, tipo) values (new.id, 'termina') on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists retos_avisos on public.retos;
create trigger retos_avisos after insert or update of estado, inicia_en on public.retos
  for each row execute function public._avisos_reto();
create or replace function public.push_suscribir(p_token uuid, p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := public._usuario_de(p_token);
begin
  if coalesce(p_endpoint, '') !~ '^https://' or char_length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'suscripcion_invalida'; end if;
  insert into public.push_subs (endpoint, usuario_id, p256dh, auth) values (p_endpoint, v, p_p256dh, p_auth)
  on conflict (endpoint) do update set usuario_id = v, p256dh = excluded.p256dh, auth = excluded.auth, creado_en = now();
end $$;
create or replace function public.push_desuscribir(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subs where endpoint = p_endpoint;
$$;
create or replace function public.push_clave_publica()
returns text language sql stable security definer set search_path = public as $$
  select publica from public.push_vapid where id = 1;
$$;
create or replace function public.push_vapid_leer()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('publica', publica, 'privada', privada) from public.push_vapid where id = 1;
$$;
create or replace function public.push_vapid_guardar(p_publica text, p_privada text)
returns void language sql security definer set search_path = public as $$
  insert into public.push_vapid (id, publica, privada) values (1, p_publica, p_privada) on conflict (id) do nothing;
$$;
create or replace function public.tomar_avisos()
returns setof json language plpgsql security definer set search_path = public as $$
declare
  a record; r public.retos; s record; z text; ids uuid[];
  v_tit text; v_txt text; que text; tnom text; jnom text; dur text;
begin
  select zona_horaria into z from public.admin_config where id = 1;
  z := coalesce(z, 'America/Bogota');
  for a in select * from public.avisos where enviado_en is null and enviar_en <= now() order by id for update skip locked loop
    update public.avisos set enviado_en = now() where id = a.id;
    select * into r from public.retos where id = a.reto_id;
    continue when r.id is null;
    continue when a.tipo = 'propuesta' and r.estado <> 'propuesto';
    continue when a.tipo = 'pronto' and r.estado <> 'programado';
    continue when a.tipo = 'empieza' and r.estado <> 'activo';
    continue when a.enviar_en < now() - interval '2 hours';
    que := r.emoji || ' ' || r.meta || case when r.meta = 1 then ' foto de ' else ' fotos de ' end || r.que_buscar;
    select nombre into tnom from public.torneos where id = r.torneo_id;
    select nombre into jnom from public.usuarios where id = public._juez_de(r.id);
    dur := case when extract(epoch from r.termina_en - r.inicia_en) >= 86400 then round(extract(epoch from r.termina_en - r.inicia_en) / 86400) || ' día(s)'
                when extract(epoch from r.termina_en - r.inicia_en) >= 3600 then round(extract(epoch from r.termina_en - r.inicia_en) / 3600) || ' h'
                else round(extract(epoch from r.termina_en - r.inicia_en) / 60) || ' min' end;
    if a.tipo = 'propuesta' then
      ids := array(select usuario_id from public.torneo_participantes where torneo_id = r.torneo_id and usuario_id <> r.creado_por);
      v_tit := '🗳️ Nuevo reto propuesto';
      v_txt := (select nombre from public.usuarios where id = r.creado_por) || ' propone «' || que || '»'
               || coalesce(' en ' || tnom, '') || '. Necesita 5 votos en 24 h: ¡entra a votar!';
    else
      ids := array(select u.id from public.usuarios u where public._compite(r.id, u.id) or u.id = public._juez_de(r.id));
      if a.tipo = 'pronto' then
        v_tit := '⏰ En 30 minutos empieza un reto';
        v_txt := que || '. Empieza a las ' || to_char(r.inicia_en at time zone z, 'HH24:MI') || ', dura ' || dur || '. Juez: ' || coalesce(jnom, '—') || '.';
      elsif a.tipo = 'empieza' then
        v_tit := '🎯 ¡Empezó el reto!';
        v_txt := que || '. Tienes hasta las ' || to_char(r.termina_en at time zone z, 'HH24:MI')
                 || case when (r.termina_en at time zone z)::date <> (now() at time zone z)::date then ' del ' || to_char(r.termina_en at time zone z, 'DD/MM') else '' end
                 || '. Juez: ' || coalesce(jnom, '—') || '.';
      else
        v_tit := '🏁 Terminó el reto';
        v_txt := que || '. ' || coalesce('¡Ganó ' || (select nombre from public.usuarios where id = r.ganador_id) || '!', 'Nadie consiguió fotos aceptadas.');
      end if;
    end if;
    if tnom is not null then v_tit := v_tit || ' · ' || tnom; end if;
    for s in select * from public.push_subs where usuario_id = any(ids) loop
      return next json_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
        'titulo', v_tit, 'cuerpo', v_txt, 'url', '?reto=' || r.id, 'tag', a.tipo || '-' || r.id);
    end loop;
  end loop;
end $$;
revoke all on function public._avisos_reto(), public.push_vapid_leer(), public.push_vapid_guardar(text, text), public.tomar_avisos()
  from public, anon, authenticated;
grant execute on function public.push_vapid_leer(), public.push_vapid_guardar(text, text), public.tomar_avisos(), public.revisar_retos() to service_role;
grant execute on function public.push_suscribir(uuid, text, text, text), public.push_desuscribir(text), public.push_clave_publica()
  to anon, authenticated;
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.unschedule(jobid) from cron.job where jobname = 'juego-avisos';
    perform cron.schedule('juego-avisos', '* * * * *', $cmd$
      select net.http_post(
        url := 'https://dxabadqcsayfjqhebttr.supabase.co/functions/v1/avisos',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4YWJhZHFjc2F5ZmpxaGVidHRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5MzM0MzAsImV4cCI6MjEwOTUwOTQzMH0.0UfIiSseyWZPOY0eGqiYm6Mjb9S_ZLdgHz7ncT2JtlY'),
        body := '{}'::jsonb)
    $cmd$);
  end if;
end $$;
