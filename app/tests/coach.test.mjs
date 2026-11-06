import test from 'node:test';
import assert from 'node:assert/strict';
import { linreg, mondayOf, tCrit95, fmt, sgn } from '../src/coach/stats.js';
import { classify, countsAsSet, epley } from '../src/coach/muscles.js';
import { resolveTargets, loadTargets, DEFAULT_TARGETS } from '../src/coach/targets.js';
import { weightTrendInsight, weighinInsight, sleepInsight, freshnessInsight } from '../src/coach/rules-body.js';
import { nutritionQuality, nutritionLoggingInsight, proteinInsight, energyInsight } from '../src/coach/rules-nutrition.js';
import { analyzeSessions, adherenceInsight, volumeInsight, progressionInsight } from '../src/coach/rules-training.js';
import { planTests } from '../src/coach/tests-plan.js';
import { buildReview } from '../src/coach/review.js';
import { TODAY, weights, noise, nutrition, sleep, sessions, exercise, assertAllFinite } from './helpers/coach-fixtures.mjs';

const T = resolveTargets(null);

// ---------- statistica e utilità ----------
test('stat: regressione lineare, IC e valori non calcolabili', () => {
  const r = linreg([0, 1, 2, 3, 4].map(x => ({ x, y: 10 + 2 * x })));
  assert.equal(r.slope, 2); assert.equal(r.n, 5); assert.ok(r.se < 1e-9);
  assert.equal(linreg([{ x: 0, y: 1 }, { x: 1, y: 2 }]), null); // meno di 3 punti
  assert.equal(linreg([0, 0, 0].map(x => ({ x, y: x }))), null); // x tutti uguali
  assert.equal(tCrit95(0), null); assert.equal(tCrit95(5), 2.571); assert.equal(tCrit95(100), 1.96);
  assert.equal(mondayOf('2026-11-06'), '2026-11-02'); assert.equal(mondayOf('2026-11-08'), '2026-11-02'); assert.equal(mondayOf('2026-11-02'), '2026-11-02');
  assert.equal(fmt(1.25, 1), '1,3'); assert.equal(fmt(null), '—'); assert.equal(sgn(-0.31, 2), '−0,31'); assert.equal(sgn(0.5, 1), '+0,5');
});

test('muscoli: classificazione, serie dirette ed e1RM', () => {
  const cases = { 'Barbell Bench Press': 'petto', 'Pull-up': 'schiena', 'Dumbbell Lateral Raise': 'spalle', 'Barbell Curl': 'bicipiti', 'Dumbbell Seated Biceps Curl to Shoulder Press': 'bicipiti',
    'Triceps Dip': 'tricipiti', 'Barbell Close-Grip Bench Press': 'tricipiti', 'Dumbbell Seated Reverse Grip One Arm Overhead Tricep Extension': 'tricipiti', 'Barbell Full Squat': 'quadricipiti', 'Walking Lunge': 'quadricipiti',
    'Lever Seated Leg Curl': 'femorali', 'Romanian Deadlift': 'femorali', 'Standing Leg Calf Raise': 'polpacci', 'Lying Leg Raise': 'addome', 'Front Plank': 'addome', 'Lying Neck Flexion': 'collo',
    'Walking on Treadmill': 'ignore', 'Riscaldamento': 'ignore', 'Couch Stretch': 'ignore', 'Squat mobility Complex': 'ignore', 'Esercizio mai visto': 'unmapped', '  Pull-up  ': 'schiena', '': 'unmapped', 'Standing One Arm Extension': 'unmapped' };
  for (const [n, m] of Object.entries(cases)) assert.equal(classify(n), m, n);
  assert.equal(countsAsSet({ reps: 8 }, 'petto'), true);
  assert.equal(countsAsSet({ reps: 8, warmup: true }, 'petto'), false);
  assert.equal(countsAsSet({ reps: 8, completed: false }, 'petto'), true); // is_completed di Lyfta non è affidabile
  assert.equal(countsAsSet({ reps: null, duration_sec: 40 }, 'petto'), false); // il tempo conta solo per addome/collo
  assert.equal(countsAsSet({ reps: null, duration_sec: 40 }, 'addome'), true);
  assert.equal(countsAsSet({ reps: null, duration_sec: 5 }, 'addome'), false);
  assert.equal(epley(60, 5), 70); assert.equal(epley(null, 5), null); assert.equal(epley(60, 13), null); assert.equal(epley(0, 5), null);
});

