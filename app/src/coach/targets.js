// Target del Coach: default generici per l'obiettivo "massa muscolare" + versione in vigore letta da D1 (coach_targets).
// I default sono indicazioni generali (vedi docs/COACH_SPEC.md), non prescrizioni personali: ogni valore è sovrascrivibile.
import { MUSCLES } from './muscles.js';

// Tipo di obiettivo della fase → ritmo di peso e proteine indicativi (indicazioni generali, non prescrizioni: ogni valore resta sovrascrivibile dalla fase).
export const GOAL_TYPES = Object.freeze(['massa', 'forza', 'mantenimento', 'definizione']);
export const GOAL_LABEL = Object.freeze({ massa: 'Massa', forza: 'Forza', mantenimento: 'Mantenimento', definizione: 'Definizione' });
export const GOAL_PRESETS = Object.freeze({
  massa: Object.freeze({ weight_pct_week: Object.freeze({ min: 0.25, max: 0.5 }) }),
  // Forza: volume per muscolo più contenuto, peso stabile o in leggero aumento; i carichi sui fondamentali contano più delle serie totali.
  forza: Object.freeze({ weight_pct_week: Object.freeze({ min: 0, max: 0.25 }), sets_per_muscle_week: Object.freeze({ min: 6, max: 12 }) }),
  mantenimento: Object.freeze({ weight_pct_week: Object.freeze({ min: -0.1, max: 0.1 }) }),
  definizione: Object.freeze({ weight_pct_week: Object.freeze({ min: -0.7, max: -0.3 }), protein_g_per_kg: Object.freeze({ min: 1.8, max: 2.4 }) }),
});

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
// Ritmo di peso: con segno (negativo = perdita), min <= max, entro ±3 %/sett.
const srange = (v, def) => (isObj(v) && num(v.min) && num(v.max) && v.min >= -3 && v.max <= 3 && v.max >= v.min ? { min: v.min, max: v.max } : def);
const pos = (v, def, max = Infinity) => (num(v) && v > 0 && v <= max ? v : def);

/** Unisce i valori della riga ai default; valori non validi tornano al default (mai NaN o 0 inventati). */
export function resolveTargets(raw) {
  const t = isObj(raw) ? raw : {};
  const D = DEFAULT_TARGETS;
  const weight = srange(t.weight_pct_week ?? t.weight_gain_pct_week, D.weight_gain_pct_week);
  return {
    goal_type: GOAL_TYPES.includes(t.goal_type) ? t.goal_type : null,
    weight_pct_week: weight, weight_gain_pct_week: weight, // stesso valore: il nome storico resta per compatibilità
    protein_g_per_kg: range(t.protein_g_per_kg, D.protein_g_per_kg),
    strength_sessions_per_week: pos(t.strength_sessions_per_week, D.strength_sessions_per_week, 7),
    sets_per_muscle_week: range(t.sets_per_muscle_week, D.sets_per_muscle_week),
    min_weekly_frequency_per_muscle: pos(t.min_weekly_frequency_per_muscle, D.min_weekly_frequency_per_muscle, 7),
    sleep_min_hours: pos(t.sleep_min_hours, D.sleep_min_hours, 12),
    muscles: Array.isArray(t.muscles) && t.muscles.every(m => MUSCLES.includes(m)) && t.muscles.length ? t.muscles : D.muscles,
    tests_done: isObj(t.tests_done) ? Object.fromEntries(Object.entries(t.tests_done).filter(([, v]) => /^\d{4}-\d{2}-\d{2}$/.test(v))) : {},
  };
}

/** Valori dei target di una fase: preset del tipo di obiettivo, poi i valori impostati nella fase. */
export const phaseValues = meta => resolveTargets({ ...(GOAL_PRESETS[meta?.goal_type] ?? {}), ...(meta?.targets ?? {}), goal_type: meta?.goal_type });

const legacyRow = async (db, subject, today) => {
  try {
    return await db.prepare('SELECT id, valid_from, valid_to, phase, goal, targets_json, note FROM coach_targets WHERE subject_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?) ORDER BY valid_from DESC, id DESC LIMIT 1').bind(subject, today, today).first();
  } catch { return null; } // migrazione non ancora applicata
};
const parseJson = t => { try { return JSON.parse(t); } catch { return null; } };

/** Target in vigore alla data `today`. Ordine: fase attiva con tipo di obiettivo o target propri → versione storica di coach_targets → default.
 *  Con la fase come fonte, tests_done (data dell'ultimo test) resta quello della riga storica, se esiste. */
export async function loadTargets(db, subject, today) {
  let ph = null;
  try {
    ph = await db.prepare(
      `SELECT v.id, v.phase_id, v.valid_from, v.valid_to, v.data_json FROM plan_versions v JOIN phases p ON p.id = v.phase_id AND p.subject_id = v.subject_id
        WHERE v.subject_id = ? AND v.kind = 'phase' AND p.status = 'active' AND v.valid_from <= ? AND (v.valid_to IS NULL OR v.valid_to > ?) ORDER BY v.valid_from DESC, v.id DESC LIMIT 1`
    ).bind(subject, today, today).first();
  } catch { ph = null; } // tabelle del Piano non ancora migrate
  const meta = ph ? parseJson(ph.data_json) : null, row = await legacyRow(db, subject, today);
  if (meta && (meta.goal_type || meta.targets)) {
    const values = phaseValues(meta), legacyDone = resolveTargets(row ? parseJson(row.targets_json) : null).tests_done;
    return { using_defaults: false, version: { id: ph.id, valid_from: ph.valid_from, valid_to: ph.valid_to, phase: meta.name ?? 'Fase', goal: meta.goal ?? GOAL_LABEL[meta.goal_type] ?? 'Obiettivo della fase', goal_type: meta.goal_type ?? null, note: null, source: 'phase', phase_id: ph.phase_id }, values: { ...values, tests_done: legacyDone } };
  }
  return {
    using_defaults: !row,
    version: row ? { id: row.id, valid_from: row.valid_from, valid_to: row.valid_to, phase: row.phase, goal: row.goal, note: row.note, source: 'coach_targets' } : null,
    values: resolveTargets(row ? parseJson(row.targets_json) : null),
  };
}
