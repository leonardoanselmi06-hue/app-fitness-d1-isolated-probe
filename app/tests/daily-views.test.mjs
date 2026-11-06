import test from 'node:test';
import assert from 'node:assert/strict';
import { ingest } from '../src/ingest/ledger.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { nutritionView, sleepView, stepsView } from '../src/analytics/daily-views.js';
import { createApp } from '../src/app.js';
import { AppError } from '../src/core/errors.js';
import { normalizeEntry, intFromDate } from '../src/adapters/fatsecret/normalize.js';
import { newDb } from './helpers/d1-shim.mjs';

const S = 'owner';
const NOW = new Date('2026-11-06T12:00:00Z'); // oggi = 2026-11-06 (Europe/Rome)
const rid = n => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const put = (db, n, source_system, scope_id, records) => ingest({ db, raw: new MemoryRawStore(), now: () => '2026-11-06T10:00:00.000Z' }, {
  subject: S, source_system, source_account: 'acc', scope_id, request_id: rid(n), captured_at: '2026-11-06T10:00:00Z',
  artifact: JSON.stringify(records), records, scope_complete: false,
});

// ---------- Alimentazione ----------
const entry = (id, date, meal, name, nut = {}) => normalizeEntry({ food_entry_id: String(id), date_int: String(intFromDate(date)), meal, food_entry_name: name, food_entry_description: `1 ${name}`, ...nut });
async function nutritionDb() {
  const db = newDb();
  await put(db, 1, 'fatsecret', 'diary', [
    entry(1, '2026-11-05', 'Breakfast', 'Banana', { calories: '90', protein: '1', carbohydrate: '23.1', fat: '0.3' }),
    entry(2, '2026-11-05', 'Lunch', 'Pasta', { calories: '600', protein: '20', carbohydrate: '100', fat: '10' }),
    entry(3, '2026-11-05', 'Other', 'Castagne', { calories: '69', protein: '1', carbohydrate: '15', fat: '0.6' }),
    entry(4, '2026-11-05', 'Dinner', 'Misterioso', { calories: '' }), // senza dati nutrizionali
    entry(5, '2026-11-04', 'Breakfast', 'Yogurt', { calories: '300', protein: '10', carbohydrate: '40', fat: '8' }),
    entry(6, '2026-11-06', 'Breakfast', 'Caffè e latte', { calories: '200', protein: '5', carbohydrate: '30', fat: '4' }), // oggi
    entry(7, '2026-11-01', 'Dinner', 'Riso', { calories: '500', protein: '30', carbohydrate: '50', fat: '20' }),
  ]);
  return db;
}

test('alimentazione: totali giornalieri, pasti in ordine, mancanti = null, oggi parziale', async () => {
  const v = await nutritionView(await nutritionDb(), S, { days: '7', now: NOW });
  assert.deepEqual(v.by_day.map(d => d.date), ['2026-11-06', '2026-11-05', '2026-11-04', '2026-11-01']);
  assert.equal(v.by_day[0].partial, true); assert.equal(v.by_day[1].partial, false);
  const d = v.by_day[1];
  assert.deepEqual(d.totals, { calories: 759, protein: 22, carbohydrate: 138.1, fat: 10.9, fiber: null, sugar: null });
  assert.deepEqual(d.meals.map(m => m.meal), ['Breakfast', 'Lunch', 'Dinner', 'Other']);
  assert.equal(d.meals[2].calories, null); // solo voci senza calorie: null, non 0
  assert.equal(d.entries, 4); assert.equal(d.incomplete_entries, 1);
  assert.equal(d.meals[0].entries[0].name, 'Banana');
});

