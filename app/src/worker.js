// Entry point Cloudflare Worker. Configurazione tramite binding/secret (mai nel repo):
//   DB (D1), ACCESS_TEAM_DOMAIN, ACCESS_AUD, OWNER_EMAIL. Senza questi, le API /v1 falliscono chiuse (503).
import { createApp } from './app.js';
import { createAuth } from './http/auth.js';

export default {
  async fetch(request, env) {
    const auth = createAuth({ teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, ownerEmail: env.OWNER_EMAIL });
    const assets = env.ASSETS ? r => env.ASSETS.fetch(r) : undefined;
    return createApp({ db: env.DB, auth, assets })(request);
  },
};
