import test from 'node:test';
import assert from 'node:assert/strict';
import { runFatSecretSync } from '../src/jobs/fatsecret-job.js';
import { normalizeEntry, intFromDate, dateFromInt } from '../src/adapters/fatsecret/normalize.js';
import { FatSecretTokens } from '../src/adapters/fatsecret/oauth1.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { listCanonical } from '../src/ingest/ledger.js';
import { newDb } from './helpers/d1-shim.mjs';

const NOW = () => '2026-11-05T20:00:00.000Z';
const res = (b, status = 200) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status });
const entry = (id, date, kcal, extra = {}) => ({ food_entry_id: String(id), food_entry_name: `Cibo ${id}`, food_entry_description: 'x', date_int: String(intFromDate(date)), meal: 'Lunch', food_id: '9', serving_id: '8', number_of_units: '1.000', calories: String(kcal), carbohydrate: '10', protein: '5', fat: '2', ...extra });
// FatSecret finto con stato modificabile: days = { 'AAAA-MM-GG': [entries] }
function fake(days) {
  const calls = { month: 0, day: 0 };
  const fetchFn = async url => {
    const u = new URL(url); const di = Number(u.searchParams.get('date'));
    if (u.pathname.endsWith('/oauth/access_token')) return res('oauth_token=AT&oauth_token_secret=AS');
    if (u.pathname === '/rest/food-entries/month/v2') {
      calls.month++; const m = dateFromInt(di).slice(0, 7);
      const ds = Object.keys(days).filter(d => d.startsWith(m) && days[d].length).sort();
      return res({ month: { from_date_int: '1', to_date_int: '2', day: ds.map(d => ({ date_int: String(intFromDate(d)), calories: String(days[d].reduce((a, e) => a + Number(e.calories), 0)) })) } });
    }
    if (u.pathname === '/rest/food-entries/v2') { calls.day++; const l = days[dateFromInt(di)] ?? []; return res({ food_entries: l.length ? { food_entry: l } : {} }); }
    return res('x', 404);
  };
  return { fetchFn, calls };
}
async function setup(days) {
  const db = newDb(), f = fake(days);
  const tk = new FatSecretTokens({ db, consumerKey: 'ck', consumerSecret: 'cs', fetchFn: f.fetchFn, now: () => Date.parse(NOW()) });
  await tk.db.prepare("INSERT INTO oauth_tokens (provider, sealed, expires_at, scope, updated_at) VALUES ('fatsecret', ?, '9999-12-31T00:00:00.000Z', 'diary', ?)").bind(await (await import('../src/adapters/polar/oauth.js')).seal({ token: 'AT', secret: 'AS' }, 'cs'), NOW()).run();
  return { db, f, raw: new MemoryRawStore(), env: { DB: db, FATSECRET_CONSUMER_KEY: 'ck', FATSECRET_CONSUMER_SECRET: 'cs', FATSECRET_SYNC_ENABLED: 'true' } };
}
const rows = db => listCanonical(db, 'owner', 'nutrition');

test('normalizzazione: stringhe -> numeri, assente = null, nessuna ora inventata', () => {
  const r = normalizeEntry(entry(1, '2026-11-04', 300, { fiber: '' }));
  assert.equal(r.id, 'entry:1'); assert.equal(r.observed_at, null); assert.equal(r.payload.local_date, '2026-11-04');
  assert.equal(r.payload.nutrients.calories, 300); assert.equal(r.payload.nutrients.fiber, null); assert.equal(r.payload.nutrients.sodium, null);
  assert.throws(() => normalizeEntry({}), /without_id/);
});
test('spento per default e fail-closed', async () => {
  const db = newDb();
  assert.deepEqual(await runFatSecretSync({ DB: db }), { ran: false, reason: 'disabled' });
  assert.equal((await runFatSecretSync({ DB: db, FATSECRET_SYNC_ENABLED: 'true' })).reason, 'fatsecret_unconfigured');
  assert.equal((await runFatSecretSync({ DB: db, FATSECRET_SYNC_ENABLED: 'true', FATSECRET_CONSUMER_KEY: 'a', FATSECRET_CONSUMER_SECRET: 'b' })).reason, 'raw_store_unconfigured');
});
test('sync: voci in D1 per giorno, nessun dato nel risultato; seconda run senza nuove richieste di dettaglio per i giorni invariati', async () => {
  const { db, f, raw, env } = await setup({ '2026-11-05': [entry(1, '2026-11-05', 300), entry(2, '2026-11-05', 200)], '2026-11-01': [entry(3, '2026-11-01', 500)], '2026-10-20': [entry(4, '2026-10-20', 700)] });
  const r1 = await runFatSecretSync(env, { now: NOW, fetchFn: f.fetchFn, rawStore: raw });
  assert.equal(r1.ok, true); assert.equal(r1.days_processed, 3); assert.equal(r1.entries, 4); assert.equal(r1.remaining, 0);
  assert.ok(!JSON.stringify(r1).includes('Cibo')); assert.equal((await rows(db)).length, 4);
  const before = f.calls.day;
  const r2 = await runFatSecretSync(env, { now: NOW, fetchFn: f.fetchFn, rawStore: raw });
  assert.equal(r2.ok, true); assert.equal(f.calls.day - before, 1, 'solo oggi/ieri vengono riletti'); // 2026-11-05
  assert.equal((await rows(db)).length, 4);
});
test('modifica e cancellazione in FatSecret si riflettono (scope giornaliero completo)', async () => {
  const days = { '2026-11-02': [entry(1, '2026-11-02', 300), entry(2, '2026-11-02', 200)] };
  const { db, f, raw, env } = await setup(days);
  await runFatSecretSync(env, { now: NOW, fetchFn: f.fetchFn, rawStore: raw });
  days['2026-11-02'] = [entry(1, '2026-11-02', 350)]; // voce 2 eliminata, voce 1 modificata
  await runFatSecretSync(env, { now: NOW, fetchFn: f.fetchFn, rawStore: raw });
  const rs = await rows(db); assert.equal(rs.length, 1); assert.equal(rs[0].payload.nutrients.calories, 350);
  days['2026-11-02'] = []; // giorno svuotato
  await runFatSecretSync(env, { now: NOW, fetchFn: f.fetchFn, rawStore: raw });
  assert.equal((await rows(db)).length, 0);
});
test('limite di giorni per esecuzione: i più recenti prima, il resto alla run successiva', async () => {
  const days = {}; for (let i = 1; i <= 11; i++) days[`2026-10-${String(i + 10).padStart(2, '0')}`] = [entry(i, `2026-10-${String(i + 10).padStart(2, '0')}`, 100 + i)];
  const { db, f, raw, env } = await setup(days);
  const r1 = await runFatSecretSync(env, { now: NOW, fetchFn: f.fetchFn, rawStore: raw }); assert.equal(r1.days_processed, 8); assert.equal(r1.remaining, 3);
  const r2 = await runFatSecretSync(env, { now: NOW, fetchFn: f.fetchFn, rawStore: raw }); assert.equal(r2.remaining, 0);
  assert.equal((await rows(db)).length, 11);
});
test('senza connessione: esito pulito', async () => {
  const db = newDb(); const r = await runFatSecretSync({ DB: db, FATSECRET_CONSUMER_KEY: 'ck', FATSECRET_CONSUMER_SECRET: 'cs', FATSECRET_SYNC_ENABLED: 'true' }, { now: NOW, fetchFn: async () => res('x', 500), rawStore: new MemoryRawStore() });
  assert.equal(r.ok, false); assert.equal(r.reason, 'fatsecret_not_connected');
});
