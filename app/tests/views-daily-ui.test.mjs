import test from 'node:test';
import assert from 'node:assert/strict';
import { barChart, nutritionSummary, nutritionDays, sleepSummary, sleepChart, sleepList, stepsSummary, stepsChart, stepsList } from '../public/views-daily.js';

const avg = (value, n) => ({ value, n });
const nut = { empty_days: 3, complete_days: 3, incomplete_days: 1, averages: { calories: avg(1850, 3), protein: avg(120.5, 3), carbohydrate: avg(200, 3), fat: avg(60.2, 3) }, by_day: [
  { date: '2026-11-06', partial: true, completeness: { complete: null, missing: [], no_calorie_entries: 0, reason: '' }, entries: 1, incomplete_entries: 0, totals: { calories: 200, protein: 5, carbohydrate: 30, fat: 4 }, meals: [{ meal: 'Breakfast', calories: 200, entries: [{ name: 'Caffè <b>e</b> latte', description: '1 tazza', calories: 200 }] }] },
  { date: '2026-11-05', partial: false, completeness: { complete: false, missing: ['Dinner'], no_calorie_entries: 1, reason: 'manca la cena, 1 voce senza calorie' }, entries: 2, incomplete_entries: 1, totals: { calories: 1234, protein: 22, carbohydrate: 138.1, fat: 10.9 }, meals: [{ meal: 'Lunch', calories: 1234, entries: [{ name: 'Pasta', description: '1 piatto', calories: 1234 }] }, { meal: 'Dinner', calories: null, entries: [{ name: 'Misterioso', description: null, calories: null }] }] },
] };

test('barChart: giorni mancanti = vuoti sull\'asse, nessun NaN, serie vuota gestita', () => {
  assert.match(barChart([], { yMax: 10, tickFmt: String, label: 'x' }), /Nessun dato/);
  const svg = barChart([{ date: '2026-11-01', value: 5 }, { date: '2026-11-05', value: 10, cls: 'partial' }], { yMax: 10, tickFmt: v => `${v} u`, label: 'Prova' });
  assert.equal((svg.match(/<rect /g) ?? []).length, 2); // 5 giorni di asse, solo 2 barre
  assert.ok(!/NaN|undefined/.test(svg)); assert.match(svg, /class="bar partial"/); assert.match(svg, /1 nov/); assert.match(svg, /5 nov/); assert.match(svg, /10 u/);
  assert.ok(!barChart([{ date: '2026-11-01', value: 0 }], { yMax: 2000, tickFmt: String, label: 'z' }).includes('NaN')); // un solo giorno, valore 0
});

test('alimentazione: medie con separatore italiano, giorni vuoti non zero, oggi in corso, voci senza calorie segnalate, HTML escapato', () => {
  const s = nutritionSummary(nut);
  assert.match(s, /1\.850 kcal/); assert.match(s, /120,5 g/); assert.match(s, /media su 3 giorni/); assert.match(s, /3 giorni senza alcuna voce/);
  const days = nutritionDays(nut);
  assert.match(days, /in corso/); assert.match(days, /<span class="tag warn">incompleto<\/span>/); assert.match(days, /manca la cena, 1 voce senza calorie/); assert.equal((days.match(/>incompleto</g) ?? []).length, 1); // oggi non è "incompleto"
  assert.match(s, /Medie solo sui giorni completi \(pranzo, cena e almeno colazione o altro\): 3 giorni, 1 incompleto escluso/); assert.match(days, /1\.234 kcal/); assert.match(days, /Colazione/); assert.match(days, /Pranzo/); assert.match(days, /Cena/);
  assert.match(days, /1 voce senza calorie: il totale è parziale/); assert.ok(!days.includes('<b>'));
  assert.match(nutritionDays({ by_day: [] }), /Nessuna voce/);
  assert.match(nutritionSummary({ ...nut, empty_days: 0, averages: { calories: avg(null, 0), protein: avg(null, 0), carbohydrate: avg(null, 0), fat: avg(null, 0) } }), /nessun giorno completo/);
});

const sleep = { count: 3, short_count: 1, avg_min_window: 445, avg_min_7: 442, n_7: 7, avg_min_prev_7: 450, n_prev_7: 6, delta_min_7: -8,
  longest: { date: '2026-11-05', duration_min: 510 }, shortest: { date: '2026-10-24', duration_min: 400 }, nights: [
    { date: '2026-11-04', start_local: '23:30', end_local: '07:00', duration_min: 450, short: false, quality_pct: null, cycles: null },
    { date: '2026-11-05', start_local: '23:30', end_local: '07:00', duration_min: 32, short: true, quality_pct: 51, cycles: 8 },
    { date: '2026-11-06', start_local: '00:11', end_local: '06:58', duration_min: 407, short: false, quality_pct: null, cycles: null },
  ] };

test('sonno: durate "h min", confronto con segno, notti brevi segnalate, qualità/cicli solo se presenti', () => {
  const s = sleepSummary(sleep);
  assert.match(s, /7 h 22 min/); assert.match(s, /−8 min rispetto alle 7 notti prima/); assert.match(s, /8 h 30 min/); assert.match(s, /1 notte breve/);
  assert.match(sleepSummary({ ...sleep, delta_min_7: null }), /dati insufficienti/);
  assert.match(sleepSummary({ count: 0 }), /Nessuna notte/);
  const l = sleepList(sleep);
  assert.match(l, /23:30 → 07:00/); assert.match(l, /class="tag warn">breve/); assert.match(l, /qualità 51%/); assert.match(l, /8 cicli/);
  assert.equal((l.match(/qualità/g) ?? []).length, 1);
  assert.match(l, /<strong>32 min<\/strong>/); assert.ok(!l.includes('0 h 32')); // sotto l'ora: solo minuti
  const c = sleepChart(sleep);
  assert.equal((c.match(/<rect /g) ?? []).length, 3); assert.match(c, /class="bar short"/); assert.match(c, /8 h/); assert.ok(!/NaN/.test(c));
});

const steps = { today: '2026-11-06', today_count: 188, avg_7: 8714, n_7: 7, avg_prev_7: 7000, n_prev_7: 6, delta_7: 1714, avg_window: 7923, n_window: 13, best: { date: '2026-11-04', count: 12000 }, missing_days: 16,
  series: [{ date: '2026-11-04', count: 12000 }, { date: '2026-11-05', count: 5000 }, { date: '2026-11-06', count: 188 }] };

test('passi: oggi in corso, medie con separatore, giorni senza dati non contati come zero', () => {
  const s = stepsSummary(steps);
  assert.match(s, /<strong>188<\/strong>/); assert.match(s, /giornata in corso/); assert.match(s, /8\.714/); assert.match(s, /\+1\.714 rispetto ai 7 giorni prima/);
  assert.match(s, /12\.000/); assert.match(s, /16<\/strong><small>non contati come zero/);
  assert.match(stepsSummary({ ...steps, today_count: null, delta_7: null }), /nessun dato di oggi/);
  assert.match(stepsSummary({ ...steps, delta_7: null }), /dati insufficienti/);
  const c = stepsChart(steps);
  assert.match(c, /class="bar partial"/); assert.match(c, /12\.000/); assert.ok(!/NaN/.test(c));
  assert.match(stepsList(steps), /6 nov 2026 <span class="tag">in corso/);
  assert.equal(stepsList({ ...steps, series: [] }), '');
});
