import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syncFatSecret, REREAD_DAYS } from '../src/adapters/fatsecret/sync.js';
import { intFromDate, dateFromInt } from '../src/adapters/fatsecret/normalize.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { listCanonical } from '../src/ingest/ledger.js';
import { checkinSummary, checkinForm } from '../public/checkin.js';
import worker, { EVENING_CRON } from '../src/worker.js';
import { newDb } from './helpers/d1-shim.mjs';

const entry = (id, date, kcal) => ({ food_entry_id: String(id), food_entry_name: `Cibo ${id}`, food_entry_description: 'x', date_int: String(intFromDate(date)), meal: 'Lunch', food_id: '9', serving_id: '8', number_of_units: '1.000', calories: String(kcal), carbohydrate: '10', protein: '5', fat: '2' });
function fakeGet(days, log) {
  return async (path, { date }) => {
    const d = dateFromInt(date);
    if (path === '/food-entries/month/v2') return { month: { day: Object.keys(days).filter(k => k.startsWith(d.slice(0, 7)) && days[k].length).map(k => ({ date_int: String(intFromDate(k)), calories: String(days[k].reduce((a, e) => a + Number(e.calories), 0)) })) } };
    log.push(d); const l = days[d] ?? []; return { food_entries: l.length ? { food_entry: l } : {} };
  };
}
const run = (db, raw, days, log, n) => syncFatSecret({ db, raw }, { get: fakeGet(days, log), captured_at: '2026-11-14T20:00:00.000Z', request_id: null, newId: (() => { let i = 0; return () => `00000000-0000-4000-8${n}00-${String(++i).padStart(12, '0')}`; })() });

test('FatSecret: gli ultimi 3 giorni sono riletti anche se le calorie coincidono; rilancio idempotente', async () => {
  assert.equal(REREAD_DAYS, 3);
  const db = newDb(), raw = new MemoryRawStore();
  const days = { '2026-11-10': [entry(1, '2026-11-10', 300)], '2026-11-12': [entry(2, '2026-11-12', 400)], '2026-11-13': [entry(3, '2026-11-13', 500)], '2026-11-14': [entry(4, '2026-11-14', 200)] };
  await run(db, raw, days, [], 1);
  const log = []; await run(db, raw, days, log, 2);
  assert.deepEqual(log.sort(), ['2026-11-12', '2026-11-13', '2026-11-14']); // 3 giorni, non il 10
  assert.equal((await listCanonical(db, 'owner', 'nutrition')).length, 4); // nessun duplicato
});

test('FatSecret: pasto aggiunto il giorno dopo a parità di calorie totali viene registrato; lettura fallita non cancella', async () => {
  const db = newDb(), raw = new MemoryRawStore();
  const days = { '2026-11-13': [entry(3, '2026-11-13', 500)] };
  await run(db, raw, days, [], 1);
  days['2026-11-13'] = [entry(3, '2026-11-13', 500), entry(5, '2026-11-13', 0)];
  await run(db, raw, days, [], 2);
  assert.equal((await listCanonical(db, 'owner', 'nutrition')).length, 2);
  const failing = async (path) => { if (path === '/food-entries/v2') throw new Error('429'); return { month: { day: [] } }; };
  await assert.rejects(syncFatSecret({ db, raw }, { get: failing, captured_at: '2026-11-14T20:00:00.000Z', newId: () => '00000000-0000-4000-8000-000000000009' }));
  assert.equal((await listCanonical(db, 'owner', 'nutrition')).length, 2);
});

test('cron serale: solo FatSecret (nessun altro job)', async () => {
  const waits = []; await worker.scheduled({ cron: EVENING_CRON }, {}, { waitUntil: p => waits.push(p) });
  assert.equal(waits.length, 1); await waits[0]; // senza env: ritorna 'disabled', non lancia
  assert.match(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'), new RegExp(`"${EVENING_CRON.replaceAll('*', '\\*')}"`));
  assert.match(readFileSync(new URL('../../.github/workflows/deploy-worker.yml', import.meta.url), 'utf8'), new RegExp(`"${EVENING_CRON.replaceAll('*', '\\*')}"`));
});

test('Recupero: scheda di apertura, check-in prima del riepilogo, ordine schede, verso dichiarato', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="ciFormBox"') < html.indexOf('id="ciSummary"'));
  assert.deepEqual([...html.matchAll(/data-tab="(\w+)"/g)].map(m => m[1]).slice(0, 4), ['recupero', 'coach', 'piano', 'home']);
  assert.match(html, /data-view="home" hidden/); assert.doesNotMatch(html, /data-view="recupero" hidden/);
  assert.match(js, /: 'recupero'/);
  assert.match(js, /ids: \['ciFormBox', 'ciSummary', 'ciList'\]/);
  const m = { n: 5, index: 76, sleep_quality: 4, readiness: 4, fatigue: 2, soreness: 2, stress: 2 };
  const out = checkinSummary({ last7: m, prev7: { n: 0, index: null, sleep_quality: null, readiness: null, fatigue: null, soreness: null, stress: null } });
  assert.match(out, /5 check-in · confronto non disponibile/); assert.equal((out.match(/più basso = meglio/g) ?? []).length, 3); assert.equal((out.match(/più alto = meglio/g) ?? []).length, 3);
  assert.match(checkinForm({ today: '2026-11-14', today_entry: null }), /Salva il check-in/);
});
