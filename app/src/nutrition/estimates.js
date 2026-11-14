// Pasti stimati da ChatGPT (foto, peso, descrizione). Restano SEPARATI da FatSecret: source_system 'chatgpt_estimate', mai sommati ai totali di FatSecret.
// Formato fisso (versione 1): { "version": 1, "meals": [{ "id", "date", "meal", "name", "description"?, "calories", "protein"?, "carbohydrate"?, "fat"?, "fiber"?, "sugar"?, "uncertainty_pct"? }] }
// Idempotente: l'id del pasto è la chiave. Lo stesso pasto reimportato identico = nessuna modifica; mai cancellazioni (scope parziale).
// Importazione: dal JSON incollato nell'app (POST /v1/nutrition/estimates). Solo proprietario.
import { AppError, insist } from '../core/errors.js';
import { ingest } from '../ingest/ledger.js';
import { validDay } from '../plan/schema.js';
import { addDays } from '../coach/stats.js';

export const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Other'];
export const DEFAULT_UNCERTAINTY_PCT = 25; // senza stima dichiarata: intervallo largo (le stime non sono misure)
export const MAX_MEALS = 50, BACKFILL_DAYS = 30;
const NUTRIENTS = ['calories', 'protein', 'carbohydrate', 'fat', 'fiber', 'sugar'];
const MEAL_ID = /^[A-Za-z0-9_.-]{1,80}$/;
const text = (v, max) => { insist(v == null || (typeof v === 'string' && v.length <= max), 422, 'invalid_estimate'); return v?.trim() || null; };

export function validateEstimates(b, { today }) {
  insist(b.version === 1 && Array.isArray(b.meals) && b.meals.length >= 1 && b.meals.length <= MAX_MEALS, 422, 'invalid_estimate');
  for (const k of Object.keys(b)) insist(['version', 'meals'].includes(k), 422, 'invalid_estimate');
  const seen = new Set();
  return b.meals.map(m => {
    insist(m && typeof m === 'object' && !Array.isArray(m), 422, 'invalid_estimate');
    for (const k of Object.keys(m)) insist(['id', 'date', 'meal', 'name', 'description', 'uncertainty_pct', ...NUTRIENTS].includes(k), 422, 'invalid_estimate');
    insist(typeof m.id === 'string' && MEAL_ID.test(m.id) && !seen.has(m.id), 422, 'invalid_estimate'); seen.add(m.id);
    insist(validDay(m.date) && m.date <= today && m.date >= addDays(today, -BACKFILL_DAYS), 422, 'invalid_day');
    insist(MEALS.includes(m.meal), 422, 'invalid_estimate');
    const nutrients = {};
    for (const k of NUTRIENTS) { const v = m[k] ?? null; insist(v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10000), 422, 'invalid_estimate'); nutrients[k] = v; }
    insist(nutrients.calories !== null, 422, 'invalid_estimate'); // una stima senza calorie non serve
    const u = m.uncertainty_pct ?? DEFAULT_UNCERTAINTY_PCT; insist(typeof u === 'number' && u >= 0 && u <= 100, 422, 'invalid_estimate');
    return { id: `meal:${m.id}`, domain: 'nutrition', observed_at: null, payload: { local_date: m.date, meal: m.meal, name: text(m.name, 120), description: text(m.description, 400), nutrients, estimated: true, uncertainty_pct: u, source: 'chatgpt_estimate' } };
  });
}

export async function importEstimates(db, raw, subject, body, { today, nowIso }) {
  const records = validateEstimates(body, { today });
  if (!raw) throw new AppError(503, 'raw_store_unavailable');
  const r = await ingest({ db, raw, now: () => nowIso }, { subject, source_system: 'chatgpt_estimate', source_account: 'chatgpt', scope_id: 'estimates', request_id: crypto.randomUUID(), captured_at: nowIso, artifact: JSON.stringify(body), records, scope_complete: false });
  return { meals: records.length, new_or_changed: r.replayed ? 0 : r.modified, replayed: r.replayed };
}

export async function estimatesRoute(request, url, { db, raw, subject, now, readBody }) {
  if (request.method !== 'POST' || url.pathname !== '/v1/nutrition/estimates') throw new AppError(request.method === 'POST' ? 404 : 405, request.method === 'POST' ? 'not_found' : 'method_not_allowed');
  const nowIso = now().toISOString();
  return importEstimates(db, raw, subject, await readBody(request, url, 64 * 1024), { today: nowIso.slice(0, 10), nowIso });
}
