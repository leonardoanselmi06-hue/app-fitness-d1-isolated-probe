// Validazione rigida dei dati del Piano (solo dal proprietario, ma il server non si fida del client). Campi sconosciuti = rifiutati.
import { insist } from '../core/errors.js';

export const KINDS = ['phase', 'day', 'rx', 'note'];
export const NOTE_CATEGORIES = ['evento', 'malattia', 'infortunio', 'viaggio', 'stress', 'sonno', 'alimentazione', 'allenamento', 'altro'];
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, min, max, code) => { insist(typeof v === 'string' && v.trim().length >= min && v.length <= max, 422, code); return v.trim(); };
const optStr = (v, max, code) => (v == null || v === '' ? null : str(v, 1, max, code));
const optInt = (v, min, max, code) => { if (v == null) return null; insist(Number.isInteger(v) && v >= min && v <= max, 422, code); return v; };
const only = (o, keys, code) => { insist(o && typeof o === 'object' && !Array.isArray(o), 422, code); for (const k of Object.keys(o)) insist(keys.includes(k), 422, code); };
export const validDay = s => typeof s === 'string' && DAY_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
export const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Ritorna i dati normalizzati. `removed:true` ammesso su day/rx/note (rimozione = nuova versione, lo storico resta). */
export function validateData(kind, d) {
  insist(KINDS.includes(kind), 422, 'invalid_kind');
  if (d && d.removed === true) { insist(kind !== 'phase', 422, 'invalid_data'); only(d, ['removed'], 'invalid_data'); return { removed: true }; }
  if (kind === 'phase') {
    only(d, ['name', 'goal', 'method'], 'invalid_phase');
    return { name: str(d.name, 1, 60, 'invalid_phase'), goal: optStr(d.goal, 200, 'invalid_phase'), method: optStr(d.method, 300, 'invalid_phase') };
  }
  if (kind === 'day') {
    only(d, ['order', 'focus'], 'invalid_day');
    return { order: optInt(d.order ?? 0, 0, 20, 'invalid_day'), focus: optStr(d.focus, 60, 'invalid_day') };
  }
  if (kind === 'rx') {
    only(d, ['order', 'sets', 'reps_min', 'reps_max', 'rir', 'rest_sec', 'method', 'note'], 'invalid_rx');
    const reps_min = optInt(d.reps_min, 1, 100, 'invalid_rx'), reps_max = optInt(d.reps_max, 1, 100, 'invalid_rx');
    insist(reps_min == null || reps_max == null || reps_max >= reps_min, 422, 'invalid_rx');
    insist(d.rir == null || (typeof d.rir === 'number' && d.rir >= 0 && d.rir <= 6 && Number.isInteger(d.rir * 2)), 422, 'invalid_rx'); // RIR 0–6, passi da 0,5
    return { order: optInt(d.order ?? 0, 0, 30, 'invalid_rx'), sets: (insist(d.sets != null, 422, 'invalid_rx'), optInt(d.sets, 1, 20, 'invalid_rx')), reps_min, reps_max, rir: d.rir ?? null, rest_sec: optInt(d.rest_sec, 0, 900, 'invalid_rx'), method: optStr(d.method, 60, 'invalid_rx'), note: optStr(d.note, 200, 'invalid_rx') };
  }
  only(d, ['date', 'category', 'title', 'text'], 'invalid_note');
  insist(validDay(d.date), 422, 'invalid_note'); insist(NOTE_CATEGORIES.includes(d.category), 422, 'invalid_note');
  return { date: d.date, category: d.category, title: str(d.title, 1, 80, 'invalid_note'), text: d.text == null || d.text === '' ? null : str(d.text, 1, 5000, 'invalid_note') };
}
