import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { ingest } from '../src/ingest/ledger.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { newDb } from './helpers/d1-shim.mjs';
import { weightRecent } from '../public/views.js';
import { weightRequest, weightErrorText } from '../public/weights-ui.js';

const NOW = new Date('2026-11-06T12:00:00Z');
const raw = new MemoryRawStore();
const mk = (db, principal = 'owner', r = raw) => createApp({ db, raw: r, auth: { authenticate: async () => ({ subject: 'owner', principal }) }, jobs: {}, now: () => NOW });
const call = async (app, path, body, headers = { 'content-type': 'application/json' }) => { const r = await app(new Request(`https://app.test${path}`, { method: body ? 'POST' : 'GET', headers: body ? headers : {}, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, json: await r.json() }; };
let rid = 0;
async function seed(db, more = []) {
  const recs = [['2026-10-30T07:00:00.000Z', 71.9], ['2026-11-03T07:00:00.000Z', 72.1], ['2026-11-05T07:00:00.000Z', 91.5], ...more].map(([t, kg], i) => ({ id: `weight:${i}`, domain: 'body', observed_at: t, payload: { metric: 'body_weight_kg', kg, time: t, local_date: t.slice(0, 10), origin: 'x' } }));
  await ingest({ db, raw, now: () => NOW.toISOString() }, { subject: 'owner', source_system: 'health_connect', source_account: 'p1', scope_id: 'weight', request_id: `70000000-0000-4000-8000-${String(++rid).padStart(12, '0')}`, captured_at: NOW.toISOString(), artifact: JSON.stringify(recs), records: recs, scope_complete: false });
}
const T = '2026-11-05T07:00:00.000Z';

test('escludi: la pesata sparisce dalle viste, resta nel ledger (revisioni), registro con valore e motivo', async () => {
  const db = newDb(), app = mk(db); await seed(db);
  assert.equal((await call(app, '/v1/derived/weight?days=30')).json.count, 3);
  const r = await call(app, '/v1/weights/exclude', { time: '2026-11-05T09:00:00+02:00', reason: 'bilancia usata da un\'altra persona' }); assert.equal(r.status, 200); assert.equal(r.json.kg, 91.5);
  const v = (await call(app, '/v1/derived/weight?days=30')).json; assert.equal(v.count, 2); assert.equal(v.latest.kg, 72.1); assert.equal(v.excluded_count, 1); assert.deepEqual(v.excluded.map(x => [x.time, x.kg, x.reason]), [[T, 91.5, 'bilancia usata da un\'altra persona']]);
  const revs = (await db.prepare("SELECT revision, tombstone FROM record_revisions WHERE record_id = 'weight:2' ORDER BY revision").all()).results; assert.deepEqual(revs.map(x => x.tombstone), [0, 1]); // la storia resta
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM weight_exclusion_log WHERE action = 'exclude'").first()).n, 1);
  assert.equal((await call(app, '/v1/weights/exclusions')).json.excluded[0].kg, 91.5);
});
test('errori: già esclusa, non trovata, istante non valido, campi sconosciuti, ripristino di ciò che non è escluso', async () => {
  const db = newDb(), app = mk(db); await seed(db);
  assert.equal((await call(app, '/v1/weights/exclude', { time: '2026-01-01T00:00:00.000Z' })).json.error, 'weight_not_found');
  assert.equal((await call(app, '/v1/weights/exclude', { time: 'ieri' })).json.error, 'invalid_time');
  assert.equal((await call(app, '/v1/weights/exclude', { time: T, kg: 1 })).json.error, 'invalid_body');
  assert.equal((await call(app, '/v1/weights/exclude', { time: T, reason: 'x'.repeat(201) })).json.error, 'invalid_reason');
  assert.equal((await call(app, '/v1/weights/restore', { time: T })).json.error, 'not_excluded');
  await call(app, '/v1/weights/exclude', { time: T }); assert.equal((await call(app, '/v1/weights/exclude', { time: T })).json.error, 'already_excluded');
});
test('ripristina: esce dalla lista, il telefono la reinvia e torna; il registro conserva entrambe le azioni', async () => {
  const db = newDb(), app = mk(db); await seed(db);
  await call(app, '/v1/weights/exclude', { time: T });
  const r = await call(app, '/v1/weights/restore', { time: T }); assert.equal(r.status, 200); assert.match(r.json.note, /prossima sincronizzazione/);
  assert.equal((await call(app, '/v1/derived/weight?days=30')).json.excluded_count, 0);
  await seed(db, [['2026-11-06T07:00:00.000Z', 72.0]]); // il collector reinvia la finestra (con una pesata nuova)
  const v = (await call(app, '/v1/derived/weight?days=30')).json; assert.equal(v.count, 4); assert.ok(v.recent.some(p => p.kg === 91.5));
  assert.deepEqual((await db.prepare('SELECT action FROM weight_exclusion_log ORDER BY id').all()).results.map(x => x.action), ['exclude', 'restore']);
});
test('sicurezza: solo proprietario, solo JSON, Origin coerente; il telefono non può escludere', async () => {
  const db = newDb(), app = mk(db); await seed(db);
  assert.equal((await call(mk(db, 'device'), '/v1/weights/exclude', { time: T })).status, 403);
  assert.equal((await call(app, '/v1/weights/exclude', { time: T }, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await call(app, '/v1/weights/exclude', { time: T }, { 'content-type': 'application/json', origin: 'https://evil.test' })).status, 403);
  assert.equal((await call(app, '/v1/derived/weight?days=30')).json.excluded_count, 0);
  assert.equal((await call(app, '/v1/weights/altro', { time: T })).status, 404);
  const put = await app(new Request('https://app.test/v1/weights/exclude', { method: 'PUT' })); assert.equal(put.status, 405);
});
test('senza archivio RAW: la lista viene comunque aggiornata (503 sul tombstone, applicato alla prossima sincronizzazione)', async () => {
  const db = newDb(), app = mk(db, 'owner', null); await seed(db);
  assert.equal((await call(app, '/v1/weights/exclude', { time: T })).status, 503);
  assert.equal((await call(app, '/v1/derived/weight?days=30')).json.excluded_count, 1);
});
test('PWA: bottone Escludi per pesata, elenco escluse con Ripristina, escape, richieste', () => {
  const d = { recent: [{ local_date: '2026-11-05', kg: 91.5, time: T }, { local_date: '2026-11-03', kg: 72.1 }], excluded_count: 1, excluded: [{ time: '2026-10-17T19:11:56.000Z', kg: 75.3, reason: 'errore <b>' }, { time: '2026-10-18T07:00:00.000Z', kg: null, reason: null }] };
  const h = weightRecent(d); assert.match(h, /data-wact="exclude" data-time="2026-11-05T07:00:00.000Z"/); assert.equal((h.match(/data-wact="exclude"/g) ?? []).length, 1);
  assert.match(h, /data-wact="restore"/); assert.match(h, /errore &lt;b&gt;/); assert.match(h, /75,30 kg/);
  assert.deepEqual(weightRequest('exclude', T), { path: '/v1/weights/exclude', body: { time: T } }); assert.equal(weightRequest('restore', T).path, '/v1/weights/restore');
  assert.match(weightErrorText('already_excluded'), /già esclusa/); assert.match(weightErrorText('x'), /Riprova/);
  assert.equal(weightRecent({ recent: [], excluded_count: 0 }), '');
});
