import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { ingest } from '../src/ingest/ledger.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { weekStart, bandsOf } from '../src/analytics/cardio.js';
import { cardioSummary, cardioWeeks, cardioSessions } from '../public/cardio.js';
import { newDb } from './helpers/d1-shim.mjs';

const NOW = new Date('2026-11-14T12:00:00Z'); // sabato
const zones = ms => [{ type: 'ZONE_TYPE_HEART_RATE', zones: [100, 120, 140, 160, 180].map((lo, i) => ({ lower: lo, upper: lo + 20, in_zone: ms[i] })) }];
const sess = (id, date, ms, extra = {}) => ({ id: `session:${id}`, domain: 'cardio', observed_at: `${date}T07:00:00.000Z`, payload: { local_date: date, start_at: `${date}T07:00:00.000Z`, sport: 'RUNNING', duration_ms: 1_800_000, hr_avg: 140, hr_max: 165, hr_detail: { status: ms ? 'ok' : 'pending', zones: ms ? zones(ms) : [] }, ...extra } });
const put = (db, records) => ingest({ db, raw: new MemoryRawStore(), now: () => NOW.toISOString() }, { subject: 'owner', source_system: 'polar', source_account: 'a', scope_id: 'full', request_id: crypto.randomUUID(), captured_at: NOW.toISOString(), artifact: JSON.stringify(records), records, scope_complete: false });
const get = async (db, q = '') => (await createApp({ db, auth: { authenticate: async () => ({ subject: 'owner', principal: 'owner' }) }, jobs: {}, now: () => NOW })(new Request(`https://app.test/v1/derived/cardio${q}`))).json();
const MIN = 60000;

test('settimana = lunedì; fasce Polar ordinate; senza dettaglio = null', () => {
  assert.equal(weekStart('2026-11-14'), '2026-11-09'); assert.equal(weekStart('2026-11-09'), '2026-11-09'); assert.equal(weekStart('2026-11-15'), '2026-11-09');
  assert.equal(bandsOf({ hr_detail: { zones: [] } }), null); assert.equal(bandsOf({ hr_detail: { zones: zones([1, 2, 3, 4, 5]) } })[1].lower, 120);
});

test('tempo in zona 2 per settimana: somma per fascia, settimana in corso parziale, sedute senza dettaglio dichiarate (mai zero)', async () => {
  const db = newDb(), recs = [];
  for (const [i, date] of ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'].entries()) recs.push(sess(`a${i}`, date, [1 * MIN, 8 * MIN, 20 * MIN, 2 * MIN, 0]));
  recs.push(sess('b', '2026-11-03', [0, 4 * MIN, 0, 0, 0]), sess('c', '2026-11-04', null)); // 2ª seduta nella settimana del 2 nov + una senza dettaglio
  await put(db, recs);
  const d = await get(db, '?days=4');
  const w = Object.fromEntries(d.weeks_list.map(x => [x.week_start, x]));
  assert.equal(w['2026-11-02'].z2_min, 12); assert.equal(w['2026-11-02'].sessions, 3); assert.equal(w['2026-11-02'].sessions_without_detail, 1);
  assert.deepEqual(w['2026-11-02'].zone_min, [1, 12, 20, 2, 0]);
  assert.equal(w['2026-11-09'].partial, true); assert.equal(w['2026-11-09'].z2_min, 8);
  assert.equal(w['2026-10-19'].z2_min, 8); assert.equal(d.z2_avg_4w, null); // solo 3 settimane complete nella finestra di 4 (una è la corrente)
  assert.deepEqual(d.bands.map(b => [b.lower, b.upper]), [[100, 120], [120, 140], [140, 160], [160, 180], [180, 200]]);
  assert.match(d.pace_note, /non disponibile/);
});

test('media zona 2 su 4 settimane complete; settimana senza sedute = 0 min registrati; senza dati = elenco vuoto', async () => {
  const db = newDb();
  assert.match(cardioWeeks(await get(db)), /Nessuna seduta cardio/);
  const recs = [['a', '2026-10-13'], ['b', '2026-10-27'], ['c', '2026-11-03']].map(([i, date]) => sess(i, date, [0, 10 * MIN, 0, 0, 0]));
  await put(db, recs);
  const d = await get(db, '?days=8');
  assert.equal(d.z2_avg_4w, 7.5); // ultime 4 complete: 12/10 (10), 19/10 (nessuna seduta = 0), 26/10 (10), 2/11 (10) → 7,5
});

test('UI: dichiara fasce fisse e ritmo non disponibile; escape', async () => {
  const db = newDb(); await put(db, [sess('x', '2026-11-10', [0, 5 * MIN, 0, 0, 0], { sport: '<b>RUN</b>' })]);
  const d = await get(db);
  assert.match(cardioSummary(d), /Fasce fisse Polar/); assert.match(cardioSummary(d), /non disponibile/);
  assert.doesNotMatch(cardioSessions(d), /<b>RUN/); assert.match(cardioSessions(d), /Z2 120–140: 5/);
  assert.match(cardioWeeks(d), /in corso/);
});
