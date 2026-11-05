import test from 'node:test';
import assert from 'node:assert/strict';
import { runSyncE2E } from './d1-remote/sync-e2e.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { newDb } from './helpers/d1-shim.mjs';

// Verifica la logica del collaudo sull'emulatore con RawStore in memoria: se fallisse su D1+Drive reali il difetto sarebbe nel loro comportamento.
test('collaudo sync end-to-end: la logica passa sull\'emulatore', async () => {
  const out = await runSyncE2E({ DB: newDb() }, '777', { rawStore: new MemoryRawStore() });
  assert.deepEqual(out.results.filter(r => r.status !== 'PASS'), []);
  assert.equal(out.ok, true); assert.equal(out.results.length, 6);
});