test('target: default, valori non validi tornano al default, versione in vigore', async () => {
  assert.deepEqual(resolveTargets(undefined).protein_g_per_kg, DEFAULT_TARGETS.protein_g_per_kg);
  const t = resolveTargets({ protein_g_per_kg: { min: 2, max: 1 }, strength_sessions_per_week: -3, sleep_min_hours: 7.5, muscles: ['petto', 'cervello'], tests_done: { rep_test: '2026-10-01', x: 'ieri' } });
  assert.deepEqual(t.protein_g_per_kg, DEFAULT_TARGETS.protein_g_per_kg); assert.equal(t.strength_sessions_per_week, 4);
  assert.equal(t.sleep_min_hours, 7.5); assert.deepEqual(t.muscles, DEFAULT_TARGETS.muscles); assert.deepEqual(t.tests_done, { rep_test: '2026-10-01' });
  const { newDb } = await import('./helpers/d1-shim.mjs');
  const db = newDb();
  const none = await loadTargets(db, 'owner', TODAY);
  assert.equal(none.using_defaults, true); assert.equal(none.version, null);
  const ins = (from, to, phase, json) => db.prepare('INSERT INTO coach_targets (subject_id, valid_from, valid_to, phase, goal, targets_json, created_at) VALUES (?,?,?,?,?,?,?)').bind('owner', from, to, phase, 'g', json, 'x').run();
  await ins('2026-09-01', '2026-11-01', 'vecchia', '{"strength_sessions_per_week":6}');
  await ins('2026-11-01', null, 'massa', '{"strength_sessions_per_week":3}');
  await ins('2026-12-01', null, 'futura', '{}');
  const cur = await loadTargets(db, 'owner', TODAY);
  assert.equal(cur.version.phase, 'massa'); assert.equal(cur.values.strength_sessions_per_week, 3); assert.equal(cur.using_defaults, false);
  assert.equal((await loadTargets(db, 'owner', '2026-10-15')).version.phase, 'vecchia'); // lo storico resta consultabile
  assert.equal((await loadTargets(db, 'altro', TODAY)).using_defaults, true);
  const bad = await ins('2026-11-03', null, 'rotta', '{non json'); void bad;
  assert.equal((await loadTargets(db, 'owner', TODAY)).values.strength_sessions_per_week, 4); // JSON illeggibile => default
  db.raw.exec('DROP TABLE coach_targets');
  assert.equal((await loadTargets(db, 'owner', TODAY)).using_defaults, true); // migrazione non applicata
});

// ---------- peso ----------
test('peso: dentro / sotto / sopra / calo rapido / incerto / dati insufficienti', () => {
  const run = kg => weightTrendInsight(weights(28, kg), TODAY, T).insight;
  const dentro = run(i => 72 + 0.0386 * i + noise(i)); // +0,37 %/sett.
  assert.equal(dentro.data.verdict, 'dentro'); assert.equal(dentro.status, 'ok');
  assert.equal(run(i => 72 + noise(i)).data.verdict, 'sotto');
  assert.equal(run(i => 72 + 0.12 * i + noise(i)).data.verdict, 'sopra');
  const calo = run(i => 80 - 0.2 * i + noise(i));
  assert.equal(calo.data.verdict, 'calo_rapido'); assert.equal(calo.status, 'attenzione');
  const incerto = weightTrendInsight(weights(28, i => 72 + 0.0386 * i + (i % 3 - 1) * 1.2, { every: 4 }), TODAY, T).insight;
  assert.equal(incerto.data.verdict, 'incerto'); assert.equal(incerto.status, 'info');
  const poche = weightTrendInsight(weights(28, () => 72, { every: 13 }), TODAY, T);
  assert.equal(poche.insight.status, 'insufficiente'); assert.equal(poche.trend, null);
  const corto = weightTrendInsight(weights(10, i => 72 + i), TODAY, T); // 10 pesate in 10 giorni: arco troppo breve
  assert.equal(corto.insight.status, 'insufficiente');
  assert.equal(weightTrendInsight({ daily: [], raw: [] }, TODAY, T).insight.status, 'insufficiente');
});

