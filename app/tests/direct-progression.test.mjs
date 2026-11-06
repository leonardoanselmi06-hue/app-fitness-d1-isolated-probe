import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExposures, classifyExercise, compareDirect, exposureSummary } from '../src/coach/progression.js';
import { secondaryOf, classify } from '../src/coach/muscles.js';
import { analyzeSessions, volumeInsight, progressionInsight } from '../src/coach/rules-training.js';
import { resolveTargets } from '../src/coach/targets.js';
import { addDays } from '../src/coach/stats.js';

const TODAY = '2026-11-06';
const sets = (n, reps, load, rir = null) => Array.from({ length: n }, () => ({ reps, external_load_kg: load, rir, warmup: false, duration_sec: null }));
const sess = (name, pts) => pts.map(([ago, n, reps, load, rir], i) => ({ id: `${name}${i}`, date: addDays(TODAY, -ago), title: 'A', exercises: [{ name, sets: sets(n, reps, load, rir) }] }));
const direct = pts => classifyExercise(buildExposures(sess('Barbell Bench Press', pts))[0], TODAY).direct;

test('esempio 1: 8×3 a 20 kg → 8×3 a 24 kg (settimana 1 → 3) = progressione per carico', () => {
  const d = direct([[14, 3, 8, 20, null], [0, 3, 8, 24, null]]);
  assert.equal(d.available, true); assert.equal(d.verdict, 'up'); assert.match(d.reasons.join(' '), /carico 20 → 24 kg/); assert.equal(d.text, '20 kg 3×8 → 24 kg 3×8');
});
test('esempio 2: 8×3 → 10×3 a 20 kg = progressione per ripetizioni', () => {
  const d = direct([[7, 3, 8, 20, null], [0, 3, 10, 20, null]]);
  assert.equal(d.verdict, 'up'); assert.match(d.reasons.join(' '), /ripetizioni 8 → 10/);
});
test('esempio 3: 8×3 a 20 kg RIR 1 → RIR 2 = progressione (stesso lavoro con più margine)', () => {
  const d = direct([[7, 3, 8, 20, 1], [0, 3, 8, 20, 2]]);
  assert.equal(d.verdict, 'up'); assert.match(d.reasons.join(' '), /RIR 1 → 2/);
});
test('invariato, in calo, più serie, carico su ma ripetizioni molto giù', () => {
  assert.equal(direct([[7, 3, 8, 20, 2], [0, 3, 8, 20, 2]]).verdict, 'same');
  assert.equal(direct([[7, 3, 8, 20, 2], [0, 3, 8, 20, 1]]).verdict, 'down'); // più sforzo a pari lavoro
  assert.equal(direct([[7, 3, 8, 20, null], [0, 3, 6, 20, null]]).verdict, 'down');
  assert.equal(direct([[7, 3, 8, 20, null], [0, 4, 8, 20, null]]).verdict, 'up'); assert.match(direct([[7, 3, 8, 20, null], [0, 4, 8, 20, null]]).reasons.join(' '), /serie 3 → 4/);
  assert.equal(direct([[7, 3, 8, 20, null], [0, 3, 3, 22, null]]).verdict, 'down'); // 22×3 vale meno di 20×8 (e1RM)
});
test('ripetizioni più alte ma RIR più basso (stesso lavoro efficace) = invariato', () => {
  assert.equal(direct([[7, 3, 8, 20, 2], [0, 3, 10, 20, 0]]).verdict, 'same');
});
test('non disponibile: una sola seduta o troppo vicine; la finestra non cambia lo stato e1RM', () => {
  assert.equal(direct([[0, 3, 8, 20, null]]).available, false);
  assert.match(direct([[3, 3, 8, 20, null], [0, 3, 8, 24, null]]).reason, /3 giorni/);
  const r = classifyExercise(buildExposures(sess('Barbell Bench Press', [[14, 3, 8, 20, null], [0, 3, 8, 24, null]]))[0], TODAY); assert.equal(r.status, 'insufficiente'); // l'e1RM resta prudente con 2 sedute
});
test('serie di scarico a carico minore non falsano il confronto (conta il carico più alto)', () => {
  const [e] = buildExposures([{ id: 'x', date: TODAY, exercises: [{ name: 'Barbell Bench Press', sets: [...sets(2, 5, 80, 2), ...sets(1, 10, 60, null)] }] }]);
  const s = exposureSummary(e.exposures[0]); assert.equal(s.load, 80); assert.equal(s.sets, 2); assert.equal(s.reps, 5);
});
test('senza carico esterno (corpo libero): confronto sulle ripetizioni', () => {
  const pts = [[7, 3, 8, null, null], [0, 3, 10, null, null]].map(([ago, n, reps, load, rir], i) => ({ id: `p${i}`, date: addDays(TODAY, -ago), title: 'A', exercises: [{ name: 'Pull-up', sets: sets(n, reps, load, rir) }] }));
  const d = classifyExercise(buildExposures(pts)[0], TODAY).direct; assert.equal(d.verdict, 'up'); assert.equal(d.text, 'corpo libero 3×8 → corpo libero 3×10');
});
test('compareDirect: carico presente solo in una delle due = non chiaro', () => {
  assert.equal(compareDirect({ load: null, sets: 3, reps: 8, rir: null }, { load: 20, sets: 3, reps: 8, rir: null }).verdict, 'unclear');
});
test('l\'insight di progressione mostra i valori reali', () => {
  const s = [...sess('Barbell Bench Press', [[21, 3, 8, 20, 2], [14, 3, 8, 20, 2], [7, 3, 8, 22, 2], [0, 3, 8, 24, 2]]), ...sess('Barbell Bent Over Row', [[21, 3, 8, 50, 2], [14, 3, 8, 50, 2], [7, 3, 8, 52.5, 2], [0, 3, 8, 55, 2]]), ...sess('Barbell Full Squat', [[21, 3, 8, 60, 2], [14, 3, 8, 62.5, 2], [7, 3, 8, 65, 2], [0, 3, 8, 67.5, 2]])];
  assert.match(progressionInsight(s, TODAY).evidence.join(' '), /valori reali: 20 kg 3×8 RIR 2 → 24 kg 3×8 RIR 2 \(migliora\); carico 20 → 24 kg/);
});

