// v28 (R33): l'assistente online dell'app. Solo utenti con l'account (il token lo
// controlla Supabase prima di arrivare qui), al massimo 20 domande al giorno
// (public.usa_domanda), solo modelli gratuiti di OpenRouter. La chiave sta nei
// secret di Supabase:  npx supabase secrets set OPENROUTER_API_KEY=sk-or-...
// Il modello si sceglie da solo: solo gratuiti, dal più potente (modelliGratis), e se uno è
// esaurito o bloccato si passa al successivo. OPENROUTER_MODEL, se c'è, ne mette uno gratuito in cima.
// R46: la domanda, tradotta in inglese, diventa un vettore gte-small (l'unico modello che la funzione
// sa calcolare) e trova i brani più vicini in public.pezzi_libri (solo con la chiave service_role).
// I brani vanno al modello per rispondere, mai al telefono: sono protetti dal diritto d'autore.

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
Puoi ricevere anche BRANI DAI LIBRI: usali per completare la risposta, ma non copiarli né citarli
alla lettera; cita il loro codice e la pagina fra parentesi quadre, come [L30 p. 12].
Cita le fonti fra parentesi quadre, come in quelle risposte. Su reflusso, intestino, stomaco
o qualunque disturbo: informazioni, mai diagnosi, e rimanda al medico o al gastroenterologo.`;

// Elenco dei gratuiti dal più potente: prezzo della versione a pagamento, poi miliardi di parametri
// nel nome. Si rilegge ogni ora; un modello che fallisce resta fuori 10 minuti (un giorno se 403/404).
// v29: con `visione` solo i modelli che leggono anche le immagini (foto della scheda o della dieta).
const elenchi: Record<string, { modelli: string[]; quando: number }> = {};
const esauriti = new Map<string, number>();
async function modelliGratis(preferito: string, visione = false): Promise<string[]> {
  const k = visione ? 'v' : 't', elenco = elenchi[k] ?? { modelli: [], quando: 0 };
  if (elenco.modelli.length && Date.now() - elenco.quando < 3600000) return elenco.modelli;
  const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(10000) });
  const dati: any[] = (await r.json())?.data ?? [];
  const prezzo = new Map(dati.map((m) => [m.id, Number(m.pricing?.completion) || 0]));
  const lista = dati.filter((m) => typeof m.id === 'string' && m.id.endsWith(':free')
      && Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0
      && (m.architecture?.output_modalities ?? ['text']).includes('text') && (m.context_length ?? 0) >= 32000
      && (!visione || (m.architecture?.input_modalities ?? []).includes('image')))
    .map((m) => {
      const b = /(\d+(?:\.\d+)?)b\b/.exec(m.id.split('/').pop());
      return { id: m.id as string, p: prezzo.get(m.id.slice(0, -5)) ?? 0, b: b ? Number(b[1]) : 0, c: m.context_length ?? 0, piccolo: !!b && Number(b[1]) < 7 };
    })
    .filter((m) => !m.piccolo)
    .sort((x, y) => y.p - x.p || y.b - x.b || y.c - x.c)
    .map((m) => m.id);
  if (lista.includes(preferito)) lista.splice(0, 0, ...lista.splice(lista.indexOf(preferito), 1));
  if (lista.length) elenchi[k] = { modelli: lista, quando: Date.now() };
  return (elenchi[k] ?? elenco).modelli;
}

// Chiede a un modello gratuito, al massimo `quanti` tentativi di `ms` ciascuno: chi aspetta è al telefono.
async function chiedi(chiave: string, messaggi: unknown[], maxTok: number, quanti: number, ms: number, visione = false) {
  const pronti = (await modelliGratis(visione ? '' : Deno.env.get('OPENROUTER_MODEL') || '', visione))
    .filter((m) => (esauriti.get(m) ?? 0) < Date.now()).slice(0, quanti);
  for (const modello of pronti) {
    let stato = 0, testo = '';
    try {
      const or = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + chiave, 'Content-Type': 'application/json', 'X-Title': 'palestra-app' },
        signal: AbortSignal.timeout(ms),
        body: JSON.stringify({ model: modello, temperature: 0.2, max_tokens: maxTok, messages: messaggi }),
      });
      stato = or.status;
      const t = or.ok ? (await or.json())?.choices?.[0]?.message?.content : '';
      testo = typeof t === 'string' ? t.trim() : '';
    } catch { /* scaduto o caduto: si passa al prossimo */ }
    if (testo) return testo;
    esauriti.set(modello, Date.now() + (stato === 403 || stato === 404 ? 86400000 : 600000));
  }
  return '';
}

// R46: i brani dei libri più vicini alla domanda. Qualunque guasto (tabella vuota, modello che non
// parte) lascia l'assistente com'era: risponde con le sole risposte già pronte.
let sessione: any = null;
async function brani(chiave: string, domanda: string): Promise<string> {
  try {
    const inglese = (await chiedi(chiave, [{ role: 'user', content:
      'Translate into English for a search engine. Reply with the translation only.\n\n' + domanda }], 120, 1, 8000)) || domanda;
    sessione ??= new (globalThis as any).Supabase.ai.Session('gte-small');
    const v: number[] = await sessione.run(inglese.slice(0, 500), { mean_pool: true, normalize: true });
    const r = await fetch(Deno.env.get('SUPABASE_URL') + '/rest/v1/rpc/cerca_pezzi', {
      method: 'POST',
      headers: { apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, Authorization: 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
                 'Content-Type': 'application/json' },
      body: JSON.stringify({ domanda: '[' + Array.from(v).join(',') + ']', quanti: 5 }),
      signal: AbortSignal.timeout(8000),
    });
    const righe: { codice: string; pagina: number; testo: string }[] = r.ok ? await r.json() : [];
    return righe.map((x) => `[${x.codice} p. ${x.pagina}] ${x.testo}`).join('\n\n');
  } catch { return ''; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return risposta({ errore: 'solo POST' }, 405);

  const chiave = Deno.env.get('OPENROUTER_API_KEY');
  if (!chiave) return risposta({ errore: 'L’assistente online non è ancora attivo.' }, 503);

  // la richiesta vera sta in pochi kB (500 caratteri di domanda, 5 risposte da 1500); con una foto (v29) fino a 2,5 MB
  if (Number(req.headers.get('content-length') || 0) > 2500000) return risposta({ errore: 'richiesta troppo grande' }, 413);
  let corpo: { domanda?: unknown; contesto?: unknown; tipo?: unknown; elenco?: unknown; immagine?: unknown } | null;
  try { corpo = await req.json(); } catch { return risposta({ errore: 'richiesta non valida' }, 400); }
  if (!corpo || typeof corpo !== 'object') return risposta({ errore: 'richiesta non valida' }, 400);
  const foto = corpo.tipo === 'scheda' || corpo.tipo === 'dieta';
  const immagine = typeof corpo.immagine === 'string' ? corpo.immagine : '';
  if (foto && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(immagine) || immagine.length > 2400000)) {
    return risposta({ errore: 'foto non valida o troppo grande' }, 400);
  }
  if (!foto && Number(req.headers.get('content-length') || 0) > 50000) return risposta({ errore: 'richiesta troppo grande' }, 413);
  const domanda = foto ? 'foto' : typeof corpo.domanda === 'string' ? corpo.domanda.trim().slice(0, 500) : '';
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

    // v29: il campo «Altro» del questionario. Il modello sceglie SOLO fra le chiavi che il
    // telefono manda (validate qui), e quello che non riconosce torna come testo corto.
    if (corpo.tipo === 'condizioni') {
      const elenco = (Array.isArray(corpo.elenco) ? corpo.elenco.slice(0, 40) : [])
        .filter((c: unknown) => Array.isArray(c) && /^[a-z-]{2,20}$/.test(String(c[0])) && typeof c[1] === 'string')
        .map((c: string[]) => [c[0], c[1].slice(0, 60)]);
      const ammesse = new Set(elenco.map((c) => c[0]));
      const t = await chiedi(chiave, [{ role: 'user', content:
        `Una persona ha scritto nel questionario di un'app di allenamento: «${domanda}».
