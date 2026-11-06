import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { validateData, validTargets } from '../src/plan/schema.js';
import { resolveTargets, loadTargets, phaseValues, GOAL_TYPES } from '../src/coach/targets.js';
import { weightTrendInsight } from '../src/coach/rules-body.js';
import { weights } from './helpers/coach-fixtures.mjs';
import { targetsFrom, buildRequest, phaseForm } from '../public/plan-forms.js';
import { diffLines, targetsLine, planHeader, historyList } from '../public/plan.js';
import { reportView } from '../public/plan-report.js';
import { newDb } from './helpers/d1-shim.mjs';

const NOW = new Date('2026-11-06T12:00:00Z'), TODAY = '2026-11-06';
const mk = db => createApp({ db, auth: { authenticate: async () => ({ subject: 'owner', principal: 'owner' }) }, jobs: {}, now: () => NOW });
const call = async (app, path, body) => { const r = await app(new Request(`https://app.test${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, json: await r.json() }; };
const targetsOf = async app => (await call(app, '/v1/coach/review')).json.targets;

test('schema: tipo di obiettivo e target validi, chiavi sconosciute e valori fuori range rifiutati, vuoti omessi', () => {
  assert.deepEqual(validateData('phase', { name: 'Definizione 1', goal: null, method: null, goal_type: 'definizione', targets: { weight_pct_week: { min: -0.7, max: -0.3 }, sleep_min_hours: 7.5 } }), { name: 'Definizione 1', goal: null, method: null, goal_type: 'definizione', targets: { weight_pct_week: { min: -0.7, max: -0.3 }, sleep_min_hours: 7.5 } });
  assert.deepEqual(validateData('phase', { name: 'X', goal_type: null, targets: {} }), { name: 'X', goal: null, method: null }); // niente chiavi vuote: le versioni restano confrontabili
  for (const bad of [{ goal_type: 'bulk' }, { targets: { foo: 1 } }, { targets: { weight_pct_week: { min: 1, max: 0 } } }, { targets: { weight_pct_week: { min: -5, max: 0 } } }, { targets: { protein_g_per_kg: { min: 1 } } }, { targets: { strength_sessions_per_week: 9 } }, { targets: { strength_sessions_per_week: 3.5 } }, { targets: { sleep_min_hours: 2 } }, { targets: [] }])
    assert.throws(() => validateData('phase', { name: 'X', ...bad }), /invalid_/);
  assert.equal(validTargets(null), null);
});
test('preset e risoluzione: ritmo del peso con segno, tipo di obiettivo, retrocompatibilità del nome storico', () => {
  assert.deepEqual(phaseValues({ goal_type: 'definizione' }).weight_pct_week, { min: -0.7, max: -0.3 }); assert.deepEqual(phaseValues({ goal_type: 'definizione' }).protein_g_per_kg, { min: 1.8, max: 2.4 });
  assert.deepEqual(phaseValues({ goal_type: 'mantenimento' }).weight_pct_week, { min: -0.1, max: 0.1 });
  const o = phaseValues({ goal_type: 'definizione', targets: { weight_pct_week: { min: -1, max: -0.5 }, strength_sessions_per_week: 3 } }); assert.deepEqual(o.weight_pct_week, { min: -1, max: -0.5 }); assert.equal(o.strength_sessions_per_week, 3); assert.equal(o.goal_type, 'definizione');
  const legacy = resolveTargets({ weight_gain_pct_week: { min: 0.3, max: 0.6 } }); assert.deepEqual(legacy.weight_pct_week, { min: 0.3, max: 0.6 }); assert.deepEqual(legacy.weight_gain_pct_week, legacy.weight_pct_week);
  assert.deepEqual(resolveTargets({ weight_pct_week: { min: 5, max: 6 } }).weight_pct_week, { min: 0.25, max: 0.5 }); // fuori range: default
  assert.equal(resolveTargets({}).goal_type, null);
});
test('il Coach legge i target dalla fase attiva; senza fase o con fase chiusa torna ai default', async () => {
  const db = newDb(), app = mk(db);
  let t = await targetsOf(app); assert.equal(t.using_defaults, true); assert.equal(t.version, null);
  const { json: { phase_id } } = await call(app, '/v1/plan/phase/start', { name: 'Taglio', goal: 'Perdere grasso', start_date: '2026-10-20', goal_type: 'definizione', targets: { strength_sessions_per_week: 3 } });
  t = await targetsOf(app); assert.equal(t.using_defaults, false); assert.equal(t.version.source, 'phase'); assert.equal(t.version.phase, 'Taglio'); assert.equal(t.version.goal_type, 'definizione'); assert.equal(t.version.phase_id, phase_id);
  assert.deepEqual(t.values.weight_pct_week, { min: -0.7, max: -0.3 }); assert.equal(t.values.strength_sessions_per_week, 3); assert.deepEqual(t.values.protein_g_per_kg, { min: 1.8, max: 2.4 });
  await call(app, '/v1/plan/phase/close', { phase_id, last_day: '2026-11-05' });
  t = await targetsOf(app); assert.equal(t.using_defaults, true); assert.deepEqual(t.values.weight_pct_week, { min: 0.25, max: 0.5 });
});
test('modificare i target a metà fase = nuova versione con storico; i target seguono la data di validità', async () => {
  const db = newDb(), app = mk(db);
  const { json: { phase_id } } = await call(app, '/v1/plan/phase/start', { name: 'Massa', start_date: '2026-10-20', goal_type: 'massa' });
  const v1 = (await call(app, '/v1/plan')).json.active; assert.equal(v1.goal_type, 'massa');
  const r = await call(app, '/v1/plan/version', { kind: 'phase', phase_id, expected_version_id: v1.phase_version_id, valid_from: '2026-11-06', reason: 'ritmo più prudente', data: { name: 'Massa', goal: null, method: null, goal_type: 'massa', targets: { weight_pct_week: { min: 0.1, max: 0.3 } } } });
  assert.equal(r.status, 200);
  assert.deepEqual((await targetsOf(app)).values.weight_pct_week, { min: 0.1, max: 0.3 });
  const hist = (await call(app, `/v1/plan/history?entity=phase:${phase_id}`)).json.versions; assert.equal(hist.length, 2); assert.equal(hist[0].valid_to, '2026-11-06'); assert.deepEqual(hist[0].data.targets, undefined);
  assert.match(diffLines('phase', hist[0].data, hist[1].data).join(' '), /target — → peso 0,1–0,3 %\/sett\./);
  assert.equal((await call(app, '/v1/plan/version', { kind: 'phase', phase_id, expected_version_id: hist[1].id, valid_from: '2026-11-06', data: { name: 'Massa', goal: null, method: null, goal_type: 'massa', targets: { weight_pct_week: { min: 0.1, max: 0.3 } } } })).json.error, 'no_change');
  assert.equal((await call(app, '/v1/plan/phase/start', { name: 'Y', start_date: '2026-11-06', goal_type: 'boh' })).status, 422); // tipo non valido: rifiutato prima di ogni scrittura
});
test('fase senza tipo né target: si usa la riga storica di coach_targets (con tests_done); con la fase come fonte tests_done resta', async () => {
  const db = newDb(), app = mk(db);
  await db.prepare("INSERT INTO coach_targets (subject_id, valid_from, valid_to, phase, goal, targets_json, note, created_at) VALUES ('owner', '2026-10-01', NULL, 'massa', 'Massa storica', ?, NULL, '2026-10-01T00:00:00Z')").bind(JSON.stringify({ sleep_min_hours: 8, tests_done: { rep_test: '2026-10-15' } })).run();
  const { json: { phase_id } } = await call(app, '/v1/plan/phase/start', { name: 'Fase senza target', start_date: '2026-11-01' });
  let t = await targetsOf(app); assert.equal(t.version.source, 'coach_targets'); assert.equal(t.values.sleep_min_hours, 8);
  const v = (await call(app, '/v1/plan')).json.active;
  await call(app, '/v1/plan/version', { kind: 'phase', phase_id, expected_version_id: v.phase_version_id, valid_from: '2026-11-06', data: { name: 'Fase senza target', goal_type: 'mantenimento' } });
  t = await targetsOf(app); assert.equal(t.version.source, 'phase'); assert.deepEqual(t.values.weight_pct_week, { min: -0.1, max: 0.1 }); assert.equal(t.values.sleep_min_hours, 7); assert.equal(t.values.tests_done.rep_test, '2026-10-15');
});
test('regole: con obiettivo di definizione un calo nel ritmo previsto è "in linea"; con massa lo stesso calo è sotto', () => {
  const dec = i => 80 - 0.0457 * i; // ≈ −0,4 %/sett.
  const T = resolveTargets({}), D = phaseValues({ goal_type: 'definizione' });
  const m = weightTrendInsight(weights(28, dec), TODAY, T).insight, d = weightTrendInsight(weights(28, dec), TODAY, D).insight;
  assert.equal(d.data.verdict, 'dentro'); assert.equal(d.status, 'ok'); assert.match(d.summary, /in linea con l'obiettivo/); assert.match(d.evidence.join(' '), /\(definizione\)/);
  assert.notEqual(m.data.verdict, 'dentro'); assert.match(m.summary, /meno dell'obiettivo|rapid|scendendo/);
  const fast = weightTrendInsight(weights(28, i => 80 - 0.16 * i), TODAY, D).insight; assert.equal(fast.data.verdict, 'calo_rapido'); assert.match(fast.summary, /massa muscolare/);
  const slow = weightTrendInsight(weights(28, i => 80 - 0.01 * i), TODAY, D).insight; assert.equal(slow.data.verdict, 'sopra'); assert.match(slow.summary, /meno del previsto/);
  assert.match(weightTrendInsight(weights(28, i => 72 + 0.0386 * i), TODAY, T).insight.summary, /in linea con l'obiettivo/); // massa invariata
});

test('PWA: tipo di obiettivo e target nel modulo, richiesta, errori, riassunto, storico, intestazione, report', () => {
  const a = { id: 2, name: 'Taglio', goal: null, method: null, goal_type: 'definizione', targets: { weight_pct_week: { min: -0.7, max: -0.3 }, sleep_min_hours: 7.5 }, phase_version_id: 9, start_date: '2026-10-20', days: [] };
  const f = phaseForm({ mode: 'edit', a, today: TODAY }); assert.match(f, /<option value="definizione" selected>/); assert.match(f, /<details class="ptargets" open>/); assert.match(f, /name="w_min" type="text" inputmode="decimal" value="-0,7"/); assert.match(f, /value="7,5"/);
  assert.match(phaseForm({ mode: 'new', today: TODAY }), /<details class="ptargets">/);
  assert.deepEqual(targetsFrom({ w_min: '-0,7', w_max: '-0,3', p_min: '', p_max: '', sessions: '3', sleep_h: '7,5' }), { weight_pct_week: { min: -0.7, max: -0.3 }, strength_sessions_per_week: 3, sleep_min_hours: 7.5 });
  assert.equal(targetsFrom({}), null);
  assert.throws(() => targetsFrom({ w_min: '0,2' }), /sia il minimo sia il massimo/); assert.throws(() => targetsFrom({ p_min: '2', p_max: '1' }), /non può essere minore/); assert.throws(() => targetsFrom({ sessions: 'tre' }), /inserisci un numero/);
  const n = buildRequest('phase-new', { name: 'Taglio', goal: '', method: '', start_date: TODAY, goal_type: 'definizione', w_min: '-0,7', w_max: '-0,3' }, {}); assert.equal(n.body.goal_type, 'definizione'); assert.deepEqual(n.body.targets, { weight_pct_week: { min: -0.7, max: -0.3 } });
  const e = buildRequest('phase-edit', { name: 'Taglio', valid_from: TODAY, goal_type: '' }, { version: '9', phase: '2' }); assert.equal(e.body.data.goal_type, null); assert.equal(e.body.data.targets, null);
  assert.equal(targetsLine({ weight_pct_week: { min: -0.7, max: -0.3 }, protein_g_per_kg: { min: 1.8, max: 2.4 }, strength_sessions_per_week: 3 }), 'peso -0,7–-0,3 %/sett. · proteine 1,8–2,4 g/kg · 3 sedute/sett.'); assert.equal(targetsLine(null), '—');
  assert.match(planHeader({ active: a, phases: [], notes: [] }), /definizione/); assert.match(planHeader({ active: a, phases: [], notes: [] }), /Target: peso/);
  assert.match(historyList('phase', [{ valid_from: '2026-10-20', valid_to: null, data: { name: 'Taglio', goal_type: 'definizione' }, reason: null }]), /Taglio · definizione/);
  const base = { phase: { name: 'Taglio', goal: null, method: null, goal_type: 'definizione' }, targets: { weight_pct_week: { min: -0.7, max: -0.3 } }, period: { start: '2026-10-01', last_day: '2026-10-31', weeks: 4.4 }, weight: { start_kg: 80, end_kg: 78.5, change_kg: -1.5, rate_pct_week: -0.4 }, body_fat: { n: 0, start_pct: null, end_pct: null }, nutrition: { avg_kcal: null, complete_days: 0, calendar_days: 31, avg_protein_g: null, protein_g_per_kg: null }, sleep: { avg_min: null, nights: 0 }, steps: { avg: null, days: 0 }, scheda_changes: 0, scheda: [], notes: [], training: { strength_per_week: null, sessions_strength: 0, sessions_total: 0, avg_rest_sec: null, avg_rir_logged: null, rir_sets_with_value: 0, sets_per_muscle_week: {}, progression: [] } };
  const h = reportView(base); assert.match(h, /previsto −0,7…−0,3 %\/sett\./); assert.match(h, /· definizione/); assert.ok(!reportView({ ...base, targets: null }).includes('previsto'));
});
test('report alla chiusura: tipo di obiettivo e target della fase', async () => {
  const db = newDb(), app = mk(db);
  const { json: { phase_id } } = await call(app, '/v1/plan/phase/start', { name: 'Taglio', start_date: '2026-10-20', goal_type: 'definizione' });
  await call(app, '/v1/plan/phase/close', { phase_id, last_day: '2026-11-05' });
  const rep = (await call(app, `/v1/plan/report?phase_id=${phase_id}`)).json.report; assert.equal(rep.phase.goal_type, 'definizione'); assert.deepEqual(rep.targets.weight_pct_week, { min: -0.7, max: -0.3 }); assert.deepEqual(rep.targets.protein_g_per_kg, { min: 1.8, max: 2.4 });
});

test('obiettivo "forza": preset (volume contenuto, peso stabile o in leggero aumento) e validazione', () => {
  assert.ok(GOAL_TYPES.includes('forza')); const v = phaseValues({ goal_type: 'forza' });
  assert.deepEqual(v.weight_pct_week, { min: 0, max: 0.25 }); assert.deepEqual(v.sets_per_muscle_week, { min: 6, max: 12 }); assert.equal(v.goal_type, 'forza');
  assert.deepEqual(validateData('phase', { name: 'Forza 1', goal: null, method: null, goal_type: 'forza' })?.goal_type ?? 'forza', 'forza');
});
