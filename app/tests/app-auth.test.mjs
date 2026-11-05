import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../src/http/auth.js';
import { createApp } from '../src/app.js';
import { ingest } from '../src/ingest/ledger.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { newDb } from './helpers/d1-shim.mjs';
import { normalizeWorkout } from '../src/adapters/lyfta/normalize.js';
import { workout } from './fixtures/lyfta-synthetic.mjs';

const TEAM = 'test-team.cloudflareaccess.com', AUD = 'aud-test-123', OWNER = 'owner@example.test';
const b64u = b => Buffer.from(b).toString('base64url');
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const kp2 = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pub = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256' };
const NOW = 1_800_000_000;

async function jwt(claims = {}, { key = kp.privateKey, kid = 'k1', alg = 'RS256' } = {}) {
  const h = b64u(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], email: OWNER, exp: NOW + 600, nbf: NOW - 10, ...claims }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}
let jwksCalls = 0;
const auth = (over = {}) => createAuth({ teamDomain: TEAM, aud: AUD, ownerEmail: OWNER, now: () => NOW, fetchJwks: async () => { jwksCalls++; return { keys: [pub] }; }, ...over });
const reqWith = async (path, token, method = 'GET') => new Request(`https://app.test${path}`, { method, headers: token ? { 'cf-access-jwt-assertion': token } : {} });
const status = async (a, token) => { try { return (await a.authenticate(await reqWith('/v1/x', token))).subject; } catch (e) { return e.status; } };

test('JWT valido del proprietario: accettato; il soggetto non viene dal client', async () => {
  assert.equal(await status(auth(), await jwt()), 'owner');
});

test('JWT rifiutato: assente, firma di altra chiave, aud/iss errati, scaduto, alg none/HS256, kid ignoto', async () => {
  const a = auth();
  assert.equal(await status(a, null), 401);
  assert.equal(await status(a, await jwt({}, { key: kp2.privateKey })), 401);
  assert.equal(await status(a, await jwt({ aud: ['altro'] })), 401);
  assert.equal(await status(a, await jwt({ iss: 'https://evil.example' })), 401);
  assert.equal(await status(a, await jwt({ exp: NOW - 1 })), 401);
  assert.equal(await status(a, await jwt({ nbf: NOW + 3600 })), 401);
  assert.equal(await status(a, await jwt({}, { alg: 'none' })), 401);
  assert.equal(await status(a, await jwt({}, { kid: 'sconosciuto' })), 401);
  assert.equal(await status(a, 'a.b.c'), 401);
});

test('utente autenticato ma non proprietario: 403', async () => {
  assert.equal(await status(auth(), await jwt({ email: 'altro@example.test' })), 403);
});

test('configurazione assente: fail-closed 503, anche con un JWT valido', async () => {
  assert.equal(await status(createAuth({}), await jwt()), 503);
  assert.equal(await status(createAuth({ teamDomain: TEAM, aud: AUD }), await jwt()), 503);
});

test('chiavi JWKS in cache; refresh singolo su kid sconosciuto', async () => {
  jwksCalls = 0; const a = auth();
  await status(a, await jwt()); await status(a, await jwt()); assert.equal(jwksCalls, 1);
  await status(a, await jwt({}, { kid: 'nuovo' })); assert.equal(jwksCalls, 2);
});

async function appWithData() {
  const db = newDb(); const raw = new MemoryRawStore();
  const records = [normalizeWorkout(workout(7))];
  await ingest({ db, raw }, { subject: 'owner', source_system: 'lyfta', source_account: 'acc', scope_id: 'full', request_id: '20000000-0000-4000-8000-000000000001', captured_at: '2026-11-01T10:00:00Z', artifact: '[]', records, scope_complete: false });
  return createApp({ db, auth: auth() });
}

test('API: /v1/health pubblico; tutto il resto richiede autenticazione', async () => {
  const app = await appWithData();
  assert.equal((await app(await reqWith('/v1/health'))).status, 200);
  for (const p of ['/v1/canonical/training', '/v1/derived/summary', '/v1/operations/op_x']) assert.equal((await app(await reqWith(p))).status, 401);
});

test('API: letture autenticate; metodo non-GET rifiutato; nessuna scrittura esposta', async () => {
  const app = await appWithData(); const t = await jwt();
  const c = await (await app(await reqWith('/v1/canonical/training', t))).json();
  assert.equal(c.records.length, 1); assert.equal(c.records[0].payload.exercises[0].sets[0].external_load_kg, 0);
  const s = await (await app(await reqWith('/v1/derived/summary', t))).json();
  assert.equal(s.coverage.training, 1); assert.equal(s.coverage.body, 0); assert.equal(s.training_sessions[0].date, '2026-10-15');
  assert.equal((await app(await reqWith('/v1/ingest/operations', t, 'POST'))).status, 405);
  assert.equal((await app(await reqWith('/v1/canonical/boh', t))).status, 404);
  assert.equal((await app(await reqWith('/v1/operations/op_inesistente', t))).status, 404);
});
