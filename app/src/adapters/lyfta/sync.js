// Sync Lyfta lato server (DEC-TRAIN-002): pull REST read-only con paginazione completa.
// La COMPLETEZZA dello scope è calcolata qui, dal server, e mai dichiarata da un client (DEC-MODEL-009).
// fetchPage(page) è iniettato: in produzione usa fetch + chiave API da secret; nei test, fixture sintetiche.
// Paginazione: campi al livello superiore `total_records`, `total_pages`, `current_page` (documentazione ufficiale https://my.lyfta.app/community/api, 5 novembre 2026).
// Da confermare su payload reale con il workflow `lyfta-probe` (stampa solo la struttura, mai i valori).
import { ingest } from '../../ingest/ledger.js';
import { normalizeWorkout } from './normalize.js';

export const MAX_PAGES = 200;

export async function pullAllWorkouts(fetchPage) {
  const workouts = [];
  let total = null, totalPages = null, complete = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let body;
    try { body = await fetchPage(page); } catch { return { workouts, complete: false, reason: 'fetch_error', page }; }
    const list = body?.workouts;
    if (!Array.isArray(list)) return { workouts, complete: false, reason: 'invalid_page', page };
    total ??= body.total_records ?? null;
    totalPages ??= body.total_pages ?? null;
    workouts.push(...list);
    if (totalPages == null) return { workouts, complete: false, reason: 'pagination_unknown', page };
    if (page >= totalPages) { complete = true; break; }
  }
  const ids = new Set(workouts.map(w => String(w.id)));
  // Controlli di integrità: conteggio dichiarato e id unici. Un risultato vuoto NON è mai autorevole se non coincide col totale.
  if (!complete || (total != null && ids.size !== total) || ids.size !== workouts.length) {
    return { workouts, complete: false, reason: complete ? 'count_mismatch' : 'max_pages' };
  }
  return { workouts, complete: true };
}

export async function syncLyfta(deps, { subject, account = 'lyfta-user', fetchPage, request_id, captured_at }) {
  const pulled = await pullAllWorkouts(fetchPage);
  if (!pulled.workouts.length && !pulled.complete) return { ok: false, reason: pulled.reason };
  const records = pulled.workouts.map((w, i) => normalizeWorkout(w, i));
  const receipt = await ingest(deps, {
    subject, source_system: 'lyfta', source_account: account, scope_id: 'full', request_id, captured_at,
    artifact: JSON.stringify(pulled.workouts), // RAW lossless: payload originale delle pagine
    records,
    scope_complete: pulled.complete, // solo se TUTTE le pagine sono state lette e i controlli sono passati
  });
  return { ok: true, complete: pulled.complete, reason: pulled.reason ?? null, receipt };
}
