// Viste derivate di SOLA LETTURA: alimentazione, sonno, passi (on demand, DEC-ANA-001).
// Regole: valori mancanti = null (mai zero); un giorno senza record è "mancante", non "0"; il giorno in corso è parziale e
// non entra nelle medie; nessuna soglia/obiettivo inventato.
import { getGeneration } from '../ingest/ledger.js';
import { localDate } from '../core/time.js';
import { clampInt, round, mean } from './views.js';
import { dayCompleteness } from './meal-completeness.js';

const DAY_MS = 86_400_000;
const TZ = 'Europe/Rome';
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const sum = xs => { const v = xs.filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const calendarDays = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const MIN_FOR_DELTA = 3; // un confronto tra periodi richiede almeno 3 osservazioni per parte

export const NUTRITION_DAYS = Object.freeze({ def: 7, min: 1, max: 60 });
export const SLEEP_DAYS = Object.freeze({ def: 30, min: 7, max: 365 });
export const STEPS_DAYS = Object.freeze({ def: 30, min: 7, max: 365 });

// ---------------- Alimentazione (FatSecret) ----------------
const MEAL_ORDER = ['Breakfast', 'Lunch', 'Dinner', 'Other'];
const TOTAL_KEYS = ['calories', 'protein', 'carbohydrate', 'fat', 'fiber', 'sugar'];

export async function nutritionView(db, subject, { days, now = new Date() } = {}) {
  const span = clampInt(days, NUTRITION_DAYS.def, NUTRITION_DAYS.min, NUTRITION_DAYS.max);
  const today = localDate(now.toISOString(), TZ), from = addDays(today, -(span - 1));
  const { results } = await db.prepare(
    `SELECT record_id, payload_json FROM current_records WHERE subject_id = ? AND domain = 'nutrition' AND deleted = 0
       AND json_extract(payload_json, '$.local_date') >= ? AND json_extract(payload_json, '$.local_date') <= ?
     ORDER BY json_extract(payload_json, '$.local_date') DESC, record_id ASC`
  ).bind(subject, from, today).all();

  const byDate = new Map();
  for (const r of results) {
    const p = JSON.parse(r.payload_json);
    if (!p.local_date) continue;
    if (!byDate.has(p.local_date)) byDate.set(p.local_date, []);
    byDate.get(p.local_date).push(p);
  }
  const by_day = [...byDate.entries()].map(([date, entries]) => {
    const n = e => e.nutrients ?? {};
    const totals = Object.fromEntries(TOTAL_KEYS.map(k => [k, round(sum(entries.map(e => n(e)[k] ?? null)), k === 'calories' ? 0 : 1)]));
    const meals = [...new Set(entries.map(e => e.meal ?? 'Other'))]
      .sort((a, b) => (MEAL_ORDER.indexOf(a) + 1 || 99) - (MEAL_ORDER.indexOf(b) + 1 || 99))
      .map(meal => {
        const es = entries.filter(e => (e.meal ?? 'Other') === meal);
        return {
          meal, calories: round(sum(es.map(e => n(e).calories ?? null)), 0),
          entries: es.map(e => ({ name: e.name ?? null, description: e.description ?? null, calories: n(e).calories ?? null, protein: n(e).protein ?? null, carbohydrate: n(e).carbohydrate ?? null, fat: n(e).fat ?? null })),
        };
      });
    const noCal = entries.filter(e => n(e).calories == null).length, partial = date === today;
    return { date, partial, entries: entries.length, incomplete_entries: noCal, completeness: dayCompleteness(entries.map(e => e.meal ?? 'Other'), { noCalorieEntries: noCal, partial }), totals, meals };
  });

  const complete = by_day.filter(d => d.completeness.complete === true); // medie SOLO sui giorni completi (regola pasti)
  const avg = k => { const xs = complete.map(d => d.totals[k]).filter(x => x != null); return { value: round(mean(xs), k === 'calories' ? 0 : 1), n: xs.length }; };
  const logged = new Set(by_day.map(d => d.date));
  return {
    generation: await getGeneration(db), window_days: span, from, to: today, today,
    averages: { calories: avg('calories'), protein: avg('protein'), carbohydrate: avg('carbohydrate'), fat: avg('fat') },
    complete_days: complete.length, incomplete_days: by_day.filter(d => d.completeness.complete === false).length,
    empty_days: calendarDays(from, addDays(today, -1)).filter(d => !logged.has(d)).length, // giorni passati senza alcuna voce: mancanti, non zero
    by_day,
  };
}

// ---------------- Sonno (Sleep as Android) ----------------
function localTime(iso, tz) {
  const fmt = zone => new Intl.DateTimeFormat('it-IT', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  try { return fmt(tz ?? TZ); } catch { return fmt(TZ); }
}
// Valori sentinella del provider NON confermati (rating 0 = non valutata; quality/cycles <= 0 = non calcolato): esposti solo se > 0.
const positive = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

export async function sleepView(db, subject, { days, now = new Date() } = {}) {
  const span = clampInt(days, SLEEP_DAYS.def, SLEEP_DAYS.min, SLEEP_DAYS.max);
  const cutoff = new Date(now.getTime() - span * DAY_MS).toISOString();
  const { results } = await db.prepare(
    "SELECT record_id, observed_at, payload_json FROM current_records WHERE subject_id = ? AND domain = 'sleep' AND deleted = 0 AND observed_at >= ? ORDER BY observed_at ASC, record_id ASC"
  ).bind(subject, cutoff).all();
  const nights = results.map(r => {
    const p = JSON.parse(r.payload_json);
    return {
      id: r.record_id, date: p.local_date ?? null, start_at: p.start_at ?? r.observed_at, end_at: p.end_at ?? null,
      start_local: localTime(p.start_at ?? r.observed_at, p.timezone), end_local: p.end_at ? localTime(p.end_at, p.timezone) : null,
      duration_min: p.duration_min ?? null, short: !!p.short,
      quality_pct: positive(p.quality) == null ? null : round(Math.min(p.quality, 1) * 100, 0), cycles: positive(p.cycles), rating: positive(p.rating),
    };
  }).filter(n => n.duration_min != null);

  const regular = nights.filter(n => !n.short); // le notti brevi (< 3 h) restano visibili ma non entrano nelle medie
  const dur = xs => xs.map(n => n.duration_min);
  const last7 = regular.slice(-7), prev7 = regular.slice(-14, -7);
  const avg7 = round(mean(dur(last7)), 0), avgPrev = round(mean(dur(prev7)), 0);
  const longest = regular.length ? regular.reduce((a, b) => (b.duration_min > a.duration_min ? b : a)) : null;
  const shortest = regular.length ? regular.reduce((a, b) => (b.duration_min < a.duration_min ? b : a)) : null;
  return {
    generation: await getGeneration(db), window_days: span, count: nights.length, short_count: nights.length - regular.length,
    avg_min_window: round(mean(dur(regular)), 0),
    avg_min_7: avg7, n_7: last7.length, avg_min_prev_7: avgPrev, n_prev_7: prev7.length,
    delta_min_7: last7.length >= MIN_FOR_DELTA && prev7.length >= MIN_FOR_DELTA ? avg7 - avgPrev : null,
    longest: longest && { date: longest.date, duration_min: longest.duration_min }, shortest: shortest && { date: shortest.date, duration_min: shortest.duration_min },
    nights,
  };
}

// ---------------- Passi (Health Connect, origine Samsung Health) ----------------
export async function stepsView(db, subject, { days, now = new Date() } = {}) {
  const span = clampInt(days, STEPS_DAYS.def, STEPS_DAYS.min, STEPS_DAYS.max);
  const today = localDate(now.toISOString(), TZ), from = addDays(today, -(span - 1));
  const { results } = await db.prepare(
    `SELECT payload_json FROM current_records WHERE subject_id = ? AND domain = 'activity' AND deleted = 0
       AND json_extract(payload_json, '$.local_date') >= ? AND json_extract(payload_json, '$.local_date') <= ?
     ORDER BY json_extract(payload_json, '$.local_date') ASC`
  ).bind(subject, from, today).all();
  const series = [];
  for (const r of results) {
    const p = JSON.parse(r.payload_json);
    if (p.metric === 'steps_total' && p.local_date && Number.isInteger(p.count)) series.push({ date: p.local_date, count: p.count });
  }
  const complete = series.filter(d => d.date < today); // il giorno in corso è parziale
  const within = (a, b) => complete.filter(d => d.date >= addDays(today, -a) && d.date <= addDays(today, -b)).map(d => d.count);
  const w7 = within(7, 1), wPrev = within(14, 8);
  const avg7 = round(mean(w7), 0), avgPrev = round(mean(wPrev), 0);
  const best = complete.length ? complete.reduce((a, b) => (b.count > a.count ? b : a)) : null;
  const have = new Set(series.map(d => d.date));
  return {
    generation: await getGeneration(db), window_days: span, from, to: today, today,
    today_count: series.find(d => d.date === today)?.count ?? null,
    avg_window: round(mean(complete.map(d => d.count)), 0), n_window: complete.length,
    avg_7: avg7, n_7: w7.length, avg_prev_7: avgPrev, n_prev_7: wPrev.length,
    delta_7: w7.length >= MIN_FOR_DELTA && wPrev.length >= MIN_FOR_DELTA ? avg7 - avgPrev : null,
    best: best && { date: best.date, count: best.count },
    missing_days: calendarDays(from, addDays(today, -1)).filter(d => !have.has(d)).length, // senza record: mancanti, non zero
    series,
  };
}
