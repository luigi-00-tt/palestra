-- v27: la scheda in uso e la versione dell'app che l'ha costruita, accanto ai dati.
-- La scheda si ricalcola dal questionario, ma il motore cambia fra le versioni:
-- salvarla con la sigla della build dice cosa vedeva davvero l'utente.
-- Le autorizzazioni (select, insert, update ad authenticated) e le policy sono sulla tabella: valgono anche qui.

alter table public.dati_utente
  add column scheda jsonb
    check (scheda is null or (jsonb_typeof(scheda) = 'object' and octet_length(scheda::text) < 1000000)),
  add column build text
    check (build is null or build ~ '^[a-z0-9]{1,20}$');
