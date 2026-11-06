import test from 'node:test';
import assert from 'node:assert/strict';
import { ingest } from '../src/ingest/ledger.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { trainingView, weightView } from '../src/analytics/views.js';
import { createApp } from '../src/app.js';
import { AppError } from '../src/core/errors.js';
import { normalizeWorkout } from '../src/adapters/lyfta/normalize.js';
import { workout } from './fixtures/lyfta-synthetic.mjs';
import { newDb } from './helpers/d1-shim.mjs';

const S = 'owner';
const NOW = new Date('2026-11-06T12:00:00Z');
const rid = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const put = (db, raw, n, source_system, scope_id, records) => ingest({ db, raw, now: () => '2026-11-06T10:00:00.000Z' }, {
  subject: S, source_system, source_account: 'acc', scope_id, request_id: rid(n), captured_at: '2026-11-06T10:00:00Z',
  artifact: JSON.stringify(records), records, scope_complete: false,
});
const wrec = (n, time, kg) => ({ id: `weight:${n}`, domain: 'body', observed_at: time, payload: { metric: 'body_weight_kg', kg, time, local_date: time.slice(0, 10), origin: 'com.renpho.health' } });

async function trainingDb() {
  const db = newDb(), raw = new MemoryRawStore();
  const ws = [
    workout(1001, { title: 'Vecchio', workout_perform_date: '2026-10-10 16:00:00' }),
    workout(1002, { title: 'Medio', workout_perform_date: '2026-10-20 16:00:00' }),
    workout(1003, { title: 'Recente', workout_perform_date: '2026-11-02 16:00:00' }),
  ];
  await put(db, raw, 1, 'lyfta', 'full', ws.map((w, i) => normalizeWorkout(w, i)));
  return db;
}

test('allenamenti: ordine dal più recente, riepilogo corretto, carico esterno separato dal peso corporeo', async () => {
  const db = await trainingDb();
  const v = await trainingView(db, S, {});
  assert.deepEqual(v.workouts.map(w => w.title), ['Recente', 'Medio', 'Vecchio']);
  assert.equal(v.total, 3); assert.equal(v.has_more, false);
  const w = v.workouts[0];
  assert.equal(w.date, '2026-11-02');
  // fixture: Pull Up 0kg x9 (lavoro), riscaldamento (escluso), 5kg x6 (lavoro) + corsa (1 serie senza ripetizioni)
  assert.deepEqual(w.summary, { exercises: 2, working_sets: 3, warmup_sets: 1, reps_total: 15, external_load_volume_kg: 30 });
  assert.equal(w.user_body_weight_kg, 72.5); // campo separato: non sommato al carico
  assert.equal(w.exercises[0].name, 'Pull Up');
  assert.equal(w.exercises[0].sets[1].warmup, true);
});

test('allenamenti: is_completed di Lyfta non esclude serie registrate; senza zavorra il volume è null (mai zero)', async () => {
  const db = newDb(), raw = new MemoryRawStore();
  const w = workout(2001, { exercises: [{ exercise_id: 1, excercise_name: 'Flessioni', sets: [
    { id: 5, reps: 10, set_type_id: 0, is_completed: true },
    { id: 6, reps: 10, set_type_id: 0, is_completed: false },
  ] }] });
  await put(db, raw, 1, 'lyfta', 'full', [normalizeWorkout(w)]);
  const s = (await trainingView(db, S, {})).workouts[0].summary;
  assert.equal(s.working_sets, 2); assert.equal(s.reps_total, 20); assert.equal(s.external_load_volume_kg, null);
});

test('allenamenti: paginazione e limiti sui parametri', async () => {
  const db = await trainingDb();
  const p1 = await trainingView(db, S, { limit: '2', offset: '0' });
  assert.deepEqual(p1.workouts.map(w => w.title), ['Recente', 'Medio']); assert.equal(p1.has_more, true);
  const p2 = await trainingView(db, S, { limit: '2', offset: '2' });
  assert.deepEqual(p2.workouts.map(w => w.title), ['Vecchio']); assert.equal(p2.has_more, false);
  assert.equal((await trainingView(db, S, { limit: '999999' })).limit, 100);
  assert.equal((await trainingView(db, S, { limit: 'abc', offset: '-5' })).limit, 20);
  assert.equal((await trainingView(db, S, { offset: '-5' })).offset, 0);
  assert.equal((await trainingView(db, 'altro-soggetto', {})).total, 0); // isolamento per soggetto
});

