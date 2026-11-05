import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkout, absent, num } from '../src/adapters/lyfta/normalize.js';
import { syncLyfta, pullAllWorkouts } from '../src/adapters/lyfta/sync.js';
import { listCanonical, getGeneration } from '../src/ingest/ledger.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { newDb } from './helpers/d1-shim.mjs';
import { workout, makePager } from './fixtures/lyfta-synthetic.mjs';

const S = 'owner';
const rid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const deps = () => ({ db: newDb(), raw: new MemoryRawStore(), now: () => '2026-11-01T10:00:00.000Z' });
const run = (d, pager, n) => syncLyfta(d, { subject: S, fetchPage: pager, request_id: rid(n), captured_at: '2026-11-01T10:00:00Z' });

test('assenza: null, "null", "" e spazi normalizzati in modo deterministico', () => {
  for (const v of [null, undefined, '', 'null', ' NULL ']) assert.equal(absent(v), true);
  assert.equal(num('null'), null); assert.equal(num('5'), 5); assert.equal(num('7,5'), 7.5); assert.equal(num(0), 0);
});

test('bodyweight: il carico resta zavorra esterna, il peso corporeo è un campo separato e non viene sommato', () => {
  const r = normalizeWorkout(workout(1));
  const sets = r.payload.exercises[0].sets;
  assert.equal(sets[0].external_load_kg, 0); assert.equal(sets[2].external_load_kg, 5);
  assert.equal(r.payload.user_body_weight_kg, 72.5);
  assert.ok(sets.every(s => s.external_load_kg == null || s.external_load_kg <= 5));
});

test('set type, riposo configurato ×5, set id 0 non usato come chiave, nessun campo inventato', () => {
  const p = normalizeWorkout(workout(1)).payload;
  assert.deepEqual(p.exercises[0].sets.map(s => s.set_type), ['NORMAL', 'WARMUP', 'TOP']);
  assert.equal(p.exercises[0].sets[1].warmup, true);
  assert.equal(p.exercises[0].configured_rest_sec, 90); assert.equal(p.exercises[1].configured_rest_sec, null);
  assert.equal(p.exercises[0].sets[1].native_set_id, null); // id=0
  assert.equal(new Set(p.exercises.flatMap(e => e.sets.map(s => s.key))).size, 4); // chiavi posizionali uniche
  assert.equal(p.exercises[0].sets[1].rir, null); assert.equal(p.exercises[0].sets[1].reps, null);
  assert.equal('superset_id' in p.exercises[0], false); // non restituito dalla REST: non inventato
  assert.equal(normalizeWorkout(workout(2, { exercises: [{ exercise_id: 1, sets: [{ id: 5, set_type_id: 99 }] }] })).payload.exercises[0].sets[0].set_type, 'UNKNOWN_99');
});

test('tempo: UTC senza offset -> istante UTC e data locale Europe/Rome', () => {
  const p = normalizeWorkout(workout(1, { workout_perform_date: '2026-10-15 16:12:00' })).payload;
  assert.equal(p.start_at, '2026-10-15T16:12:00.000Z'); assert.equal(p.local_date, '2026-10-15');
  const late = normalizeWorkout(workout(1, { workout_perform_date: '2026-10-25 22:30:00' })).payload; // 00:30 CET del giorno dopo
  assert.equal(late.local_date, '2026-10-25'); // 22:30Z dopo il cambio ora (UTC+1) = 23:30 locale, stesso giorno
  assert.equal(normalizeWorkout(workout(1, { workout_perform_date: '2026-10-25 23:30:00' })).payload.local_date, '2026-10-26');
  assert.equal(normalizeWorkout(workout(1, { workout_perform_date: 'boh' })).payload.start_at, null);
  assert.throws(() => normalizeWorkout({ title: 'senza id' }), /without_id/);
});

test('sync completo (15 pagine come il contratto reale): scope completo calcolato dal server, replay NO-OP', async () => {
  const d = deps(); const pager = makePager(296, 20);
  const a = await run(d, pager, 1);
  assert.equal(a.ok, true); assert.equal(a.complete, true); assert.equal(a.receipt.modified, 296);
  assert.equal((await listCanonical(d.db, S, 'training')).length, 296);
  const b = await run(d, pager, 2);
  assert.equal(b.receipt.replayed, true); assert.equal(await getGeneration(d.db), 1);
});

test('modifica a monte = nuova revisione; cancellazione a monte = tombstone SOLO con scope completo', async () => {
  const d = deps(); const pager = makePager(40, 20); await run(d, pager, 1);
  const edited = makePager(40, 20, id => workout(id, id === 1005 ? { title: 'Modificato' } : {}));
  const r = await run(d, edited, 2); assert.equal(r.receipt.modified, 1);
  const fewer = makePager(39, 20, id => workout(id, id === 1005 ? { title: 'Modificato' } : {})); // sparisce l'ultimo (1039)? ids 1000..1038
  const r3 = await run(d, fewer, 3); assert.equal(r3.receipt.deleted, 1);
  assert.equal((await listCanonical(d.db, S, 'training')).length, 39);
});

test('sync parziale o con errore NON cancella nulla', async () => {
  const d = deps(); await run(d, makePager(40, 20), 1);
  const broken = async page => { if (page === 2) throw new Error('429'); return makePager(40, 20)(page); };
  const r = await run(d, broken, 2);
  assert.equal(r.complete, false); assert.equal(r.receipt.deleted, 0);
  assert.equal((await listCanonical(d.db, S, 'training')).length, 40);
  const empty = async () => { throw new Error('401'); };
  assert.deepEqual(await run(d, empty, 3), { ok: false, reason: 'fetch_error' }); // vuoto da errore != snapshot vuoto autorevole
  assert.equal((await listCanonical(d.db, S, 'training')).length, 40);
});

test('integrità paginazione: totale dichiarato non coerente => incompleto', async () => {
  const pager = makePager(30, 20); const lying = async p => ({ ...(await pager(p)), total_records: 31 });
  const r = await pullAllWorkouts(lying); assert.equal(r.complete, false); assert.equal(r.reason, 'count_mismatch');
  const nopag = async () => ({ workouts: [workout(1)] }); assert.equal((await pullAllWorkouts(nopag)).reason, 'pagination_unknown');
});

test('volume: legge total_volume (campo reale), con fallback a volume', () => {
  assert.equal(normalizeWorkout(workout(1, { volume: undefined, total_volume: 4321 })).payload.source_volume, 4321);
  assert.equal(normalizeWorkout(workout(2)).payload.source_volume, 1200);
});
