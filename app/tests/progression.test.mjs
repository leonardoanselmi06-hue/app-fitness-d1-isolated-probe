import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExposures, seriesOf, classifyExercise, classifyAll } from '../src/coach/progression.js';
import { addDays } from '../src/coach/stats.js';

const TODAY = '2026-11-06';
const st = (reps, load, rir = null) => ({ reps, external_load_kg: load, rir, warmup: false, duration_sec: null });
// Serie per un esercizio: `pts` = [giorniFa, reps, carico, rir]
const sess = (name, pts) => pts.map(([ago, reps, load, rir], i) => ({ id: `${name}${i}`, date: addDays(TODAY, -ago), title: 'A', exercises: [{ name, sets: [st(reps, load, rir), st(reps, load, rir)] }] }));
const weekly = (name, f, weeks = 12) => Array.from({ length: weeks }, (_, w) => { const ago = (weeks - 1 - w) * 7 + 1; const [reps, load, rir] = f(w); return [ago, reps, load, rir]; });
const classify = (name, pts) => classifyExercise(buildExposures(sess(name, pts))[0], TODAY);

test('carico che sale con stesso RIR = in progresso; piatto per settimane = ferma con giorni dall\'ultimo massimo', () => {
  const up = classify('Barbell Bench Press', weekly('x', w => [8, 60 + w * 2.5, 2]));
  assert.equal(up.status, 'in progresso'); assert.equal(up.metric, 'e1rm_kg'); assert.equal(up.confidence, 'alta'); assert.ok(up.pct_week > 0.5); assert.equal(up.rir_used, true);
  const flat = classify('Barbell Bench Press', weekly('x', () => [8, 80, 2]));
  assert.equal(flat.status, 'ferma'); assert.ok(flat.days_since_best >= 70); assert.equal(flat.pct_week, 0);
});
test('stesso carico ma RIR che scende (più sforzo) non è progresso; carico più alto con RIR peggiore non conta', () => {
  // il carico sale (a occhio sembra progresso) ma il RIR passa da 3 a 0: l'e1RM aggiustato non cresce => non è progresso
  const harder = classify('Barbell Bench Press', weekly('x', w => [8, 80 + w * 0.5, Math.max(0, 3 - Math.floor(w / 3))]));
  assert.notEqual(harder.status, 'in progresso');
  // stesso carico, RIR che sale da 0 a 3: l'allenato migliora (più riserva allo stesso carico)
  const easier = classify('Barbell Bench Press', weekly('x', w => [8, 80, Math.min(3, Math.floor(w / 3))]));
  assert.equal(easier.status, 'in progresso');
});
test('senza RIR: forma semplice e fiducia bassa', () => {
  const r = classify('Barbell Bench Press', weekly('x', w => [8, 60 + w * 2.5, null]));
  assert.equal(r.rir_used, false); assert.equal(r.confidence, 'bassa'); assert.equal(r.status, 'in progresso');
});
test('in calo: pendenza ≤ −1 %/sett. e ultime due esposizioni ≥ 3 % sotto le prime', () => {
  const r = classify('Barbell Bench Press', weekly('x', w => [8, 100 - w * 2.5, 2]));
  assert.equal(r.status, 'in calo'); assert.ok(r.pct_week <= -1); assert.ok(r.change_pct <= -3);
});
test('dati insufficienti: poche esposizioni, concentrate, fuori finestra', () => {
  assert.match(classify('Barbell Bench Press', [[3, 8, 60, 2], [10, 8, 60, 2]]).reason, /2 esposizioni/);
  assert.match(classify('Barbell Bench Press', [[1, 8, 60, 2], [5, 8, 60, 2], [9, 8, 60, 2]]).reason, /concentrate in 8 giorni/);
  const old = classify('Barbell Bench Press', [[40, 8, 60, 2], [50, 8, 60, 2], [60, 8, 60, 2]]); assert.equal(old.status, 'insufficiente'); assert.equal(old.n_window, 0); assert.equal(old.last_value, null);
  assert.equal(classifyAll([], TODAY).key, 'insufficient');
});
test('un nuovo massimo recente rispetto al periodo precedente conta come progresso anche con pendenza piccola', () => {
  const pts = [...weekly('x', () => [8, 80, 2]).map(([a, r, l, i]) => [a + 35, r, l, i]).slice(-3), [26, 8, 80, 2], [19, 8, 80, 2], [12, 8, 80, 2], [5, 8, 82.5, 2]];
  const r = classify('Barbell Bench Press', pts); assert.equal(r.status, 'in progresso');
});
test('serie con più di 12 ripetizioni: tetto a 12 per Epley; esposizioni dello stesso giorno si uniscono; riscaldamenti e addome esclusi', () => {
  const [b] = buildExposures([{ id: '1', date: TODAY, exercises: [{ name: 'Barbell Bench Press', sets: [st(15, 40, 2), { ...st(5, 40, null), warmup: true }] }, { name: 'Barbell Bench Press', sets: [st(8, 60, 2)] }, { name: 'Crunch Floor', sets: [st(20, null)] }, { name: 'Riscaldamento', sets: [st(10, null)] }] }]);
  assert.equal(buildExposures([{ id: '1', date: TODAY, exercises: [{ name: 'Crunch Floor', sets: [st(20, null)] }] }]).length, 0);
  assert.equal(b.exposures.length, 1); assert.equal(b.exposures[0].sets.length, 2);
  const s = seriesOf(b); assert.equal(s.points.length, 1); assert.ok(s.points[0].value > 0);
});
test('classificazione globale: progressione, calo, stallo lungo, stabile, mista, insufficiente', () => {
  const mk = (...fs) => fs.flatMap(([name, f]) => sess(name, weekly(name, f)));
  const up = w => [8, 60 + w * 2.5, 2], flat = () => [8, 80, 2], down = w => [8, 100 - w * 2.5, 2];
  const names = ['Barbell Bench Press', 'Barbell Bent Over Row', 'Barbell Full Squat', 'Barbell Curl'];
  assert.equal(classifyAll(mk(...names.map(n => [n, up])), TODAY).key, 'progressing');
  assert.equal(classifyAll(mk(...names.map(n => [n, down])), TODAY).key, 'declining');
  assert.equal(classifyAll(mk(...names.map(n => [n, flat])), TODAY).key, 'stalling');
  // fermi da poco: il massimo è di ~5 settimane fa (meno di 6) => STABILE, non stallo
  const recentFlat = names.flatMap(n => sess(n, [[38, 8, 80, 2], [31, 8, 80, 2], [24, 8, 80, 2], [17, 8, 80, 2], [10, 8, 80, 2], [3, 8, 80, 2]]));
  assert.equal(classifyAll(recentFlat, TODAY).key, 'stable');
  assert.equal(classifyAll(mk(['Barbell Bench Press', up], ['Barbell Bent Over Row', flat], ['Barbell Full Squat', down], ['Barbell Curl', flat]), TODAY).key, 'mixed');
  const few = classifyAll(mk(['Barbell Bench Press', up], ['Barbell Curl', up]), TODAY); assert.equal(few.key, 'insufficient'); assert.equal(few.label, 'DATI INSUFFICIENTI');
  const mixedIn = classifyAll([...mk(...names.map(n => [n, up])), ...sess('Pull-up', [[2, 8, null, 2]])], TODAY); assert.equal(mixedIn.counts.insufficient, 1); assert.equal(mixedIn.key, 'progressing');
});

