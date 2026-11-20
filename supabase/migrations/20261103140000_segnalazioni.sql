-- v28 (R30-R31): segnalazioni private degli utenti con account (idee e problemi).
-- Non c'è un forum: ognuno vede solo le proprie; chi gestisce l'app le legge dalla
-- dashboard di Supabase e ne cambia lo stato da lì (il telefono non può).

create table public.segnalazioni (
  id bigint generated always as identity primary key,
  utente uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo text not null check (tipo in ('idea', 'problema')),
  testo text not null check (length(btrim(testo)) between 5 and 2000),
  build text check (build is null or build ~ '^[a-z0-9]{1,20}$'),
  pagina text check (pagina is null or pagina ~ '^[a-z-]{1,30}$'),
  stato text not null default 'nuova' check (stato in ('nuova', 'letta', 'fatta', 'scartata')),
  creata_il timestamptz not null default now()
);

alter table public.segnalazioni enable row level security;
revoke all on public.segnalazioni from anon, authenticated;
-- dal telefono si scrivono solo questi quattro campi: utente, stato e data li decide il server
grant select on public.segnalazioni to authenticated;
grant insert (tipo, testo, build, pagina) on public.segnalazioni to authenticated;

create policy "segnalazioni: lettura delle proprie"
  on public.segnalazioni for select to authenticated
  using ((select auth.uid()) = utente);
create policy "segnalazioni: inserimento delle proprie"
  on public.segnalazioni for insert to authenticated
  with check ((select auth.uid()) = utente);

-- Al massimo 20 segnalazioni al giorno a testa: un telefono impazzito o un abuso
-- non riempiono la tabella.
create function public.limita_segnalazioni() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.segnalazioni
      where utente = new.utente and creata_il > now() - interval '1 day') >= 20 then
    raise exception 'troppe segnalazioni oggi: riprova domani';
  end if;
  return new;
end $$;
revoke execute on function public.limita_segnalazioni() from public, anon, authenticated;

create trigger segnalazioni_limite
  before insert on public.segnalazioni
  for each row execute function public.limita_segnalazioni();

create index segnalazioni_utente_data on public.segnalazioni (utente, creata_il);
