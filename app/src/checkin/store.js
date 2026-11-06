// Check-in di recupero: 5 valori 1–5 (qualità del sonno percepita, prontezza, stanchezza, indolenzimento, stress), tutti opzionali ma almeno uno.
// Append-only: per ogni giorno vale l'ultima riga, le precedenti restano come storico. Mancante = null, mai 0.
import { AppError, insist } from '../core/errors.js';
import { stableStringify } from '../core/hash.js';
import { validDay } from '../plan/schema.js';
import { addDays } from '../coach/stats.js';
import { localDate } from '../core/time.js';

export const FIELDS = ['sleep_quality', 'readiness', 'fatigue', 'soreness', 'stress'];
export const BACKFILL_DAYS = 14;
const WORSE_WHEN_HIGH = new Set(['fatigue', 'soreness', 'stress']);

/** Indice 0–100 (più alto = recupero migliore) sui valori presenti; servono almeno 3 valori su 5. */
export function recoveryIndex(d) {
  const vals = FIELDS.filter(k => Number.isInteger(d[k])).map(k => (WORSE_WHEN_HIGH.has(k) ? 6 - d[k] : d[k]));
  return vals.length >= 3 ? Math.round(((vals.reduce((a, b) => a + b, 0) / vals.length - 1) / 4) * 100) : null;
}

export function validateCheckin(b) {
  const allowed = ['day', ...FIELDS];
  for (const k of Object.keys(b)) insist(allowed.includes(k), 422, 'invalid_checkin');
  const data = {};
  for (const k of FIELDS) { const v = b[k] ?? null; insist(v === null || (Number.isInteger(v) && v >= 1 && v <= 5), 422, 'invalid_checkin'); data[k] = v; }
  insist(FIELDS.some(k => data[k] !== null), 422, 'empty_checkin');
  return data;
}

export async function saveCheckin(db, subject, body, { today, nowIso }) {
  const data = validateCheckin(body), day = body.day ?? today;
  insist(validDay(day) && day <= today && day >= addDays(today, -BACKFILL_DAYS), 422, 'invalid_day');
  const last = await db.prepare('SELECT data_json FROM checkin_versions WHERE subject_id = ? AND day = ? ORDER BY id DESC LIMIT 1').bind(subject, day).first();
  insist(!last || last.data_json !== stableStringify(data), 422, 'no_change');
  await db.prepare('INSERT INTO checkin_versions (subject_id, day, data_json, created_at) VALUES (?, ?, ?, ?)').bind(subject, day, stableStringify(data), nowIso).run();
  return { day, ...data, index: recoveryIndex(data) };
}

/** Un check-in per giorno (l'ultimo) nell'intervallo [from, to], con il numero di versioni. Una sola query D1. */
export async function loadCheckins(db, subject, from, to) {
  const { results } = await db.prepare('SELECT day, data_json, created_at FROM checkin_versions WHERE subject_id = ? AND day >= ? AND day <= ? ORDER BY day ASC, id ASC').bind(subject, from, to).all();
  const by = new Map();
  for (const r of results) { const cur = by.get(r.day); by.set(r.day, { day: r.day, ...JSON.parse(r.data_json), edited_at: r.created_at, versions: (cur?.versions ?? 0) + 1 }); }
  return [...by.values()].map(c => ({ ...c, index: recoveryIndex(c) }));
}

const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
/** Medie degli ultimi 7 giorni e dei 7 precedenti (null se meno di 3 check-in). */
export function checkinAverages(list, today) {
  const win = (a, b) => list.filter(c => c.day > addDays(today, -a) && c.day <= addDays(today, -b));
  const mk = rows => (rows.length >= 3 ? { n: rows.length, index: avg(rows.map(r => r.index).filter(x => x != null)), ...Object.fromEntries(FIELDS.map(k => [k, avg(rows.map(r => r[k]).filter(Number.isInteger))])) } : { n: rows.length, index: null, ...Object.fromEntries(FIELDS.map(k => [k, null])) });
  return { last7: mk(win(7, 0)), prev7: mk(win(14, 7)) };
}

export async function checkinView(db, subject, { days, today }) {
  const span = Math.min(90, Math.max(7, Number.isInteger(days) ? days : 30)), list = await loadCheckins(db, subject, addDays(today, -(span - 1)), today);
  return { today, window_days: span, entries: list.slice().reverse(), today_entry: list.find(c => c.day === today) ?? null, ...checkinAverages(list, today) };
}

export async function checkinRoute(request, url, { db, subject, now, readBody }) {
  const nowIso = now().toISOString(), today = localDate(nowIso, 'Europe/Rome');
  if (request.method === 'GET') { const d = Number.parseInt(url.searchParams.get('days'), 10); return await checkinView(db, subject, { days: Number.isInteger(d) ? d : 30, today }); }
  if (request.method !== 'POST') throw new AppError(405, 'method_not_allowed');
  return await saveCheckin(db, subject, await readBody(request, url, 2048), { today, nowIso });
}
