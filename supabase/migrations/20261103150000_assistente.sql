-- v28 (R33): quante domande online ha fatto ognuno oggi. Al massimo 20 al giorno.
-- Il telefono non legge né scrive la tabella: passa solo dalla funzione usa_domanda(),
-- chiamata dalla Edge Function `assistente` con il token dell'utente.

create table public.assistente_uso (
  utente uuid not null references auth.users (id) on delete cascade,
  giorno date not null default current_date,
  domande integer not null default 0 check (domande between 0 and 20),
  primary key (utente, giorno)
);

alter table public.assistente_uso enable row level security;
revoke all on public.assistente_uso from anon, authenticated;

-- Conta una domanda e dice quante ne restano; se sono finite, errore.
create function public.usa_domanda() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := (select auth.uid());
  n integer;
begin
  if u is null then
    raise exception 'serve l''account';
  end if;
  insert into public.assistente_uso as a (utente, giorno, domande)
  values (u, current_date, 1)
  on conflict (utente, giorno) do update set domande = a.domande + 1
    where a.domande < 20
  returning domande into n;
  if n is null then
    raise exception 'domande di oggi finite: riprova domani';
  end if;
  return 20 - n;
end $$;
revoke execute on function public.usa_domanda() from public, anon;
grant execute on function public.usa_domanda() to authenticated;
