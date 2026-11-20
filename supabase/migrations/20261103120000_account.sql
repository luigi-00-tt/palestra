-- v27: account utente e copia dei dati dell'app nel cloud.
-- Ogni utente vede e scrive solo la propria riga (RLS). Le password le gestisce
-- Supabase Auth (auth.users): qui non passano mai.

-- ---------------------------------------------------------------- profili
create table public.profili (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,30}$'),
  creato_il timestamptz not null default now(),
  consenso_salute_il timestamptz not null,   -- consenso esplicito, art. 9.2.a GDPR
  consenso_versione text not null check (length(consenso_versione) between 1 and 20)
);

alter table public.profili enable row level security;
revoke all on public.profili from anon, authenticated;
grant select on public.profili to authenticated;

create policy "profilo: solo il proprio, in lettura"
  on public.profili for select to authenticated
  using ((select auth.uid()) = id);

-- ------------------------------------------------------------ dati_utente
create table public.dati_utente (
  id uuid primary key references auth.users (id) on delete cascade,
  dati jsonb not null
    check (jsonb_typeof(dati) = 'object' and octet_length(dati::text) < 5000000),
  aggiornato_il timestamptz not null default now()
);

alter table public.dati_utente enable row level security;
revoke all on public.dati_utente from anon, authenticated;
grant select, insert, update on public.dati_utente to authenticated;

create policy "dati: lettura dei propri"
  on public.dati_utente for select to authenticated
  using ((select auth.uid()) = id);
create policy "dati: inserimento dei propri"
  on public.dati_utente for insert to authenticated
  with check ((select auth.uid()) = id);
create policy "dati: modifica dei propri"
  on public.dati_utente for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- L'ora dell'ultimo aggiornamento la decide il server, non il telefono.
create function public.timbra_aggiornamento() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.aggiornato_il := now();
  return new;
end $$;
revoke execute on function public.timbra_aggiornamento() from public, anon, authenticated;

create trigger dati_utente_timbro
  before insert or update on public.dati_utente
  for each row execute function public.timbra_aggiornamento();

-- ------------------------------------------------- registrazione -> profilo
-- Il profilo nasce dentro la stessa transazione della registrazione: se lo
-- username non è valido o manca il consenso, la registrazione stessa fallisce.
create function public.crea_profilo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  nome text := lower(m ->> 'username');
begin
  if nome is null or nome !~ '^[a-z0-9_.]{3,30}$' then
    raise exception 'username non valido';
  end if;
  if split_part(lower(new.email), '@', 1) <> nome then
    raise exception 'email e username non coincidono';
  end if;
  if (m ->> 'consenso_salute') is distinct from 'true'
     or (m ->> 'almeno_14_anni') is distinct from 'true' then
    raise exception 'manca il consenso o la conferma dell''età';
  end if;
  insert into public.profili (id, username, consenso_salute_il, consenso_versione)
  values (new.id, nome, now(), coalesce(m ->> 'consenso_versione', '?'));
  return new;
end $$;
revoke execute on function public.crea_profilo() from public, anon, authenticated;

create trigger auth_utente_crea_profilo
  after insert on auth.users
  for each row execute function public.crea_profilo();

-- ------------------------------------------------------ elimina l'account
-- Cancella l'utente da auth.users; profilo e dati spariscono in cascata.
create function public.elimina_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'non autenticato';
  end if;
  delete from auth.users where id = (select auth.uid());
end $$;
revoke execute on function public.elimina_account() from public, anon;
grant execute on function public.elimina_account() to authenticated;
