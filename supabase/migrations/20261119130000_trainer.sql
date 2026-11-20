-- v29: trainer e amministratore (decisioni di Luigi del 19/11/2026).
-- * Ogni account nasce «cliente». Solo l'amministratore rende trainer un account: il ruolo non si scrive
--   da telefono (profili non ha permessi di modifica), solo con imposta_ruolo(), che controlla l'admin.
-- * Il trainer ha un codice invito (7 giorni); il cliente lo inserisce e resta collegato a un solo trainer.
-- * Il cliente sceglie voce per voce cosa vede il trainer: carichi, peso, diario, dolori. Tutto spento all'inizio.
-- * Il trainer manda la scheda al cliente (schede_trainer); il cliente la legge e la usa.
-- Le tabelle nuove non hanno permessi diretti: si passa solo dalle funzioni qui sotto.

-- ------------------------------------------------------------------ ruolo
alter table public.profili
  add column ruolo text not null default 'cliente' check (ruolo in ('cliente', 'trainer', 'admin'));

-- --------------------------------------------------------- codici invito
create table public.codici_trainer (
  trainer_id uuid primary key references public.profili (id) on delete cascade,
  codice text not null unique check (codice ~ '^PT-[0-9A-Z]{6}$'),
  scade_il timestamptz not null
);
alter table public.codici_trainer enable row level security;
revoke all on public.codici_trainer from anon, authenticated;

-- ------------------------------------------------- trainer e loro clienti
create table public.trainer_clienti (
  cliente_id uuid primary key references public.profili (id) on delete cascade,
  trainer_id uuid not null references public.profili (id) on delete cascade check (trainer_id <> cliente_id),
  dal timestamptz not null default now(),
  vede_carichi boolean not null default false,
  vede_peso boolean not null default false,
  vede_diario boolean not null default false,
  vede_dolori boolean not null default false
);
create index trainer_clienti_trainer on public.trainer_clienti (trainer_id);
alter table public.trainer_clienti enable row level security;
revoke all on public.trainer_clienti from anon, authenticated;

-- ------------------------------------------- la scheda mandata dal trainer
create table public.schede_trainer (
  cliente_id uuid primary key references public.trainer_clienti (cliente_id) on delete cascade,
  trainer_id uuid not null references public.profili (id) on delete cascade,
  scheda jsonb not null check (jsonb_typeof(scheda) = 'object' and octet_length(scheda::text) < 500000),
  aggiornata_il timestamptz not null default now()
);
alter table public.schede_trainer enable row level security;
revoke all on public.schede_trainer from anon, authenticated;

-- ---------------------------------------------------------------- aiuti
create function public.ruolo_di(u uuid) returns text
language sql stable security definer set search_path = '' as $$
  select ruolo from public.profili where id = u
$$;
revoke execute on function public.ruolo_di(uuid) from public, anon, authenticated;

-- il proprio ruolo: l'app mostra «Modalità trainer» e «Amministrazione» solo a chi li ha
create function public.mio_ruolo() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(public.ruolo_di((select auth.uid())), 'cliente')
$$;
revoke execute on function public.mio_ruolo() from public, anon;
grant execute on function public.mio_ruolo() to authenticated;