import { reportView } from '../public/plan-report.js';
test('report di fase: mostra la classificazione globale di progressione', () => {
  const r = { phase: { name: 'Massa', goal: null, method: null }, period: { start: '2026-10-01', last_day: '2026-10-31', weeks: 4.4 },
    weight: { start_kg: null, end_kg: null, change_kg: null, rate_pct_week: null }, body_fat: { n: 0, start_pct: null, end_pct: null }, nutrition: { avg_kcal: null, complete_days: 0, calendar_days: 31, avg_protein_g: null, protein_g_per_kg: null },
    sleep: { avg_min: null, nights: 0 }, steps: { avg: null, days: 0 }, scheda_changes: 0, scheda: [], notes: [],
    training: { strength_per_week: null, sessions_strength: 0, sessions_total: 0, avg_rest_sec: null, avg_rir_logged: null, rir_sets_with_value: 0, sets_per_muscle_week: {}, progression: [], progression_overall: { key: 'stalling', label: 'IN STALLO', evaluable: 5, counts: { progressing: 0, stalled: 4, declining: 1, insufficient: 2 }, window_days: 28 } } };
  const html = reportView(r); assert.match(html, /IN STALLO/); assert.match(html, /4 fermi/); assert.match(html, /ultime 4 sett\./);
  assert.ok(!reportView({ ...r, training: { ...r.training, progression_overall: undefined } }).includes('Progressione</span>'));
});
