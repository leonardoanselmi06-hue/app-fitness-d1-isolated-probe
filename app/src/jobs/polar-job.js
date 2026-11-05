// Job di sync Polar (cron + POST /v1/sync/polar). SPENTO per default: gira solo con POLAR_SYNC_ENABLED="true"
// (il Readiness Gate DB-RG-001 resta NOT PASS per le sorgenti diverse da Lyfta: serve l'approvazione esplicita dell'utente).
import { syncPolar } from '../adapters/polar/sync.js';
import { PolarTokens } from '../adapters/polar/oauth.js';
import { polarGet } from '../adapters/polar/client.js';
import { makeRawStore } from '../storage/drive-rawstore.js';
import { UnconfiguredRawStore } from '../storage/rawstore.js';
import { AppError } from '../core/errors.js';

export async function runPolarSync(env, { now = () => new Date().toISOString(), fetchFn, rawStore } = {}) {
  if (env.POLAR_SYNC_ENABLED !== 'true') return { ran: false, reason: 'disabled' };
  if (!env.DB) return { ran: false, reason: 'no_database' };
  if (!env.POLAR_CLIENT_ID || !env.POLAR_CLIENT_SECRET) return { ran: false, reason: 'polar_unconfigured' };
  const raw = rawStore ?? makeRawStore(env);
  if (raw instanceof UnconfiguredRawStore) return { ran: false, reason: 'raw_store_unconfigured' };
  const t = now();
  try {
    const tokens = new PolarTokens({ db: env.DB, clientId: env.POLAR_CLIENT_ID, clientSecret: env.POLAR_CLIENT_SECRET, fetchFn, now: () => Date.parse(t) });
    const get = polarGet({ tokens, fetchFn });
    const out = await syncPolar({ db: env.DB, raw, now }, { get, days: Number(env.POLAR_SYNC_DAYS) || 60, request_id: crypto.randomUUID(), captured_at: t });
    return { ran: true, ok: out.ok, listed: out.listed, new_sessions: out.new_sessions, detailed: out.detailed, remaining: out.remaining, receipt: out.receipt };
  } catch (e) {
    if (e instanceof AppError) return { ran: true, ok: false, reason: e.code, upstream_status: e.extra?.upstream_status ?? null };
    return { ran: true, ok: false, reason: 'internal_error' };
  }
}
