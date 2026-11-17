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
alter table public.denuncias enable row level security;
revoke all on public.denuncias from anon, authenticated;
