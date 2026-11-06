// Revisione settimanale del Coach: orchestra le regole, ordina per priorità e propone i test. Solo lettura, deterministico.
import { getGeneration } from '../ingest/ledger.js';
import { loadInputs } from './data.js';
import { loadTargets } from './targets.js';
import { addDays, mondayOf } from './stats.js';
import { weightTrendInsight, weighinInsight, freshnessInsight, sleepInsight } from './rules-body.js';
import { nutritionQuality, nutritionLoggingInsight, proteinInsight, energyInsight } from './rules-nutrition.js';
import { analyzeSessions, adherenceInsight, volumeInsight, progressionInsight } from './rules-training.js';
import { planTests } from './tests-plan.js';

const ACTIONABLE = new Set(['attenzione', 'insufficiente']);

export function buildReview({ inputs, targets, using_defaults, version, generation }) {
  const { today, weights, nutrition, sleep, sessions } = inputs;
  const q = nutritionQuality(nutrition, today);
  const wt = weightTrendInsight(weights, today, targets);
  const analyzed = analyzeSessions(sessions);
  const insights = [
    nutritionLoggingInsight(q, today), weighinInsight(weights, today), wt.insight, proteinInsight(q, weights, today, targets),
    energyInsight(q, wt.trend, today, targets), adherenceInsight(analyzed, today, targets), volumeInsight(analyzed, today, targets),
    progressionInsight(sessions, today), sleepInsight(sleep, targets), freshnessInsight(weights, today),
  ].filter(Boolean).sort((a, b) => b.priority - a.priority);
  const actions = insights.filter(i => ACTIONABLE.has(i.status) && i.action).slice(0, 3).map(i => ({ id: i.id, title: i.title, text: i.action }));
  const loggingBad = insights.find(i => i.id === 'nutrition_logging')?.status === 'attenzione';
  const monday = mondayOf(today);
  return {
    generation, as_of: today, week: { from: addDays(monday, -7), to: addDays(monday, -1) },
    targets: { using_defaults, version, values: targets },
    summary: { attention: insights.filter(i => i.status === 'attenzione').length, ok: insights.filter(i => i.status === 'ok').length, insufficient: insights.filter(i => i.status === 'insufficiente').length },
    actions, insights, tests: planTests({ today, targets, version, loggingBad }),
    disclaimer: 'Indicazioni generali basate su regole fisse, non consulenza medica. In caso di sintomi, dolore o perdita di peso involontaria rivolgiti a un medico.',
  };
}

export async function coachReview(db, subject, { now = new Date() } = {}) {
  const inputs = await loadInputs(db, subject, now);
  const t = await loadTargets(db, subject, inputs.today);
  return buildReview({ inputs, targets: t.values, using_defaults: t.using_defaults, version: t.version, generation: await getGeneration(db) });
}
