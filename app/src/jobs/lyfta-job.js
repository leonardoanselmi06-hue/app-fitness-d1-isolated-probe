// Job di sync Lyfta (cron + POST /v1/sync/lyfta). SPENTO per default: gira solo con LYFTA_SYNC_ENABLED="true".
// Motivo: il Readiness Gate (DEC-GOV-003) blocca i dati personali reali finché l'utente non lo supera e lo approva.
// Fail-closed: senza chiave Lyfta, RawStore Drive configurato e database, non fa nulla e lo dice (mai un dato a metà).
import { syncLyfta } from '../adapters/lyfta/sync.js';
import { lyftaFetchPage } from '../adapters/lyfta/client.js';
import { makeRawStore } from '../storage/drive-rawstore.js';
import { UnconfiguredRawStore } from '../storage/rawstore.js';
import { AppError } from '../core/errors.js';

export async function runLyftaSync(env, { now = () => new Date().toISOString(), fetchFn, rawStore } = {}) {
  if (env.LYFTA_SYNC_ENABLED !== 'true') return { ran: false, reason: 'disabled' };
  if (!env.DB) return { ran: false, reason: 'no_database' };
  if (!env.LYFTA_API_KEY) return { ran: false, reason: 'lyfta_unconfigured' };
  const raw = rawStore ?? makeRawStore(env);
  if (raw instanceof UnconfiguredRawStore) return { ran: false, reason: 'raw_store_unconfigured' };
  const t = now();
  try {
    const fetchPage = lyftaFetchPage({ apiKey: env.LYFTA_API_KEY, fetchFn });
    const out = await syncLyfta({ db: env.DB, raw, now }, { subject: 'owner', fetchPage, request_id: crypto.randomUUID(), captured_at: t });
    // Nessun dato di allenamento nel risultato: solo esito e ricevuta del ledger.
    return { ran: true, ok: out.ok, complete: out.complete ?? false, reason: out.reason ?? null, receipt: out.receipt ?? null };
  } catch (e) {
    if (e instanceof AppError) return { ran: true, ok: false, complete: false, reason: e.code };
    return { ran: true, ok: false, complete: false, reason: 'internal_error' };
  }
}
