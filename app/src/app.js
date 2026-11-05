// Router HTTP (API stabile /v1, DEC-API-001 CANDIDATE) — Web standard Request/Response.
// Superficie attuale: SOLA LETTURA + health. L'ingestione avviene solo da adapter server-side fidati:
// nessun endpoint accetta dal client il flag scope_complete (non verificabile).
import { AppError } from './core/errors.js';
import { DOMAINS } from './ingest/envelope.js';
import { getGeneration, getOperation, listCanonical } from './ingest/ledger.js';
import { summarize } from './analytics/summary.js';

const json = (status, body, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
});

export function createApp({ db, auth, assets }) {
  return async function fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/v1/health' && request.method === 'GET') return json(200, { ok: true });
      if (url.pathname.startsWith('/v1/')) {
        const { subject } = await auth.authenticate(request); // fail-closed
        if (request.method !== 'GET') throw new AppError(405, 'method_not_allowed');
        const m = url.pathname.match(/^\/v1\/(canonical|operations)\/([A-Za-z0-9_.:-]{1,120})$/);
        if (m?.[1] === 'canonical') {
          if (!DOMAINS.includes(m[2])) throw new AppError(404, 'unsupported_domain');
          return json(200, { generation: await getGeneration(db), records: await listCanonical(db, subject, m[2]) });
        }
        if (m?.[1] === 'operations') {
          const op = await getOperation(db, m[2], subject);
          if (!op) throw new AppError(404, 'not_found');
          return json(200, op);
        }
        if (url.pathname === '/v1/derived/summary') return json(200, await summarize(db, subject));
        throw new AppError(404, 'not_found');
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new AppError(405, 'method_not_allowed');
      return assets ? assets(request) : json(404, { error: 'not_found' });
    } catch (e) {
      if (e instanceof AppError) return json(e.status, { error: e.code, retryable: e.status === 503, ...e.extra });
      return json(500, { error: 'internal_error', retryable: false }); // nessun dettaglio/dato in errore o log
    }
  };
}
