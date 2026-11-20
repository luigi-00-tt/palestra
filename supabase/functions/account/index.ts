// 19/11/2026: le due cose dell'account che il telefono non può fare da solo senza vedere
// dati altrui. Si chiama prima di avere una sessione, quindi senza controllo del token
// (npx supabase functions deploy account --no-verify-jwt).
//   { azione: 'libero', username }        -> { libero: true|false }
//   { azione: 'accedi', username, password } -> la sessione, come /auth/v1/token, senza l'email
// L'email dello username la legge public.email_per_accesso, eseguibile solo con service_role.
// shortcut: gli accessi con username escono tutti dall'IP della funzione, quindi il limite di
// Supabase sugli accessi (per IP) vale per tutti insieme; con molti utenti va alzato in
// Authentication -> Rate limits.

const CORS = {
  'Access-Control-Allow-Origin': 'https://luigi-00-tt.github.io',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const risposta = (corpo: unknown, stato = 200) =>
  new Response(JSON.stringify(corpo), { status: stato, headers: { ...CORS, 'Content-Type': 'application/json' } });
const USERNAME = /^[a-z0-9_.]{3,30}$/;

async function rpc(nome: string, argomenti: unknown) {
  const chiave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const r = await fetch(Deno.env.get('SUPABASE_URL') + '/rest/v1/rpc/' + nome, {
    method: 'POST',
    headers: { apikey: chiave, Authorization: 'Bearer ' + chiave, 'Content-Type': 'application/json' },
    body: JSON.stringify(argomenti),
  });
  if (!r.ok) throw new Error('rpc ' + nome + ' ' + r.status);
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return risposta({ msg: 'solo POST' }, 405);
  let d: any;
  try { d = await req.json(); } catch { return risposta({ msg: 'richiesta non valida' }, 400); }
  const username = String(d?.username ?? '').trim().toLowerCase();
  try {
    if (d?.azione === 'libero') {
      return risposta({ libero: USERNAME.test(username) && (await rpc('username_libero', { nome: username })) === true });
    }
    if (d?.azione === 'accedi') {
      const password = String(d?.password ?? '');
      // username sconosciuto e password sbagliata danno la stessa risposta
      const sbagliate = () => risposta({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      if (!USERNAME.test(username) || !password || password.length > 200) return sbagliate();
      const email = await rpc('email_per_accesso', { nome: username });
      if (typeof email !== 'string' || !email) return sbagliate();
      const r = await fetch(Deno.env.get('SUPABASE_URL') + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY')!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) return risposta({ error_code: j.error_code, msg: j.msg || j.error_description || '' }, r.status === 200 ? 400 : r.status);
      return risposta({ access_token: j.access_token, refresh_token: j.refresh_token, expires_in: j.expires_in, user: { id: j.user?.id } });
    }
    return risposta({ msg: 'azione sconosciuta' }, 400);
  } catch (_e) {
    return risposta({ msg: 'errore del server' }, 500);
  }
});
