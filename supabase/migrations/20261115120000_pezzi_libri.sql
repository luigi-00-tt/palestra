-- v28 (R46): i pezzi di libri e articoli (letteratura/rag/indice.sqlite) con i vettori gte-small in halfvec (16 bit, come vettori.npy: metà spazio sui 500 MB del piano gratuito)
-- (letteratura/rag/vettori-gte-small/), per l'assistente online che cerca per significato.
-- I testi sono protetti dal diritto d'autore: il telefono non li legge mai. Né `anon` né
-- `authenticated` hanno permessi sulla tabella o sulla funzione: le usa solo la Edge Function
-- `assistente` con la chiave service_role, e passa i brani al modello senza mostrarli.
-- Righe caricate da letteratura/rag/carica_supabase.py.

create extension if not exists vector with schema extensions;

create table public.pezzi_libri (
  id bigint primary key,                                   -- rowid del pezzo in indice.sqlite
  codice text not null check (codice ~ '^[A-Z][0-9]{2,3}$'),
  pagina integer not null check (pagina between 1 and 10000),
  testo text not null check (length(testo) between 1 and 2000),
  embedding extensions.halfvec(384) not null
);

alter table public.pezzi_libri enable row level security;
revoke all on public.pezzi_libri from public, anon, authenticated;
grant select, insert, update, delete on public.pezzi_libri to service_role;

create index pezzi_libri_embedding on public.pezzi_libri
  using hnsw (embedding extensions.halfvec_cosine_ops);

-- I pezzi più vicini alla domanda (vettore già normalizzato): da 1 a 8.
create function public.cerca_pezzi(domanda extensions.halfvec(384), quanti integer default 5)
returns table (codice text, pagina integer, testo text)
language sql stable set search_path = '' as $$
  select p.codice, p.pagina, p.testo
  from public.pezzi_libri p
  order by p.embedding operator(extensions.<=>) domanda
  limit least(greatest(coalesce(quanti, 5), 1), 8)
$$;
revoke execute on function public.cerca_pezzi(extensions.halfvec, integer) from public, anon, authenticated;
grant execute on function public.cerca_pezzi(extensions.halfvec, integer) to service_role;
