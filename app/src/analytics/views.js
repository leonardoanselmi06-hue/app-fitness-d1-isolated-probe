// Viste derivate di SOLA LETTURA per la PWA: allenamenti e peso (on demand, DEC-ANA-001).
// Nessuna inferenza: i valori mancanti restano null (mai zero) e ogni numero derivato è calcolato qui, in modo testabile.
// Il peso corporeo di Lyfta (user_body_weight_kg) resta un campo separato e non entra mai nel carico delle serie (DEC-TRAIN-001).
import { getGeneration } from '../ingest/ledger.js';

export const clampInt = (v, def, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
export const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
export const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const DAY_MS = 86_400_000;

export const TRAINING_PAGE = Object.freeze({ def: 20, min: 1, max: 100 });
export const WEIGHT_DAYS = Object.freeze({ def: 90, min: 14, max: 3650 });

function summarizeWorkout(payload) {
  const exercises = payload.exercises ?? [];
  let working = 0, warmup = 0, reps = 0, repsSeen = false, loadVolume = 0, loadSeen = false;
  for (const ex of exercises) {
    for (const s of ex.sets ?? []) {
      if (s.completed === false) continue; // una serie non completata non conta
      if (s.warmup) { warmup++; continue; }
      working++;
      if (s.reps != null) { reps += s.reps; repsSeen = true; }
      if (s.reps != null && s.external_load_kg != null && s.external_load_kg > 0) { loadVolume += s.reps * s.external_load_kg; loadSeen = true; }
    }
  }
  return {
    exercises: exercises.length,
    working_sets: working,
    warmup_sets: warmup,
    reps_total: repsSeen ? reps : null,
    external_load_volume_kg: loadSeen ? round(loadVolume, 1) : null, // solo zavorra esterna x ripetizioni; nulla se non c'è zavorra
  };
}

const exerciseView = ex => ({
  name: ex.name ?? null,
  type: ex.type ?? null,
  sets: (ex.sets ?? []).map(s => ({
    set_type: s.set_type ?? null, warmup: !!s.warmup, completed: s.completed ?? null,
    reps: s.reps ?? null, external_load_kg: s.external_load_kg ?? null, rir: s.rir ?? null,
    duration_sec: s.duration_sec ?? null, distance: s.distance ?? null, // unità della distanza NON documentata: esposta grezza
  })),
});

/** Allenamenti dal più recente, paginati. */
export async function trainingView(db, subject, { limit, offset } = {}) {
  const lim = clampInt(limit, TRAINING_PAGE.def, TRAINING_PAGE.min, TRAINING_PAGE.max);
  const off = clampInt(offset, 0, 0, 1_000_000);
  const total = (await db.prepare("SELECT COUNT(*) AS n FROM current_records WHERE subject_id = ? AND domain = 'training' AND deleted = 0").bind(subject).first()).n;
  const { results } = await db.prepare(
    "SELECT source_system, record_id, observed_at, payload_json FROM current_records WHERE subject_id = ? AND domain = 'training' AND deleted = 0 ORDER BY observed_at DESC, record_id DESC LIMIT ? OFFSET ?"
  ).bind(subject, lim, off).all();
  const workouts = results.map(r => {
    const p = JSON.parse(r.payload_json);
    return {
      id: r.record_id, source: r.source_system, date: p.local_date ?? null, start_at: p.start_at ?? r.observed_at ?? null,
      title: p.title ?? null, user_body_weight_kg: p.user_body_weight_kg ?? null,
      summary: summarizeWorkout(p), exercises: (p.exercises ?? []).map(exerciseView),
    };
  });
  return { generation: await getGeneration(db), total, offset: off, limit: lim, has_more: off + workouts.length < total, workouts };
}

/** Serie del peso e statistiche. `now` è iniettabile per i test. */
export async function weightView(db, subject, { days, now = new Date() } = {}) {
  const span = clampInt(days, WEIGHT_DAYS.def, WEIGHT_DAYS.min, WEIGHT_DAYS.max);
  const cutoff = new Date(now.getTime() - span * DAY_MS).toISOString();
  const { results } = await db.prepare(
    "SELECT observed_at, payload_json FROM current_records WHERE subject_id = ? AND domain = 'body' AND deleted = 0 AND observed_at >= ? ORDER BY observed_at ASC, record_id ASC"
  ).bind(subject, cutoff).all();
  const points = [];
  for (const r of results) {
    const p = JSON.parse(r.payload_json);
    if (p.metric !== 'body_weight_kg' || typeof p.kg !== 'number' || !Number.isFinite(p.kg)) continue;
    points.push({ time: p.time ?? r.observed_at, local_date: p.local_date ?? null, kg: round(p.kg, 2), origin: p.origin ?? null });
  }
  // una voce per giorno locale: l'ultima pesata del giorno
  const byDay = new Map();
  for (const pt of points) byDay.set(pt.local_date ?? pt.time.slice(0, 10), pt);
  const daily = [...byDay.entries()].map(([date, pt]) => ({ date, kg: pt.kg }));

  const latest = points.at(-1) ?? null;
  let avg7 = null, avgPrev7 = null, delta7 = null;
  if (latest) {
    const t = Date.parse(latest.time);
    const inRange = (from, to) => points.filter(p => { const x = Date.parse(p.time); return x > t - to * DAY_MS && x <= t - from * DAY_MS; }).map(p => p.kg);
    avg7 = round(mean(inRange(0, 7)), 2);
    avgPrev7 = round(mean(inRange(7, 14)), 2);
    delta7 = avg7 != null && avgPrev7 != null ? round(avg7 - avgPrev7, 2) : null; // null = dati insufficienti, mai 0
  }
  const kgs = points.map(p => p.kg);
  const min = kgs.length ? points.reduce((a, b) => (b.kg < a.kg ? b : a)) : null;
  const max = kgs.length ? points.reduce((a, b) => (b.kg > a.kg ? b : a)) : null;

  let excluded = 0;
  try { const row = await db.prepare("SELECT value FROM meta WHERE name = 'excluded_weights'").first(); if (row?.value) excluded = JSON.parse(row.value).length; } catch { /* lista assente o illeggibile */ }

  return {
    generation: await getGeneration(db), days: span, count: points.length,
    latest, avg_7d: avg7, avg_prev_7d: avgPrev7, delta_7d: delta7,
    change_in_window: points.length > 1 ? round(latest.kg - points[0].kg, 2) : null,
    min: min && { kg: min.kg, local_date: min.local_date }, max: max && { kg: max.kg, local_date: max.local_date },
    excluded_count: excluded, daily, recent: points.slice(-10).reverse(),
  };
}
