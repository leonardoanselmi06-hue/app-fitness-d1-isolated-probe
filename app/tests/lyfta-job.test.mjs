import test from 'node:test';
import assert from 'node:assert/strict';
import { runLyftaSync } from '../src/jobs/lyfta-job.js';
import { createApp } from '../src/app.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { listCanonical } from '../src/ingest/ledger.js';
import { newDb } from './helpers/d1-shim.mjs';
import { makePager } from './fixtures/lyfta-synthetic.mjs';

// fetchFn finto: serve le pagine sintetiche con il formato reale dell'API Lyfta.
const fakeFetch = pager => async url => new Response(JSON.stringify(await pager(Number(new URL(url).searchParams.get('page')))), { status: 200 });
const on = (db, over = {}) => ({ DB: db, LYFTA_API_KEY: 'k', LYFTA_SYNC_ENABLED: 'true', ...over });
const NOW = () => '2026-11-05T10:00:00.000Z';

test('job spento per default e senza configurazione: non fa nulla e non tocca il database', async () => {
  const db = newDb();
  assert.deepEqual(await runLyftaSync({ DB: db, LYFTA_API_KEY: 'k' }), { ran: false, reason: 'disabled' });
  assert.equal((await runLyftaSync({ ...on(db), LYFTA_API_KEY: '' })).reason, 'lyfta_unconfigured');
  assert.equal((await runLyftaSync(on(db))).reason, 'raw_store_unconfigured'); // nessuna credenziale Drive: fail-closed
  assert.equal((await listCanonical(db, 'owner', 'training')).length, 0);
});

test('job acceso: sync completo su dati sintetici, replay senza nuove righe, nessun dato nel risultato', async () => {
  const db = newDb(); const raw = new MemoryRawStore(); const pager = makePager(30, 100);
  const r1 = await runLyftaSync(on(db), { now: NOW, fetchFn: fakeFetch(pager), rawStore: raw });
  assert.equal(r1.ran, true); assert.equal(r1.ok, true); assert.equal(r1.complete, true);
  assert.equal((await listCanonical(db, 'owner', 'training')).length, 30);
  assert.ok(!JSON.stringify(r1).includes('Sintetico'));
  const r2 = await runLyftaSync(on(db), { now: NOW, fetchFn: fakeFetch(pager), rawStore: raw });
  assert.equal(r2.ok, true); assert.equal((await listCanonical(db, 'owner', 'training')).length, 30);
});

test('errori upstream: esito ok:false con codice, nessuna cancellazione', async () => {
  const db = newDb(); const raw = new MemoryRawStore(); const pager = makePager(5, 100);
  await runLyftaSync(on(db), { now: NOW, fetchFn: fakeFetch(pager), rawStore: raw });
  const bad = async () => new Response('{}', { status: 401 });
  const r = await runLyftaSync(on(db), { now: NOW, fetchFn: bad, rawStore: raw });
  assert.equal(r.ok, false); assert.equal(r.reason, 'fetch_error');
  assert.equal((await listCanonical(db, 'owner', 'training')).length, 5);
});

test('POST /v1/sync/lyfta: richiede auth, usa il job; senza job 404; GET non esiste (404)', async () => {
  const auth = { authenticate: async req => { if (!req.headers.get('x-t')) { const { AppError } = await import('../src/core/errors.js'); throw new AppError(401, 'unauthorized'); } return { subject: 'owner' }; } };
  const app = createApp({ db: newDb(), auth, jobs: { lyfta: async () => ({ ran: false, reason: 'disabled' }) } });
  const post = h => app(new Request('https://a.test/v1/sync/lyfta', { method: 'POST', headers: h }));
  assert.equal((await post({})).status, 401);
  const ok = await post({ 'x-t': '1' }); assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { ran: false, reason: 'disabled' });
  assert.equal((await createApp({ db: newDb(), auth })(new Request('https://a.test/v1/sync/lyfta', { method: 'POST', headers: { 'x-t': '1' } }))).status, 404);
  assert.equal((await app(new Request('https://a.test/v1/sync/lyfta', { headers: { 'x-t': '1' } }))).status, 404);
});
