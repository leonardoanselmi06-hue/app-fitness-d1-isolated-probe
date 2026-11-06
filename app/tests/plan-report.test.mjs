import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { ingest } from '../src/ingest/ledger.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { suggestDays } from '../src/plan/lyfta-suggest.js';
import { buildPhaseReport } from '../src/plan/report.js';
import { newDb } from './helpers/d1-shim.mjs';

const NOW = new Date('2026-11-06T12:00:00Z');
let rid = 0; const uuid = () => `50000000-0000-4000-8000-${String(++rid).padStart(12, '0')}`;
const put = (db, source_system, scope_id, records) => ingest({ db, raw: new MemoryRawStore(), now: () => NOW.toISOString() }, { subject: 'owner', source_system, source_account: 'a', scope_id, request_id: uuid(), captured_at: NOW.toISOString(), artifact: JSON.stringify(records), records, scope_complete: false });
const set = (reps, kg, rir = null, extra = {}) => ({ reps, external_load_kg: kg, rir, warmup: false, duration_sec: null, ...extra });
const session = (date, title, exercises) => ({ id: `lyfta:${date}:${title.replace(/[^A-Za-z0-9]/g, '')}`, domain: 'training', observed_at: `${date}T17:00:00.000Z`, payload: { local_date: date, title, exercises } });
const ex = (name, rest, sets) => ({ name, configured_rest_sec: rest, type: 'weight_reps', sets });
const mk = db => createApp({ db, auth: { authenticate: async () => ({ subject: 'owner', principal: 'owner' }) }, jobs: {}, now: () => NOW });
const call = async (app, path, body) => { const r = await app(new Request(`https://app.test${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, json: await r.json() }; };

async function seed(db) {
  const recs = [];
  const dates = ['2026-10-06', '2026-10-09', '2026-10-13', '2026-10-16', '2026-10-20', '2026-10-23', '2026-10-27', '2026-10-30'];
  dates.forEach((d, i) => recs.push(session(d, i % 2 ? 'B - Lower 1' : 'A - Upper 1', i % 2
    ? [ex('Squat', 180, [set(8, 60 + i, 2), set(8, 60 + i, 2), set(8, 60 + i, 3)])]
    : [ex('Riscaldamento', 0, [{ reps: null, warmup: false, duration_sec: null }]), ex('Barbell Bench Press', 195, [set(6, 40, null, { warmup: true }), set(8, 50 + i * 2, 2), set(8, 50 + i * 2, 2), set(7, 50 + i * 2, 1), set(6, 50 + i * 2, 1)]), ex('Side Plank', 70, [set(null, null, null, { duration_sec: 40 }), set(null, null, null, { duration_sec: 60 })])])));
  recs.push(session('2026-11-05', '1 - Corsa Facile - Z2', [ex('Riscaldamento', 0, [{ reps: null, warmup: false, duration_sec: null }])]));
  await put(db, 'lyfta', 'full', recs);
  await put(db, 'health_connect', 'weight', ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03'].map((d, i) => ({ id: `weight:${i}`, domain: 'body', observed_at: `${d}T06:30:00.000Z`, payload: { metric: 'body_weight_kg', kg: 70 + i * 0.3, time: `${d}T06:30:00.000Z`, local_date: d, origin: 'x' } })));
  await put(db, 'health_connect', 'body_fat', [['2026-10-06', 22.4], ['2026-11-03', 21.8]].map(([d, pct], i) => ({ id: `bodyfat:${i}`, domain: 'body', observed_at: `${d}T06:30:00.000Z`, payload: { metric: 'body_fat_pct', pct, time: `${d}T06:30:00.000Z`, local_date: d, origin: 'x' } })));
  const food = (d, meal, kcal, protein, n) => ({ id: `fs:${d}:${meal}:${n}`, domain: 'nutrition', observed_at: `${d}T10:00:00.000Z`, payload: { local_date: d, meal, name: meal, nutrients: { calories: kcal, protein } } });
  const nut = []; for (const d of ['2026-10-20', '2026-10-21', '2026-10-22']) { nut.push(food(d, 'Breakfast', 500, 30, 1), food(d, 'Lunch', 900, 60, 2), food(d, 'Dinner', 800, 50, 3)); } nut.push(food('2026-10-23', 'Lunch', 900, 60, 2)); // incompleto
  await put(db, 'fatsecret', 'day:x', nut);
  await put(db, 'sleep_as_android', 'sleep', ['2026-10-20', '2026-10-21'].map((d, i) => ({ id: `sleep:${i}`, domain: 'sleep', observed_at: `${d}T21:30:00.000Z`, payload: { start_at: `${d}T21:30:00.000Z`, end_at: `${d}T05:30:00.000Z`.replace(d, new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10)), local_date: new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10), duration_min: 420 + i * 60, short: false } })));
  await put(db, 'health_connect', 'steps', ['2026-10-20', '2026-10-21'].map((d, i) => ({ id: `steps:${d}`, domain: 'activity', observed_at: null, payload: { metric: 'steps_total', local_date: d, count: 8000 + i * 2000, origins: [] } })));
}

test('proposta da Lyfta: ultima seduta per titolo, serie di lavoro, range ripetizioni, RIR più frequente, recupero; esclude riscaldamento e cardio', () => {
  const s = suggestDays([session('2026-10-06', 'A - Upper 1', [ex('Barbell Bench Press', 150, [set(8, 50, 2)])]).payload, session('2026-10-09', 'A - Upper 1', [ex('Barbell Bench Press ', 195, [set(6, 40, null, { warmup: true }), set(8, 60, 2), set(10, 60, 2), set(6, 60, 1)]), ex('Riscaldamento', 0, [{ reps: null, duration_sec: null }]), ex('Side Plank', 70, [set(null, null, null, { duration_sec: 40 })])]).payload, session('2026-11-05', '1 - Corsa Facile - Z2', [ex('Riscaldamento', 0, [{ reps: null }])]).payload].map(p => ({ id: p.title + p.local_date, date: p.local_date, title: p.title, exercises: p.exercises })));
  assert.equal(s.length, 1); assert.equal(s[0].title, 'A - Upper 1'); assert.equal(s[0].sessions, 2);
  const bench = s[0].exercises[0]; assert.deepEqual(bench, { exercise: 'Barbell Bench Press', sets: 3, reps_min: 6, reps_max: 10, rir: 2, rest_sec: 195, method: null });
  assert.equal(s[0].exercises[1].exercise, 'Side Plank'); assert.equal(s[0].exercises[1].reps_min, null); assert.equal(s[0].exercises.length, 2);
});
test('import da Lyfta: crea giorni ed esercizi in un colpo solo, reimportare salta, il server ricalcola', async () => {
  const db = newDb(), app = mk(db); await seed(db);
  const { json: { phase_id } } = await call(app, '/v1/plan/phase/start', { name: 'Massa', start_date: '2026-10-05' });
  const sug = await call(app, '/v1/plan/suggest?from=2026-10-05&to=2026-11-06'); assert.deepEqual(sug.json.days.map(d => d.title), ['A - Upper 1', 'B - Lower 1']);
  const imp = await call(app, '/v1/plan/import-lyfta', { phase_id, from: '2026-10-05', to: '2026-11-06', titles: ['A - Upper 1', 'B - Lower 1', 'Inesistente'] });
  assert.equal(imp.status, 200); assert.deepEqual(imp.json, { days_added: 2, exercises_added: 3, skipped: 0 });
  const again = await call(app, '/v1/plan/import-lyfta', { phase_id, from: '2026-10-05', to: '2026-11-06', titles: ['A - Upper 1'] }); assert.deepEqual(again.json, { days_added: 0, exercises_added: 0, skipped: 3 });
  const v = (await call(app, '/v1/plan')).json; assert.equal(v.active.days.length, 2); assert.equal(v.active.days[0].exercises[0].exercise, 'Barbell Bench Press'); assert.equal(v.active.days[0].exercises[0].rest_sec, 195);
  assert.equal((await call(app, '/v1/plan/import-lyfta', { phase_id, from: 'x', to: '2026-11-06', titles: [] })).status, 422);
  assert.equal((await call(app, '/v1/plan/suggest?from=2026-12-01&to=2026-11-01')).status, 422);
});
test('report di fase: peso, grasso, alimentazione (solo giorni completi), sonno, passi, allenamento, progressione, recupero medio, scheda', async () => {
  const db = newDb(), app = mk(db); await seed(db);
  const { json: { phase_id } } = await call(app, '/v1/plan/phase/start', { name: 'Massa', goal: 'Aumentare massa', method: 'Upper/Lower', start_date: '2026-10-05' });
  await call(app, '/v1/plan/import-lyfta', { phase_id, from: '2026-10-05', to: '2026-11-06', titles: ['A - Upper 1', 'B - Lower 1'] });
  const c = await call(app, '/v1/plan/phase/close', { phase_id, last_day: '2026-11-04' }); assert.equal(c.status, 200);
  const r = (await call(app, `/v1/plan/report?phase_id=${phase_id}`)).json.report;
  assert.equal(r.phase.name, 'Massa'); assert.equal(r.period.days, 31); assert.equal(r.period.last_day, '2026-11-04');
  assert.equal(r.weight.n_days, 5); assert.equal(r.weight.start_kg, 70.15); assert.equal(r.weight.end_kg, 71.05); assert.ok(r.weight.change_kg > 0.5); assert.ok(r.weight.rate_pct_week > 0);
  assert.deepEqual([r.body_fat.start_pct, r.body_fat.end_pct, r.body_fat.n], [22.4, 21.8, 2]);
  assert.equal(r.nutrition.complete_days, 3); assert.equal(r.nutrition.avg_kcal, 2200); assert.equal(r.nutrition.avg_protein_g, 140); assert.equal(r.nutrition.logged_days, 4); assert.ok(r.nutrition.note); // 4° giorno incompleto escluso
  assert.equal(r.sleep.nights, 2); assert.equal(r.sleep.avg_min, 450); assert.equal(r.steps.avg, 9000);
  assert.equal(r.training.sessions_total, 8); assert.equal(r.training.sessions_strength, 4); assert.equal(r.training.strength_per_week, 0.9); // le sedute B hanno 3 serie dirette: sotto la soglia di 4, non contano come sedute di forza assert.equal(r.training.avg_rest_sec > 0, true);
  assert.ok(r.training.sets_per_muscle_week.Petto > 0); const bench = r.training.progression.find(p => p.exercise === 'Barbell Bench Press'); assert.equal(bench.trend, 'progresso'); assert.equal(bench.metric, 'e1rm_kg');
  assert.equal(r.scheda[0].label, 'A - Upper 1'); assert.equal(r.scheda[0].exercises[0].exercise, 'Barbell Bench Press'); assert.equal(r.scheda_changes, 0);
  // il report non cambia anche se i dati cambiano dopo
  await put(db, 'health_connect', 'weight', [{ id: 'weight:99', domain: 'body', observed_at: '2026-10-07T06:30:00.000Z', payload: { metric: 'body_weight_kg', kg: 99, time: '2026-10-07T06:30:00.000Z', local_date: '2026-10-07', origin: 'x' } }]);
  assert.equal((await call(app, `/v1/plan/report?phase_id=${phase_id}`)).json.report.weight.n_days, 5);
});
test('report con dati assenti: nulla è inventato (null, mai zero) e non fallisce', async () => {
  const db = newDb(); const r = await buildPhaseReport(db, 'owner', { id: 1, start_date: '2026-09-01' }, '2026-09-30');
  assert.equal(r.weight.start_kg, null); assert.equal(r.weight.n_days, 0); assert.equal(r.nutrition.avg_kcal, null); assert.equal(r.nutrition.complete_days, 0); assert.equal(r.sleep.avg_min, null); assert.equal(r.steps.avg, null);
  assert.equal(r.training.avg_rest_sec, null); assert.equal(r.training.avg_rir_logged, null); assert.deepEqual(r.training.progression, []); assert.deepEqual(r.scheda, []); assert.equal(r.body_fat.start_pct, null);
});
test('report: fase più lunga di 60 giorni (finestra dell\'alimentazione a blocchi) senza doppioni', async () => {
  const db = newDb(); await put(db, 'fatsecret', 'day:y', ['2026-07-10', '2026-09-20'].flatMap(d => ['Breakfast', 'Lunch', 'Dinner'].map((m, i) => ({ id: `fs:${d}:${m}`, domain: 'nutrition', observed_at: `${d}T10:00:00.000Z`, payload: { local_date: d, meal: m, name: m, nutrients: { calories: 700, protein: 40 } } }))));
  const r = await buildPhaseReport(db, 'owner', { id: 1, start_date: '2026-07-01' }, '2026-10-15');
  assert.equal(r.nutrition.complete_days, 2); assert.equal(r.nutrition.avg_kcal, 2100); assert.equal(r.nutrition.calendar_days, 107);
});
