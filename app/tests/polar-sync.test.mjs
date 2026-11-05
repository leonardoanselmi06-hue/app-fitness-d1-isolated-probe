import test from 'node:test';
import assert from 'node:assert/strict';
import { runPolarSync } from '../src/jobs/polar-job.js';
import { polarInstant } from '../src/adapters/polar/normalize.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { listCanonical } from '../src/ingest/ledger.js';
import { PolarTokens, TOKEN_URL } from '../src/adapters/polar/oauth.js';
import { newDb } from './helpers/d1-shim.mjs';

const NOW = () => '2026-11-05T10:00:00.000Z';
const j = (b, status = 200) => new Response(JSON.stringify(b), { status });
const sess = (n, day, hh = '07') => ({ identifier: { id: `S${n}` }, startTime: `${day}T${hh}:21:00.000`, timezoneOffsetMinutes: 60, durationMillis: 3600000, hrAvg: 120, hrMax: 170, calories: 400, sport: { id: 'RUNNING' }, recoveryTimeMillis: '3600000', trainingBenefit: 'X', product: { modelName: 'M' }, exercises: [{ identifier: { id: `E${n}` }, sport: { id: 'RUNNING' }, durationMillis: 3600000, calories: 400 }] });
const withDetail = s => ({ ...s, exercises: s.exercises.map(e => ({ ...e, samples: { samples: [{ type: 'HEART_RATE', intervalMillis: 1000, values: [100, 101, 102] }] }, zones: [{ type: 'ZONE_TYPE_HEART_RATE', zones: [{ lowerLimit: 50, higherLimit: 100, inZone: 12 }] }] })) });
function fakePolar(all, { noDetailFor = [] } = {}) {
  const calls = { list: 0, detail: 0, token: 0 };
  const fetchFn = async (url, init = {}) => {
    if (url === TOKEN_URL) { calls.token++; return j({ access_token: 'A', refresh_token: 'R', expires_in: 43199 }); }
    const u = new URL(url); const feats = u.searchParams.getAll('features');
    const f = u.searchParams.get('from').slice(0, 10), t = u.searchParams.get('to').slice(0, 10);
    const inRange = all.filter(s => s.startTime.slice(0, 10) >= f && s.startTime.slice(0, 10) < t);
    if (feats.length) { calls.detail++; return j({ trainingSessions: inRange.map(s => (noDetailFor.includes(s.identifier.id) ? s : withDetail(s))) }); }
    calls.list++; return j({ trainingSessions: inRange });
  };
  return { fetchFn, calls };
}
async function connected(db, fetchFn) { await new PolarTokens({ db, clientId: 'c', clientSecret: 's', fetchFn, now: () => Date.parse(NOW()) }).exchangeCode('x', 'https://x/cb'); }
const env = db => ({ DB: db, POLAR_CLIENT_ID: 'c', POLAR_CLIENT_SECRET: 's', POLAR_SYNC_ENABLED: 'true' });

test('istante: ora locale meno offset (CET e CEST attorno al cambio ora)', () => {
  assert.equal(polarInstant('2026-10-24T12:00:00.000', 120), '2026-10-24T10:00:00.000Z');
  assert.equal(polarInstant('2026-10-25T12:00:00.000', 60), '2026-10-25T11:00:00.000Z');
  assert.equal(polarInstant('2026-10-25T12:00', 60), null);
});

test('spento per default e fail-closed senza configurazione', async () => {
  const db = newDb();
  assert.deepEqual(await runPolarSync({ DB: db }), { ran: false, reason: 'disabled' });
  assert.equal((await runPolarSync({ ...env(db), POLAR_CLIENT_ID: '' })).reason, 'polar_unconfigured');
  assert.equal((await runPolarSync(env(db))).reason, 'raw_store_unconfigured');
});

