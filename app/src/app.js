// Router HTTP (API stabile /v1, DEC-API-001 CANDIDATE) — Web standard Request/Response.
// Superficie: lettura + health; scrittura SOLO del proprietario sotto /v1/plan/* (fasi, scheda, note; DEC-PLAN-001 CANDIDATE) /v1/checkin (recupero giornaliero) e /v1/weights/exclude|restore (esclusione pesate). L'ingestione avviene solo da adapter server-side fidati:
// nessun endpoint accetta dal client il flag scope_complete (non verificabile).
import { AppError } from './core/errors.js';
import { DOMAINS } from './ingest/envelope.js';
import { getGeneration, getOperation, listCanonical } from './ingest/ledger.js';
import { summarize } from './analytics/summary.js';
import { trainingView, weightView } from './analytics/views.js';
import { nutritionView, sleepView, stepsView } from './analytics/daily-views.js';
import { coachReview } from './coach/review.js';
import { planRoute } from './plan/routes.js';
import { buildPhaseReport } from './plan/report.js';
import { checkinRoute } from './checkin/store.js';
import { readOwnerJson } from './core/body.js';
import { weightsRoute } from './weights/exclusions.js';
import { comparePeriods } from './compare/periods.js';
import { aiRoute } from './ai/advice.js';
import { estimatesRoute } from './nutrition/estimates.js';

const json = (status, body, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
});

export function createApp({ db, auth, assets, raw = null, ai = null, jobs = {}, now = () => new Date() }) {
  return async function fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/v1/health' && request.method === 'GET') return json(200, { ok: true });
      if (url.pathname.startsWith('/v1/')) {
        const { subject, principal = 'owner' } = await auth.authenticate(request); // fail-closed
        if (principal === 'device') { // il collector del telefono può SOLO inviare dati: nessuna lettura, nessun altro endpoint
          if (url.pathname === '/v1/ingest/device' && request.method === 'POST' && jobs.device) return json(200, await jobs.device(request));
          throw new AppError(403, 'forbidden');
        }
        if (url.pathname.startsWith('/v1/polar/')) { if (!jobs.polar) throw new AppError(404, 'not_found'); return await jobs.polar(request); }
        if (url.pathname.startsWith('/v1/fatsecret/')) { if (!jobs.fatsecret) throw new AppError(404, 'not_found'); return await jobs.fatsecret(request); }
        if (url.pathname === '/v1/sync/lyfta' && request.method === 'POST') {
          if (!jobs.lyfta) throw new AppError(404, 'not_found');
          return json(200, await jobs.lyfta()); // sync server-side: il client non invia dati né scope_complete
        }
        if (url.pathname === '/v1/sync/polar' && request.method === 'POST') {
          if (!jobs.polarSync) throw new AppError(404, 'not_found');
          return json(200, await jobs.polarSync());
        }
        if (url.pathname === '/v1/sync/fatsecret' && request.method === 'POST') {
          if (!jobs.fatsecretSync) throw new AppError(404, 'not_found');
          return json(200, await jobs.fatsecretSync());
        }
        if (url.pathname === '/v1/sync/estimates' && request.method === 'POST') {
          if (!jobs.estimatesSync) throw new AppError(404, 'not_found');
          return json(200, await jobs.estimatesSync());
        }
        if (url.pathname.startsWith('/v1/plan/') || url.pathname === '/v1/plan') return json(200, await planRoute(request, url, { db, subject, now, buildReport: jobs.phaseReport ?? buildPhaseReport }));
        if (url.pathname === '/v1/checkin') return json(200, await checkinRoute(request, url, { db, subject, now, readBody: readOwnerJson }));
        if (url.pathname.startsWith('/v1/ai/')) return json(200, await aiRoute(request, url, { db, subject, now, ai, readBody: readOwnerJson }));
        if (url.pathname === '/v1/nutrition/estimates') return json(200, await estimatesRoute(request, url, { db, raw, subject, now, readBody: readOwnerJson }));
        if (url.pathname.startsWith('/v1/weights/')) return json(200, await weightsRoute(request, url, { db, raw, subject, now, readBody: readOwnerJson }));
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
        if (url.pathname === '/v1/derived/training') return json(200, await trainingView(db, subject, { limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') }));
        if (url.pathname === '/v1/derived/weight') return json(200, await weightView(db, subject, { days: url.searchParams.get('days'), now: now() }));
        const daily = { '/v1/derived/nutrition': nutritionView, '/v1/derived/sleep': sleepView, '/v1/derived/steps': stepsView }[url.pathname];
        if (daily) return json(200, await daily(db, subject, { days: url.searchParams.get('days'), now: now() }));
        if (url.pathname === '/v1/compare') return json(200, await comparePeriods(db, subject, { days: Number.parseInt(url.searchParams.get('days'), 10), now: now() }));
        if (url.pathname === '/v1/coach/review') return json(200, await coachReview(db, subject, { now: now() }));
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
