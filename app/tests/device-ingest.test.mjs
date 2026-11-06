import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../src/http/auth.js';
import { createApp } from '../src/app.js';
import { deviceIngest, parseDeviceBody } from '../src/http/device-ingest.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { listCanonical } from '../src/ingest/ledger.js';
import { newDb } from './helpers/d1-shim.mjs';

const TEAM = 't.cloudflareaccess.com', AUD = 'aud', OWNER = 'o@example.test', NOW = 1_800_000_000;
const b64u = b => Buffer.from(b).toString('base64url');
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pub = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256' };
async function jwt(claims) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' })), p = b64u(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], exp: NOW + 600, ...claims }));
  return `${h}.${p}.${b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;
}
const auth = createAuth({ teamDomain: TEAM, aud: AUD, ownerEmail: OWNER, now: () => NOW, fetchJwks: async () => ({ keys: [pub] }) });
const NOWISO = () => '2026-11-05T21:00:00.000Z';
function appFor(db, enabled = true) { return createApp({ db, auth, jobs: { device: deviceIngest({ db, raw: new MemoryRawStore(), now: NOWISO, enabled }), lyfta: async () => ({ ran: false }) } }); }
const post = (token, body, path = '/v1/ingest/device') => new Request(`https://app.test${path}`, { method: 'POST', headers: { 'cf-access-jwt-assertion': token, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const GOOD = { device_id: 'phone-1', steps: [{ date: '2026-11-04', count: 8123, origins: ['com.sec.android.app.shealth'] }, { date: '2026-11-05', count: 2300 }], weights: [{ id: 'hc-1', time: '2026-11-05T06:30:00Z', kg: 77.4, origin: 'com.renpho.app' }] };