test('sync: sessioni cardio con riepilogo in D1 e serie al secondo nel RAW; nessun dato nel risultato', async () => {
  const db = newDb(), raw = new MemoryRawStore(), p = fakePolar([sess(1, '2026-11-04'), sess(2, '2026-11-02')]);
  await connected(db, p.fetchFn);
  const r = await runPolarSync(env(db), { now: NOW, fetchFn: p.fetchFn, rawStore: raw });
  assert.equal(r.ok, true); assert.equal(r.new_sessions, 2); assert.equal(r.detailed, 2); assert.equal(r.remaining, 0);
  assert.ok(!JSON.stringify(r).includes('RUNNING'));
  const rows = await listCanonical(db, 'owner', 'cardio'); assert.equal(rows.length, 2);
  const pl = rows.find(x => x.record_id === 'session:S1' || x.id === 'session:S1')?.payload ?? JSON.parse(rows[0].payload_json ?? '{}');
  const d = (pl.hr_detail ?? rows[0].payload.hr_detail);
  assert.equal(d.status, 'ok'); assert.match(d.raw_ref, /^mem:|^[a-z]+:/); assert.equal(d.series[0].count, 3);
  assert.ok(!JSON.stringify(rows).includes('"values"')); // la serie non è nel record, solo nel RAW
  const stored = JSON.parse(new TextDecoder().decode(await raw.get(d.raw_ref)));
  assert.deepEqual(stored.exercises[0].samples.samples[0].values, [100, 101, 102]);
});

test('seconda esecuzione: niente richieste di dettaglio per sessioni già complete, nessuna nuova revisione', async () => {
  const db = newDb(), raw = new MemoryRawStore(), p = fakePolar([sess(1, '2026-11-04')]);
  await connected(db, p.fetchFn);
  await runPolarSync(env(db), { now: NOW, fetchFn: p.fetchFn, rawStore: raw });
  const before = p.calls.detail;
  const r = await runPolarSync(env(db), { now: NOW, fetchFn: p.fetchFn, rawStore: raw });
  assert.equal(r.ok, true); assert.equal(r.new_sessions, 0); assert.equal(p.calls.detail, before);
});

test('limite di dettagli per esecuzione: le restanti restano pending e si completano alla run successiva', async () => {
  const db = newDb(), raw = new MemoryRawStore(), all = Array.from({ length: 9 }, (_, i) => sess(i + 1, `2026-11-0${(i % 4) + 1}`, `0${i}`));
  const p = fakePolar(all); await connected(db, p.fetchFn);
  const r1 = await runPolarSync(env(db), { now: NOW, fetchFn: p.fetchFn, rawStore: raw });
  assert.equal(r1.detailed, 6); assert.equal(r1.remaining, 3);
  const r2 = await runPolarSync(env(db), { now: NOW, fetchFn: p.fetchFn, rawStore: raw });
  assert.equal(r2.detailed, 3); assert.equal(r2.remaining, 0);
  const r3 = await runPolarSync(env(db), { now: NOW, fetchFn: p.fetchFn, rawStore: raw });
  assert.equal(r3.new_sessions, 0);
  assert.equal((await listCanonical(db, 'owner', 'cardio')).length, 9);
});

test('sessione senza battito: status none, nessun RAW dedicato; errore Polar = esito pulito senza dati', async () => {
  const db = newDb(), raw = new MemoryRawStore(), p = fakePolar([sess(1, '2026-11-04')], { noDetailFor: ['S1'] });
  await connected(db, p.fetchFn);
  const r = await runPolarSync(env(db), { now: NOW, fetchFn: p.fetchFn, rawStore: raw });
  assert.equal(r.ok, true);
  const rows = await listCanonical(db, 'owner', 'cardio'); assert.equal(rows[0].payload.hr_detail.status, 'none');
  const bad = await runPolarSync(env(newDb()), { now: NOW, fetchFn: async () => j({}, 500), rawStore: raw });
  assert.equal(bad.ok, false); assert.equal(bad.reason, 'polar_not_connected');
});
