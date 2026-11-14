import test from 'node:test';
import assert from 'node:assert/strict';
import { nutritionQuality, energyInsight, proteinInsight } from '../src/coach/rules-nutrition.js';
import { dayCompleteness } from '../src/analytics/meal-completeness.js';
import { addDays } from '../src/coach/stats.js';

const TODAY = '2026-11-14';
const fsDay = (date, meals, kcal = 600) => ({ date, partial: false, incomplete_entries: 0, completeness: dayCompleteness(meals), totals: { calories: kcal * meals.length, protein: 30 * meals.length }, meals: meals.map(meal => ({ meal })) });
const est = (date, meal, kcal, u = 25, protein = 20) => ({ id: `${date}-${meal}`, date, meal, nutrients: { calories: kcal, protein }, uncertainty_pct: u });

test('giorno incompleto in FatSecret + pasto stimato che manca = completo, con incertezza dichiarata', () => {
  const d = addDays(TODAY, -1);
  const q = nutritionQuality({ by_day: [fsDay(d, ['Breakfast', 'Lunch'])], estimates: [est(d, 'Dinner', 800, 25, 40)] }, TODAY);
  const day = q.days.at(-1);
  assert.equal(day.state, 'complete'); assert.equal(day.estimated, true); assert.equal(day.kcal, 1200 + 800); assert.equal(day.protein, 60 + 40); assert.equal(day.uncertainty_kcal, 200);
  const none = nutritionQuality({ by_day: [fsDay(d, ['Breakfast', 'Lunch'])], estimates: [] }, TODAY).days.at(-1);
  assert.equal(none.state, 'incomplete'); assert.equal(none.estimated, undefined);
});

test('solo stime (nessun dato FatSecret): conta solo se i pasti bastano; stima senza proteine = proteine ignote', () => {
  const d = addDays(TODAY, -2);
  const some = nutritionQuality({ by_day: [], estimates: [est(d, 'Lunch', 700)] }, TODAY).days.find(x => x.date === d);
  assert.equal(some.state, 'incomplete');
  const all = nutritionQuality({ by_day: [], estimates: [est(d, 'Lunch', 700), est(d, 'Dinner', 700), { ...est(d, 'Breakfast', 300), nutrients: { calories: 300 } }] }, TODAY).days.find(x => x.date === d);
  assert.equal(all.state, 'complete'); assert.equal(all.protein, null);
});

test('fabbisogno: le stime allargano l\'intervallo e lo dichiarano; senza stime il risultato non cambia', () => {
  const mk = withEst => { const by = [], es = []; for (let i = 1; i <= 14; i++) { const d = addDays(TODAY, -i); if (withEst && i <= 7) { by.push(fsDay(d, ['Breakfast', 'Lunch'])); es.push(est(d, 'Dinner', 1000, 30)); } else by.push(fsDay(d, ['Breakfast', 'Lunch', 'Dinner'], 800)); } return nutritionQuality({ by_day: by, estimates: es }, TODAY); };
  const trend = { reg: { slope: 0.02, ci: [0.01, 0.03], mean_y: 75 } }, targets = { weight_pct_week: { min: 0.1, max: 0.3 }, goal_type: 'massa', protein_g_per_kg: { min: 1.6, max: 2.2 } };
  const a = energyInsight(mk(false), trend, TODAY, targets), b = energyInsight(mk(true), trend, TODAY, targets);
  assert.equal(a.data.estimated_days, 0); assert.equal(b.data.estimated_days, 7);
  assert.ok(b.data.half_width_kcal > a.data.half_width_kcal); assert.ok(b.evidence.some(x => /pasti stimati da ChatGPT/.test(x)));
});
