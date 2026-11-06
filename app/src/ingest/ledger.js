// Ledger di ingestione idempotente, progettato per D1 (nessuna transazione interattiva: solo db.batch()).
//
// Protocollo (DEC-MODEL-009, DEC-STORAGE-007/008):
//  1. artifact -> sha256 -> RawStore.put (hash verificato) -> riferimento.
//  2. ingest_key = sha256(subject|source|account|scope|artifact_sha256|completeness). Stesso artefatto = NO-OP.
//  3. Si legge la generation G e lo stato corrente dello scope, si calcola il diff in JS.
//  4. Un unico batch atomico: la PRIMA istruzione inserisce l'operazione solo se generation == G (CAS);
//     tutte le successive sono protette da EXISTS(operazione COMMITTING con base G). Se un altro writer
//     ha avanzato la generation, l'intero batch diventa un no-op e si ritenta (max MAX_ATTEMPTS).
//  5. Cancellazioni (tombstone) solo se scope_complete=true, valore deciso dall'adapter server-side
//     (mai dal client). Un sync parziale non cancella mai nulla.
//  6. Se il diff è vuoto la generation NON avanza (re-sync identico = nessuna nuova versione).
import { AppError } from '../core/errors.js';
import { sha256Hex, stableStringify } from '../core/hash.js';
import { validateIngest } from './envelope.js';

const MAX_ATTEMPTS = 4;
const GUARD = `EXISTS (SELECT 1 FROM ingest_operations WHERE id = ? AND status = 'COMMITTING' AND base_generation = ?)`;
const OP_COLS = 'id, subject_id, ingest_key, request_id, status, committed_generation, modified_count, deleted_count, base_generation, artifact_ref, artifact_sha256';

const receipt = (op, replayed) => ({
  operation_id: op.id,
  status: op.status,
  committed_generation: op.committed_generation,
  modified: op.modified_count,
  deleted: op.deleted_count,
  artifact_ref: op.artifact_ref,
  artifact_sha256: op.artifact_sha256,
  replayed,
});

export async function getGeneration(db) {
  return (await db.prepare("SELECT value FROM meta WHERE name = 'generation'").first()).value;
}

export async function getOperation(db, id, subject) {
  const op = await db.prepare(`SELECT ${OP_COLS}, created_at FROM ingest_operations WHERE id = ? AND subject_id = ?`).bind(id, subject).first();
  return op ? { ...receipt(op, false), created_at: op.created_at } : null;
}

const readByKey = (db, subject, key) => db.prepare(`SELECT ${OP_COLS} FROM ingest_operations WHERE subject_id = ? AND ingest_key = ?`).bind(subject, key).first();
const readByRequest = (db, subject, rid) => db.prepare(`SELECT ${OP_COLS} FROM ingest_operations WHERE subject_id = ? AND request_id = ?`).bind(subject, rid).first();

/**
 * @param {{db: object, raw: {put: Function}, now?: () => string}} deps
 * @param {object} input vedi validateIngest()
 */
