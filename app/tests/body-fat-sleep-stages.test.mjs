import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceIngest, parseDeviceBody } from '../src/http/device-ingest.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { listCanonical } from '../src/ingest/ledger.js';
import { weightView } from '../src/analytics/views.js';
import { sleepView } from '../src/analytics/daily-views.js';
import { summarizeStages, validSegments, matchStages } from '../src/analytics/sleep-stages.js';
import { bodyFatBlock } from '../public/views.js';
import { sleepSummary, sleepList } from '../public/views-daily.js';
import { newDb } from './helpers/d1-shim.mjs';

const NOWISO = '2026-11-06T12:00:00.000Z', NOW = new Date(NOWISO);
const handler = db => deviceIngest({ db, raw: new MemoryRawStore(), now: () => NOWISO, enabled: true });
const send = (h, body) => h(new Request('https://app.test/v1/ingest/device', { method: 'POST', body: JSON.stringify({ device_id: 'phone-1', ...body }) }));
const bad = b => { try { parseDeviceBody(JSON.stringify({ device_id: 'p', ...b }), NOW.getTime()); return null; } catch (e) { return e.code; } };

const START = Date.parse('2026-11-05T22:30:00Z'), END = START + 8 * 3600 * 1000;
// 480 min: sveglio 10 · leggero 200 · profondo 90 · REM 110 · leggero 60 · sveglio 10
const SEGS = [[1, 0, 10], [4, 10, 200], [5, 210, 90], [6, 300, 110], [4, 410, 60], [7, 470, 10]];
const NIGHT = { id: String(START), start_ms: START, end_ms: END, latest_end_ms: null, tz: 'Europe/Rome', rating: 0, quality: 0.8, snore: null, cycles: 5, len_adjust: 0, noise_level: null, length_raw: null };
const SESSION = { id: 'hc-s1', start_ms: START, end_ms: END, origin: 'com.urbandroid.sleep', segments: SEGS };

