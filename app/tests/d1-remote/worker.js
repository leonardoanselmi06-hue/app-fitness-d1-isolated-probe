// Worker TEMPORANEO di prova: esegue gli scenari del ledger contro il binding D1 reale (database di test).
// Fail-closed: senza TEST_KEY risponde 503. Un solo endpoint (POST /run), nessun SQL libero, nessun dato personale.
// Viene creato e distrutto dal workflow manuale d1-ledger-test.yml.
import { runScenarios } from './scenarios.js';
import { runSyncE2E } from './sync-e2e.js';

const send = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const sameText = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export default {
  async fetch(request, env) {
    if (!env.DB || !env.TEST_KEY) return send(503, { ok: false, error: 'misconfigured' });
    if (!sameText(request.headers.get('authorization') || '', `Bearer ${env.TEST_KEY}`)) return send(403, { ok: false, error: 'forbidden' });
    const url = new URL(request.url);
    if (request.method !== 'POST' || !['/run', '/run-sync'].includes(url.pathname)) return send(404, { ok: false, error: 'not_found' });
    let body; try { body = await request.json(); } catch { return send(400, { ok: false, error: 'invalid_json' }); }
    const runId = String(body?.run_id ?? '');
    if (!/^\d{1,20}$/.test(runId)) return send(422, { ok: false, error: 'bad_run_id' });
    try { return send(200, await (url.pathname === '/run-sync' ? runSyncE2E(env, runId) : runScenarios(env.DB, runId))); }
    catch (e) { return send(500, { ok: false, error: 'runner_error', detail: String(e?.message ?? e).slice(0, 200) }); }
  },
};
