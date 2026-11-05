// Sync FatSecret (diario alimentare, sola lettura). Ogni GIORNO è uno scope completo (`day:AAAA-MM-GG`): le voci tolte o modificate in
// FatSecret si riflettono (tombstone) perché la completezza del giorno la stabilisce il server leggendo tutte le voci di quel giorno.
// Per rispettare i limiti del Worker: 1-2 chiamate di totali mensili, poi il dettaglio solo dei giorni cambiati (calorie diverse da D1,
// giorno assente in D1, o oggi/ieri), al massimo MAX_DAYS per esecuzione, dal più recente. I restanti si completano alle esecuzioni successive.
import { ingest } from '../../ingest/ledger.js';
import { normalizeEntry, asArray, dateFromInt, intFromDate } from './normalize.js';
import { num } from '../lyfta/normalize.js';

export const MAX_DAYS = 8;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

async function storedDays(db, subject, from) {
  const rs = await db.prepare(`SELECT json_extract(payload_json,'$.local_date') AS d, SUM(json_extract(payload_json,'$.nutrients.calories')) AS kcal FROM current_records WHERE subject_id = ? AND source_system = 'fatsecret' AND deleted = 0 AND json_extract(payload_json,'$.local_date') >= ? GROUP BY 1`).bind(subject, from).all();
  return new Map((rs.results ?? []).map(r => [r.d, r.kcal]));
}

export async function syncFatSecret({ db, raw, now = () => new Date().toISOString() }, { get, subject = 'owner', account = 'fatsecret-user', days = 30, request_id, captured_at, maxDays = MAX_DAYS, newId = () => crypto.randomUUID() }) {
  const today = captured_at.slice(0, 10), win = Math.min(Math.max(days, 1), 120);
  const from = addDays(today, -win);
  // 1) totali mensili che coprono la finestra
  const totals = new Map();
  const seen = new Set();
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const key = d.slice(0, 7); if (seen.has(key)) continue; seen.add(key);
    const m = await get('/food-entries/month/v2', { date: intFromDate(d) });
    for (const x of asArray(m?.month?.day)) totals.set(dateFromInt(x.date_int), num(x.calories));
  }
  // la finestra deve includere anche l'ultimo mese (oggi)
  if (!seen.has(today.slice(0, 7))) { const m = await get('/food-entries/month/v2', { date: intFromDate(today) }); for (const x of asArray(m?.month?.day)) totals.set(dateFromInt(x.date_int), num(x.calories)); }
  const stored = await storedDays(db, subject, from);
  // 2) giorni da (ri)leggere
  const todo = new Set();
  for (const [d, kcal] of totals) if (d >= from && (d >= addDays(today, -1) || !stored.has(d) || Math.abs((stored.get(d) ?? 0) - (kcal ?? 0)) > 0.5)) todo.add(d);
  for (const d of stored.keys()) if (!totals.has(d)) todo.add(d); // giorno svuotato in FatSecret: va riletto per applicare i tombstone
  const ordered = [...todo].sort().reverse();
  let processed = 0, entries = 0;
  for (const d of ordered.slice(0, maxDays)) {
    const r = await get('/food-entries/v2', { date: intFromDate(d) });
    const list = asArray(r?.food_entries?.food_entry);
    const records = list.map(normalizeEntry);
    await ingest({ db, raw, now }, { subject, source_system: 'fatsecret', source_account: account, scope_id: `day:${d}`, request_id: newId(), captured_at, artifact: JSON.stringify(r ?? {}), records, scope_complete: true });
    processed++; entries += records.length;
  }
  return { ok: true, window_days: win, days_with_entries: totals.size, days_processed: processed, entries, remaining: Math.max(ordered.length - processed, 0) };
}