Elenco delle condizioni che l'app conosce (chiave = nome):
${elenco.map((c) => c[0] + ' = ' + c[1]).join('\n')}
Rispondi SOLO con un JSON {"chiavi": [...], "altro": [...]}: in "chiavi" le chiavi dell'elenco che la persona
dice di avere (anche con parole diverse: «bruciore di stomaco» è reflusso), in "altro" i problemi di salute che
ha scritto e che non sono nell'elenco, in 2-4 parole ciascuno. Niente diagnosi, niente altro testo.` }], 200, 2, 12000);
      let j: { chiavi?: unknown; altro?: unknown } = {};
      try { j = JSON.parse((/\{[\s\S]*\}/.exec(t || '') || ['{}'])[0]); } catch { j = {}; }
      const chiavi = (Array.isArray(j.chiavi) ? j.chiavi : []).map(String).filter((k) => ammesse.has(k)).slice(0, 10);
      const altro = (Array.isArray(j.altro) ? j.altro : []).map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, 3);
      return risposta({ chiavi, altro, restanti });
    }

    // v29: una foto della scheda (dal personal trainer, anche scritta a mano) o della dieta del professionista.
    // Il modello la trascrive in righe semplici; il telefono le riconosce con lo stesso lettore dei file.
    if (foto) {
      const compito = corpo.tipo === 'scheda'
        ? `Trascrivi la scheda di allenamento nella foto. Una riga per esercizio, nel formato «Nome esercizio 4x8 rec 90''»
(serie x ripetizioni, recupero se scritto). Prima degli esercizi di ogni seduta una riga «Giorno A», «Giorno B»… o il giorno
scritto. Se un nome non si legge bene scrivi quello che leggi. Solo il testo della scheda, niente commenti.`
        : `Trascrivi la dieta nella foto. Se cambia nei giorni, una riga col giorno («Lunedì»…) prima dei pasti di quel giorno.
Per ogni pasto una riga «Colazione: alimento quantità; alimento quantità», lo stesso per Spuntino, Pranzo, Merenda, Cena;
kcal solo se sono scritte. Solo il testo della dieta, niente commenti e niente consigli.`;
      const testo = await chiedi(chiave, [{ role: 'user', content: [{ type: 'text', text: compito }, { type: 'image_url', image_url: { url: immagine } }] }],
        1500, 3, 30000, true);
      if (!testo) return risposta({ errore: 'Adesso non riesco a leggere la foto: riprova fra poco o scrivi il testo.' }, 502);
      return risposta({ testo: testo.slice(0, 8000), restanti });
    }

    const libri = await brani(chiave, domanda);
    const testo = await chiedi(chiave, [{ role: 'system', content: ISTRUZIONI },
      { role: 'user', content: `DOMANDA: ${domanda}\n\nRISPOSTE GIÀ PRONTE:\n${pronte || '(nessuna)'}`
        + (libri ? `\n\nBRANI DAI LIBRI (non copiarli):\n${libri}` : '') }], 500, 3, 15000);
    if (!testo) return risposta({ errore: 'Il modello non risponde adesso: riprova fra poco.' }, 502);
    return risposta({ risposta: testo.slice(0, 3000), restanti });
  } catch {
    return risposta({ errore: 'Il servizio non risponde adesso: riprova fra poco.' }, 502);
  }
});
