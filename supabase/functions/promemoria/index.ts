// v29: i promemoria push (decisione di Luigi del 19/11/2026). La chiama pg_cron ogni 15 minuti con il
// segreto condiviso (x-segreto); legge le scelte di ognuno (promemoria_imp) e manda quelli dovuti:
// allenamento (giorni e ora scelti), scadenze in dispensa (fra due giorni, alle 18), pasti non segnati
// (alle 21), scheda nuova dal trainer. Le chiavi VAPID stanno nei segreti della funzione.
import webpush from 'npm:web-push@3.6.7';

const URL_DB = Deno.env.get('SUPABASE_URL')!;
const SERVIZIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const H = { apikey: SERVIZIO, Authorization: 'Bearer ' + SERVIZIO, 'Content-Type': 'application/json' };

async function leggi(percorso: string) {
  const r = await fetch(URL_DB + '/rest/v1/' + percorso, { headers: H, signal: AbortSignal.timeout(10000) });
  return r.ok ? await r.json() : [];
}
async function scrivi(percorso: string, metodo: string, corpo?: unknown) {
  await fetch(URL_DB + '/rest/v1/' + percorso, { method: metodo, headers: { ...H, Prefer: 'return=minimal' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(10000) });
}
// ora e data locali della persona
function locale(fuso: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const giorno = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday);
  return { data: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) % 24 * 60 + Number(p.minute), giorno };
}
function piuGiorni(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const segreto = Deno.env.get('PROMEMORIA_SEGRETO');
  if (!segreto || req.headers.get('x-segreto') !== segreto) return new Response('no', { status: 401 });
  const pub = Deno.env.get('VAPID_PUBBLICA'), priv = Deno.env.get('VAPID_PRIVATA');
  if (!pub || !priv) return new Response('chiavi VAPID mancanti', { status: 503 });
  webpush.setVapidDetails('mailto:avvisi@example.invalid', pub, priv);

  const utenti: { utente_id: string; imp: any; fuso: string; ultimo: any }[] = await leggi('promemoria_imp?select=*');
  let mandati = 0;
  for (const u of utenti) {
    try {
      const l = locale(u.fuso || 'Europe/Rome'), imp = u.imp || {}, ultimo = { ...(u.ultimo || {}) }, messaggi: { t: string; b: string }[] = [];
      const [hh, mm] = String(imp.ora || '17:30').split(':').map(Number), ora = hh * 60 + mm;
      if (imp.allen && (imp.giorni || []).includes(l.giorno) && l.min >= ora && l.min < ora + 15 && ultimo.allen !== l.data) {
        messaggi.push({ t: 'Oggi ti alleni', b: 'Alle ' + imp.ora + ': la seduta di oggi ti aspetta.' }); ultimo.allen = l.data;
      }
      let dati: any = null;
      const datiDi = async () => dati ??= ((await leggi('dati_utente?select=dati&id=eq.' + u.utente_id))[0]?.dati ?? {});
      if (imp.scad && l.min >= 18 * 60 && l.min < 18 * 60 + 15 && ultimo.scad !== l.data) {
        const fra2 = piuGiorni(l.data, 2), disp = (await datiDi()).dispensa || {};
        const nomi = Object.values(disp).filter((v: any) => v && v.scad === fra2 && Number(v.q) > 0).map((v: any) => String(v.n).slice(0, 40));
        if (nomi.length) messaggi.push({ t: 'In scadenza fra due giorni', b: nomi.slice(0, 4).join(', ') + (nomi.length > 4 ? ' e altro' : '') });
        ultimo.scad = l.data;
      }
      if (imp.pasti && l.min >= 21 * 60 && l.min < 21 * 60 + 15 && ultimo.pasti !== l.data) {
        const cibo = ((await datiDi()).diario || {})[l.data]?.cibo || [];
        if (!cibo.length) messaggi.push({ t: 'I pasti di oggi', b: 'Non hai ancora segnato niente nel diario.' });
        ultimo.pasti = l.data;
      }
      if (imp.trainer) {
        const s = (await leggi('schede_trainer?select=aggiornata_il&cliente_id=eq.' + u.utente_id))[0];
        if (s && s.aggiornata_il !== ultimo.trainer) {
          if (ultimo.trainer) messaggi.push({ t: 'Scheda nuova', b: 'Il tuo trainer ti ha mandato la scheda aggiornata.' });
          ultimo.trainer = s.aggiornata_il;
        }
      }
      if (JSON.stringify(ultimo) !== JSON.stringify(u.ultimo || {})) await scrivi('promemoria_imp?utente_id=eq.' + u.utente_id, 'PATCH', { ultimo });
      if (!messaggi.length) continue;
      const iscr: { endpoint: string; p256dh: string; auth: string }[] = await leggi('push_iscrizioni?select=*&utente_id=eq.' + u.utente_id);
      for (const m of messaggi) for (const i of iscr) {
        try {
          await webpush.sendNotification({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } }, JSON.stringify({ titolo: m.t, testo: m.b }), { TTL: 3600 });
          mandati++;
        } catch (e: any) {
          // iscrizione scaduta o revocata: si toglie
          if (e?.statusCode === 404 || e?.statusCode === 410) await scrivi('push_iscrizioni?endpoint=eq.' + encodeURIComponent(i.endpoint), 'DELETE');
        }
      }
    } catch { /* un utente con dati strani non ferma gli altri */ }
  }
  return new Response(JSON.stringify({ utenti: utenti.length, mandati }), { headers: { 'Content-Type': 'application/json' } });
});
