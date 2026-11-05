// Entry point Cloudflare Worker. Configurazione tramite binding/secret (mai nel repo):
//   DB (D1), ACCESS_TEAM_DOMAIN, ACCESS_AUD, OWNER_EMAIL; per il sync Lyfta: LYFTA_API_KEY, LYFTA_SYNC_ENABLED, GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN. Senza questi, le API /v1 falliscono chiuse (503).
import { createApp } from './app.js';
import { createAuth } from './http/auth.js';
import { runLyftaSync } from './jobs/lyfta-job.js';
import { polarRoutes } from './http/polar-routes.js';

export default {
  async fetch(request, env) {
    const auth = createAuth({ teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, ownerEmail: env.OWNER_EMAIL });
    const assets = env.ASSETS ? r => env.ASSETS.fetch(r) : undefined;
    return createApp({ db: env.DB, auth, assets, jobs: { lyfta: () => runLyftaSync(env), polar: polarRoutes({ db: env.DB, env }) } })(request);
  },
  // Cron: sync automatico. Spento finché LYFTA_SYNC_ENABLED non è "true" (vedi lyfta-job.js).
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runLyftaSync(env));
  },
};
