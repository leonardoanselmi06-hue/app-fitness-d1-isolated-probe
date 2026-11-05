// Job di sync FatSecret (cron + POST /v1/sync/fatsecret). SPENTO per default: gira solo con FATSECRET_SYNC_ENABLED="true"
// (Readiness Gate DB-RG-001 NOT PASS per le sorgenti diverse da Lyfta: serve l'approvazione esplicita dell'utente).
import { syncFatSecret } from '../adapters/fatsecret/sync.js';
import { FatSecretTokens, fatsecretGet } from '../adapters/fatsecret/oauth1.js';
import { makeRawStore } from '../storage/drive-rawstore.js';
import { UnconfiguredRawStore } from '../storage/rawstore.js';
import { AppError } from '../core/errors.js';

export async function runFatSecretSync(env, { now = () => new Date().toISOString(), fetchFn, rawStore } = {}) {
  if (env.FATSECRET_SYNC_ENABLED !== 'true') return { ran: false, reason: 'disabled' };
  if (!env.DB) return { ran: false, reason: 'no_database' };
  if (!env.FATSECRET_CONSUMER_KEY || !env.FATSECRET_CONSUMER_SECRET) return { ran: false, reason: 'fatsecret_unconfigured' };
  const raw = rawStore ?? makeRawStore(env);
  if (raw instanceof UnconfiguredRawStore) return { ran: false, reason: 'raw_store_unconfigured' };
  const t = now();
  try {
    const tokens = new FatSecretTokens({ db: env.DB, consumerKey: env.FATSECRET_CONSUMER_KEY, consumerSecret: env.FATSECRET_CONSUMER_SECRET, fetchFn, now: () => Date.parse(t) });
    const out = await syncFatSecret({ db: env.DB, raw, now }, { get: fatsecretGet({ tokens, fetchFn }), days: Number(env.FATSECRET_SYNC_DAYS) || 30, captured_at: t });
    return { ran: true, ...out };
  } catch (e) {
    if (e instanceof AppError) return { ran: true, ok: false, reason: e.code, step: e.extra?.step ?? null, upstream_status: e.extra?.upstream_status ?? null };
    return { ran: true, ok: false, reason: 'internal_error' };
  }
}
