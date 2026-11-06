// Esclusione di pesate dall'app (es. una pesata sbagliata o di un'altra persona). Solo il proprietario, mai dal telefono.
// Effetto: l'istante entra in meta('excluded_weights') (già rispettata dall'ingestione del telefono: non ricompare) e il record attuale
// riceve subito un tombstone nel ledger (la cronologia delle revisioni resta). Ripristino: l'istante esce dalla lista e la pesata torna
// alla prossima sincronizzazione del telefono, se rientra nella finestra che il collector invia. Ogni azione è registrata nel log.
import { AppError, insist } from '../core/errors.js';
import { validIsoInstant } from '../core/time.js';
import { ingest } from '../ingest/ledger.js';

const KEY = 'excluded_weights';
export async function readExcluded(db) {
  try { const row = await db.prepare('SELECT value FROM meta WHERE name = ?').bind(KEY).first(); const v = row?.value ? JSON.parse(row.value) : []; return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; }
}
const saveList = (db, list) => db.prepare('INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').bind(KEY, JSON.stringify([...list].sort()));
const logRow = (db, subject, instant, action, kg, reason, nowIso) => db.prepare('INSERT INTO weight_exclusion_log (subject_id, instant, action, kg, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(subject, instant, action, kg, reason, nowIso);
const instantOf = b => { insist(b && validIsoInstant(b.time), 422, 'invalid_time'); return new Date(b.time).toISOString(); };
const reasonOf = b => { insist(b.reason == null || (typeof b.reason === 'string' && b.reason.length <= 200), 422, 'invalid_reason'); return b.reason?.trim() || null; };
const only = (b, keys) => { for (const k of Object.keys(b)) insist(keys.includes(k), 422, 'invalid_body'); };

export async function excludeWeight(db, raw, subject, b, { nowIso }) {
  only(b, ['time', 'reason']); const instant = instantOf(b), reason = reasonOf(b);
  const list = await readExcluded(db); insist(!list.includes(instant), 409, 'already_excluded');
  const rec = await db.prepare("SELECT record_id, source_account, payload_json FROM current_records WHERE subject_id = ? AND source_system = 'health_connect' AND scope_id = 'weight' AND domain = 'body' AND observed_at = ? AND deleted = 0").bind(subject, instant).first();
  insist(rec, 404, 'weight_not_found');
  const kg = JSON.parse(rec.payload_json).kg ?? null;
  await db.batch([saveList(db, [...list, instant]), logRow(db, subject, instant, 'exclude', kg, reason, nowIso)]); // prima la lista: anche se il tombstone fallisce, la prossima sincronizzazione lo applica
  if (!raw) throw new AppError(503, 'raw_store_unavailable');
  await ingest({ db, raw, now: () => nowIso }, { subject, source_system: 'health_connect', source_account: rec.source_account, scope_id: 'weight', request_id: crypto.randomUUID(), captured_at: nowIso,
    artifact: JSON.stringify({ action: 'exclude_weight', instant, at: nowIso }), records: [], drop_ids: [rec.record_id], scope_complete: false });
  return { excluded: instant, kg };
}

export async function restoreWeight(db, subject, b, { nowIso }) {
  only(b, ['time', 'reason']); const instant = instantOf(b), reason = reasonOf(b);
  const list = await readExcluded(db); insist(list.includes(instant), 404, 'not_excluded');
  const last = await db.prepare("SELECT kg FROM weight_exclusion_log WHERE subject_id = ? AND instant = ? AND action = 'exclude' ORDER BY id DESC LIMIT 1").bind(subject, instant).first();
  await db.batch([saveList(db, list.filter(x => x !== instant)), logRow(db, subject, instant, 'restore', last?.kg ?? null, reason, nowIso)]);
  return { restored: instant, note: 'La pesata tornerà alla prossima sincronizzazione del telefono, se rientra nella finestra di invio.' };
}

/** Esclusioni attive con valore, motivo e data (dal log; le voci storiche senza log hanno kg null). Due query D1. */
export async function listExclusions(db, subject) {
  const list = await readExcluded(db); if (!list.length) return [];
  const { results } = await db.prepare("SELECT instant, kg, reason, created_at FROM weight_exclusion_log WHERE subject_id = ? AND action = 'exclude' ORDER BY id ASC").bind(subject).all();
  const by = new Map(results.map(r => [r.instant, r]));
  return list.map(t => ({ time: t, kg: by.get(t)?.kg ?? null, reason: by.get(t)?.reason ?? null, excluded_at: by.get(t)?.created_at ?? null })).sort((a, b) => (a.time < b.time ? 1 : -1));
}

export async function weightsRoute(request, url, { db, raw, subject, now, readBody }) {
  const nowIso = now().toISOString(), p = url.pathname;
  if (request.method === 'GET' && p === '/v1/weights/exclusions') return { excluded: await listExclusions(db, subject) };
  if (request.method === 'POST' && (p === '/v1/weights/exclude' || p === '/v1/weights/restore')) {
    const body = await readBody(request, url, 2048);
    return p.endsWith('/exclude') ? await excludeWeight(db, raw, subject, body, { nowIso }) : await restoreWeight(db, subject, body, { nowIso });
  }
  throw new AppError(request.method === 'GET' || request.method === 'POST' ? 404 : 405, request.method === 'GET' || request.method === 'POST' ? 'not_found' : 'method_not_allowed');
}
