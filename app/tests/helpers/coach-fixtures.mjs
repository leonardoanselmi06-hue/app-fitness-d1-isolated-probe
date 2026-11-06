// Dati sintetici per i test del Coach (nessun dato reale). Oggi = 2026-11-06 (venerdì), lunedì = 2026-11-02.
import { addDays } from '../../src/coach/stats.js';

export const TODAY = '2026-11-06';
export const NOW = new Date('2026-11-06T12:00:00Z');

/** Pesate giornaliere: kg(i) con i = giorni dall'inizio; `n` giorni che finiscono oggi. */
export function weights(n, kg, { hour = 7, every = 1 } = {}) {
  const daily = [], raw = [];
  for (let i = 0; i < n; i += every) {
    const date = addDays(TODAY, -(n - 1 - i));
    const w = { date, kg: kg(i), hour, time: `${date}T0${hour}:00:00.000Z` };
    daily.push(w); raw.push(w);
  }
  return { daily, raw };
}
export const noise = i => (i % 2 ? 0.1 : -0.1);

/** Diario: per ogni giorno passato (28) un oggetto per nutritionView.by_day. */
export function nutrition(kcalOf, protein = 150) {
  const by_day = [];
  for (let k = 1; k <= 28; k++) {
    const date = addDays(TODAY, -k), kcal = kcalOf(k, date);
    if (kcal === undefined) continue; // giorno non registrato
    by_day.push({ date, partial: false, entries: kcal == null ? 1 : 4, incomplete_entries: kcal == null ? 1 : 0, totals: { calories: kcal, protein: kcal == null ? null : protein, carbohydrate: null, fat: null, fiber: null, sugar: null }, meals: [] });
  }
  return { by_day };
}

/** Notti di sonno (ultime n) con durata in minuti. */
export function sleep(durations) {
  return { nights: durations.map((m, i) => ({ date: addDays(TODAY, -(durations.length - i)), duration_min: m, short: m < 180 })) };
}

const PLAN = {
  A: [['Barbell Bench Press', 60], ['Barbell Bent Over Row', 50], ['Dumbbell Lateral Raise', 8], ['Barbell Curl', 25], ['Triceps Pushdown', 30]],
  B: [['Barbell Full Squat', 80], ['Romanian Deadlift', 90], ['Standing Leg Calf Raise', 60], ['Crunch Floor', 0]],
};
const set = (reps, load) => ({ set_type: 'normal', warmup: false, completed: true, reps, external_load_kg: load > 0 ? load : null, rir: 2 });
export const exercise = (name, nSets, reps = 8, load = 0) => ({ name, type: 'weight_reps', sets: Array.from({ length: nSets }, () => set(reps, load)) });

/** Quattro sedute a settimana (lun, mar, gio, ven) A/B/A/B per le ultime 12 settimane, fino a ieri; `step` = kg aggiunti per settimana. */
export function sessions({ setsPerExercise = 6, step = 2.5, skipAfter = null, from = addDays('2026-11-02', -84), without = [] } = {}) {
  const out = [];
  for (let w = 0; w < 13; w++) {
    ['A', 'B', 'A', 'B'].forEach((kind, i) => {
      const date = addDays(addDays(from, w * 7), [0, 1, 3, 4][i]);
      if (date >= TODAY || (skipAfter && date >= skipAfter)) return;
      out.push({ id: `s-${date}-${kind}`, date, title: kind, exercises: PLAN[kind].filter(([n]) => !without.includes(n)).map(([n, base]) => exercise(n, setsPerExercise, 8, base ? base + step * w : 0)) });
    });
  }
  return out;
}

/** Visita ricorsiva: ogni numero deve essere finito (nessun NaN/Infinity nelle risposte). */
export function assertAllFinite(value, path = '$') {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`numero non finito in ${path}`);
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) assertAllFinite(v, `${path}.${k}`);
}
