// Rotte FatSecret sotto /v1/fatsecret (dietro Cloudflare Access): connect, callback, status, probe. Fail-closed.
import { AppError } from '../core/errors.js';
import { FatSecretTokens, fatsecretGet } from '../adapters/fatsecret/oauth1.js';
import { probeFatSecret, selfTest } from '../adapters/fatsecret/probe.js';

const COOKIE = 'af_fs_req';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const cookie = (req, n) => (req.headers.get('cookie') || '').split(/;\s*/).map(c => c.split('=')).find(([k]) => k === n)?.[1];

export function fatsecretRoutes({ db, env, fetchFn, now }) {
  const tokens = () => new FatSecretTokens({ db, consumerKey: env.FATSECRET_CONSUMER_KEY, consumerSecret: env.FATSECRET_CONSUMER_SECRET, fetchFn, now });
  const callback = req => env.FATSECRET_REDIRECT_URI || `${new URL(req.url).origin}/v1/fatsecret/callback`;
  return async function handle(req) {
    const u = new URL(req.url);
    if (req.method !== 'GET') throw new AppError(405, 'method_not_allowed');
    if (u.pathname === '/v1/fatsecret/status') return json(200, await tokens().status());
    if (u.pathname === '/v1/fatsecret/connect') {
      const authorize = await tokens().begin(callback(req));
      const t = new URL(authorize).searchParams.get('oauth_token');
      return new Response(null, { status: 302, headers: { location: authorize, 'set-cookie': `${COOKIE}=${encodeURIComponent(t)}; HttpOnly; Secure; SameSite=Lax; Path=/v1/fatsecret; Max-Age=900`, 'cache-control': 'no-store' } });
    }
    if (u.pathname === '/v1/fatsecret/callback') {
      const t = u.searchParams.get('oauth_token'), v = u.searchParams.get('oauth_verifier');
      if (!t || !v || decodeURIComponent(cookie(req, COOKIE) ?? '') !== t) throw new AppError(400, 'fatsecret_state_mismatch'); // anti-CSRF
      await tokens().finish(t, v);
      return new Response(null, { status: 302, headers: { location: '/?fatsecret=connesso', 'set-cookie': `${COOKIE}=; Max-Age=0; Path=/v1/fatsecret`, 'cache-control': 'no-store' } });
    }
    if (u.pathname === '/v1/fatsecret/probe') { const t = tokens(); return json(200, await probeFatSecret(fatsecretGet({ tokens: t, fetchFn }), new Date(now ? now() : Date.now()))); }
    if (u.pathname === '/v1/fatsecret/selftest') return json(200, await selfTest(tokens(), fetchFn ?? ((...a) => fetch(...a))));
    throw new AppError(404, 'not_found');
  };
}