test('alimentazione: medie solo sui giorni completi con voci; giorni senza voci contati come mancanti', async () => {
  const v = await nutritionView(await nutritionDb(), S, { days: '7', now: NOW });
  assert.deepEqual(v.averages.calories, { value: 520, n: 3 }); // 759, 300, 500: oggi escluso
  assert.deepEqual(v.averages.protein, { value: 20.7, n: 3 });
  assert.equal(v.empty_days, 3); // 31/10, 2/11, 3/11
  assert.equal(v.from, '2026-10-31'); assert.equal(v.to, '2026-11-06');
  const s = await nutritionView(await nutritionDb(), S, { days: '3', now: NOW });
  assert.deepEqual(s.by_day.map(x => x.date), ['2026-11-06', '2026-11-05', '2026-11-04']); assert.equal(s.empty_days, 0);
  const none = await nutritionView(newDb(), S, { now: NOW });
  assert.deepEqual(none.by_day, []); assert.equal(none.averages.calories.value, null); assert.equal(none.averages.calories.n, 0);
  assert.equal((await nutritionView(await nutritionDb(), S, { days: '9999', now: NOW })).window_days, 60);
  assert.equal((await nutritionView(await nutritionDb(), 'altro', { days: '7', now: NOW })).by_day.length, 0);
});

// ---------- Sonno ----------
const DUR = [400, 420, 440, 460, 480, 500, 420, 450, 430, 410, 32, 470, 510, 407]; // k=0..13 = notti del 24/10 .. 6/11
const dayOf = k => new Date(Date.parse('2026-10-24T00:00:00Z') + k * 86400000).toISOString().slice(0, 10);
function night(k) {
  const date = dayOf(k), prev = dayOf(k - 1), min = DUR[k];
  const start = `${prev}T22:30:00.000Z`;
  return { id: `sleep:${Date.parse(start)}`, domain: 'sleep', observed_at: start, payload: {
    start_at: start, end_at: new Date(Date.parse(start) + min * 60000).toISOString(), local_date: date, timezone: k === 0 ? 'Nope/Zone' : 'Europe/Rome',
    duration_min: min, short: min < 180, quality: k === 13 ? 0.5054945349693298 : 0, cycles: k === 13 ? 8 : 0, rating: 0, snore: 1740, noise_level: 0.02 } };
}
async function sleepDb() { const db = newDb(); await put(db, 1, 'sleep_as_android', 'sleep', DUR.map((_, k) => night(k))); return db; }

test('sonno: notti brevi visibili ma escluse dalle medie; confronto con le 7 precedenti', async () => {
  const v = await sleepView(await sleepDb(), S, { days: '30', now: NOW });
  assert.equal(v.count, 14); assert.equal(v.short_count, 1);
  assert.equal(v.nights.find(n => n.duration_min === 32).short, true);
  assert.equal(v.avg_min_7, 442); assert.equal(v.n_7, 7); assert.equal(v.avg_min_prev_7, 450); assert.equal(v.n_prev_7, 6);
  assert.equal(v.delta_min_7, -8); assert.equal(v.avg_min_window, 446);
  assert.deepEqual(v.longest, { date: '2026-11-05', duration_min: 510 }); assert.deepEqual(v.shortest, { date: '2026-10-24', duration_min: 400 });
});

test('sonno: orari locali Europe/Rome (ora legale/solare), fallback su fuso non valido, sentinelle non esposte', async () => {
  const v = await sleepView(await sleepDb(), S, { days: '30', now: NOW });
  const last = v.nights.at(-1);
  assert.equal(last.start_local, '23:30'); assert.equal(last.end_local, '06:17'); // 22:30Z + 407 min = 05:17Z = 06:17 CET
  assert.equal(last.quality_pct, 51); assert.equal(last.cycles, 8); assert.equal(last.rating, null); // valutazione 0 = non valutata
  assert.equal(v.nights[1].quality_pct, null); assert.equal(v.nights[1].cycles, null); // 0 = non calcolato
  assert.equal(v.nights[0].start_local, '00:30'); // 22:30Z in CEST, fuso non valido -> Europe/Rome, mai "24:30"
});