async function weightDb() {
  const db = newDb(), raw = new MemoryRawStore();
  await put(db, raw, 1, 'health_connect', 'weight', [
    wrec(1, '2026-10-20T07:00:00.000Z', 74.0),
    wrec(2, '2026-10-25T07:00:00.000Z', 73.0),
    wrec(3, '2026-10-28T07:00:00.000Z', 73.4),
    wrec(4, '2026-11-01T07:00:00.000Z', 72.0),
    wrec(5, '2026-11-03T07:00:00.000Z', 72.4),
    wrec(6, '2026-11-03T18:00:00.000Z', 72.8), // seconda pesata dello stesso giorno
    wrec(7, '2026-11-06T07:08:29.000Z', 71.8499984741211), // float32 come arriva da Health Connect
    { id: 'fat:1', domain: 'body', observed_at: '2026-11-05T07:00:00.000Z', payload: { metric: 'body_fat_pct', value: 20 } }, // altra metrica: ignorata
  ]);
  await db.prepare("INSERT INTO meta(name, value) VALUES ('excluded_weights', ?)").bind(JSON.stringify(['2026-10-17T19:11:56.000Z', '2026-11-06T07:07:37.000Z'])).run();
  return db;
}

test('peso: ultima pesata arrotondata, una voce per giorno, altre metriche ignorate', async () => {
  const v = await weightView(await weightDb(), S, { days: '30', now: NOW });
  assert.equal(v.count, 7);
  assert.equal(v.latest.kg, 71.85); assert.equal(v.latest.local_date, '2026-11-06');
  assert.equal(v.daily.length, 6);
  assert.equal(v.daily.find(d => d.date === '2026-11-03').kg, 72.8); // l'ultima del giorno
  assert.deepEqual(v.min, { kg: 71.85, local_date: '2026-11-06' }); assert.deepEqual(v.max, { kg: 74, local_date: '2026-10-20' });
  assert.equal(v.change_in_window, -2.15);
  assert.equal(v.excluded_count, 2);
});

test('peso: medie a 7 giorni e confronto con i 7 precedenti', async () => {
  const v = await weightView(await weightDb(), S, { days: '30', now: NOW });
  assert.equal(v.avg_7d, 72.26); assert.equal(v.avg_prev_7d, 73.2); assert.equal(v.delta_7d, -0.94);
});

test('peso: finestra temporale; dati insufficienti = null, mai zero', async () => {
  const db = await weightDb();
  const w14 = await weightView(db, S, { days: '14', now: NOW });
  assert.equal(w14.count, 6); assert.equal(w14.change_in_window, -1.15); // la pesata del 20/10 è fuori finestra
  const w3 = await weightView(db, S, { days: '1', now: NOW }); // il minimo è 14 giorni
  assert.equal(w3.days, 14);
  const empty = await weightView(newDb(), S, { now: NOW });
  assert.equal(empty.latest, null); assert.equal(empty.count, 0); assert.deepEqual(empty.daily, []);
  assert.equal(empty.delta_7d, null); assert.equal(empty.change_in_window, null); assert.equal(empty.min, null); assert.equal(empty.excluded_count, 0);
  const one = newDb(); await put(one, new MemoryRawStore(), 1, 'health_connect', 'weight', [wrec(1, '2026-11-05T07:00:00.000Z', 70)]);
  const o = await weightView(one, S, { now: NOW });
  assert.equal(o.avg_7d, 70); assert.equal(o.avg_prev_7d, null); assert.equal(o.delta_7d, null); assert.equal(o.change_in_window, null);
});

const authOk = { authenticate: async () => ({ subject: S }) };
const authNo = { authenticate: async () => { throw new AppError(401, 'unauthenticated'); } };
const get = (app, path, method = 'GET') => app(new Request(`https://app.test${path}`, { method }));

test('API: /v1/derived/training e /v1/derived/weight richiedono autenticazione e sono di sola lettura', async () => {
  const db = await weightDb(); const t = await trainingDb();
  for (const p of ['/v1/derived/training', '/v1/derived/weight']) assert.equal((await get(createApp({ db, auth: authNo }), p)).status, 401);
  const app = createApp({ db: t, auth: authOk, now: () => NOW });
  const r = await get(app, '/v1/derived/training?limit=2'); assert.equal(r.status, 200);
  const body = await r.json(); assert.equal(body.workouts.length, 2); assert.equal(body.has_more, true);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const w = await (await get(createApp({ db, auth: authOk, now: () => NOW }), '/v1/derived/weight?days=30')).json();
  assert.equal(w.latest.kg, 71.85);
  for (const p of ['/v1/derived/training', '/v1/derived/weight']) assert.equal((await get(app, p, 'POST')).status, 405);
});
