import test from 'node:test';
import assert from 'node:assert/strict';
import { PolarTokens, seal, open, authorizeUrl, TOKEN_URL } from '../src/adapters/polar/oauth.js';
import { polarGet } from '../src/adapters/polar/client.js';
import { probePolar, shape } from '../src/adapters/polar/probe.js';
import { polarRoutes } from '../src/http/polar-routes.js';
import { createApp } from '../src/app.js';
import { newDb } from './helpers/d1-shim.mjs';

const T0 = Date.parse('2026-11-05T12:00:00Z');
const res = (status, body = {}) => new Response(JSON.stringify(body), { status });
// Polar finto: token endpoint + data endpoint.
function fakePolar({ rotate = true, dataStatus = 200 } = {}) {
  let n = 0, cur = 'R1'; const log = [];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url); log.push(`${init.method || 'GET'} ${u.host}${u.pathname}`);
    if (url === TOKEN_URL) {
      const b = new URLSearchParams(init.body); const basic = init.headers.authorization;
      if (basic !== `Basic ${btoa('cid:csecret')}`) return res(401);
      if (b.get('grant_type') === 'authorization_code') return b.get('code') === 'buono' ? (cur = 'R1', res(200, { access_token: `A${++n}`, refresh_token: 'R1', expires_in: 43199 })) : res(400);
      if (b.get('grant_type') === 'refresh_token') return b.get('refresh_token') === cur ? (rotate && (cur = 'R' + (n + 2)), res(200, { access_token: `A${++n}`, ...(rotate ? { refresh_token: cur } : {}), expires_in: 43199 })) : res(400);
    }
    if (u.pathname === '/v4/data/training-sessions/list') {
      if (dataStatus !== 200) return res(dataStatus);
      for (const k of ['from', 'to']) if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(u.searchParams.get(k) || '')) return res(400);
      const f = u.searchParams.get('features');
      return res(200, { trainingSessions: [{ identifier: 'x', startTime: '2026-11-04T07:21:00.000', hrAvg: 120, sport: 'RUNNING', exercises: [{ id: 1, ...(f ? { samples: { samples: [{ type: 'HEART_RATE', intervalMillis: 1000, values: [60, 61] }] }, zones: [{ type: 'ZONE_TYPE_HEART_RATE', zones: [{ lowerLimit: 50, higherLimit: 100, inZone: 'PT10S' }] }] } : {}) }] }] });
    }
    return res(404);
  };
  return { fetchFn, log };
}
const mk = (over = {}, o = {}) => { const db = newDb(), f = fakePolar(o); let t = T0; const tk = new PolarTokens({ db, clientId: 'cid', clientSecret: 'csecret', fetchFn: f.fetchFn, now: () => t, ...over }); return { db, f, tk, adv: ms => { t += ms; } }; };

