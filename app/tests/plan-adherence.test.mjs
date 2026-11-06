import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { ingest } from '../src/ingest/ledger.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { compareSession, computeAdherence } from '../src/plan/adherence.js';
import { adherenceView, adherenceSummaryView } from '../public/plan-adherence.js';
import { newDb } from './helpers/d1-shim.mjs';

const NOW = new Date('2026-11-06T12:00:00Z');
let rid = 0; const uuid = () => `60000000-0000-4000-8000-${String(++rid).padStart(12, '0')}`;
const put = (db, records) => ingest({ db, raw: new MemoryRawStore(), now: () => NOW.toISOString() }, { subject: 'owner', source_system: 'lyfta', source_account: 'a', scope_id: 'full', request_id: uuid(), captured_at: NOW.toISOString(), artifact: JSON.stringify(records), records, scope_complete: false });
const set = (reps, kg, rir = null, extra = {}) => ({ reps, external_load_kg: kg, rir, warmup: false, duration_sec: null, ...extra });
const ex = (name, rest, sets) => ({ name, configured_rest_sec: rest, type: 'weight_reps', sets });
const session = (date, title, exercises) => ({ id: `lyfta:${date}:${title.replace(/[^A-Za-z0-9]/g, '')}`, domain: 'training', observed_at: `${date}T17:00:00.000Z`, payload: { local_date: date, title, exercises } });
const mk = db => createApp({ db, auth: { authenticate: async () => ({ subject: 'owner', principal: 'owner' }) }, jobs: {}, now: () => NOW });
const call = async (app, path, body) => { const r = await app(new Request(`https://app.test${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, json: await r.json() }; };
const rx = (exercise, o = {}) => ({ exercise, sets: 3, reps_min: 6, reps_max: 10, rir: 2, rest_sec: 150, order: 0, ...o });

test('una seduta contro la scheda: completo, parziale, saltato, sostituito, extra; ripetizioni nel range, RIR e recupero', () => {
  const presc = [rx('Barbell Bench Press', { order: 0 }), rx('Lat Pulldown', { order: 1 }), rx('Barbell Curl', { order: 2, sets: 3 }), rx('Squat', { order: 3, rest_sec: 180 })];
  const { rows, extras } = compareSession(presc, [
    ex('Barbell Bench Press', 150, [set(8, 60, 2), set(10, 60, 1), set(5, 60, 0)]),
    ex('Lat Pulldown', 150, [set(10, 50, 3), set(9, 50, 3)]),
    ex('Hammer Curl', 90, [set(12, 14, null), set(12, 14, null)]),
    ex('Riscaldamento', 0, [{ reps: null, warmup: false }]),
    ex('Squat', 120, [set(8, 80, 2, { warmup: true })]),
  ]);
  const by = n => rows.find(r => r.exercise === n);
  assert.equal(by('Barbell Bench Press').status, 'completo'); assert.deepEqual(by('Barbell Bench Press').reps, { below: 1, in: 2, above: 0 });
  assert.equal(by('Barbell Bench Press').rir_diff, -1); assert.equal(by('Barbell Bench Press').rest_match, true);
  assert.equal(by('Lat Pulldown').status, 'parziale'); assert.equal(by('Lat Pulldown').rir_diff, 1);
  assert.equal(by('Barbell Curl').status, 'sostituito'); assert.equal(by('Barbell Curl').replaced_by, 'Hammer Curl'); assert.deepEqual(extras, []);
  assert.equal(by('Squat').status, 'saltato'); assert.equal(by('Squat').sets_done, 0); assert.equal(by('Squat').rest_match, null); // solo riscaldamento = nessuna serie di lavoro
  assert.equal(by('Squat').reps, null); assert.equal(by('Squat').rir_diff, null);
});
test('esercizio fuori scheda senza saltati = extra; riscaldamento e cardio non contano', () => {
  const { rows, extras } = compareSession([rx('Barbell Bench Press')], [ex('Barbell Bench Press', 150, [set(8, 60), set(8, 60), set(8, 60), set(8, 60)]), ex('Lateral Raise', 60, [set(15, 8), set(15, 8)]), ex('Walking on Treadmill', 0, [set(10, 0)])]);
  assert.equal(rows[0].status, 'completo'); assert.equal(rows[0].sets_done, 4); assert.deepEqual(extras, [{ exercise: 'Lateral Raise', sets: 2 }]);
});

const phase = { id: 1 };
const v = (entity_key, kind, data, valid_from, valid_to = null, id = 0) => ({ id, entity_key, kind, valid_from, valid_to, data });
test('la scheda in vigore quel giorno: recupero 2:30 fino all\'11 nov, poi 3:00; sedute senza giorno in scheda separate', () => {
  const versions = [
    v('day:1:a-upper', 'day', { label: 'A - Upper', order: 0 }, '2026-10-01'), v('day:1:b-lower', 'day', { label: 'B - Lower', order: 1 }, '2026-10-01'),
    v('rx:1:a-upper:barbell-bench-press', 'rx', { day: 'A - Upper', ...rx('Barbell Bench Press', { rest_sec: 150 }) }, '2026-10-01', '2026-10-20'),
    v('rx:1:a-upper:barbell-bench-press', 'rx', { day: 'A - Upper', ...rx('Barbell Bench Press', { rest_sec: 180 }) }, '2026-10-20'),
  ];
  const s = (date, title, rest, n = 3) => ({ id: `${date}${title}`, date, title, exercises: [ex('Barbell Bench Press', rest, Array.from({ length: n }, () => set(8, 60, 2)))] });
  const sessions = [s('2026-10-10', 'A - Upper', 150), s('2026-10-24', 'A - Upper', 150), s('2026-10-27', 'A - Upper', 180, 2), { id: 'x', date: '2026-10-12', title: 'Gambe extra', exercises: [ex('Squat', 120, [set(8, 80), set(8, 80), set(8, 80), set(8, 80)])] }, { id: 'c', date: '2026-10-13', title: 'Corsa', exercises: [ex('Riscaldamento', 0, [{ reps: null }])] }];
  const a = computeAdherence({ phase, versions, sessions, start: '2026-10-01', last: '2026-11-05' });
  assert.equal(a.sessions.matched, 3); assert.equal(a.sessions.unmatched_strength, 1); assert.equal(a.sessions.unmatched_other, 1);
  assert.deepEqual(a.sets, { prescribed: 9, done: 8, completion_pct: 89 });
  assert.equal(a.rest_match_pct, 67); assert.equal(a.rest_compared, 3); // 10 ott ok (150), 24 ott NON ok (scheda 180, Lyfta 150), 27 ott ok
  assert.deepEqual(a.days_never_done, ['B - Lower']); assert.deepEqual(a.unmatched_titles, [{ title: 'Gambe extra', sessions: 1 }]);
  assert.equal(a.exercises.partial, 1); assert.equal(a.per_day[0].sessions, 3); assert.equal(a.recent[0].date, '2026-10-27');
  assert.equal(a.weeks.length, 6); assert.equal(a.weeks[0].partial, true);
  assert.equal(a.note, null);
});
test('senza sedute o senza scheda: valori null, mai zero', () => {
  const a = computeAdherence({ phase, versions: [], sessions: [], start: '2026-10-01', last: '2026-11-05' });
  assert.equal(a.sets.completion_pct, null); assert.equal(a.rir_diff_avg, null); assert.equal(a.reps_in_range_pct, null); assert.equal(a.rest_match_pct, null); assert.match(a.note, /Meno di 3/);
});

test('API: /v1/plan/adherence sulla fase attiva, una fase chiusa, nessuna fase; report di fase contiene il riepilogo', async () => {
  const db = newDb(), app = mk(db);
  assert.deepEqual((await call(app, '/v1/plan/adherence')).json, { phase_id: null, adherence: null });
  const dates = ['2026-10-06', '2026-10-09', '2026-10-13', '2026-10-16'];
  await put(db, dates.map((d, i) => session(d, 'A - Upper 1', [ex('Barbell Bench Press', 195, [set(8, 50, 2), set(8, 50, 2), set(7, 50, 1)].slice(0, i === 3 ? 2 : 3)), ex('Side Plank', 70, [set(null, null, null, { duration_sec: 40 })])])));
  const { json: { phase_id } } = await call(app, '/v1/plan/phase/start', { name: 'Massa', start_date: '2026-10-05' });
  await call(app, '/v1/plan/import-lyfta', { phase_id, from: '2026-10-05', to: '2026-11-06', titles: ['A - Upper 1'] });
  const r = await call(app, '/v1/plan/adherence'); assert.equal(r.status, 200); const a = r.json.adherence;
  assert.equal(a.sessions.matched, 4); assert.equal(a.exercises.partial, 0); // l'importazione prende l'ULTIMA seduta (2 serie): è la scheda
  assert.equal(a.sets.completion_pct, 100); assert.equal(a.rest_match_pct, 100);
  assert.equal((await call(app, '/v1/plan/adherence?phase_id=abc')).status, 422);
  assert.equal((await call(app, '/v1/plan/adherence?phase_id=999')).json.adherence, null);
  await call(app, '/v1/plan/phase/close', { phase_id, last_day: '2026-10-14' });
  const closed = (await call(app, `/v1/plan/adherence?phase_id=${phase_id}`)).json.adherence; assert.equal(closed.range.to, '2026-10-14'); assert.equal(closed.sessions.matched, 3);
  const rep = (await call(app, `/v1/plan/report?phase_id=${phase_id}`)).json.report; assert.equal(rep.adherence.sessions.matched, 3); assert.equal(rep.adherence.recent, undefined);
});

test('rendering: sezione completa, riepilogo nel report, escape, vuoti', () => {
  const a = computeAdherence({ phase, versions: [v('day:1:a-b', 'day', { label: 'A <b>', order: 0 }, '2026-10-01'), v('rx:1:a-b:squat', 'rx', { day: 'A <b>', ...rx('Squat') }, '2026-10-01')], sessions: [{ id: '1', date: '2026-10-05', title: 'A <b>', exercises: [ex('Squat', 120, [set(8, 80, 3), set(8, 80, 3)])] }], start: '2026-10-01', last: '2026-10-10' });
  const html = adherenceView(a); assert.match(html, /Aderenza alla scheda/); assert.match(html, /A &lt;b&gt;/); assert.ok(!html.includes('<b>')); assert.match(html, /parziale/); assert.match(html, /\+1/); assert.match(html, /67 %/);
  assert.match(adherenceSummaryView({ ...a, worst_exercises: a.per_exercise }), /Aderenza alla scheda/); assert.equal(adherenceSummaryView(null), ''); assert.equal(adherenceView(null), '');
  assert.match(adherenceView(computeAdherence({ phase, versions: [], sessions: [], start: '2026-10-01', last: '2026-10-10' })), /Nessuna seduta/);
});
