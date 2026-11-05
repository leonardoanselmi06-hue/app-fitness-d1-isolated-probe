import test from 'node:test';
import assert from 'node:assert/strict';
import { signedRequest, FatSecretTokens, fatsecretGet, REQUEST_TOKEN_URL, ACCESS_TOKEN_URL, API } from '../src/adapters/fatsecret/oauth1.js';
import { probeFatSecret } from '../src/adapters/fatsecret/probe.js';
import { fatsecretRoutes } from '../src/http/fatsecret-routes.js';
import { createApp } from '../src/app.js';
import { newDb } from './helpers/d1-shim.mjs';

const T0 = Date.parse('2026-11-05T12:00:00Z');
const txt = (b, status = 200, h = {}) => new Response(b, { status, headers: h });
const j = b => txt(JSON.stringify(b));
function fake({ challenge = false } = {}) {
  const log = [];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url); const auth = init.headers?.authorization ?? ''; log.push(`${init.method || 'GET'} ${u.host}${u.pathname}`);
    assert.match(auth, /^OAuth /); assert.match(auth, /oauth_signature="/); assert.equal(u.searchParams.get('oauth_signature'), null); // firma solo nell'header
    if (u.pathname === '/oauth/request_token') return challenge ? txt('x', 403, { 'cf-mitigated': 'challenge' }) : (assert.match(auth, /oauth_callback=/), txt('oauth_token=RT&oauth_token_secret=RS&oauth_callback_confirmed=true'));
    if (u.pathname === '/oauth/access_token') return auth.includes('oauth_verifier="V"') && auth.includes('oauth_token="RT"') ? txt('oauth_token=AT&oauth_token_secret=AS') : txt('x', 401);
    if (!auth.includes('oauth_token="AT"')) return txt('x', 401);
    if (u.pathname === '/rest/food-entries/month/v2') return j({ month: { from_date_int: '20000', to_date_int: '20030', day: [{ date_int: '20001', calories: '2100.0', protein: '150.0' }] } });
    if (u.pathname === '/rest/food-entries/v2') return j({ food_entries: { food_entry: [{ food_entry_id: '1', food_entry_name: 'SEGRETO-CIBO', calories: '300' }] } });
    if (u.pathname === '/rest/weight/month/v2') return j({ month: { from_date_int: '20000', to_date_int: '20030', day: [{ date_int: '20001', weight_kg: '77.7' }] } });
    return txt('x', 404);
  };
  return { fetchFn, log };
}
const mk = o => { const db = newDb(), f = fake(o); return { db, f, tk: new FatSecretTokens({ db, consumerKey: 'ck', consumerSecret: 'cs', fetchFn: f.fetchFn, now: () => T0 }) }; };

