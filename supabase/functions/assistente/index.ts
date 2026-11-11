// v28 (R33): l'assistente online dell'app. Solo utenti con l'account (il token lo
// controlla Supabase prima di arrivare qui), al massimo 20 domande al giorno
// (public.usa_domanda), solo modelli gratuiti di OpenRouter. La chiave sta nei
// secret di Supabase:  npx supabase secrets set OPENROUTER_API_KEY=sk-or-...
// Il modello si cambia con OPENROUTER_MODEL (deve finire con ":free").

const CORS = {
  'Access-Control-Allow-Origin': 'https://luigi-00-tt.github.io',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const risposta = (corpo: unknown, stato = 200) =>
  new Response(JSON.stringify(corpo), { status: stato, headers: { ...CORS, 'Content-Type': 'application/json' } });

const ISTRUZIONI = `Sei l'assistente di un'app italiana di allenamento e alimentazione.
Rispondi in italiano corretto, in 2-6 frasi, usando SOLO le RISPOSTE GIÀ PRONTE che ricevi
(vengono dalla letteratura dell'app, ognuna con le sue fonti fra parentesi quadre).
Se non bastano a rispondere, dillo e suggerisci di riformulare. Non inventare numeri né fonti.
Cita le fonti fra parentesi quadre, come in quelle risposte. Su reflusso, intestino, stomaco
o qualunque disturbo: informazioni, mai diagnosi, e rimanda al medico o al gastroenterologo.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return risposta({ errore: 'solo POST' }, 405);

  const chiave = Deno.env.get('OPENROUTER_API_KEY');
  const modello = Deno.env.get('OPENROUTER_MODEL') || 'meta-llama/llama-3.3-70b-instruct:free';
  if (!chiave) return risposta({ errore: 'L’assistente online non è ancora attivo.' }, 503);
  if (!modello.endsWith(':free')) return risposta({ errore: 'Modello non gratuito: configurazione da correggere.' }, 500);

  // la richiesta vera sta in pochi kB (500 caratteri di domanda, 5 risposte da 1500)
  if (Number(req.headers.get('content-length') || 0) > 50000) return risposta({ errore: 'richiesta troppo grande' }, 413);
  let corpo: { domanda?: unknown; contesto?: unknown } | null;
  try { corpo = await req.json(); } catch { return risposta({ errore: 'richiesta non valida' }, 400); }
  if (!corpo || typeof corpo !== 'object') return risposta({ errore: 'richiesta non valida' }, 400);
  const domanda = typeof corpo.domanda === 'string' ? corpo.domanda.trim().slice(0, 500) : '';
  if (domanda.length < 3) return risposta({ errore: 'domanda troppo corta' }, 400);
  // Il contesto arriva dal telefono: si controlla PRIMA di contare la domanda, così una
  // richiesta malformata non fa cadere la funzione dopo aver consumato una delle 20.
  const stringa = (v: unknown, max: number) => (typeof v === 'string' ? v : '').slice(0, max);
  const pronte = (Array.isArray(corpo.contesto) ? corpo.contesto.slice(0, 5) : [])
    .filter((c: unknown) => !!c && typeof c === 'object')
    .map((c: { d?: unknown; r?: unknown; fonti?: unknown }, i: number) =>
      `${i + 1}. D: ${stringa(c.d, 300)}\n   R: ${stringa(c.r, 1500)} [${(Array.isArray(c.fonti) ? c.fonti : []).slice(0, 6).map((f: unknown) => stringa(f, 10)).join(', ')}]`)
    .join('\n');

  // Senza try e senza scadenza, una chiamata lenta o caduta dava un 500 senza intestazioni
  // CORS, che il telefono leggeva come «nessuna connessione».
  try {
    // una domanda in meno per oggi: con il token dell'utente, così conta la sua
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
      return risposta({ errore: finite ? 'Domande online di oggi finite: riprova domani.' : 'Serve l’account.' }, finite ? 429 : 401);
    }
    const restanti = await conto.json();

    const or = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + chiave, 'Content-Type': 'application/json', 'X-Title': 'palestra-app' },
      signal: AbortSignal.timeout(40000),
      body: JSON.stringify({
        model: modello, temperature: 0.2, max_tokens: 500,
        messages: [{ role: 'system', content: ISTRUZIONI },
                   { role: 'user', content: `DOMANDA: ${domanda}\n\nRISPOSTE GIÀ PRONTE:\n${pronte || '(nessuna)'}` }],
      }),
    });
    if (!or.ok) return risposta({ errore: 'Il modello non risponde adesso: riprova fra poco.' }, 502);
    const t = (await or.json())?.choices?.[0]?.message?.content;
    const testo = typeof t === 'string' ? t.trim() : '';
    if (!testo) return risposta({ errore: 'Risposta vuota: riprova.' }, 502);
    return risposta({ risposta: testo.slice(0, 3000), restanti });
  } catch {
    return risposta({ errore: 'Il servizio non risponde adesso: riprova fra poco.' }, 502);
  }
});
