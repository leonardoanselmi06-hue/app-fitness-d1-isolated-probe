// Scenari del ledger eseguibili sia su D1 REALE (dentro un Worker temporaneo) sia sull'emulatore locale.
// Usano il codice vero di src/ingest/ledger.js. Solo dati sintetici, soggetti con prefisso `d1t-<run_id>-`
// (la pulizia li elimina per prefisso). Nessuna dipendenza da Node: gira anche in Workers.
import { ingest, getGeneration, getOperation, listCanonical, recordHistory } from '../../src/ingest/ledger.js';
import { MemoryRawStore } from '../../src/storage/rawstore.js';

const fail = m => { throw new Error(m); };
const eq = (a, b, what) => { if (a !== b) fail(`${what}: atteso ${JSON.stringify(b)}, ottenuto ${JSON.stringify(a)}`); };
const yes = (c, what) => { if (!c) fail(what); };
const rejects = async (p, pred, what) => {
  try { await p; } catch (e) { if (pred(e)) return; fail(`${what}: errore inatteso (${e?.code ?? e?.message})`); }
  fail(`${what}: nessun errore, ma era atteso`);
};

const rec = (id, reps = 8) => ({ id, domain: 'training', observed_at: '2026-10-25T12:00:00Z', payload: { title: 'T', reps } });
const HISTORY_KEY = (record_id) => ({ source_system: 'synthetic_test', source_account: 'acc', scope_id: 'full', record_id });

const SCENARIOS = [
  ['primo ingest: committed, generation +1, record canonico presente', async ({ db, deps, req, subject }) => {
    const s = subject(); const g = await getGeneration(db);
    const r = await ingest(deps, req(s, [rec('w1')]));
    eq(r.status, 'COMMITTED', 'status'); eq(r.modified, 1, 'modified'); eq(r.committed_generation, g + 1, 'committed_generation');
    eq(await getGeneration(db), g + 1, 'generation'); eq((await listCanonical(db, s, 'training')).length, 1, 'record canonici');
  }],

  ['replay: stesso request_id, o altro request_id con stesso artefatto = no-op', async ({ db, deps, req, subject }) => {
    const s = subject(); const first = req(s, [rec('w1')]); const a = await ingest(deps, first);
    const g = await getGeneration(db);
    const b = await ingest(deps, first);
    const c = await ingest(deps, { ...first, request_id: crypto.randomUUID() });
    yes(b.replayed && c.replayed, 'replay non segnalato'); eq(c.operation_id, a.operation_id, 'operation_id');
    eq(await getGeneration(db), g, 'generation invariata');
  }],

  ['stesso request_id con contenuto diverso = 409', async ({ db, deps, req, subject }) => {
    const s = subject(); const first = req(s, [rec('w1')]); await ingest(deps, first);
    const g = await getGeneration(db);
    await rejects(ingest(deps, { ...req(s, [rec('w1', 9)]), request_id: first.request_id }), e => e.status === 409 && e.code === 'request_id_conflict', '409');
    eq(await getGeneration(db), g, 'generation invariata dopo il conflitto');
  }],

  ['payload cambiato = nuova revisione, nessun duplicato canonico', async ({ db, deps, req, subject }) => {
    const s = subject(); await ingest(deps, req(s, [rec('w1')])); await ingest(deps, req(s, [rec('w1', 9)]));
    const cur = await listCanonical(db, s, 'training');
    eq(cur.length, 1, 'record canonici'); eq(cur[0].payload.reps, 9, 'payload aggiornato'); eq(cur[0].revision, 2, 'revision');
    const h = await recordHistory(db, s, HISTORY_KEY('w1'));
    eq(JSON.stringify(h.map(x => x.revision)), '[1,2]', 'storico revisioni');
  }],

  ['scope parziale non cancella; scope completo cancella con tombstone e conserva lo storico', async ({ db, deps, req, subject }) => {
    const s = subject(); await ingest(deps, req(s, [rec('w1'), rec('w2')]));
    await ingest(deps, req(s, [rec('w1')]));
    eq((await listCanonical(db, s, 'training')).length, 2, 'un sync parziale non deve cancellare');
    const r = await ingest(deps, req(s, [rec('w1')], { scope_complete: true }));
    eq(r.deleted, 1, 'deleted');
    eq((await listCanonical(db, s, 'training')).map(x => x.record_id).join(','), 'w1', 'record rimasti');
    const h = await recordHistory(db, s, HISTORY_KEY('w2'));
    eq(h.at(-1).tombstone, true, 'tombstone'); eq(h.length, 2, 'storico di w2 conservato');
  }],

  ['rollback atomico di db.batch(): una violazione a metà annulla anche la prima istruzione', async ({ db, subject }) => {
    const s = subject(); const opId = `op_rollback_${s}`;
    const insert = () => db.prepare(
      `INSERT INTO ingest_operations (id, subject_id, ingest_key, request_id, source_system, source_account, scope_id, artifact_sha256, artifact_ref, artifact_bytes, scope_complete, status, base_generation, created_at)
       VALUES (?, ?, ?, ?, 'synthetic_test', 'acc', 'full', 'x', 'mem://x', 1, 0, 'COMMITTING', 0, ?)`
    ).bind(opId, s, `key_${opId}`, crypto.randomUUID(), new Date().toISOString());
    let rejected = false;
    try { await db.batch([insert(), insert()]); } catch { rejected = true; } // il secondo duplica la chiave primaria
    const n = (await db.prepare('SELECT COUNT(*) AS n FROM ingest_operations WHERE id = ?').bind(opId).first()).n;
    yes(rejected, 'il batch con violazione doveva fallire'); eq(n, 0, 'righe residue dopo il rollback');
  }],

  ['CAS: 4 writer concorrenti su scope diversi, nessun aggiornamento perso', async ({ db, deps, req, subject, counter }) => {
    const s = subject(); const g = await getGeneration(db); const b0 = counter.batches;
    const settled = await Promise.allSettled(['A', 'B', 'C', 'D'].map(k => ingest(deps, req(s, [rec(`r${k}`)], { scope_id: `scope${k}` }))));
    const bad = settled.filter(x => x.status === 'rejected');
    if (bad.length) fail(`${bad.length} writer falliti: ${bad.map(x => x.reason?.code ?? x.reason?.message).join(', ')}`);
    yes(settled.every(x => x.value.status === 'COMMITTED'), 'non tutti committed');
    eq(await getGeneration(db), g + 4, 'generation: ogni writer avanza di 1');
    eq((await listCanonical(db, s, 'training')).map(x => x.record_id).sort().join(','), 'rA,rB,rC,rD', 'record presenti');
    return { batch_calls: counter.batches - b0, nota: 'oltre 4 chiamate = conflitti CAS reali, ritentati' };
  }],

  ['stessa chiave scritta due volte in concorrenza = una sola operazione', async ({ db, deps, req, subject }) => {
    const s = subject(); const g = await getGeneration(db); const one = req(s, [rec('w1')]);
    const [a, b] = await Promise.all([ingest(deps, one), ingest(deps, one)]);
    eq(a.operation_id, b.operation_id, 'operation_id');
    eq((await db.prepare('SELECT COUNT(*) AS n FROM ingest_operations WHERE subject_id = ?').bind(s).first()).n, 1, 'operazioni registrate');
    eq(await getGeneration(db), g + 1, 'generation');
  }],

  ['stato recuperabile per operation_id (ricevuta persa SIMULATA, non una vera disconnessione)', async ({ db, deps, req, subject }) => {
    const s = subject(); const r = await ingest(deps, req(s, [rec('w1')]));
    const st = await getOperation(db, r.operation_id, s);
    eq(st.status, 'COMMITTED', 'stato'); eq(st.committed_generation, r.committed_generation, 'committed_generation');
    eq(await getOperation(db, r.operation_id, subject()), null, 'isolamento tra soggetti');
  }],
];

