import test from 'node:test';
import assert from 'node:assert/strict';
import { ingest, getGeneration, getOperation, listCanonical, recordHistory } from '../src/ingest/ledger.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { newDb } from './helpers/d1-shim.mjs';

const S = 'owner';
const rid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rec = (id, reps = 8) => ({ id, domain: 'training', observed_at: '2026-10-25T12:00:00Z', payload: { title: 'T', reps } });
const req = (n, records, extra = {}) => ({
  subject: S, source_system: 'synthetic_test', source_account: 'acc', scope_id: 'full', request_id: rid(n),
  captured_at: '2026-10-30T10:00:00Z', artifact: JSON.stringify(records), records, scope_complete: false, ...extra,
});
const env = (opts) => ({ db: newDb(opts), raw: new MemoryRawStore(), now: () => '2026-10-30T10:00:00.000Z' });

test('primo ingest: committed, generation 1, RAW archiviato con hash verificato', async () => {
  const e = env(); const r = await ingest(e, req(1, [rec('w1')]));
  assert.equal(r.status, 'COMMITTED'); assert.equal(r.committed_generation, 1); assert.equal(r.modified, 1);
  assert.equal(await getGeneration(e.db), 1); assert.equal(e.raw.objects.size, 1);
  assert.equal((await listCanonical(e.db, S, 'training')).length, 1);
});

test('replay stesso request_id e stesso artefatto con altro request_id = NO-OP, nessuna nuova generation', async () => {
  const e = env(); const a = await ingest(e, req(1, [rec('w1')]));
  const b = await ingest(e, req(1, [rec('w1')]));
  const c = await ingest(e, req(2, [rec('w1')]));
  assert.equal(b.replayed, true); assert.equal(c.replayed, true); assert.equal(c.operation_id, a.operation_id);
  assert.equal(await getGeneration(e.db), 1);
});

test('stesso request_id con contenuto diverso = 409', async () => {
  const e = env(); await ingest(e, req(1, [rec('w1')]));
  await assert.rejects(ingest(e, req(1, [rec('w1', 9)])), x => x.status === 409 && x.code === 'request_id_conflict');
  assert.equal(await getGeneration(e.db), 1);
});

test('payload cambiato = nuova revisione immutabile, nessun duplicato canonico', async () => {
  const e = env(); await ingest(e, req(1, [rec('w1')])); await ingest(e, req(2, [rec('w1', 9)]));
  const cur = await listCanonical(e.db, S, 'training');
  assert.equal(cur.length, 1); assert.equal(cur[0].payload.reps, 9); assert.equal(cur[0].revision, 2);
  const h = await recordHistory(e.db, S, { source_system: 'synthetic_test', source_account: 'acc', scope_id: 'full', record_id: 'w1' });
  assert.deepEqual(h.map(x => x.revision), [1, 2]);
});

test('artefatto diverso ma record invariati: operazione registrata, generation invariata', async () => {
  const e = env(); await ingest(e, req(1, [rec('w1')]));
  const r = await ingest(e, req(2, [rec('w1')], { artifact: 'export-ricatturato' }));
  assert.equal(r.modified, 0); assert.equal(r.committed_generation, 1); assert.equal(await getGeneration(e.db), 1);
});

test('scope parziale non cancella mai; scope completo cancella solo lo scope e conserva lo storico', async () => {
  const e = env(); await ingest(e, req(1, [rec('w1'), rec('w2')]));
  await ingest(e, req(2, [rec('w1')]));
  assert.equal((await listCanonical(e.db, S, 'training')).length, 2);
  await ingest(e, req(3, [rec('x1')], { scope_id: 'altro', scope_complete: true })); // altro scope: w1/w2 intatti
  assert.equal((await listCanonical(e.db, S, 'training')).length, 3);
  const r = await ingest(e, req(4, [rec('w1')], { scope_complete: true }));
  assert.equal(r.deleted, 1);
  assert.deepEqual((await listCanonical(e.db, S, 'training')).map(x => x.record_id).sort(), ['w1', 'x1']);
  const h = await recordHistory(e.db, S, { source_system: 'synthetic_test', source_account: 'acc', scope_id: 'full', record_id: 'w2' });
  assert.equal(h.at(-1).tombstone, true); assert.equal(h.length, 2);
});