test('sonno: finestra, dati insufficienti = null, soggetto isolato', async () => {
  const db = await sleepDb();
  const w7 = await sleepView(db, S, { days: '7', now: NOW });
  assert.equal(w7.count, 7); assert.equal(w7.n_prev_7, 0); assert.equal(w7.avg_min_prev_7, null); assert.equal(w7.delta_min_7, null);
  assert.equal((await sleepView(db, S, { days: '1', now: NOW })).window_days, 7);
  const e = await sleepView(newDb(), S, { now: NOW });
  assert.equal(e.count, 0); assert.equal(e.avg_min_7, null); assert.equal(e.avg_min_window, null); assert.equal(e.longest, null); assert.deepEqual(e.nights, []);
  assert.equal((await sleepView(db, 'altro', { now: NOW })).count, 0);
});

// ---------- Passi ----------
const step = (date, count, metric = 'steps_total') => ({ id: `${metric === 'steps_total' ? 'steps' : 'other'}:${date}`, domain: 'activity', observed_at: null, payload: { metric, local_date: date, count, origins: ['com.sec.android.app.shealth'] } });
async function stepsDb() {
  const db = newDb();
  await put(db, 1, 'health_connect', 'steps', [
    step('2026-10-23', 6000), step('2026-10-24', 7000), step('2026-10-25', 8000), /* 26/10 mancante */ step('2026-10-27', 9000), step('2026-10-28', 5000), step('2026-10-29', 7000),
    step('2026-10-30', 8000), step('2026-10-31', 9000), step('2026-11-01', 10000), step('2026-11-02', 11000), step('2026-11-03', 6000), step('2026-11-04', 12000), step('2026-11-05', 5000),
    step('2026-11-06', 188), step('2026-11-05', 5, 'active_minutes'),
  ]);
  return db;
}

test('passi: medie sui giorni completi (oggi escluso), confronto a 7 giorni, giorno migliore', async () => {
  const v = await stepsView(await stepsDb(), S, { days: '30', now: NOW });
  assert.equal(v.today_count, 188);
  assert.equal(v.avg_7, 8714); assert.equal(v.n_7, 7); assert.equal(v.avg_prev_7, 7000); assert.equal(v.n_prev_7, 6); assert.equal(v.delta_7, 1714);
  assert.equal(v.avg_window, 7923); assert.equal(v.n_window, 13);
  assert.deepEqual(v.best, { date: '2026-11-04', count: 12000 });
  assert.equal(v.series.length, 14); // l'altra metrica (active_minutes) è ignorata
  assert.equal(v.missing_days, 16); // giorni senza record: mancanti, non zero
});

test('passi: finestra corta, zero legittimo conservato, dati insufficienti = null', async () => {
  const db = await stepsDb();
  const w = await stepsView(db, S, { days: '7', now: NOW });
  assert.equal(w.series.length, 7); assert.equal(w.n_prev_7, 0); assert.equal(w.delta_7, null);
  const z = newDb(); await put(z, 1, 'health_connect', 'steps', [step('2026-11-04', 0)]);
  const zv = await stepsView(z, S, { now: NOW });
  assert.deepEqual(zv.series, [{ date: '2026-11-04', count: 0 }]); assert.equal(zv.avg_window, 0);
  const e = await stepsView(newDb(), S, { now: NOW });
  assert.equal(e.today_count, null); assert.equal(e.avg_window, null); assert.equal(e.avg_7, null); assert.equal(e.best, null); assert.deepEqual(e.series, []);
});

// ---------- API ----------
const authOk = { authenticate: async () => ({ subject: S }) };
const authNo = { authenticate: async () => { throw new AppError(401, 'unauthenticated'); } };
const get = (app, path, method = 'GET') => app(new Request(`https://app.test${path}`, { method }));

test('API: nutrition, sleep e steps richiedono autenticazione e sono di sola lettura', async () => {
  const paths = ['/v1/derived/nutrition', '/v1/derived/sleep', '/v1/derived/steps'];
  const db = await stepsDb();
  for (const p of paths) assert.equal((await get(createApp({ db, auth: authNo }), p)).status, 401);
  const app = createApp({ db, auth: authOk, now: () => NOW });
  for (const p of paths) { const r = await get(app, `${p}?days=14`); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal((await r.json()).window_days, 14); }
  for (const p of paths) assert.equal((await get(app, p, 'POST')).status, 405);
});