test('muscoli primari e secondari', () => {
  assert.deepEqual(secondaryOf('Barbell Bench Press'), ['tricipiti', 'spalle']); assert.equal(classify('Barbell Bench Press'), 'petto');
  assert.deepEqual(secondaryOf('Pull-up'), ['bicipiti']); assert.deepEqual(secondaryOf('Barbell Bent Over Row'), ['bicipiti', 'spalle']);
  assert.deepEqual(secondaryOf('Close-Grip Bench Press'), ['petto', 'spalle']); // primario tricipiti
  assert.deepEqual(secondaryOf('Barbell Curl'), []); assert.deepEqual(secondaryOf('Riscaldamento'), []); assert.deepEqual(secondaryOf('Esercizio mai visto'), []);
});
test('volume: i bicipiti con solo tirate non risultano a zero ma "indiretti"; il minimo usa il volume efficace', () => {
  const T = resolveTargets({}), mk = (ago, name, n) => ({ id: `${name}${ago}`, date: addDays(TODAY, -ago), title: 'A', exercises: [{ name, sets: sets(n, 8, 50, 2) }] });
  const analyzed = analyzeSessions([mk(8, 'Pull-up', 10), mk(9, 'Barbell Bent Over Row', 10), mk(15, 'Pull-up', 10), mk(16, 'Barbell Bent Over Row', 10)]);
  const v = volumeInsight(analyzed, TODAY, T), bic = v.data.muscles.find(m => m.muscle === 'bicipiti');
  assert.equal(bic.sets_per_week, 0); assert.equal(bic.indirect_sets_per_week, 20); assert.equal(bic.effective_sets_per_week, 10); assert.equal(bic.state, 'ok');
  assert.match(v.evidence.join(' '), /Bicipiti: 0 serie dirette\/sett\. \+ 20 indirette \(efficaci 10\)/);
});
