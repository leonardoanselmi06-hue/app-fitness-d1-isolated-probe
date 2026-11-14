import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { validateEstimates } from '../src/nutrition/estimates.js';
import { ingest } from '../src/ingest/ledger.js';
import { nutritionView } from '../src/analytics/daily-views.js';
import { estimatesBlock, importText } from '../public/estimates.js';
import { newDb } from './helpers/d1-shim.mjs';

const NOW = new Date('2026-11-14T12:00:00Z'), TODAY = '2026-11-14';
const mk = (db, raw = new MemoryRawStore()) => createApp({ db, raw, auth: { authenticate: async () => ({ subject: 'owner', principal: 'owner' }) }, jobs: {}, now: () => NOW });
const post = async (app, body, ct = 'application/json') => { const r = await app(new Request('https://app.test/v1/nutrition/estimates', { method: 'POST', headers: { 'content-type': ct }, body: JSON.stringify(body) })); return { status: r.status, json: await r.json() }; };
const meal = (o = {}) => ({ id: 'm1', date: TODAY, meal: 'Lunch', name: 'Pasta', calories: 650, protein: 22, carbohydrate: 100, fat: 16, ...o });
const body = (...m) => ({ version: 1, meals: m.length ? m : [meal()] });

test('validazione: formato fisso, calorie obbligatorie, date entro 30 giorni, campi sconosciuti rifiutati, incertezza di default larga', () => {
  const r = validateEstimates(body(), { today: TODAY });
  assert.equal(r[0].id, 'meal:m1'); assert.equal(r[0].payload.uncertainty_pct, 25); assert.equal(r[0].payload.estimated, true); assert.equal(r[0].payload.nutrients.fiber, null);
  for (const bad of [{ version: 2, meals: [meal()] }, { version: 1, meals: [] }, body(meal({ calories: null })), body(meal({ calories: -5 })), body(meal({ meal: 'Brunch' })), body(meal({ date: '2026-12-01' })), body(meal({ date: '2026-09-01' })), body(meal(), meal()), body(meal({ id: 'a b' })), body(meal({ extra: 1 })), body(meal({ uncertainty_pct: 150 }))]) assert.throws(() => validateEstimates(bad, { today: TODAY }), e => e.status === 422);
});

test('API: importa, reimportare è un NO-OP, pasto corretto = nuova revisione, solo JSON', async () => {
  const db = newDb(), app = mk(db);
  const a = await post(app, body()); assert.equal(a.status, 200); assert.equal(a.json.new_or_changed, 1);
  const b = await post(app, body()); assert.equal(b.json.new_or_changed, 0); assert.match(importText(b.json), /Nessuna novità/);
  const c = await post(app, body(meal({ calories: 700 }), meal({ id: 'm2', meal: 'Dinner' }))); assert.equal(c.json.new_or_changed, 2);
  const rows = (await db.prepare("SELECT revision FROM current_records WHERE source_system = 'chatgpt_estimate' ORDER BY record_id").all()).results; assert.deepEqual(rows.map(x => x.revision), [2, 1]);
  assert.equal((await post(app, body(), 'text/plain')).status, 415);
  assert.equal((await post(app, { version: 1, meals: [meal({ calories: null })] })).json.error, 'invalid_estimate');
});

test('API: senza archivio RAW non importa (503) e non scrive nulla', async () => {
  const db = newDb(), app = createApp({ db, raw: null, auth: { authenticate: async () => ({ subject: 'owner', principal: 'owner' }) }, jobs: {}, now: () => NOW });
  assert.equal((await post(app, body())).status, 503);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM current_records').first()).n, 0);
});

test('separazione: le stime non entrano nei totali/medie di FatSecret e compaiono in `estimates`', async () => {
  const db = newDb(), raw = new MemoryRawStore(), app = mk(db, raw);
  const fs = ['Breakfast', 'Lunch', 'Dinner'].map((m, i) => ({ id: `entry:${i}`, domain: 'nutrition', observed_at: null, payload: { local_date: '2026-11-13', meal: m, name: m, nutrients: { calories: 600, protein: 30, carbohydrate: 70, fat: 20 } } }));
  await ingest({ db, raw, now: () => NOW.toISOString() }, { subject: 'owner', source_system: 'fatsecret', source_account: 'a', scope_id: 'day:2026-11-13', request_id: crypto.randomUUID(), captured_at: NOW.toISOString(), artifact: '[]', records: fs, scope_complete: true });
  const before = await nutritionView(db, 'owner', { days: 7, now: NOW });
  await post(app, body(meal({ date: '2026-11-13', calories: 900 })));
  const after = await nutritionView(db, 'owner', { days: 7, now: NOW });
  assert.deepEqual({ ...after, estimates: undefined, generation: 0 }, { ...before, estimates: undefined, generation: 0 });
  assert.equal(after.by_day[0].totals.calories, 1800); assert.equal(before.estimates.length, 0); assert.equal(after.estimates.length, 1); assert.equal(after.estimates[0].nutrients.calories, 900);
});

test('UI: elenco con intervallo di incertezza, avviso di separazione, escape', () => {
  const html = estimatesBlock({ estimates: [{ id: 'm1', date: '2026-11-14', meal: 'Lunch', name: '<b>Pasta</b>', nutrients: { calories: 600, protein: 20, carbohydrate: 90, fat: 10 }, uncertainty_pct: 25 }] });
  assert.match(html, /450–750 kcal \(±25%\)/); assert.match(html, /separate dal diario FatSecret/); assert.doesNotMatch(html, /<b>Pasta/); assert.match(html, /id="estForm"/);
  assert.match(estimatesBlock({ estimates: [] }), /Nessun pasto stimato/);
});
