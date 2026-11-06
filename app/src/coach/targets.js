// Target del Coach: default generici per l'obiettivo "massa muscolare" + versione in vigore letta da D1 (coach_targets).
// I default sono indicazioni generali (vedi docs/COACH_SPEC.md), non prescrizioni personali: ogni valore è sovrascrivibile.
import { MUSCLES } from './muscles.js';

export const DEFAULT_TARGETS = Object.freeze({
  weight_gain_pct_week: Object.freeze({ min: 0.25, max: 0.5 }),
  protein_g_per_kg: Object.freeze({ min: 1.6, max: 2.2 }),
  strength_sessions_per_week: 4,
  sets_per_muscle_week: Object.freeze({ min: 10, max: 20 }),
  min_weekly_frequency_per_muscle: 2,
  sleep_min_hours: 7,
  muscles: MUSCLES,
  tests_done: Object.freeze({}), // es. { rep_test: '2026-11-10' } = ultima esecuzione
});

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const num = v => typeof v === 'number' && Number.isFinite(v);
const range = (v, def) => (isObj(v) && num(v.min) && num(v.max) && v.min > 0 && v.max >= v.min ? { min: v.min, max: v.max } : def);
const pos = (v, def, max = Infinity) => (num(v) && v > 0 && v <= max ? v : def);

/** Unisce i valori della riga ai default; valori non validi tornano al default (mai NaN o 0 inventati). */
export function resolveTargets(raw) {
  const t = isObj(raw) ? raw : {};
  const D = DEFAULT_TARGETS;
  return {
    weight_gain_pct_week: range(t.weight_gain_pct_week, D.weight_gain_pct_week),
    protein_g_per_kg: range(t.protein_g_per_kg, D.protein_g_per_kg),
    strength_sessions_per_week: pos(t.strength_sessions_per_week, D.strength_sessions_per_week, 7),
    sets_per_muscle_week: range(t.sets_per_muscle_week, D.sets_per_muscle_week),
    min_weekly_frequency_per_muscle: pos(t.min_weekly_frequency_per_muscle, D.min_weekly_frequency_per_muscle, 7),
    sleep_min_hours: pos(t.sleep_min_hours, D.sleep_min_hours, 12),
    muscles: Array.isArray(t.muscles) && t.muscles.every(m => MUSCLES.includes(m)) && t.muscles.length ? t.muscles : D.muscles,
    tests_done: isObj(t.tests_done) ? Object.fromEntries(Object.entries(t.tests_done).filter(([, v]) => /^\d{4}-\d{2}-\d{2}$/.test(v))) : {},
  };
}

/** Versione in vigore alla data `today`. Tabella assente o nessuna riga => default (using_defaults = true). */
export async function loadTargets(db, subject, today) {
  let row = null;
  try {
    row = await db.prepare(
      'SELECT id, valid_from, valid_to, phase, goal, targets_json, note FROM coach_targets WHERE subject_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?) ORDER BY valid_from DESC, id DESC LIMIT 1'
    ).bind(subject, today, today).first();
  } catch { row = null; } // migrazione non ancora applicata
  let raw = null;
  if (row) { try { raw = JSON.parse(row.targets_json); } catch { raw = null; } }
  return {
    using_defaults: !row,
    version: row ? { id: row.id, valid_from: row.valid_from, valid_to: row.valid_to, phase: row.phase, goal: row.goal, note: row.note } : null,
    values: resolveTargets(raw),
  };
}
