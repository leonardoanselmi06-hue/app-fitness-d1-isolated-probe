// Caricamento dati per il Coach: solo lettura da D1. Riusa le viste esistenti dove possibile (stessi numeri della PWA).
import { localDate } from '../core/time.js';
import { nutritionView, sleepView } from '../analytics/daily-views.js';
import { DAY_MS, addDays } from './stats.js';

const TZ = 'Europe/Rome';
export const localHour = iso => {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return Number.parseInt(h, 10);
};

/** Una pesata per giorno locale (l'ultima), 90 giorni. */
async function loadWeights(db, subject, now) {
  const cutoff = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  const { results } = await db.prepare(
    "SELECT observed_at, payload_json FROM current_records WHERE subject_id = ? AND domain = 'body' AND deleted = 0 AND observed_at >= ? ORDER BY observed_at ASC, record_id ASC"
  ).bind(subject, cutoff).all();
  const raw = [];
  for (const r of results) {
    const p = JSON.parse(r.payload_json);
    if (p.metric !== 'body_weight_kg' || typeof p.kg !== 'number' || !Number.isFinite(p.kg) || p.kg <= 0) continue;
    const time = p.time ?? r.observed_at;
    raw.push({ time, date: p.local_date ?? localDate(time, TZ), kg: p.kg, hour: localHour(time) });
  }
  const byDay = new Map();
  for (const w of raw) byDay.set(w.date, w);
  return { raw, daily: [...byDay.values()] };
}

/** Allenamenti degli ultimi 84 giorni (solo dati, nessuna classificazione). */
async function loadSessions(db, subject, today) {
  const from = addDays(today, -84);
  const { results } = await db.prepare(
    `SELECT record_id, payload_json FROM current_records WHERE subject_id = ? AND domain = 'training' AND deleted = 0
       AND json_extract(payload_json, '$.local_date') >= ? AND json_extract(payload_json, '$.local_date') <= ?
     ORDER BY json_extract(payload_json, '$.local_date') ASC, record_id ASC`
  ).bind(subject, from, today).all();
  return results.map(r => { const p = JSON.parse(r.payload_json); return { id: r.record_id, date: p.local_date, title: p.title ?? null, exercises: p.exercises ?? [] }; });
}

export async function loadInputs(db, subject, now) {
  const today = localDate(now.toISOString(), TZ);
  const [weights, nutrition, sleep, sessions] = await Promise.all([
    loadWeights(db, subject, now),
    nutritionView(db, subject, { days: 29, now }),
    sleepView(db, subject, { days: 14, now }),
    loadSessions(db, subject, today),
  ]);
  return { today, weights, nutrition, sleep, sessions };
}