test('grasso corporeo: ingest in D1 (domain body), non altera il peso, vista con media e variazione', async () => {
  const db = newDb(), h = handler(db);
  const w = (id, time, kg) => ({ id, time, kg, origin: 'com.renpho.health' }), f = (id, time, pct) => ({ id, time, pct, origin: 'com.renpho.health' });
  const r = await send(h, { weights: [w('w1', '2026-11-05T06:30:00Z', 73.1)], body_fat: [f('f1', '2026-10-25T06:30:00Z', 16.4), f('f2', '2026-11-01T06:30:00Z', 16.0), f('f3', '2026-11-05T06:30:00Z', 15.6)] });
  assert.equal(r.body_fat.modified, 3);
  const rows = await listCanonical(db, 'owner', 'body'); assert.equal(rows.length, 4);
  assert.equal(rows.find(x => x.payload.metric === 'body_fat_pct' && x.payload.pct === 15.6).payload.local_date, '2026-11-05');
  await send(h, { body_fat: [f('f1', '2026-10-25T06:30:00Z', 16.4)] }); assert.equal((await listCanonical(db, 'owner', 'body')).length, 4); // ripetizione = nessun duplicato
  const v = await weightView(db, 'owner', { days: '90', now: NOW });
  assert.equal(v.count, 1); assert.equal(v.latest.kg, 73.1); // il grasso non entra nel peso
  assert.equal(v.body_fat.count, 3); assert.equal(v.body_fat.latest.pct, 15.6); assert.equal(v.body_fat.change_in_window, -0.8);
  assert.equal(v.body_fat.avg_7d, 15.8); assert.equal(v.body_fat.avg_prev_7d, 16.4); assert.equal(v.body_fat.delta_7d, -0.6); // (16,0+15,6)/2 contro la misura dei 7 giorni prima
  const html = bodyFatBlock(v); assert.ok(html.includes('15,6%')); assert.ok(html.includes('−0,8 punti'));
});
test('grasso corporeo: senza misure nessun blocco e nessun numero inventato; validazione', async () => {
  const v = await weightView(newDb(), 'owner', { days: '90', now: NOW });
  assert.equal(v.body_fat.count, 0); assert.equal(v.body_fat.latest, null); assert.equal(bodyFatBlock(v), '');
  const ok = { id: 'a', time: '2026-11-05T06:30:00Z', pct: 15 };
  assert.equal(bad({ body_fat: [ok] }), null);
  for (const pct of [1, 80, '15', null]) assert.equal(bad({ body_fat: [{ ...ok, pct }] }), 'invalid_body_fat', String(pct));
  assert.equal(bad({ body_fat: [ok, ok] }), 'invalid_body_fat'); assert.equal(bad({ body_fat: [{ ...ok, time: 'ieri' }] }), 'invalid_body_fat');
  assert.equal(bad({ body_fat: [{ ...ok, time: '2030-01-01T00:00:00Z' }] }), 'invalid_body_fat');
});
test('fasi del sonno: minuti per fase calcolati dal server, agganciate alla notte, non contano come notti', async () => {
  const db = newDb(), h = handler(db);
  const r = await send(h, { sleep: [NIGHT], sleep_stages: [SESSION] });
  assert.equal(r.sleep.modified, 1); assert.equal(r.sleep_stages.modified, 1);
  const rec = (await listCanonical(db, 'owner', 'sleep')).find(x => x.payload.metric === 'sleep_stages').payload;
  assert.deepEqual([rec.light_min, rec.deep_min, rec.rem_min, rec.awake_min], [260, 90, 110, 20]);
  const v = await sleepView(db, 'owner', { days: '30', now: NOW });
  assert.equal(v.count, 1); assert.equal(v.nights.length, 1); // la sessione con fasi non è una notte
  const st = v.nights[0].stages; assert.equal(st.deep_min, 90); assert.equal(st.rem_min, 110); assert.equal(st.segments.length, 6);
  assert.equal(v.stages_7.n_staged, 1); assert.equal(v.stages_7.light_min, 260);
  const html = sleepList(v); assert.ok(html.includes('stagebar')); assert.ok(sleepSummary(v).includes('Profondo'));
});
test('fasi del sonno: sessione senza fasi reali = null (mai zero); notte senza sessione = nessuna fase', async () => {
  assert.deepEqual(summarizeStages([[1, 0, 480]]), { staged: false, light_min: null, deep_min: null, rem_min: null, awake_min: null, asleep_stage_min: null });
  assert.equal(summarizeStages([[2, 0, 480]]).staged, false); // sonno generico senza leggero/profondo/REM
  const db = newDb(), h = handler(db);
  await send(h, { sleep: [NIGHT], sleep_stages: [{ ...SESSION, segments: [[1, 0, 480]] }] });
  const v = await sleepView(db, 'owner', { days: '30', now: NOW });
  assert.equal(v.nights[0].stages, null); assert.equal(v.stages_7, null);
  assert.ok(sleepSummary(v).includes('Fasi del sonno non disponibili')); assert.ok(!sleepList(v).includes('stagebar'));
  const solo = await sleepView((await (async () => { const d = newDb(); await send(handler(d), { sleep: [NIGHT] }); return d; })()), 'owner', { days: '30', now: NOW });
  assert.equal(solo.nights[0].stages, null);
});
test('fasi del sonno: aggancio per sovrapposizione e validazione dei segmenti', async () => {
  const s = { start: START, end: END };
  assert.equal(matchStages({ start_at: new Date(START + 600000).toISOString(), end_at: new Date(END - 600000).toISOString() }, [s]), s);
  assert.equal(matchStages({ start_at: new Date(END + 3600000).toISOString(), end_at: new Date(END + 7200000).toISOString() }, [s]), null); // altra notte
  assert.equal(validSegments(SEGS), true);
  for (const x of [[[9, 0, 5]], [[4, -1, 5]], [[4, 0, 0]], [[4, 0, 1.5]], [[4, 0]], 'no', Array.from({ length: 1501 }, () => [4, 0, 1])]) assert.equal(validSegments(x), false, JSON.stringify(x).slice(0, 30));
  assert.equal(bad({ sleep_stages: [SESSION] }), null);
  assert.equal(bad({ sleep_stages: [{ ...SESSION, segments: [[4, 470, 60]] }] }), 'invalid_stages'); // oltre la fine della sessione
  assert.equal(bad({ sleep_stages: [{ ...SESSION, end_ms: START - 1 }] }), 'invalid_stages'); assert.equal(bad({ sleep_stages: [SESSION, SESSION] }), 'invalid_stages');
  assert.equal(bad({ sleep_stages: [{ ...SESSION, start_ms: 5 }] }), 'invalid_stages'); assert.equal(bad({ sleep_stages: [{ ...SESSION, origin: 'a b' }] }), 'invalid_stages');
  assert.equal(bad({ body_fat: [], sleep_stages: [] }), 'invalid_items'); // corpo senza dati
});
