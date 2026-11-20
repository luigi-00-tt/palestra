-- v29: promemoria con Web Push (decisione di Luigi del 19/11/2026: arrivano anche ad app chiusa,
-- l'utente sceglie quali). Il telefono salva la sua iscrizione push e le scelte; la funzione
-- `promemoria` (ogni 15 minuti, pg_cron + pg_net) manda quelli dovuti con le chiavi VAPID.

create table public.push_iscrizioni (
  endpoint text primary key check (endpoint ~ '^https://' and length(endpoint) < 1000),
  utente_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null check (length(p256dh) between 20 and 200),
  auth text not null check (length(auth) between 8 and 100),
  creato_il timestamptz not null default now()
);
create index push_iscrizioni_utente on public.push_iscrizioni (utente_id);
alter table public.push_iscrizioni enable row level security;
revoke all on public.push_iscrizioni from anon, authenticated;

create table public.promemoria_imp (
  utente_id uuid primary key references auth.users (id) on delete cascade,
  imp jsonb not null check (jsonb_typeof(imp) = 'object' and octet_length(imp::text) < 2000),
  fuso text not null default 'Europe/Rome' check (fuso ~ '^[A-Za-z_]+(/[A-Za-z_]+){0,2}$'),
  ultimo jsonb not null default '{}'::jsonb check (jsonb_typeof(ultimo) = 'object'),   -- quando è partito l'ultimo di ogni tipo
  aggiornato_il timestamptz not null default now()
);
alter table public.promemoria_imp enable row level security;
revoke all on public.promemoria_imp from anon, authenticated;

create function public.salva_iscrizione(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'non autenticato'; end if;
  insert into public.push_iscrizioni (endpoint, utente_id, p256dh, auth) values (p_endpoint, (select auth.uid()), p_p256dh, p_auth)
  on conflict (endpoint) do update set utente_id = excluded.utente_id, p256dh = excluded.p256dh, auth = excluded.auth;
  -- al massimo 5 dispositivi per persona: i più vecchi escono
  delete from public.push_iscrizioni where utente_id = (select auth.uid()) and endpoint not in
    (select endpoint from public.push_iscrizioni where utente_id = (select auth.uid()) order by creato_il desc limit 5);
end $$;
revoke execute on function public.salva_iscrizione(text, text, text) from public, anon;
grant execute on function public.salva_iscrizione(text, text, text) to authenticated;

create function public.salva_promemoria(p_imp jsonb, p_fuso text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'non autenticato'; end if;
  insert into public.promemoria_imp (utente_id, imp, fuso) values ((select auth.uid()), p_imp, coalesce(p_fuso, 'Europe/Rome'))
  on conflict (utente_id) do update set imp = excluded.imp, fuso = excluded.fuso, aggiornato_il = now();
end $$;
revoke execute on function public.salva_promemoria(jsonb, text) from public, anon;
grant execute on function public.salva_promemoria(jsonb, text) to authenticated;

-- ogni 15 minuti: l'indirizzo e il segreto stanno nel vault (si mettono una volta, fuori da git:
--   select vault.create_secret('https://<progetto>.supabase.co/functions/v1/promemoria', 'promemoria_url');
--   select vault.create_secret('<segreto lungo>', 'promemoria_segreto');   -- uguale al segreto PROMEMORIA_SEGRETO della funzione)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('promemoria', '*/15 * * * *', $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'promemoria_url'),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-segreto', (select decrypted_secret from vault.decrypted_secrets where name = 'promemoria_segreto')),
    body := '{}'::jsonb, timeout_milliseconds := 25000)
  where exists (select 1 from vault.decrypted_secrets where name = 'promemoria_url')
$cron$);