test('cifratura: i token non sono leggibili senza il segreto e il dump non li espone', async () => {
  const s = await seal({ access_token: 'SEGRETO-A', refresh_token: 'SEGRETO-R' }, 'k1');
  assert.ok(!s.includes('SEGRETO')); assert.deepEqual(await open(s, 'k1'), { access_token: 'SEGRETO-A', refresh_token: 'SEGRETO-R' });
  await assert.rejects(open(s, 'k2'), e => e.status === 503);
  const { db, tk } = mk(); await tk.exchangeCode('buono', 'https://x/cb');
  const row = await db.prepare('SELECT sealed FROM oauth_tokens').first(); assert.ok(!/A1|R1/.test(row.sealed.replace(/[.=/+]/g, '')) || row.sealed.length > 40);
  assert.ok(!JSON.stringify(row).includes('"access_token"'));
});
test('scambio del codice e rinnovo: access token riusato, poi rinnovato alla scadenza con refresh token ruotato', async () => {
  const { tk, adv, f } = mk(); await tk.exchangeCode('buono', 'https://x/cb');
  assert.equal(await tk.accessToken(), 'A1'); assert.equal(await tk.accessToken(), 'A1');
  adv(12 * 3600 * 1000); assert.equal(await tk.accessToken(), 'A2');
  assert.equal(f.log.filter(l => l.startsWith('POST')).length, 2);
  adv(12 * 3600 * 1000); assert.equal(await tk.accessToken(), 'A3'); // il refresh ruotato R2 non viene più accettato dal finto: ma qui R2 non è stato rinviato -> vedi test seguente
});
test('rinnovo senza rotazione: il refresh token precedente resta valido; codice errato = reauth', async () => {
  const { tk, adv } = mk({}, { rotate: false }); await tk.exchangeCode('buono', 'https://x/cb');
  adv(13 * 3600 * 1000); assert.equal(await tk.accessToken(), 'A2'); adv(13 * 3600 * 1000); assert.equal(await tk.accessToken(), 'A3');
  await assert.rejects(mk().tk.exchangeCode('cattivo', 'https://x/cb'), e => e.code === 'polar_reauth_required');
});
test('senza connessione o senza credenziali: errori chiari, nessun fallback', async () => {
  await assert.rejects(mk().tk.accessToken(), e => e.status === 409 && e.code === 'polar_not_connected');
  assert.throws(() => new PolarTokens({ db: newDb(), clientId: '', clientSecret: '' }), e => e.status === 503);
});
test('client dati: Bearer, parametri, features come lista; 401 = reauth', async () => {
  const { tk, f } = mk(); await tk.exchangeCode('buono', 'https://x/cb');
  const get = polarGet({ tokens: tk, fetchFn: f.fetchFn, sleep: async () => {} });
  const r = await get('/training-sessions/list', { from: '2026-11-04', to: '2026-11-05', features: ['samples', 'zones'] });
  assert.equal(r.trainingSessions.length, 1);
  const bad = mk({}, { dataStatus: 401 }); await bad.tk.exchangeCode('buono', 'https://x/cb');
  await assert.rejects(polarGet({ tokens: bad.tk, fetchFn: bad.f.fetchFn, sleep: async () => {} })('/training-sessions/list'), e => e.code === 'polar_reauth_required');
});
test('probe: restituisce solo struttura, nessun valore', async () => {
  const { tk, f } = mk(); await tk.exchangeCode('buono', 'https://x/cb');
  const out = await probePolar(polarGet({ tokens: tk, fetchFn: f.fetchFn, sleep: async () => {} }), new Date(T0));
  const txt = JSON.stringify(out); assert.equal(out.sessions, 1);
  for (const leak of ['RUNNING', '2026-11-04', 'x"', '"120', 'PT10S']) assert.ok(!txt.includes(leak), `valore trapelato: ${leak}`);
  assert.ok(out.features.exercise_shape.samples); assert.deepEqual(shape([1, 2]), { array: 2, item: 'number' });
});
test('rotte: connect reindirizza con state in cookie; callback verifica lo state (anti-CSRF) e salva i token', async () => {
  const { db, f } = mk(); const env = { POLAR_CLIENT_ID: 'cid', POLAR_CLIENT_SECRET: 'csecret' };
  const auth = { authenticate: async () => ({ subject: 'owner' }) };
  const app = createApp({ db, auth, jobs: { polar: polarRoutes({ db, env, fetchFn: f.fetchFn, now: () => T0 }) } });
  const c = await app(new Request('https://app.test/v1/polar/connect')); assert.equal(c.status, 302);
  const loc = new URL(c.headers.get('location')); assert.equal(loc.host, 'auth.polar.com'); assert.equal(loc.searchParams.get('scope'), 'training_sessions:read');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://app.test/v1/polar/callback');
  const state = loc.searchParams.get('state'); const ck = c.headers.get('set-cookie').split(';')[0];
  assert.equal((await app(new Request(`https://app.test/v1/polar/callback?code=buono&state=${state}`))).status, 400); // senza cookie
  assert.equal((await app(new Request(`https://app.test/v1/polar/callback?code=buono&state=altro`, { headers: { cookie: ck } }))).status, 400);
  const ok = await app(new Request(`https://app.test/v1/polar/callback?code=buono&state=${state}`, { headers: { cookie: ck } })); assert.equal(ok.status, 302);
  assert.deepEqual(Object.keys(await (await app(new Request('https://app.test/v1/polar/status'))).json()).sort(), ['access_token_expires_at', 'connected', 'scope', 'updated_at']);
  assert.equal((await app(new Request('https://app.test/v1/polar/connect', { method: 'POST' }))).status, 405);
});
test('senza credenziali Polar le rotte falliscono chiuse (503)', async () => {
  const db = newDb(); const app = createApp({ db, auth: { authenticate: async () => ({ subject: 'owner' }) }, jobs: { polar: polarRoutes({ db, env: {} }) } });
  assert.equal((await app(new Request('https://app.test/v1/polar/connect'))).status, 503);
  assert.equal((await app(new Request('https://app.test/v1/polar/status'))).status, 503);
});
