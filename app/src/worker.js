// Entry point Cloudflare Worker. Configurazione tramite binding/secret (mai nel repo):
//   DB (D1), ACCESS_TEAM_DOMAIN, ACCESS_AUD, OWNER_EMAIL; per il sync Lyfta: LYFTA_API_KEY, LYFTA_SYNC_ENABLED, GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN. Senza questi, le API /v1 falliscono chiuse (503).
import { createApp } from './app.js';
import { createAuth } from './http/auth.js';
import { runLyftaSync } from './jobs/lyfta-job.js';
import { runPolarSync } from './jobs/polar-job.js';
import { runFatSecretSync } from './jobs/fatsecret-job.js';
import { deviceIngest } from './http/device-ingest.js';
import { makeRawStore } from './storage/drive-rawstore.js';
import { fatsecretRoutes } from './http/fatsecret-routes.js';
import { polarRoutes } from './http/polar-routes.js';

export default {
  async fetch(request, env) {
    const auth = createAuth({ teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, ownerEmail: env.OWNER_EMAIL });
    const assets = env.ASSETS ? r => env.ASSETS.fetch(r) : undefined;
    return createApp({ db: env.DB, auth, assets, raw: makeRawStore(env), jobs: { lyfta: () => runLyftaSync(env), polar: polarRoutes({ db: env.DB, env }), polarSync: () => runPolarSync(env), fatsecret: fatsecretRoutes({ db: env.DB, env }), fatsecretSync: () => runFatSecretSync(env), device: request => deviceIngest({ db: env.DB, raw: makeRawStore(env), enabled: env.DEVICE_INGEST_ENABLED === 'true' })(request) } })(request);
  },
  // Cron: sync automatico. Spento finché LYFTA_SYNC_ENABLED non è "true" (vedi lyfta-job.js).
  async scheduled(_event, env, ctx) {
    // Esito dell'ultimo cron in meta('cron_last'): solo codici, nessun dato né segreto. Serve a vedere che il cron gira davvero.
    const run = async (name, fn) => { try { const r = await fn(env); return [name, r?.ran === false ? { ran: false, reason: r.reason } : { ran: true, ok: r?.ok !== false, reason: r?.reason ?? null }]; } catch { return [name, { ran: true, ok: false, reason: 'exception' }]; } };
    ctx.waitUntil((async () => {
      const res = Object.fromEntries(await Promise.all([run('lyfta', runLyftaSync), run('polar', runPolarSync), run('fatsecret', runFatSecretSync)]));
      try { await env.DB.prepare("INSERT INTO meta (name, value) VALUES ('cron_last', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ at: new Date().toISOString(), ...res })).run(); } catch { /* best effort */ }
    })());
  },
};
