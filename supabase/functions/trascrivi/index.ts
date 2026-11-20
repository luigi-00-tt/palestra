// v29 (Luigi, 19/11): il dettato del diario quando la voce offline non è scaricata. Solo con l'account
// (Supabase controlla il token prima di arrivare qui), e conta come una delle domande online del
// giorno (public.usa_domanda). L'audio va a Groq (whisper-large-v3-turbo, piano gratuito) e non si salva.
// La chiave sta nei secret:  npx supabase secrets set GROQ_API_KEY=gsk_...

const CORS = {
  'Access-Control-Allow-Origin': 'https://luigi-00-tt.github.io',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const risposta = (corpo: unknown, stato = 200) =>
  new Response(JSON.stringify(corpo), { status: stato, headers: { ...CORS, 'Content-Type': 'application/json' } });

const TIPI = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']);
const MAX = 3_000_000;   // circa 2 minuti di voce compressa: il dettato di un pasto ne usa pochi secondi

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return risposta({ errore: 'solo POST' }, 405);
  const chiave = Deno.env.get('GROQ_API_KEY');
  if (!chiave) return risposta({ errore: 'Il dettato online non è ancora attivo: scarica la voce offline dalle Impostazioni.' }, 503);

  const tipo = (req.headers.get('content-type') || '').split(';')[0].trim();
  if (!TIPI.has(tipo)) return risposta({ errore: 'formato audio non valido' }, 415);
  if (Number(req.headers.get('content-length') || 0) > MAX) return risposta({ errore: 'registrazione troppo lunga' }, 413);
  const audio = new Uint8Array(await req.arrayBuffer());
  if (audio.length < 1000 || audio.length > MAX) return risposta({ errore: 'registrazione troppo corta o troppo lunga' }, 400);

  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const conto = await fetch(url + '/rest/v1/rpc/usa_domanda', {
      method: 'POST',
      headers: { apikey: anon, Authorization: req.headers.get('Authorization') || '', 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    });
    if (!conto.ok) {
      const e = await conto.json().catch(() => ({}));
      const finite = /finite/.test(e.message || '');
      return risposta({ errore: finite ? 'Richieste online di oggi finite: riprova domani o scarica la voce offline.' : 'Serve l’account.' }, finite ? 429 : 401);
    }
    const restanti = await conto.json();

    const modulo = new FormData();
    modulo.append('file', new Blob([audio], { type: tipo }), 'voce.' + (tipo.split('/')[1] || 'webm'));
    modulo.append('model', 'whisper-large-v3-turbo');
    modulo.append('language', 'it');
    modulo.append('response_format', 'json');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + chiave }, body: modulo, signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return risposta({ errore: 'La trascrizione non risponde adesso: riprova fra poco.' }, 502);
    const testo = String((await r.json())?.text || '').trim().slice(0, 1000);
    return risposta({ testo, restanti });
  } catch {
    return risposta({ errore: 'Il servizio non risponde adesso: riprova fra poco.' }, 502);
  }
});
