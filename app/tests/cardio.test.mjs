import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { ingest } from '../src/ingest/ledger.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { isCardio, cardioMinutes, classify } from '../src/coach/muscles.js';
import { validateData } from '../src/plan/schema.js';
import { rxLine } from '../public/plan.js';
import { rxForm, buildRequest } from '../public/plan-forms.js';
import { adherenceView } from '../public/plan-adherence.js';
import { analyzeSessions } from '../src/coach/rules-training.js';
import { buildDossier } from '../src/ai/dossier.js';
import { newDb } from './helpers/d1-shim.mjs';

const NOW = new Date('2026-11-06T12:00:00Z');
let rid = 0; const uuid = () => `70000000-0000-4000-8000-${String(++rid).padStart(12, '0')}`;
const put = (db, records) => ingest({ db, raw: new MemoryRawStore(), now: () => NOW.toISOString() }, { subject: 'owner', source_system: 'lyfta', source_account: 'a', scope_id: 'full', request_id: uuid(), captured_at: NOW.toISOString(), artifact: JSON.stringify(records), records, scope_complete: false });
const w = (reps, kg) => ({ reps, external_load_kg: kg, rir: 2, warmup: false, duration_sec: null });
const dur = s => ({ reps: null, external_load_kg: null, rir: null, warmup: false, duration_sec: s, distance: 5 });
const session = (date, title, exercises) => ({ id: `lyfta:${date}:${title.replace(/[^A-Za-z0-9]/g, '')}`, domain: 'training', observed_at: `${date}T17:00:00.000Z`, payload: { local_date: date, title, exercises } });
const mk = db => createApp({ db, auth: { authenticate: async () => ({ subject: 'owner', principal: 'owner' }) }, jobs: {}, now: () => NOW });
const call = async (app, path, body) => { const r = await app(new Request(`https://app.test${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json', origin: 'https://app.test' } : {}, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, json: await r.json() }; };

test('riconoscimento del cardio e minuti registrati', () => {
  for (const n of ['Run on Treadmill', 'Walking on Treadmill', 'Corsa', 'Cyclette', 'Cycling', 'Ellittica']) assert.equal(isCardio(n), true, n);
  for (const n of ['Barbell Bench Press', 'Barbell Bent Over Row', 'Pull-up', 'Riscaldamento', 'Side Plank']) assert.equal(isCardio(n), false, n);
  assert.equal(cardioMinutes({ sets: [dur(1500), dur(300), { ...dur(600), warmup: true }] }), 30); assert.equal(cardioMinutes({ sets: [w(8, 50)] }), null);
  assert.equal(classify('Run on Treadmill'), 'ignore'); // resta fuori dai muscoli
});
test('piano: durata del cardio validata, riga leggibile, form e richiesta', () => {
  assert.deepEqual(validateData('rx', { order: 0, sets: 1, duration_min: 30 }).duration_min, 30);
  assert.throws(() => validateData('rx', { order: 0, sets: 1, duration_min: 0 })); assert.throws(() => validateData('rx', { order: 0, sets: 1, duration_min: 'x' }));
  assert.equal(validateData('rx', { order: 0, sets: 3, reps_min: 5 }).duration_min, undefined);
  assert.equal(rxLine({ sets: 1, duration_min: 30, rest_sec: null }), '30 min'); assert.equal(rxLine({ sets: 4, reps_min: 3, reps_max: 5, rir: 1, rest_sec: 200 }), '4 serie × 3–5 · RIR 1 · rec 3:20');
  assert.match(rxForm({ mode: 'new', day: 'Corsa', e: null, today: '2026-11-06', phaseStart: '2026-10-10', phaseId: 1 }), /name="duration_min"/);
});
test('un allenamento "Corsa" separato: giorno secondario, minuti confrontati, fuori dalle serie di forza', async () => {
  const db = newDb(), app = mk(db);
  const strength = d => session(d, 'A - Upper 1', [{ name: 'Barbell Bench Press', configured_rest_sec: 200, sets: [w(5, 80), w(5, 80), w(5, 80), w(5, 80)] }]);
  const run = (d, s, title = 'Corsa') => session(d, title, [{ name: 'Run on Treadmill', configured_rest_sec: 0, sets: [dur(s)] }]);
  await put(db, [strength('2026-10-12'), strength('2026-10-19'), run('2026-10-14', 1800), run('2026-10-21', 1500), run('2026-10-28', 600), strength('2026-11-02'), session('2026-11-03', 'Altro', [{ name: 'Run on Treadmill', sets: [dur(1200)] }])]);
  const { json: { phase_id } } = await call(app, '/v1/plan/phase/start', { name: 'Forza', start_date: '2026-10-10' });
  await call(app, '/v1/plan/import-lyfta', { phase_id, from: '2026-10-10', to: '2026-11-06', titles: ['A - Upper 1', 'Corsa'] });
  const plan = (await call(app, '/v1/plan')).json, corsa = plan.active.days.find(d => d.label === 'Corsa'); assert.ok(corsa); assert.equal(corsa.exercises[0].duration_min, 10); // l'importazione prende l'ULTIMA seduta (10 min)
  const rxv = corsa.exercises[0]; const up = await call(app, '/v1/plan/version', { kind: 'rx', phase_id, day: 'Corsa', exercise: 'Run on Treadmill', expected_version_id: rxv.version_id, valid_from: '2026-10-10', data: { order: 0, sets: 1, duration_min: 30 }, reason: 'durata del piano' });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  const a = (await call(app, '/v1/plan/adherence')).json.adherence;
  assert.equal(a.sets.completion_pct, 100); assert.equal(a.sets.prescribed, 12); // 3 sedute da 4 serie: la corsa non entra
  assert.equal(a.secondary.sessions, 3); assert.equal(a.secondary.minutes_done, 65); assert.equal(a.secondary.minutes_prescribed, 90); assert.equal(a.secondary.completion_pct, 72); // 30+25+10 su 30×3
  const s = a.recent.filter(m => m.secondary); assert.deepEqual(s.map(m => [m.date, m.minutes_done, m.exercises[0].status]).sort(), [['2026-10-14', 30, 'completo'], ['2026-10-21', 25, 'completo'], ['2026-10-28', 10, 'parziale']]);
  assert.equal(a.cardio.sessions, 4); assert.equal(a.cardio.minutes, 85); // include la corsa registrata con un altro titolo
  assert.ok(a.per_day.find(d => d.day === 'Corsa').secondary); assert.equal(a.weeks.reduce((n, x) => n + x.sessions, 0), 3);
  const html = adherenceView(a); assert.match(html, /Cardio e attività secondarie/); assert.match(html, /secondaria/); assert.match(html, /30 min · previsti 30 min/);
  const d = await buildDossier(db, 'owner', { now: NOW, sendNotes: false });
  assert.match(JSON.stringify(d.plan), /Run on Treadmill 30 min \[cardio, attività secondaria/); assert.equal(d.adherence_to_plan.cardio_logged_in_lyfta.sessions, 4); assert.equal(d.adherence_to_plan.secondary_activities_vs_plan.sessions, 3);
});
test('il cardio non è mai una seduta di forza né un esercizio "extra" di una seduta di pesi', () => {
  const a = analyzeSessions([{ id: 'x', date: '2026-11-03', title: 'Corsa', exercises: [{ name: 'Run on Treadmill', sets: [dur(1800)] }] }]); assert.equal(a[0].strength, false); assert.equal(a[0].total, 0);
});

test('tenuta per serie (plank): secondi, anche sotto 1 minuto', async () => {
  const { validateData } = await import('../src/plan/schema.js'); const { rxLine } = await import('../public/plan.js'); const { buildRequest } = await import('../public/plan-forms.js');
  assert.equal(validateData('rx', { order: 0, sets: 3, hold_sec: 36 }).hold_sec, 36);
  assert.throws(() => validateData('rx', { order: 0, sets: 3, hold_sec: 2 })); assert.throws(() => validateData('rx', { order: 0, sets: 3, hold_sec: 'x' }));
  assert.equal(validateData('rx', { order: 0, sets: 3 }).hold_sec, undefined);
  assert.equal(rxLine({ sets: 3, hold_sec: 40, rest_sec: 60 }), '3 serie × 0:40 tenuta · rec 1:00');
  const r = buildRequest('rx-new', { exercise: 'Side Plank', sets: '3', hold: '0:40', rest: '', reps_min: '', reps_max: '', rir: '', duration_min: '', valid_from: '2026-11-09' }, { phaseId: '1', day: 'Corsa' });
  assert.equal(r.body.data.hold_sec, 40); assert.throws(() => buildRequest('rx-new', { exercise: 'x', sets: '3', hold: '0:02', rest: '', rir: '', valid_from: '2026-11-09' }, { phaseId: '1', day: 'd' }));
});

test('plank da Lyfta: tenuta letta dalle serie, per lato = metà serie, aderenza con serie doppie', async () => {
  const { suggestDays } = await import('../src/plan/lyfta-suggest.js'); const { compareSession } = await import('../src/plan/adherence.js'); const { rxLine } = await import('../public/plan.js'); const { rxForm } = await import('../public/plan-forms.js');
  const set = d => ({ duration_sec: d, reps: null, warmup: false });
  const day = suggestDays([{ id: 1, date: '2026-11-07', title: '6.UPPER', exercises: [{ name: 'Side Plank', sets: [set(40), set(36), set(40), set(38)] }, { name: 'Front Plank', sets: [set(60), set(60), set(60)] }] }]).find(d => d.title === '6.UPPER');
  const side = day.exercises.find(e => e.exercise === 'Side Plank'), front = day.exercises.find(e => e.exercise === 'Front Plank');
  assert.deepEqual([side.sets, side.hold_sec, side.per_side], [2, 39, true]); assert.deepEqual([front.sets, front.hold_sec, front.per_side], [3, 60, undefined]);
  assert.equal(rxLine({ ...side, rest_sec: null }), '2 serie per lato × 0:39 tenuta');
  const c = compareSession([{ exercise: 'Side Plank', order: 0, sets: 2, hold_sec: 40, per_side: true }], [{ name: 'Side Plank', sets: [set(40), set(36), set(40), set(38)] }]);
  assert.deepEqual([c.rows[0].sets_prescribed, c.rows[0].sets_done, c.rows[0].status], [4, 4, 'completo']);
  assert.match(rxForm({ mode: 'edit', day: 'd', e: { exercise: 'Side Plank', sets: 2, per_side: true, version_id: 1 }, today: '2026-11-09', phaseStart: '2026-10-10', phaseId: 1 }), /name="per_side"[^>]*checked/);
});

test('ordine esercizi: nuovo = in fondo al giorno, modifica senza posizione la conserva, posizione esplicita rispettata', async () => {
  const { buildRequest, rxForm } = await import('../public/plan-forms.js');
  const q = { exercise: 'X', sets: '2', rest: '', rir: '', hold: '', duration_min: '', valid_from: '2026-11-06' };
  assert.equal('order' in buildRequest('rx-new', { ...q }, { phaseId: '1', day: 'd' }).body.data, false);
  assert.equal(buildRequest('rx-new', { ...q, order: '5' }, { phaseId: '1', day: 'd' }).body.data.order, 4);
  assert.match(rxForm({ mode: 'edit', day: 'd', e: { exercise: 'X', sets: 2, order: 3, version_id: 1 }, today: '2026-11-09', phaseStart: '2026-10-10', phaseId: 1 }), /name="order" value="4"/);
});

test('ordine esercizi lato server: nuovo in fondo, modifica conserva la posizione, posizione esplicita rispettata', async () => {
  const db = newDb(), app = mk(db);
  const { json: { phase_id } } = await call(app, '/v1/plan/phase/start', { name: 'Forza', start_date: '2026-10-10' });
  await call(app, '/v1/plan/version', { kind: 'day', phase_id, day: 'D', valid_from: '2026-10-10', data: { order: 0 } });
  const add = (exercise, data, extra = {}) => call(app, '/v1/plan/version', { kind: 'rx', phase_id, day: 'D', exercise, valid_from: '2026-10-10', data, ...extra });
  assert.equal((await add('Zeta', { order: 0, sets: 3, reps_min: 5 })).status, 200);
  assert.equal((await add('Alfa', { order: 2, sets: 3, reps_min: 5 })).status, 200);
  assert.equal((await add('Side Plank', { sets: 2, hold_sec: 40, per_side: true })).status, 200); // senza posizione: in fondo
  const ex = async () => (await call(app, '/v1/plan')).json.active.days.find(d => d.label === 'D').exercises;
  let l = await ex(); assert.deepEqual(l.map(e => e.exercise), ['Zeta', 'Alfa', 'Side Plank']); assert.equal(l[2].order, 3);
  const sp = l[2]; assert.equal((await add('Side Plank', { sets: 3, hold_sec: 40, per_side: true }, { expected_version_id: sp.version_id })).status, 200); // modifica senza posizione: resta ultimo
  l = await ex(); assert.equal(l[2].order, 3); assert.equal(l[2].sets, 3);
  assert.equal((await add('Side Plank', { order: 0, sets: 3, hold_sec: 40, per_side: true }, { expected_version_id: l[2].version_id, valid_from: '2026-10-11' })).status, 200);
  l = await ex(); assert.equal(l[0].exercise, 'Side Plank'); // order 0 esplicito, a pari merito con Zeta ma prima per nome
});