test('id con contenuto identico restano identità distinte (set ripetuti legittimi)', async () => {
  const e = env(); await ingest(e, req(1, [rec('set-1'), rec('set-2')]));
  assert.equal((await listCanonical(e.db, S, 'training')).length, 2);
});

test('fault a metà batch: rollback totale (nessuna operazione, nessun record, generation invariata) e retry ok', async () => {
  const e = env({ failBatchAt: 3 });
  await assert.rejects(ingest(e, req(1, [rec('w1'), rec('w2')])), /injected_fault/);
  assert.equal(await getGeneration(e.db), 0);
  assert.equal((await e.db.prepare('SELECT COUNT(*) AS n FROM ingest_operations').first()).n, 0);
  assert.equal((await e.db.prepare('SELECT COUNT(*) AS n FROM current_records').first()).n, 0);
  e.db.failBatchAt = null;
  const r = await ingest(e, req(1, [rec('w1'), rec('w2')]));
  assert.equal(r.status, 'COMMITTED'); assert.equal(r.modified, 2);
});

test('ACK perso: dopo il commit lo stato è recuperabile per operation_id', async () => {
  const e = env(); const r = await ingest(e, req(1, [rec('w1')]));
  const st = await getOperation(e.db, r.operation_id, S);
  assert.equal(st.status, 'COMMITTED'); assert.equal(st.committed_generation, 1);
  assert.equal(await getOperation(e.db, r.operation_id, 'altro-soggetto'), null);
});

test('CAS: due writer concorrenti su record diversi vengono serializzati, nessun aggiornamento perso', async () => {
  const e = env(); let injected = false;
  // Prima che il batch di A parta, B committa: A deve rilevare il CAS perso, ricalcolare e ritentare.
  e.db.beforeBatch = async () => {
    if (injected) return; injected = true; e.db.beforeBatch = null;
    await ingest({ ...e, db: e.db }, req(2, [rec('b1')], { scope_id: 'scopeB' }));
  };
  const a = await ingest(e, req(1, [rec('a1')], { scope_id: 'scopeA' }));
  assert.equal(a.status, 'COMMITTED');
  assert.equal(e.db.batches, 3, 'B + A (CAS perso, no-op) + A (ritentato)'); // prova che il ramo di retry è stato davvero esercitato
  assert.equal(await getGeneration(e.db), 2);
  const ids = (await listCanonical(e.db, S, 'training')).map(x => x.record_id).sort();
  assert.deepEqual(ids, ['a1', 'b1']);
});

test('CAS: stessa chiave scritta due volte in concorrenza produce una sola operazione', async () => {
  const e = env();
  const [a, b] = await Promise.all([ingest(e, req(1, [rec('w1')])), ingest(e, req(1, [rec('w1')]))]);
  assert.equal(a.operation_id, b.operation_id);
  assert.equal((await e.db.prepare('SELECT COUNT(*) AS n FROM ingest_operations').first()).n, 1);
  assert.equal(await getGeneration(e.db), 1);
});

test('validazione: input non valido rifiutato senza scritture', async () => {
  const e = env();
  for (const bad of [req(1, [rec('w1'), rec('w1')]), req(1, [{ id: 'x', domain: 'boh', payload: {} }]), req(1, [], { scope_id: 'a b' }), req(1, [], { source_system: 'ignoto' })]) {
    await assert.rejects(ingest(e, bad), x => x.status === 422);
  }
  assert.equal(await getGeneration(e.db), 0); assert.equal(e.raw.objects.size, 0);
});
