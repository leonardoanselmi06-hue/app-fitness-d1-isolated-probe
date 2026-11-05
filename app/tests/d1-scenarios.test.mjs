import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenarios } from './d1-remote/scenarios.js';
import { newDb } from './helpers/d1-shim.mjs';

// Verifica la logica dell'harness stesso sull'emulatore locale: se fallisse su D1 reale, il difetto sarebbe nel comportamento di D1, non negli scenari.
test('scenari D1 remoti: la logica degli scenari passa sull\'emulatore locale', async () => {
  const out = await runScenarios(newDb(), '123');
  assert.deepEqual(out.results.filter(r => r.status !== 'PASS'), []);
  assert.equal(out.ok, true);
  assert.ok(out.results.length >= 9);
});
