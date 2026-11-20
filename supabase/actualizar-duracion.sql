create or replace function public._cambiar_duracion(p_reto uuid, p_minutos int, p_en_marcha boolean)
returns public.retos language plpgsql security definer set search_path = public as $$
declare r public.retos;
begin
  select * into r from public.retos where id = p_reto for update;
  if r.id is null or r.torneo_id is null then raise exception 'reto_no_existe'; end if;
  if p_minutos is null or p_minutos < 1 or p_minutos > 60 * 24 * 30 then raise exception 'duracion_invalida'; end if;
  if not (r.estado in ('propuesto', 'programado') or (p_en_marcha and r.estado = 'activo')) then raise exception 'no_editable'; end if;
  if r.estado = 'activo' and r.inicia_en + make_interval(mins => p_minutos) <= now() + interval '1 minute' then raise exception 'duracion_ya_pasada'; end if;
  update public.retos set duracion_min = p_minutos, termina_en = inicia_en + make_interval(mins => p_minutos)
   where id = p_reto returning * into r;
  return r;
end $$;
revoke all on function public._cambiar_duracion(uuid, int, boolean) from public, anon, authenticated;
create or replace function public.cambiar_duracion(p_token uuid, p_reto uuid, p_minutos int)
returns public.retos language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.retos where id = p_reto and creado_por = public._usuario_de(p_token)) then raise exception 'no_eres_creador'; end if;
  return public._cambiar_duracion(p_reto, p_minutos, false);
end $$;
create or replace function public.admin_cambiar_duracion(p_clave text, p_reto uuid, p_minutos int)
returns public.retos language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_ok(p_clave);
  return public._cambiar_duracion(p_reto, p_minutos, true);
end $$;
grant execute on function public.cambiar_duracion(uuid, uuid, int), public.admin_cambiar_duracion(text, uuid, int) to anon, authenticated;
