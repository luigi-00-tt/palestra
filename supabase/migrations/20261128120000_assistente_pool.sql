-- v31 (Luigi, 28/11): le domande online si dividono un monte di 40 al giorno (OpenRouter senza crediti ne dà 50:
-- le altre 10 restano per il dataset). Per ognuno: 40 ÷ chi ha usato l'assistente online negli ultimi 7 giorni,
-- da 3 a 10. Una domanda a cui il modello non risponde si restituisce (rendi_domanda).

create function public.limite_domande(u uuid) returns integer
language sql stable security definer set search_path = '' as $$
  -- chi ha chiesto negli ultimi 7 giorni, più chi chiama se è la prima volta
  select greatest(3, least(10, 40 / (count(distinct a.utente) + case when coalesce(bool_or(a.utente = u), false) then 0 else 1 end)))::integer
  from public.assistente_uso a
  where a.giorno >= current_date - 6
$$;
revoke execute on function public.limite_domande(uuid) from public, anon, authenticated;

-- quante ne restano oggi a chi chiama (il contatore accanto al pulsante)
create function public.domande_restanti() returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := (select auth.uid());
  fatte integer;
  tutte integer;
begin
  if u is null then
    raise exception 'serve l''account';
  end if;
  select coalesce(sum(domande), 0) into tutte from public.assistente_uso where giorno = current_date;
  select coalesce(max(domande), 0) into fatte from public.assistente_uso where utente = u and giorno = current_date;
  return greatest(0, least(public.limite_domande(u) - fatte, 40 - tutte));
end $$;
revoke execute on function public.domande_restanti() from public, anon;
grant execute on function public.domande_restanti() to authenticated;

-- conta una domanda e dice quante ne restano; se sono finite (sue o del monte), errore
create or replace function public.usa_domanda() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := (select auth.uid());
  lim integer;
  tutte integer;
  n integer;
begin
  if u is null then
    raise exception 'serve l''account';
  end if;
  lim := public.limite_domande(u);
  -- il monte del giorno: un lucchetto per giorno evita che due domande insieme superino 40
  perform pg_advisory_xact_lock(hashtext('assistente_uso' || current_date::text));
  select coalesce(sum(domande), 0) into tutte from public.assistente_uso where giorno = current_date;
  if tutte >= 40 then
    raise exception 'domande di oggi finite: riprova domani';
  end if;
  insert into public.assistente_uso as a (utente, giorno, domande)
  values (u, current_date, 1)
  on conflict (utente, giorno) do update set domande = a.domande + 1
    where a.domande < lim
  returning domande into n;
  if n is null then
    raise exception 'domande di oggi finite: riprova domani';
  end if;
  return greatest(0, least(lim - n, 40 - tutte - 1));
end $$;

-- il modello non ha risposto: la domanda torna a chi l'ha fatta
create function public.rendi_domanda() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'serve l''account';
  end if;
  update public.assistente_uso set domande = domande - 1
  where utente = (select auth.uid()) and giorno = current_date and domande > 0;
end $$;
revoke execute on function public.rendi_domanda() from public, anon;
grant execute on function public.rendi_domanda() to authenticated;