export async function ingest({ db, raw, now = () => new Date().toISOString() }, input) {
  const v = validateIngest(input);
  const scopeKey = `${v.source_system}|${v.source_account}|${v.scope_id}`;
  const artifactSha = await sha256Hex(v.artifact);
  const ingestKey = await sha256Hex(`${v.subject}|${scopeKey}|${artifactSha}|${v.scope_complete ? 'C' : 'P'}`);
  const opId = `op_${ingestKey.slice(0, 32)}`;

  const dup = await readByRequest(db, v.subject, v.request_id);
  if (dup) {
    if (dup.ingest_key !== ingestKey) throw new AppError(409, 'request_id_conflict');
    return receipt(dup, true);
  }
  const same = await readByKey(db, v.subject, ingestKey);
  if (same) return receipt(same, true);

  const { ref, bytes } = await raw.put(artifactSha, v.artifact); // fallisce chiuso se hash/archivio non validi

  const normalized = [];
  for (const r of v.records) {
    const payload_json = stableStringify(r.payload);
    normalized.push({ id: r.id, domain: r.domain, observed_at: r.observed_at ?? null, payload_json, payload_hash: await sha256Hex(payload_json) });
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const G = await getGeneration(db);
    const { results: prev } = await db.prepare(
      'SELECT record_id, domain, payload_hash, deleted, revision FROM current_records WHERE subject_id = ? AND source_system = ? AND source_account = ? AND scope_id = ?'
    ).bind(v.subject, v.source_system, v.source_account, v.scope_id).all();
    const prevMap = new Map(prev.map(r => [r.record_id, r]));

    const changes = [];
    for (const r of normalized) {
      const p = prevMap.get(r.id);
      if (p && !p.deleted && p.payload_hash === r.payload_hash && p.domain === r.domain) continue;
      changes.push({ ...r, revision: (p?.revision ?? 0) + 1, tombstone: 0 });
    }
    // Esclusioni decise dal proprietario (mai dal client): tombstone esplicito di singoli record, senza toccare il resto dello scope.
    for (const id of v.drop_ids ?? []) {
      const p = prevMap.get(id);
      if (p && !p.deleted) changes.push({ id, domain: p.domain, observed_at: null, payload_json: null, payload_hash: null, revision: p.revision + 1, tombstone: 1 });
    }
    if (v.scope_complete) {
      const seen = new Set(normalized.map(r => r.id));
      for (const p of prev) {
        if (!p.deleted && !seen.has(p.record_id)) changes.push({ id: p.record_id, domain: p.domain, observed_at: null, payload_json: null, payload_hash: null, revision: p.revision + 1, tombstone: 1 });
      }
    }
    const modified = changes.filter(c => !c.tombstone).length;
    const deleted = changes.length - modified;
    const newGen = changes.length ? G + 1 : G;
    const ts = now();

    const stmts = [db.prepare(
      `INSERT INTO ingest_operations (id, subject_id, ingest_key, request_id, source_system, source_account, scope_id, artifact_sha256, artifact_ref, artifact_bytes, scope_complete, status, base_generation, committed_generation, modified_count, deleted_count, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMMITTING', ?, NULL, 0, 0, ?
       WHERE (SELECT value FROM meta WHERE name = 'generation') = ? ON CONFLICT DO NOTHING`
    ).bind(opId, v.subject, ingestKey, v.request_id, v.source_system, v.source_account, v.scope_id, artifactSha, ref, bytes, v.scope_complete ? 1 : 0, G, ts, G)];

    changes.forEach((c, i) => {
      stmts.push(db.prepare(
        `INSERT INTO record_revisions (id, subject_id, source_system, source_account, scope_id, record_id, domain, revision, tombstone, payload_json, payload_hash, observed_at, op_id, recorded_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${GUARD}`
      ).bind(`${opId}:${i}`, v.subject, v.source_system, v.source_account, v.scope_id, c.id, c.domain, c.revision, c.tombstone, c.payload_json, c.payload_hash, c.observed_at, opId, ts, opId, G));
      stmts.push(db.prepare(
        `INSERT INTO current_records (subject_id, source_system, source_account, scope_id, record_id, domain, payload_json, payload_hash, revision, deleted, observed_at, last_op_id, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${GUARD}
         ON CONFLICT (subject_id, source_system, source_account, scope_id, record_id) DO UPDATE SET
           domain = excluded.domain, payload_json = excluded.payload_json, payload_hash = excluded.payload_hash, revision = excluded.revision,
           deleted = excluded.deleted, observed_at = excluded.observed_at, last_op_id = excluded.last_op_id, updated_at = excluded.updated_at`
      ).bind(v.subject, v.source_system, v.source_account, v.scope_id, c.id, c.domain, c.payload_json, c.payload_hash, c.revision, c.tombstone, c.observed_at, opId, ts, opId, G));
    });
    if (changes.length) stmts.push(db.prepare(`UPDATE meta SET value = value + 1 WHERE name = 'generation' AND ${GUARD}`).bind(opId, G));
    stmts.push(db.prepare(
      `UPDATE ingest_operations SET status = 'COMMITTED', committed_generation = ?, modified_count = ?, deleted_count = ? WHERE id = ? AND status = 'COMMITTING' AND base_generation = ?`
    ).bind(newGen, modified, deleted, opId, G));

    await db.batch(stmts); // atomico: tutto o niente

    const op = await readByKey(db, v.subject, ingestKey);
    if (op?.status === 'COMMITTED') return receipt(op, op.base_generation !== G);
    if (op) throw new AppError(500, 'operation_state_unexpected', { status: op.status }); // mai visibile da un batch atomico
    const clash = await readByRequest(db, v.subject, v.request_id);
    if (clash) throw new AppError(409, 'request_id_conflict');
    // CAS perso: un altro writer ha avanzato la generation -> ricalcola il diff e riprova
  }
  throw new AppError(503, 'ingest_contention', { retryable: true });
}

export async function listCanonical(db, subject, domain) {
  const { results } = await db.prepare(
    'SELECT source_system, source_account, scope_id, record_id, domain, payload_json, revision, observed_at FROM current_records WHERE subject_id = ? AND domain = ? AND deleted = 0 ORDER BY observed_at, record_id LIMIT 5000'
  ).bind(subject, domain).all();
  return results.map(r => ({ ...r, payload: JSON.parse(r.payload_json), payload_json: undefined }));
}

export async function recordHistory(db, subject, { source_system, source_account, scope_id, record_id }) {
  const { results } = await db.prepare(
    'SELECT revision, tombstone, payload_hash, op_id, recorded_at FROM record_revisions WHERE subject_id = ? AND source_system = ? AND source_account = ? AND scope_id = ? AND record_id = ? ORDER BY revision'
  ).bind(subject, source_system, source_account, scope_id, record_id).all();
  return results.map(r => ({ ...r, tombstone: !!r.tombstone }));
}