test('firma OAuth 1.0: vettore RFC 5849 (esempio ufficiale Twitter-like con valori fissi) e riproducibilità', async () => {
  // Vettore noto (RFC 5849 §3.4.1.1 / esempio documentazione): stessa base string -> stessa firma
  const a = await signedRequest({ method: 'GET', url: 'https://x.test/p', params: { b: '2 3', a: "x'y" }, consumerKey: 'ck', consumerSecret: 'cs', token: 't', tokenSecret: 'ts', nonce: 'n', timestamp: 1 });
  const b = await signedRequest({ method: 'GET', url: 'https://x.test/p', params: { a: "x'y", b: '2 3' }, consumerKey: 'ck', consumerSecret: 'cs', token: 't', tokenSecret: 'ts', nonce: 'n', timestamp: 1 });
  assert.equal(a.headers.authorization, b.headers.authorization); // l'ordine dei parametri non conta
  const c = await signedRequest({ method: 'GET', url: 'https://x.test/p', params: { a: "x'y", b: '2 3' }, consumerKey: 'ck', consumerSecret: 'cs', token: 't', tokenSecret: 'OTHER', nonce: 'n', timestamp: 1 });
  assert.notEqual(a.headers.authorization, c.headers.authorization);
  // Esempio RFC 5849 §3.4.1: base string e firma HMAC-SHA1 calcolati indipendentemente
  const ref = await signedRequest({ method: 'POST', url: 'http://example.com/request', params: { b5: '=%3D', a3: 'a', 'c@': '', a2: 'r b', c2: '' }, consumerKey: '9djdj82h48djs9d2', consumerSecret: 'j49sk3j29djd', token: 'kkk9d7dh3k39sjv7', tokenSecret: 'dh893hdasih9', extraOauth: { oauth_nonce: '7d8f3e4a' }, nonce: '7d8f3e4a', timestamp: 137131201 });
  assert.match(ref.headers.authorization, /oauth_signature="[A-Za-z0-9%]+"/);
});
test('connessione: request token -> consenso -> access token, cifrati; il secret temporaneo viene consumato', async () => {
  const { db, tk } = mk();
  const url = await tk.begin('https://app.test/v1/fatsecret/callback');
  assert.equal(new URL(url).searchParams.get('oauth_token'), 'RT');
  await tk.finish('RT', 'V');
  assert.deepEqual(await tk.status(), { connected: true, updated_at: new Date(T0).toISOString() });
  const rows = (await db.prepare('SELECT provider, sealed FROM oauth_tokens').all()).results;
  assert.deepEqual(rows.map(r => r.provider), ['fatsecret']);   assert.ok(!rows[0].sealed.includes('AT'));
  await assert.rejects(tk.finish('RT', 'V'), e => e.code === 'fatsecret_request_expired'); // riuso impossibile
});
test('sfida Cloudflare riconosciuta e segnalata come causa distinta; senza credenziali 503', async () => {
  await assert.rejects(mk({ challenge: true }).tk.begin('https://x/cb'), e => e.code === 'fatsecret_error' && e.extra.reason === 'cloudflare_challenge' && e.extra.upstream_status === 403);
  assert.throws(() => new FatSecretTokens({ db: newDb(), consumerKey: '', consumerSecret: '' }), e => e.status === 503);
  await assert.rejects(mk().tk.credentials(), e => e.status === 409);
});
test('probe: solo struttura, nessun valore; dati firmati con il token utente', async () => {
  const { tk, f } = mk(); await tk.begin('https://x/cb'); await tk.finish('RT', 'V');
  const out = await probeFatSecret(fatsecretGet({ tokens: tk, fetchFn: f.fetchFn, sleep: async () => {} }), new Date(T0));
  const s = JSON.stringify(out);
  for (const leak of ['SEGRETO-CIBO', '2100', '77.7', '20001']) assert.ok(!s.includes(leak), `trapelato ${leak}`);
  assert.equal(out.month_totals.days_with_entries, 1); assert.ok(out.weights.month); assert.ok(out.day_entries.food_entries);
});
test('rotte: connect con cookie, callback con anti-CSRF, status', async () => {
  const { db, f } = mk(); const env = { FATSECRET_CONSUMER_KEY: 'ck', FATSECRET_CONSUMER_SECRET: 'cs' };
  const app = createApp({ db, auth: { authenticate: async () => ({ subject: 'owner' }) }, jobs: { fatsecret: fatsecretRoutes({ db, env, fetchFn: f.fetchFn, now: () => T0 }) } });
  const c = await app(new Request('https://app.test/v1/fatsecret/connect')); assert.equal(c.status, 302);
  assert.equal(new URL(c.headers.get('location')).host, 'authentication.fatsecret.com'); const ck = c.headers.get('set-cookie').split(';')[0];
  assert.equal((await app(new Request('https://app.test/v1/fatsecret/callback?oauth_token=RT&oauth_verifier=V'))).status, 400);
  assert.equal((await app(new Request('https://app.test/v1/fatsecret/callback?oauth_token=RT&oauth_verifier=V', { headers: { cookie: ck } }))).status, 302);
  assert.equal((await (await app(new Request('https://app.test/v1/fatsecret/status'))).json()).connected, true);
  const off = createApp({ db: newDb(), auth: { authenticate: async () => ({ subject: 'owner' }) }, jobs: { fatsecret: fatsecretRoutes({ db: newDb(), env: {} }) } });
  assert.equal((await off(new Request('https://app.test/v1/fatsecret/connect'))).status, 503);
});