-- ------------------------------------------------------------- cliente
create function public.collega_trainer(p_codice text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  io uuid := (select auth.uid());
  t uuid;
begin
  if io is null then raise exception 'non autenticato'; end if;
  if p_codice is null or upper(p_codice) !~ '^PT-[0-9A-Z]{6}$' then raise exception 'codice del trainer non valido'; end if;
  select trainer_id into t from public.codici_trainer where codice = upper(p_codice) and scade_il > now();
  if t is null then raise exception 'codice del trainer sbagliato o scaduto: chiedine uno nuovo'; end if;
  if t = io then raise exception 'questo è il tuo codice: un cliente non può essere il proprio trainer'; end if;
  if public.ruolo_di(t) not in ('trainer', 'admin') then raise exception 'questo account non è più trainer'; end if;
  insert into public.trainer_clienti (cliente_id, trainer_id) values (io, t)
  on conflict (cliente_id) do update set trainer_id = excluded.trainer_id, dal = now(),
    vede_carichi = false, vede_peso = false, vede_diario = false, vede_dolori = false;
  return jsonb_build_object('username', (select username from public.profili where id = t));
end $$;
revoke execute on function public.collega_trainer(text) from public, anon;
grant execute on function public.collega_trainer(text) to authenticated;

create function public.mio_trainer()
returns table (username text, dal timestamptz, vede_carichi boolean, vede_peso boolean, vede_diario boolean, vede_dolori boolean)
language sql stable security definer set search_path = '' as $$
  select p.username, c.dal, c.vede_carichi, c.vede_peso, c.vede_diario, c.vede_dolori
  from public.trainer_clienti c join public.profili p on p.id = c.trainer_id
  where c.cliente_id = (select auth.uid())
$$;
revoke execute on function public.mio_trainer() from public, anon;
grant execute on function public.mio_trainer() to authenticated;

create function public.imposta_consensi(p_vede_carichi boolean, p_vede_peso boolean, p_vede_diario boolean, p_vede_dolori boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'non autenticato'; end if;
  update public.trainer_clienti set vede_carichi = coalesce(p_vede_carichi, false), vede_peso = coalesce(p_vede_peso, false),
    vede_diario = coalesce(p_vede_diario, false), vede_dolori = coalesce(p_vede_dolori, false)
  where cliente_id = (select auth.uid());
end $$;
revoke execute on function public.imposta_consensi(boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.imposta_consensi(boolean, boolean, boolean, boolean) to authenticated;

create function public.scollega_trainer() returns void
language sql security definer set search_path = '' as $$
  delete from public.trainer_clienti where cliente_id = (select auth.uid())
$$;
revoke execute on function public.scollega_trainer() from public, anon;
grant execute on function public.scollega_trainer() to authenticated;

create function public.scheda_dal_trainer() returns table (scheda jsonb, aggiornata_il timestamptz, trainer text)
language sql stable security definer set search_path = '' as $$
  select s.scheda, s.aggiornata_il, p.username
  from public.schede_trainer s join public.trainer_clienti c on c.cliente_id = s.cliente_id and c.trainer_id = s.trainer_id
  join public.profili p on p.id = s.trainer_id
  where s.cliente_id = (select auth.uid())
$$;
revoke execute on function public.scheda_dal_trainer() from public, anon;
grant execute on function public.scheda_dal_trainer() to authenticated;

-- ------------------------------------------------------------- trainer
create function public.genera_codice_trainer() returns text
language plpgsql security definer set search_path = '' as $$
declare
  io uuid := (select auth.uid());
  c text;
begin
  if public.ruolo_di(io) not in ('trainer', 'admin') then raise exception 'solo un trainer ha il codice invito'; end if;
  loop
    c := 'PT-' || upper(substr(translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=OIl01', ''), 1, 6));
    exit when c ~ '^PT-[0-9A-Z]{6}$' and not exists (select 1 from public.codici_trainer where codice = c);
  end loop;
  insert into public.codici_trainer (trainer_id, codice, scade_il) values (io, c, now() + interval '7 days')
  on conflict (trainer_id) do update set codice = excluded.codice, scade_il = excluded.scade_il;
  return c;
end $$;
revoke execute on function public.genera_codice_trainer() from public, anon;
grant execute on function public.genera_codice_trainer() to authenticated;

create function public.miei_clienti()
returns table (cliente_id uuid, username text, dal timestamptz, vede_carichi boolean, vede_peso boolean, vede_diario boolean, vede_dolori boolean, aggiornato_il timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.ruolo_di((select auth.uid())) not in ('trainer', 'admin') then raise exception 'solo per i trainer'; end if;
  return query
    select c.cliente_id, p.username, c.dal, c.vede_carichi, c.vede_peso, c.vede_diario, c.vede_dolori, d.aggiornato_il
    from public.trainer_clienti c join public.profili p on p.id = c.cliente_id
    left join public.dati_utente d on d.id = c.cliente_id
    where c.trainer_id = (select auth.uid())
    order by p.username;
end $$;
revoke execute on function public.miei_clienti() from public, anon;
grant execute on function public.miei_clienti() to authenticated;

-- I dati di un cliente: solo le parti che il cliente ha acceso. La scheda in uso sempre (la segue il trainer).
create function public.dati_cliente(p_cliente uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.trainer_clienti;
  d jsonb;
  s jsonb;
  out jsonb;
begin
  select * into c from public.trainer_clienti where cliente_id = p_cliente and trainer_id = (select auth.uid());
  if c.cliente_id is null then raise exception 'questo cliente non è collegato a te'; end if;
  select dati, scheda into d, s from public.dati_utente where id = p_cliente;
  d := coalesce(d, '{}'::jsonb);
  out := jsonb_build_object('scheda', s, 'questionario', d -> 'questionario');
  if c.vede_carichi then out := out || jsonb_build_object('log', d -> 'log', 'ultimo', d -> 'ultimo'); end if;
  if c.vede_peso then out := out || jsonb_build_object('pesate', d -> 'profilo' -> 'pesate'); end if;
  if c.vede_diario then out := out || jsonb_build_object('diario', d -> 'diario'); end if;
  if c.vede_dolori then out := out || jsonb_build_object('dolori', d -> 'dolori'); end if;
  return out;
end $$;
revoke execute on function public.dati_cliente(uuid) from public, anon;
grant execute on function public.dati_cliente(uuid) to authenticated;

create function public.invia_scheda(p_cliente uuid, p_scheda jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.trainer_clienti where cliente_id = p_cliente and trainer_id = (select auth.uid())) then
    raise exception 'questo cliente non è collegato a te';
  end if;
  insert into public.schede_trainer (cliente_id, trainer_id, scheda) values (p_cliente, (select auth.uid()), p_scheda)
  on conflict (cliente_id) do update set trainer_id = excluded.trainer_id, scheda = excluded.scheda, aggiornata_il = now();
end $$;
revoke execute on function public.invia_scheda(uuid, jsonb) from public, anon;
grant execute on function public.invia_scheda(uuid, jsonb) to authenticated;

-- ------------------------------------------------------- amministratore
create function public.utenti_admin(p_cerca text default '')
returns table (id uuid, username text, ruolo text, creato_il timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.ruolo_di((select auth.uid())) <> 'admin' then raise exception 'solo per l''amministratore'; end if;
  return query
    select p.id, p.username, p.ruolo, p.creato_il from public.profili p
    where coalesce(p_cerca, '') = '' or p.username like '%' || lower(left(p_cerca, 30)) || '%'
    order by p.ruolo desc, p.username limit 200;
end $$;
revoke execute on function public.utenti_admin(text) from public, anon;
grant execute on function public.utenti_admin(text) to authenticated;

create function public.imposta_ruolo(p_utente uuid, p_ruolo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.ruolo_di((select auth.uid())) <> 'admin' then raise exception 'solo l''amministratore cambia i ruoli'; end if;
  if p_ruolo not in ('cliente', 'trainer') then raise exception 'ruolo non valido'; end if;
  if public.ruolo_di(p_utente) = 'admin' then raise exception 'l''amministratore non si cambia da qui'; end if;
  update public.profili set ruolo = p_ruolo where id = p_utente;
  -- un trainer che torna cliente perde codice e clienti; i clienti tengono la scheda che hanno sul telefono
  if p_ruolo = 'cliente' then
    delete from public.codici_trainer where trainer_id = p_utente;
    delete from public.trainer_clienti where trainer_id = p_utente;
  end if;
end $$;
revoke execute on function public.imposta_ruolo(uuid, text) from public, anon;
grant execute on function public.imposta_ruolo(uuid, text) to authenticated;
