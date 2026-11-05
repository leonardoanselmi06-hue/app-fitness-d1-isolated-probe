import test from 'node:test';
import assert from 'node:assert/strict';
import { lyftaFetchPage } from '../src/adapters/lyfta/client.js';

const res = (status, body = {}) => new Response(JSON.stringify(body), { status });
const mk = (responses, calls = []) => lyftaFetchPage({ apiKey: 'k', sleep: async () => {}, fetchFn: async (u, i) => { calls.push({ u, i }); return responses.shift(); } });

test('client Lyfta: Bearer, limit e page nell\'URL', async () => {
  const calls = []; const f = mk([res(200, { status: true, workouts: [] })], calls);
  await f(3);
  assert.equal(calls[0].u, 'https://my.lyfta.app/api/v1/workouts?limit=100&page=3');
  assert.equal(calls[0].i.headers.authorization, 'Bearer k');
});
test('client Lyfta: 429 e 5xx ritentati, 401 fallisce subito, status:false è errore', async () => {
  assert.deepEqual(await mk([res(429), res(503), res(200, { status: true, workouts: [] })])(1), { status: true, workouts: [] });
  await assert.rejects(mk([res(401)])(1), e => e.code === 'lyfta_auth_failed');
  await assert.rejects(mk([res(200, { status: false, message: 'x' })])(1), e => e.code === 'lyfta_error');
  await assert.rejects(mk([res(500), res(500), res(500), res(500)])(1), e => e.code === 'lyfta_error');
});
test('client Lyfta: senza chiave fallisce chiuso', () => {
  assert.throws(() => lyftaFetchPage({ apiKey: '' }), e => e.status === 503);
});
