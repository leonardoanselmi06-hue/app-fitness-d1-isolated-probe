// Cardio: SOLO monitoraggio (DEC: nessun test periodico). Tempo per fascia cardiaca a settimana e frequenza media per seduta, dai dati Polar.
// Le fasce sono quelle FISSE riportate da Polar nella seduta (es. 100–120, 120–140, 140–160, 160–180, 180–200 bpm), in ordine: Z1…Z5.
// "Zona 2" = la seconda fascia Polar (oggi 120–140 bpm). Non sono zone personalizzate: sono dichiarate nel risultato.
// Sedute senza dettaglio delle zone = "senza dettaglio" (mai zero). La settimana in corso è parziale e non entra nella media.
// Non misurabile con i dati salvati: frequenza cardiaca a parità di ritmo (manca la velocità): dichiarato, non stimato.
import { getGeneration } from '../ingest/ledger.js';
import { localDate } from '../core/time.js';
import { clampInt, round, mean } from './views.js';

const DAY_MS = 86_400_000, TZ = 'Europe/Rome';
export const CARDIO_WEEKS = Object.freeze({ def: 8, min: 2, max: 26 });
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const weekStart = d => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7)); // lunedì

/** Fasce [{lower, upper, ms}] della seduta (prima serie di zone di frequenza cardiaca), ordinate; null se manca il dettaglio. */
export function bandsOf(p) {
  const z = (p.hr_detail?.zones ?? []).find(x => /HEART/i.test(x.type ?? '')) ?? p.hr_detail?.zones?.[0];
  const b = (z?.zones ?? []).filter(x => Number.isFinite(x.in_zone)).map(x => ({ lower: x.lower, upper: x.upper, ms: x.in_zone })).sort((a, c) => a.lower - c.lower);
  return b.length >= 2 ? b : null;
}
const minutes = ms => round(ms / 60000, 1);

export async function cardioView(db, subject, { weeks, now = new Date() } = {}) {
  const n = clampInt(weeks, CARDIO_WEEKS.def, CARDIO_WEEKS.min, CARDIO_WEEKS.max), today = localDate(now.toISOString(), TZ);
  const thisWeek = weekStart(today), first = addDays(thisWeek, -7 * (n - 1));
  const { results } = await db.prepare(`SELECT payload_json FROM current_records WHERE subject_id = ? AND domain = 'cardio' AND source_system = 'polar' AND deleted = 0 AND json_extract(payload_json, '$.local_date') >= ? AND json_extract(payload_json, '$.local_date') <= ? ORDER BY json_extract(payload_json, '$.start_at') DESC`).bind(subject, first, today).all();
  const sessions = results.map(r => JSON.parse(r.payload_json)).map(p => {
    const bands = bandsOf(p);
    return { date: p.local_date, sport: p.sport ?? null, duration_min: p.duration_ms == null ? null : minutes(p.duration_ms), hr_avg: p.hr_avg ?? null, hr_max: p.hr_max ?? null, bands: bands && bands.map((b, i) => ({ zone: i + 1, lower: b.lower, upper: b.upper, min: minutes(b.ms) })), z2_min: bands ? minutes(bands[1].ms) : null };
  });
  const weekRows = Array.from({ length: n }, (_, i) => {
    const start = addDays(first, 7 * i), end = addDays(start, 6), ss = sessions.filter(s => s.date >= start && s.date <= end), det = ss.filter(s => s.bands);
    const zone_min = [1, 2, 3, 4, 5].map(z => (det.length ? round(det.reduce((a, s) => a + (s.bands.find(b => b.zone === z)?.min ?? 0), 0), 1) : null));
    return { week_start: start, partial: start === thisWeek, sessions: ss.length, sessions_without_detail: ss.length - det.length, duration_min: ss.length && ss.every(s => s.duration_min != null) ? round(ss.reduce((a, s) => a + s.duration_min, 0), 1) : null, zone_min, z2_min: zone_min[1], hr_avg: round(mean(ss.map(s => s.hr_avg).filter(x => x != null)), 0) };
  }).reverse();
  const done = weekRows.filter(w => !w.partial && w.sessions > 0 && w.sessions_without_detail === 0), last4 = weekRows.filter(w => !w.partial).slice(0, 4);
  return {
    generation: await getGeneration(db), today, weeks: n,
    zone_note: 'Fasce fisse Polar (Z1–Z5 in ordine; Z2 = seconda fascia). Non sono zone personalizzate: per te possono sembrare più alte dello sforzo percepito.',
    bands: sessions.find(s => s.bands)?.bands.map(b => ({ zone: b.zone, lower: b.lower, upper: b.upper })) ?? null,
    z2_avg_4w: last4.length === 4 && last4.every(w => w.z2_min != null || w.sessions === 0) ? round(mean(last4.map(w => w.z2_min ?? 0)), 1) : null, // 4 settimane complete; settimana senza sedute = 0 min di cardio registrato
    complete_weeks_with_sessions: done.length,
    pace_note: 'Frequenza cardiaca a parità di ritmo: non disponibile (i dati Polar salvati contengono solo i battiti, non la velocità).',
    weeks_list: weekRows, sessions: sessions.slice(0, 10),
  };
}