/** @param db oggetto con prepare()/batch() (binding D1 o emulatore) @param runId stringa numerica del run */
export async function runScenarios(rawDb, runId) {
  const counter = { batches: 0 };
  const db = { prepare: s => rawDb.prepare(s), batch: st => { counter.batches++; return rawDb.batch(st); } };
  const deps = { db, raw: new MemoryRawStore(), now: () => new Date().toISOString() };
  let n = 0;
  const subject = () => `d1t-${runId}-${++n}`;
  const req = (subj, records, extra = {}) => ({
    subject: subj, source_system: 'synthetic_test', source_account: 'acc', scope_id: 'full', request_id: crypto.randomUUID(),
    captured_at: new Date().toISOString(), artifact: JSON.stringify(records), records, scope_complete: false, ...extra,
  });
  const ctx = { db, deps, req, subject, counter };

  const results = []; const start = await getGeneration(db);
  for (const [name, fn] of SCENARIOS) {
    const t = Date.now();
    try {
      const info = await fn(ctx);
      results.push({ name, status: 'PASS', ms: Date.now() - t, ...(info ? { info } : {}) });
    } catch (e) {
      results.push({ name, status: 'FAIL', ms: Date.now() - t, error: String(e?.message ?? e).slice(0, 300) });
    }
  }
  return { ok: results.every(r => r.status === 'PASS'), results, generation: { start, end: await getGeneration(db) }, batch_calls: counter.batches, subject_prefix: `d1t-${runId}-` };
}
