-- Account con email vera (19/11/2026): l'email serve a recuperare la password e non deve
-- più coincidere con lo username. I vecchi account (username@utenti.luigi-00-tt.github.io)
-- restano validi: l'app chiede di aggiungere l'email al primo accesso.

-- Il profilo nasce come prima, senza il vincolo email = username.
create or replace function public.crea_profilo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  nome text := lower(m ->> 'username');
begin
  if nome is null or nome !~ '^[a-z0-9_.]{3,30}$' then
    raise exception 'username non valido';
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

-- Accesso con lo username: l'email la legge solo la funzione «account» sul server
-- (chiave service_role), il telefono non la vede mai.
create function public.email_per_accesso(nome text) returns text
language sql stable security definer set search_path = '' as $$
  select u.email::text from public.profili p join auth.users u on u.id = p.id
  where p.username = lower(nome) and nome ~ '^[A-Za-z0-9_.]{3,30}$'
$$;
revoke execute on function public.email_per_accesso(text) from public, anon, authenticated;
grant execute on function public.email_per_accesso(text) to service_role;

-- Controllo «nome utente disponibile» durante l'iscrizione, sempre e solo dal server.
create function public.username_libero(nome text) returns boolean
language sql stable security definer set search_path = '' as $$
  select nome ~ '^[a-z0-9_.]{3,30}$' and not exists (select 1 from public.profili where username = nome)
$$;
revoke execute on function public.username_libero(text) from public, anon, authenticated;
grant execute on function public.username_libero(text) to service_role;
