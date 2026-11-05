// Collaudo end-to-end SINTETICO: syncLyfta vero + D1 REALE + Drive REALE (DriveRawStore). Lyfta è simulato con fixture sintetiche.
// Subject `d1t-<run_id>-sync` (pulizia per prefisso). Il file RAW su Drive è immutabile e sintetico: resta nella cartella AppFitness-RAW.
import { syncLyfta } from '../../src/adapters/lyfta/sync.js';
import { listCanonical, getGeneration } from '../../src/ingest/ledger.js';
import { makeRawStore } from '../../src/storage/drive-rawstore.js';
import { UnconfiguredRawStore } from '../../src/storage/rawstore.js';
import { sha256Hex } from '../../src/core/hash.js';
import { makePager } from '../fixtures/lyfta-synthetic.mjs';

export async function runSyncE2E(env, runId, { rawStore } = {}) {
  const results = []; const step = async (name, fn) => {
    const t0 = Date.now();
    try { const info = await fn(); results.push({ name, status: 'PASS', ms: Date.now() - t0, ...(info ? { info } : {}) }); }
    catch (e) { results.push({ name, status: 'FAIL', ms: Date.now() - t0, error: String(e?.code ?? e?.message ?? e).slice(0, 200) }); }
  };
  const eq = (a, b, w) => { if (a !== b) throw new Error(`${w}: atteso ${JSON.stringify(b)}, ottenuto ${JSON.stringify(a)}`); };
  const raw = rawStore ?? makeRawStore(env); if (raw instanceof UnconfiguredRawStore) throw new Error('credenziali Google mancanti nel Worker');
  const db = env.DB, subject = `d1t-${runId}-sync`;
  // Contenuto unico per run: il file su Drive è nuovo ogni volta (prova davvero la scrittura).
  const pager = makePager(30, 10, id => ({ ...(makePager(1).all[0]), id, title: `Sintetico ${runId} ${id}` }));
  const run = p => syncLyfta({ db, raw }, { subject, fetchPage: p, request_id: crypto.randomUUID(), captured_at: new Date().toISOString() });
  const p29 = async page => { const b = await pager(page); return { ...b, workouts: b.workouts.filter(w => w.id !== 1005), total_records: 29 }; };
  let ref, sha;

  await step('sync completo: 30 workout su D1, RAW su Drive', async () => {
    const g = await getGeneration(db); const r = await run(pager);
    eq(r.ok, true, 'ok'); eq(r.complete, true, 'complete'); eq(r.receipt.status, 'COMMITTED', 'status');
    eq((await listCanonical(db, subject, 'training')).length, 30, 'record canonici'); eq(await getGeneration(db), g + 1, 'generation');
    ref = r.receipt.artifact_ref; sha = r.receipt.artifact_sha256; if (typeof ref !== 'string' || !ref.includes('://')) throw new Error('ref mancante');
  });
  await step('RAW riletto da Drive: hash identico a quello registrato in D1', async () => {
    const bytes = await raw.get(ref); eq(await sha256Hex(bytes), sha, 'sha256'); return { bytes: bytes.byteLength };
  });
  await step('replay: nessuna nuova generation né nuovi file su Drive', async () => {
    const g = await getGeneration(db); const r = await run(pager);
    eq(r.ok, true, 'ok'); eq(r.receipt.replayed, true, 'replayed'); eq(r.receipt.artifact_ref, ref, 'stesso ref'); eq(await getGeneration(db), g, 'generation');
  });
  await step('workout rimosso a monte + sync completo = tombstone, RAW storico intatto', async () => {
    const r = await run(p29); eq(r.ok, true, 'ok'); eq(r.complete, true, 'complete'); eq(r.receipt.deleted, 1, 'cancellati');
    eq((await listCanonical(db, subject, 'training')).length, 29, 'record canonici');
    eq(await sha256Hex(await raw.get(ref)), sha, 'RAW storico ancora leggibile');
  });
  await step('sync incompleto (errore a pagina 2): scope non completo, nessuna cancellazione', async () => {
    const broken = async page => { if (page === 2) throw new Error('boom'); return p29(page); };
    const r = await run(broken); eq(r.complete, false, 'complete'); eq(r.receipt.deleted, 0, 'cancellati'); eq((await listCanonical(db, subject, 'training')).length, 29, 'record invariati');
  });
  // Scala realistica (come il tuo storico: 311 workout, ~2000 esercizi, ~6200 serie) per verificare i limiti del Worker (tempo di calcolo, memoria, richieste).
  await step('scala realistica: 311 workout / ~2000 esercizi / ~6200 serie', async () => {
    const big = id => ({ id, title: `Sintetico scala ${runId} ${id}`, body_weight: 72.5, workout_perform_date: '2026-10-15 16:12:00', total_volume: 1200, totalLiftedWeight: 1200, user: { id: 1, name: 'sintetico' },
      exercises: Array.from({ length: 6 + (id % 2) }, (_, e) => ({ exercise_id: String(100 + e), excercise_name: `Esercizio sintetico ${e}`, exercise_type: 'strength', exercise_image: 'https://example.test/' + 'x'.repeat(120), exercise_rest_time: 18,
        sets: Array.from({ length: 3 + (e % 2) }, (_, k) => ({ id: String(id * 100 + e * 10 + k), weight: '60', reps: '8', rir: '2', duration: null, distance: null, set_type_id: String(k % 3), is_completed: true, record_type: null, record_level: null, record_value: null })) })) });
    const bigPager = makePager(311, 100, id => big(id));
    const sbj = `d1t-${runId}-scale`; const t0 = Date.now();
    const r = await syncLyfta({ db, raw }, { subject: sbj, fetchPage: bigPager, request_id: crypto.randomUUID(), captured_at: new Date().toISOString() });
    eq(r.ok, true, 'ok'); eq(r.complete, true, 'complete'); eq((await listCanonical(db, sbj, 'training')).length, 311, 'record canonici');
    const again = await syncLyfta({ db, raw }, { subject: sbj, fetchPage: bigPager, request_id: crypto.randomUUID(), captured_at: new Date().toISOString() });
    eq(again.receipt.replayed, true, 'replay');
    return { ms_sync_e_replay: Date.now() - t0, bytes_raw: (await raw.get(r.receipt.artifact_ref)).byteLength };
  });
  return { ok: results.every(r => r.status === 'PASS'), results };
}