test('pesate: poche, fuori fascia, regolari; freschezza', () => {
  assert.equal(weighinInsight(weights(28, () => 72, { every: 7 }), TODAY).status, 'attenzione');
  assert.equal(weighinInsight(weights(28, () => 72, { hour: 14 }), TODAY).status, 'attenzione');
  assert.equal(weighinInsight(weights(28, () => 72, { hour: 8 }), TODAY).status, 'ok');
  assert.equal(weighinInsight({ daily: [], raw: [] }, TODAY).status, 'attenzione');
  assert.equal(freshnessInsight(weights(28, () => 72), TODAY), null);
  assert.match(freshnessInsight(weights(20, () => 72, { every: 1 }).daily.slice(0, 5) && { daily: weights(20, () => 72).daily.slice(0, 10) }, TODAY).summary, /giorni fa/);
  assert.match(freshnessInsight({ daily: [] }, TODAY).summary, /Nessuna pesata/);
});

// ---------- alimentazione ----------
test('diario: giorno completo = pranzo + cena + colazione o altro; incompleti, pochi giorni, voci senza calorie', () => {
  const ok = nutritionLoggingInsight(nutritionQuality(nutrition(() => 3000), TODAY), TODAY);
  assert.equal(ok.status, 'ok'); assert.equal(ok.data.complete, 14);
  const incQ = nutritionQuality(nutrition(() => 3000, 150, k => (k % 2 ? ['Breakfast', 'Dinner'] : ['Lunch', 'Dinner', 'Other'])), TODAY); // dispari: manca il pranzo; pari: completo con "Altro"
  assert.equal(incQ.days.find(d => d.date === '2026-11-05').state, 'incomplete'); assert.equal(incQ.days.find(d => d.date === '2026-11-05').reason, 'manca il pranzo');
  assert.equal(incQ.days.find(d => d.date === '2026-11-04').state, 'complete');
  const inc = nutritionLoggingInsight(incQ, TODAY);
  assert.equal(inc.status, 'attenzione'); assert.equal(inc.data.complete, 7); assert.match(inc.evidence.join(' '), /5\/11 \(manca il pranzo\)/);
  const poche = nutritionLoggingInsight(nutritionQuality(nutrition(k => (k % 2 ? 3000 : undefined)), TODAY), TODAY);
  assert.equal(poche.status, 'attenzione'); assert.match(poche.summary, /Solo 7 giorni su 14/);
  const vuoto = nutritionLoggingInsight(nutritionQuality(nutrition(() => undefined), TODAY), TODAY);
  assert.equal(vuoto.status, 'attenzione'); assert.equal(vuoto.data.complete, 0); assert.match(vuoto.evidence.join(' '), /senza alcuna voce: 14/);
  const senzaKcal = nutritionQuality(nutrition(k => (k === 1 ? null : 3000)), TODAY); // voce senza calorie: incompleto, non zero
  const d1 = senzaKcal.days.find(d => d.date === '2026-11-05'); assert.equal(d1.state, 'incomplete'); assert.match(d1.reason, /1 voce senza calorie/); assert.equal(d1.kcal, null);
  assert.equal(nutritionQuality(nutrition(() => 3000), TODAY).days.length, 28);
  const solo = nutritionQuality(nutrition(() => 3000, 150, () => ['Lunch', 'Dinner']), TODAY); // senza colazione né altro
  assert.match(solo.days[0].reason, /manca colazione o altro/);
});

test('proteine: sotto, in linea, sopra, dati insufficienti', () => {
  const w = weights(28, () => 72, { hour: 8 });
  const run = g => proteinInsight(nutritionQuality(nutrition(() => 3000, g), TODAY), w, TODAY, T);
  const basse = run(100); assert.equal(basse.status, 'attenzione'); assert.match(basse.action, /15 g/); // 1,6*72 = 115,2 -> +15
  assert.equal(run(130).status, 'ok'); assert.equal(run(200).status, 'info');
  assert.equal(proteinInsight(nutritionQuality(nutrition(k => (k < 4 ? 3000 : undefined)), TODAY), w, TODAY, T).status, 'insufficiente');
  assert.equal(proteinInsight(nutritionQuality(nutrition(() => 3000), TODAY), { daily: [], raw: [] }, TODAY, T).status, 'insufficiente');
});