test('service token: ammesso solo su POST /v1/ingest/device; nessuna lettura né altri endpoint', async () => {
  const dev = await jwt({ common_name: 'client-id-xyz' }), db = newDb(), app = appFor(db);
  assert.equal((await app(post(dev, GOOD))).status, 200);
  for (const p of ['/v1/canonical/body', '/v1/derived/summary', '/v1/sync/lyfta', '/v1/polar/status']) assert.equal((await app(new Request(`https://app.test${p}`, { method: p.includes('sync') ? 'POST' : 'GET', headers: { 'cf-access-jwt-assertion': dev } }))).status, 403, p);
  assert.equal((await app(new Request('https://app.test/v1/ingest/device', { method: 'GET', headers: { 'cf-access-jwt-assertion': dev } }))).status, 403);
});
test('proprietario con email: nessun cambiamento; JWT senza email né common_name: 403; email altrui: 403', async () => {
  const app = appFor(newDb());
  assert.equal((await app(new Request('https://app.test/v1/canonical/body', { headers: { 'cf-access-jwt-assertion': await jwt({ email: OWNER }) } }))).status, 200);
  assert.equal((await app(post(await jwt({}), GOOD))).status, 403);
  assert.equal((await app(post(await jwt({ email: 'x@example.test', common_name: 'c' }), GOOD))).status, 403);
  assert.equal((await app(post('', GOOD))).status, 401);
});
test('ingest: passi (activity) e peso (body) in D1, ripetizione = nessun duplicato, aggiornamento del giorno in corso = nuova revisione', async () => {
  const db = newDb(), app = appFor(db), dev = await jwt({ common_name: 'c' });
  const r = await (await app(post(dev, GOOD))).json();
  assert.equal(r.ok, true); assert.equal(r.steps.modified, 2); assert.equal(r.weights.modified, 1);
  assert.equal((await listCanonical(db, 'owner', 'activity')).length, 2); const w = await listCanonical(db, 'owner', 'body'); assert.equal(w.length, 1); assert.equal(w[0].payload.kg, 77.4);
  await app(post(dev, GOOD)); assert.equal((await listCanonical(db, 'owner', 'activity')).length, 2);
  const upd = { ...GOOD, weights: [], steps: [{ date: '2026-11-05', count: 9100 }] };
  await app(post(dev, upd)); const a = await listCanonical(db, 'owner', 'activity'); assert.equal(a.find(x => x.payload.local_date === '2026-11-05').payload.count, 9100); assert.equal(a.length, 2);
});
test('validazione: campi vietati, tipi, intervalli, duplicati, dimensione; spento per default', async () => {
  const bad = b => { try { parseDeviceBody(JSON.stringify(b), Date.parse(NOWISO())); return null; } catch (e) { return e.code; } };
  assert.equal(bad({ ...GOOD, scope_complete: true }), 'forbidden_field'); assert.equal(bad({ ...GOOD, subject: 'x' }), 'forbidden_field');
  assert.equal(bad({ ...GOOD, device_id: 'a b' }), 'invalid_device'); assert.equal(bad({ device_id: 'p' }), 'invalid_items');
  assert.equal(bad({ ...GOOD, steps: [{ date: '2026-11-04', count: -1 }] }), 'invalid_steps'); assert.equal(bad({ ...GOOD, steps: [{ date: '2031-01-01', count: 1 }] }), 'invalid_steps');
  assert.equal(bad({ ...GOOD, steps: [{ date: '2026-11-04', count: 1 }, { date: '2026-11-04', count: 2 }] }), 'invalid_steps');
  assert.equal(bad({ ...GOOD, weights: [{ id: 'a', time: '2026-11-05T06:30:00Z', kg: 5 }] }), 'invalid_weight'); assert.equal(bad({ ...GOOD, weights: [{ id: 'a', time: 'ieri', kg: 70 }] }), 'invalid_weight');
  assert.equal(bad({ ...GOOD, weights: [{ id: 'a', time: '2026-11-05T06:30:00Z', kg: 70 }, { id: 'a', time: '2026-11-05T07:30:00Z', kg: 70 }] }), 'invalid_weight');
  assert.throws(() => parseDeviceBody('x'.repeat(1024 * 1024 + 1), 0), e => e.code === 'payload_too_large'); assert.throws(() => parseDeviceBody('{no', 0), e => e.code === 'invalid_json');
  const off = appFor(newDb(), false); assert.equal((await off(post(await jwt({ common_name: 'c' }), GOOD))).status, 503);
});
test('service token con email vuota: trattato come device; senza common_name: 403 con soli nomi dei claim', async () => {
  const app = appFor(newDb());
  assert.equal((await app(post(await jwt({ common_name: 'c', email: '' }), GOOD))).status, 200);
  const r = await app(post(await jwt({ foo: 'SEGRETO-VALORE' }), GOOD)); assert.equal(r.status, 403);
  const t = JSON.stringify(await r.json()); assert.ok(t.includes('claim_names')); assert.ok(!t.includes('SEGRETO-VALORE'));
});
test('sonno: notti in D1 come domain sleep (source sleep_as_android), identità = startTime, validazione', async () => {
  const db = newDb(), app = appFor(db), dev = await jwt({ common_name: 'c' });
  const night = { id: '1793000000000', start_ms: 1793000000000, end_ms: 1793000000000 + 7.5 * 3600 * 1000, latest_end_ms: null, tz: 'Europe/Rome', rating: 4, quality: 0.8, snore: null, cycles: 5, len_adjust: 0, noise_level: 20.5, length_raw: 27000 };
  const r = await (await app(post(dev, { device_id: 'p1', sleep: [night] }))).json(); assert.equal(r.sleep.modified, 1);
  const rows = await listCanonical(db, 'owner', 'sleep'); assert.equal(rows.length, 1); assert.equal(rows[0].payload.duration_min, 450); assert.equal(rows[0].payload.snore, null); assert.equal(rows[0].payload.short, false);
  const nap = { ...night, id: '1793100000000', start_ms: 1793100000000, end_ms: 1793100000000 + 32 * 60 * 1000 };
  await app(post(dev, { device_id: 'p1', sleep: [night, nap] })); const all = await listCanonical(db, 'owner', 'sleep'); assert.equal(all.length, 2); assert.equal(all.find(r => r.payload.duration_min === 32).payload.short, true);
  await app(post(dev, { device_id: 'p1', sleep: [night] })); assert.equal((await listCanonical(db, 'owner', 'sleep')).length, 2); // la notte breve resta: il client non cancella
  const bad = b => { try { parseDeviceBody(JSON.stringify({ device_id: 'p', sleep: [b] }), Date.parse(NOWISO())); return null; } catch (e) { return e.code; } };
  assert.equal(bad({ ...night, id: '5' }), 'invalid_sleep'); assert.equal(bad({ ...night, end_ms: night.start_ms - 1 }), 'invalid_sleep'); assert.equal(bad({ ...night, end_ms: night.start_ms + 40 * 3600 * 1000 }), 'invalid_sleep');
  assert.equal(bad({ ...night, rating: 'alto' }), 'invalid_sleep'); assert.equal(bad({ ...night, tz: 'a b' }), 'invalid_sleep'); assert.equal(bad({ ...night, start_ms: 5, id: '5' }), 'invalid_sleep');
});
