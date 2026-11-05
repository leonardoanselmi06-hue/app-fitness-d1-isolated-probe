// Struttura (chiavi, tipi, lunghezze) delle risposte FatSecret reali. NESSUN valore. Date come giorni dall'epoca (date_int).
import { shape } from '../polar/probe.js';
const dayInt = d => Math.floor(d.getTime() / 86400000);

async function step(fn) { try { return await fn(); } catch (e) { return { errore: e.code ?? 'errore', step: e.extra?.step ?? null, upstream_status: e.extra?.upstream_status ?? null, reason: e.extra?.reason ?? null }; } }

export async function probeFatSecret(get, now = new Date()) {
  const today = dayInt(now);
  const out = { month_totals: null, day_entries: null, weights: null };
  const month = await step(async () => {
    const m = await get('/food-entries/month/v2', { date: today });
    const days = [m?.month?.day ?? []].flat();
    return { shape: shape(m), days_with_entries: days.length, latest_date_int: days.length ? Math.max(...days.map(d => Number(d.date_int))) : null };
  });
  out.month_totals = month.errore ? month : { shape: month.shape, days_with_entries: month.days_with_entries };
  if (month.latest_date_int != null) out.day_entries = await step(async () => shape(await get('/food-entries/v2', { date: month.latest_date_int }), 6));
  else out.day_entries = 'nessun giorno con voci nel mese corrente';
  out.weights = await step(async () => shape(await get('/weight/month/v2', { date: today })));
  return out;
}