test('fabbisogno: stima, soglie di confidenza, plausibilità e nessun numero se incerto', () => {
  const trendOf = f => weightTrendInsight(weights(28, f), TODAY, T).trend;
  const stable = trendOf(i => 72 + noise(i)); // pendenza ~0 => fabbisogno ~ apporto
  const q = intake => nutritionQuality(nutrition(() => intake), TODAY);
  const basso = energyInsight(q(2500), stable, TODAY, T);
  assert.equal(basso.status, 'attenzione'); assert.equal(basso.data.confidence, 'alta');
  assert.ok(Math.abs(basso.data.tdee_kcal - 2500) < 100); assert.ok(basso.data.target_kcal[0] > 2500);
  assert.match(basso.action, /Porta l'apporto/);
  const crescita = trendOf(i => 72 + 0.0386 * i + noise(i));
  const ok = energyInsight(q(2900), crescita, TODAY, T); // tdee ~ 2900 - 0,0386*7700 = 2603; target ~2603+300..600 => 2900..3200
  assert.equal(ok.status, 'ok');
  const veloce = trendOf(i => 72 + 0.12 * i + noise(i)); // cresce troppo in fretta con 3500 kcal: fabbisogno ~2576
  const sopra = energyInsight(q(3500), veloce, TODAY, T); assert.equal(sopra.status, 'attenzione'); assert.match(sopra.action, /Riporta/);
  assert.equal(energyInsight(q(2500), null, TODAY, T).status, 'insufficiente');
  assert.equal(energyInsight(nutritionQuality(nutrition(k => (k < 6 ? 2500 : undefined)), TODAY), stable, TODAY, T).status, 'insufficiente');
  const rumoroso = trendOf(i => 72 + (i % 3 - 1) * 3); // IC larghissimo => confidenza bassa => nessun numero consigliato
  const incerto = energyInsight(q(2500), rumoroso, TODAY, T);
  assert.equal(incerto.status, 'insufficiente'); assert.equal(incerto.data.target_kcal, undefined); assert.equal(incerto.action, null);
  assert.equal(energyInsight(q(900), stable, TODAY, T).status, 'insufficiente'); // fabbisogno non plausibile (< 1500)
  assert.ok(energyInsight(q(2500), crescita, TODAY, { ...T, weight_gain_pct_week: { min: 0.25, max: 0.5 } }).data.target_kcal[0] >= 1800);
});

// ---------- sonno ----------
test('sonno: sotto obiettivo, in linea, dati insufficienti; notti brevi escluse', () => {
  assert.equal(sleepInsight(sleep([400, 410, 420, 400, 390, 410, 400]), T).status, 'attenzione');
  assert.match(sleepInsight(sleep([400, 410, 420, 400, 390, 410, 400]), T).action, /minuti/);
  const ok = sleepInsight(sleep([450, 440, 460, 430, 450, 470, 440]), T); assert.equal(ok.status, 'ok'); assert.equal(ok.data.under6, 0);
  assert.equal(sleepInsight(sleep([450, 440, 460]), T).status, 'insufficiente');
  assert.equal(sleepInsight(sleep([450, 30, 460, 440, 450, 470, 440]), T).data.avg_min, 452); // la notte da 30 min non entra
});

// ---------- allenamento ----------
test('costanza: in linea, sotto obiettivo, nessuna seduta', () => {
  const day = analyzeSessions(sessions());
  const ok = adherenceInsight(day, TODAY, T); assert.equal(ok.status, 'ok'); assert.deepEqual(ok.data.weeks.map(w => w.sessions), [4, 4, 4]); assert.equal(ok.data.this_week, 3);
  const meno = adherenceInsight(analyzeSessions(sessions({ skipAfter: '2026-10-19' })), TODAY, T);
  assert.equal(meno.status, 'attenzione'); assert.deepEqual(meno.data.weeks.map(w => w.sessions), [4, 0, 0]);
  assert.equal(adherenceInsight([], TODAY, T).status, 'attenzione');
  const corte = analyzeSessions([{ id: 'x', date: '2026-10-27', exercises: [exercise('Barbell Bench Press', 3)] }]); // 3 serie: non è una seduta
  assert.equal(corte[0].strength, false);
  const cardio = analyzeSessions([{ id: 'y', date: '2026-10-27', exercises: [exercise('Riscaldamento', 10), exercise('Walking on Treadmill', 10)] }]);
  assert.equal(cardio[0].total, 0);
});

test('volume: in linea, muscolo scoperto, frequenza bassa, volume alto, non riconosciuti', () => {
  const ok = volumeInsight(analyzeSessions(sessions()), TODAY, T);
  assert.equal(ok.status, 'ok'); assert.equal(ok.data.muscles.find(m => m.muscle === 'petto').sets_per_week, 12);
  const senza = volumeInsight(analyzeSessions(sessions({ without: ['Standing Leg Calf Raise'] })), TODAY, T);
  assert.equal(senza.status, 'attenzione'); assert.match(senza.action, /Polpacci \(\+10 serie\)/);
  assert.equal(senza.data.muscles.find(m => m.muscle === 'polpacci').sets_per_week, 0);
  const alto = volumeInsight(analyzeSessions(sessions({ setsPerExercise: 12 })), TODAY, T); assert.equal(alto.status, 'info');
  const una = sessions().filter(s => s.title === 'A' && new Date(s.date).getUTCDay() === 1 || s.title === 'B'); // A solo il lunedì => petto 1×/sett.
  const freq = volumeInsight(analyzeSessions(una.map(s => (s.title === 'A' ? { ...s, exercises: s.exercises.map(e => ({ ...e, sets: [...e.sets, ...e.sets] })) } : s))), TODAY, T);
  assert.equal(freq.status, 'attenzione'); assert.match(freq.action, /distribuisci su 2 giorni/);
  const sess = sessions(); sess.find(x => x.date === '2026-10-27').exercises.push(exercise('Esercizio mai visto', 4));
  assert.match(volumeInsight(analyzeSessions(sess), TODAY, T).evidence.join(' '), /non riconosciuti.*Esercizio mai visto/);
  const custom = volumeInsight(analyzeSessions(sessions()), TODAY, { ...T, muscles: ['petto'] }); assert.equal(custom.data.muscles.length, 1);
});

test('progressione: in progresso, stallo, dati insufficienti, senza carico = ripetizioni', () => {
  const su = progressionInsight(sessions({ step: 2.5 }), TODAY); assert.equal(su.status, 'ok'); assert.equal(su.data.overall, 'progressing'); assert.ok(su.data.exercises.every(e => e.status === 'in progresso'));
  const ferma = progressionInsight(sessions({ step: 0 }), TODAY); assert.equal(ferma.status, 'attenzione'); assert.equal(ferma.data.overall, 'stalling'); assert.match(ferma.action, /una ripetizione/);
  assert.equal(progressionInsight(sessions().slice(0, 5), TODAY).status, 'insufficiente');
  assert.equal(progressionInsight([]).status, 'insufficiente');
  const bw = []; for (let w = 0; w < 8; w++) bw.push({ id: `p${w}`, date: `2026-10-${String(10 + w * 3).padStart(2, '0')}`, exercises: [exercise('Pull-up', 4, 5 + w)] });
  const pr = progressionInsight(bw, '2026-11-06'); assert.equal(pr.data.exercises.find(e => e.name === 'Pull-up').metric, 'reps'); // senza carico esterno: ripetizioni
});

// ---------- test planner e revisione ----------
test('test planner: cadenza, calibrazione forzata, mai eseguito', () => {
  const plan = (targets, version, loggingBad = false) => Object.fromEntries(planTests({ today: TODAY, targets, version, loggingBad }).map(t => [t.id, t]));
  const v = { valid_from: '2026-11-01' };
  const p0 = plan(T, v);
  assert.equal(p0.rep_test.due, false); assert.equal(p0.rep_test.due_date, '2026-12-27'); assert.equal(p0.measurements.due, false); // 1/11 + 14 g = 15/11
  assert.equal(plan(T, { valid_from: '2026-10-01' }).measurements.due, true);
  assert.equal(plan(T, v, true).logging_calibration.due, true); assert.match(plan(T, v, true).logging_calibration.reason, /incompleto/);
  assert.equal(plan({ ...T, tests_done: { rep_test: '2026-08-01' } }, v).rep_test.due, true);
  assert.equal(plan(T, null).rep_test.due, true); assert.match(plan(T, null).rep_test.reason, /Mai eseguito/);
  assert.ok(p0.rep_test.steps.some(s => /1–2 ripetizioni dal cedimento/.test(s)));
});

function inputs(over = {}) {
  return { today: TODAY, weights: weights(28, i => 72 + 0.0386 * i + noise(i), { hour: 8 }), nutrition: nutrition(() => 2900, 140), sleep: sleep([450, 440, 460, 430, 450, 470, 440]), sessions: sessions(), ...over };
}
const review = (over, extra = {}) => buildReview({ inputs: inputs(over), targets: T, using_defaults: true, version: null, generation: 1, ...extra });

test('revisione: tutto in ordine => nessuna azione; ordinata per priorità; numeri finiti', () => {
  const r = review();
  assert.equal(r.summary.attention, 0); assert.deepEqual(r.actions, []); assert.equal(r.week.from, '2026-10-26'); assert.equal(r.week.to, '2026-11-01');
  assert.deepEqual(r.insights.map(i => i.priority), r.insights.map(i => i.priority).sort((a, b) => b - a));
  assert.equal(r.targets.using_defaults, true); assert.equal(r.insights.find(i => i.id === 'nutrition_logging').status, 'ok');
  assertAllFinite(r); assert.match(r.disclaimer, /non consulenza medica/);
});

test('revisione: diario scarso e allenamenti saltati => azioni al massimo 3, per priorità', () => {
  const r = review({ nutrition: nutrition(k => (k % 3 ? undefined : 2900)), sleep: sleep([380, 390, 400, 380, 390, 400, 380]), sessions: sessions({ skipAfter: '2026-10-12' }) });
  assert.equal(r.actions.length, 3);
  assert.deepEqual(r.actions.map(a => a.id), ['nutrition_logging', 'training_adherence', 'muscle_volume']);
  assert.ok(r.summary.attention >= 4); assert.equal(r.tests.find(t => t.id === 'logging_calibration').due, true);
  assertAllFinite(r);
});

test('revisione: senza alcun dato non inventa nulla', () => {
  const r = review({ weights: { daily: [], raw: [] }, nutrition: { by_day: [] }, sleep: { nights: [] }, sessions: [] });
  for (const i of r.insights) assert.ok(['attenzione', 'insufficiente', 'info'].includes(i.status), i.id);
  assert.equal(r.insights.find(i => i.id === 'energy_balance').data?.target_kcal, undefined);
  assertAllFinite(r);
});

// ---------- API ----------
test('API: /v1/coach/review richiede autenticazione, è di sola lettura e legge i target versionati', async () => {
  const { createApp } = await import('../src/app.js');
  const { AppError } = await import('../src/core/errors.js');
  const { newDb } = await import('./helpers/d1-shim.mjs');
  const authOk = { authenticate: async () => ({ subject: 'owner' }) };
  const authNo = { authenticate: async () => { throw new AppError(401, 'unauthenticated'); } };
  const device = { authenticate: async () => ({ subject: 'owner', principal: 'device' }) };
  const db = newDb();
  const NOW = new Date('2026-11-06T12:00:00Z');
  const call = (auth, method = 'GET') => createApp({ db, auth, now: () => NOW })(new Request('https://app.test/v1/coach/review', { method }));
  assert.equal((await call(authNo)).status, 401);
  assert.equal((await call(device)).status, 403); // il collector del telefono non legge
  assert.equal((await call(authOk, 'POST')).status, 405);
  const vuoto = await call(authOk);
  assert.equal(vuoto.status, 200); assert.equal(vuoto.headers.get('cache-control'), 'no-store');
  const body = await vuoto.json();
  assert.equal(body.targets.using_defaults, true); assert.equal(body.as_of, '2026-11-06'); assertAllFinite(body);
  await db.prepare('INSERT INTO coach_targets (subject_id, valid_from, valid_to, phase, goal, targets_json, created_at) VALUES (?,?,?,?,?,?,?)').bind('owner', '2026-11-01', null, 'massa', 'Aumentare massa muscolare', '{"sleep_min_hours":8}', 'x').run();
  const conTarget = await (await call(authOk)).json();
  assert.equal(conTarget.targets.version.phase, 'massa'); assert.equal(conTarget.targets.values.sleep_min_hours, 8); assert.equal(conTarget.targets.using_defaults, false);
});
