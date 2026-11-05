// Rotte Polar sotto /v1/polar (dietro Cloudflare Access): connect, callback, status, probe. Tutte fail-closed.
import { AppError } from '../core/errors.js';
import { authorizeUrl, PolarTokens } from '../adapters/polar/oauth.js';
import { polarGet } from '../adapters/polar/client.js';
import { probePolar } from '../adapters/polar/probe.js';

const COOKIE = 'af_polar_state';
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } });
const cookie = (req, n) => (req.headers.get('cookie') || '').split(/;\s*/).map(c => c.split('=')).find(([k]) => k === n)?.[1];

export function polarRoutes({ db, env, fetchFn, now }) {
  const tokens = () => new PolarTokens({ db, clientId: env.POLAR_CLIENT_ID, clientSecret: env.POLAR_CLIENT_SECRET, fetchFn, now });
  const redirectUri = req => env.POLAR_REDIRECT_URI || `${new URL(req.url).origin}/v1/polar/callback`;
  return async function handle(req) {
    const path = new URL(req.url).pathname;
    if (req.method !== 'GET') throw new AppError(405, 'method_not_allowed');
    if (path === '/v1/polar/status') return json(200, await tokens().status());
    if (path === '/v1/polar/connect') {
      if (!env.POLAR_CLIENT_ID) throw new AppError(503, 'polar_unconfigured');
      const state = crypto.randomUUID();
      return new Response(null, { status: 302, headers: { location: authorizeUrl({ clientId: env.POLAR_CLIENT_ID, redirectUri: redirectUri(req), state }), 'set-cookie': `${COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/v1/polar; Max-Age=600`, 'cache-control': 'no-store' } });
    }
    if (path === '/v1/polar/callback') {
      const u = new URL(req.url), state = u.searchParams.get('state'), code = u.searchParams.get('code');
      if (!state || state !== cookie(req, COOKIE)) throw new AppError(400, 'polar_state_mismatch'); // anti-CSRF
      if (!code) throw new AppError(400, 'polar_no_code');
      await tokens().exchangeCode(code, redirectUri(req));
      return new Response(null, { status: 302, headers: { location: '/?polar=connesso', 'set-cookie': `${COOKIE}=; Max-Age=0; Path=/v1/polar`, 'cache-control': 'no-store' } });
    }
    if (path === '/v1/polar/probe') return json(200, await probePolar(polarGet({ tokens: tokens(), fetchFn }), new Date(now ? now() : Date.now())));
    throw new AppError(404, 'not_found');
  };
}
