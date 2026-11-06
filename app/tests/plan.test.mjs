import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { newDb } from './helpers/d1-shim.mjs';

const NOW = new Date('2026-11-06T12:00:00Z'), S = 'owner';
const mk = (db, { principal = 'owner', now = NOW, jobs = {} } = {}) => createApp({ db, auth: { authenticate: async () => ({ subject: S, principal }) }, jobs, now: () => now });
const call = (app, path, body, { method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) => app(new Request(`https://app.test${path}`, { method, headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
const ok = async (app, path, body) => { const r = await call(app, path, body); const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); return j; };
const fail = async (app, path, body, status, code) => { const r = await call(app, path, body); const j = await r.json(); assert.equal(r.status, status, JSON.stringify(j)); if (code) assert.equal(j.error, code); };
async function setup() {
  const db = newDb(), app = mk(db);
  const { phase_id } = await ok(app, '/v1/plan/phase/start', { name: 'Massa 1', goal: 'Aumentare massa', method: 'Upper/Lower', start_date: '2026-11-01' });
  await ok(app, '/v1/plan/version', { kind: 'day', phase_id, day: '6.UPPER', data: { order: 6 } });
  const rx = { sets: 4, reps_min: 6, reps_max: 10, rir: 2, rest_sec: 150, method: 'top set + back-off' };
  const first = await ok(app, '/v1/plan/version', { kind: 'rx', phase_id, day: '6.UPPER', exercise: 'Trazioni', data: rx, valid_from: '2026-11-01' });
  return { db, app, phase_id, rx, first };
}

test('fase + giorno + esercizio: la scheda in vigore compare in GET /v1/plan', async () => {
  const { app, phase_id } = await setup();
  const v = await ok(app, '/v1/plan'); assert.equal(v.active.id, phase_id); assert.equal(v.active.name, 'Massa 1');
  const day = v.active.days[0]; assert.equal(day.label, '6.UPPER'); assert.equal(day.exercises.length, 1);
  assert.equal(day.exercises[0].exercise, 'Trazioni'); assert.equal(day.exercises[0].rest_sec, 150); assert.equal(day.exercises[0].rir, 2);
});
test('recupero 2:30 → 3:00 dal 12 nov: la scheda attuale resta 150 fino a quel giorno, lo storico conserva entrambe', async () => {
  const { db, app, phase_id, rx, first } = await setup(); globalThis.__db = db;
  const key = first.entity_key, vid = first.version.id;
  await ok(app, '/v1/plan/version', { kind: 'rx', phase_id, day: '6.UPPER', exercise: 'Trazioni', expected_version_id: vid, valid_from: '2026-11-12', data: { ...rx, rest_sec: 180 }, reason: 'recupero più lungo' });
  const h = (await ok(app, `/v1/plan/history?entity=${encodeURIComponent(key)}`)).versions;
  assert.equal(h.length, 2); assert.deepEqual([h[0].valid_from, h[0].valid_to, h[0].data.rest_sec], ['2026-11-01', '2026-11-12', 150]); assert.deepEqual([h[1].valid_from, h[1].valid_to, h[1].data.rest_sec], ['2026-11-12', null, 180]);
  assert.equal(h[1].reason, 'recupero più lungo');
  const before = (await ok(app, '/v1/plan')).active.days[0].exercises[0]; assert.equal(before.rest_sec, 150); assert.equal(before.pending.rest_sec, 180); assert.equal(before.pending.valid_from, '2026-11-12');
  const later = await (await call(mk(globalThis.__db, { now: new Date('2026-11-13T12:00:00Z') }), '/v1/plan')).json();
  assert.equal(later.active.days[0].exercises[0].rest_sec, 180); assert.equal(later.active.days[0].exercises[0].pending, null);
});
test('RIR e altri campi seguono lo stesso principio (nuova versione, nessuna sovrascrittura)', async () => {
  const { db, app, phase_id, rx, first } = await setup();
  globalThis.__db = db;
  await ok(app, '/v1/plan/version', { kind: 'rx', phase_id, day: '6.UPPER', exercise: 'Trazioni', expected_version_id: first.version.id, valid_from: '2026-11-08', data: { ...rx, rir: 1.5 } });
  const rows = (await db.prepare("SELECT valid_from, valid_to, data_json FROM plan_versions WHERE kind = 'rx' ORDER BY id").all()).results;
  assert.equal(rows.length, 2); assert.equal(JSON.parse(rows[0].data_json).rir, 2); assert.equal(JSON.parse(rows[1].data_json).rir, 1.5); assert.equal(rows[0].valid_to, '2026-11-08');
});
test('concorrenza e coerenza: stale, esiste già, nessuna modifica, data non successiva', async () => {
  const { app, phase_id, rx, first } = await setup(); const base = { kind: 'rx', phase_id, day: '6.UPPER', exercise: 'Trazioni' };
  await fail(app, '/v1/plan/version', { ...base, data: rx }, 409, 'exists');
  await fail(app, '/v1/plan/version', { ...base, expected_version_id: first.version.id + 99, valid_from: '2026-11-08', data: { ...rx, rest_sec: 200 } }, 409, 'stale');
  await fail(app, '/v1/plan/version', { ...base, expected_version_id: first.version.id, valid_from: '2026-11-08', data: rx }, 422, 'no_change');
  const up = await ok(app, '/v1/plan/version', { ...base, expected_version_id: first.version.id, valid_from: '2026-11-08', data: { ...rx, rest_sec: 200 } });
  await fail(app, '/v1/plan/version', { ...base, expected_version_id: up.version.id, valid_from: '2026-11-05', data: { ...rx, rest_sec: 210 } }, 422, 'valid_from_before_previous');
  await ok(app, '/v1/plan/version', { ...base, expected_version_id: up.version.id, valid_from: '2026-11-08', data: { ...rx, rest_sec: 210 }, reason: 'correzione stesso giorno' });
  await fail(app, '/v1/plan/version', { ...base, expected_version_id: first.version.id, valid_from: '2027-03-01', data: { ...rx, rest_sec: 200 } }, 422, 'invalid_valid_from');
  await fail(app, '/v1/plan/version', { ...base, expected_version_id: first.version.id, valid_from: '2026-10-01', data: { ...rx, rest_sec: 200 } }, 422, 'before_phase_start');
});
test('scrittura concorrente a metà: la versione chiusa da un altro writer blocca la modifica senza lasciare nulla', async () => {
  const { db, app, phase_id, rx, first } = await setup();
  db.beforeBatch = async () => { db.beforeBatch = null; await db.prepare('UPDATE plan_versions SET valid_to = ? WHERE id = ?').bind('2026-11-03', first.version.id).run(); };
  await fail(app, '/v1/plan/version', { kind: 'rx', phase_id, day: '6.UPPER', exercise: 'Trazioni', expected_version_id: first.version.id, valid_from: '2026-11-08', data: { ...rx, rest_sec: 200 } }, 409, 'stale');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM plan_versions WHERE kind = 'rx'").first()).n, 1);
});
test('rimozione = nuova versione con removed; ripristino possibile; lo storico resta', async () => {
  const { app, phase_id, rx, first } = await setup(); const base = { kind: 'rx', phase_id, day: '6.UPPER', exercise: 'Trazioni' };
  const rem = await ok(app, '/v1/plan/version', { ...base, expected_version_id: first.version.id, valid_from: '2026-11-05', data: { removed: true } });
  assert.equal((await ok(app, '/v1/plan')).active.days[0].exercises.length, 0);
  await ok(app, '/v1/plan/version', { ...base, expected_version_id: rem.version.id, valid_from: '2026-11-06', data: rx });
  assert.equal((await ok(app, '/v1/plan')).active.days[0].exercises.length, 1);
  assert.equal((await ok(app, `/v1/plan/history?entity=${encodeURIComponent(first.entity_key)}`)).versions.length, 3);
});
test('cambio fase: chiusura congela, copia della scheda finale, una sola fase attiva', async () => {
  const { db, app, phase_id, rx, first } = await setup();
  await ok(app, '/v1/plan/version', { kind: 'rx', phase_id, day: '6.UPPER', exercise: 'Trazioni', expected_version_id: first.version.id, valid_from: '2026-11-04', data: { ...rx, rest_sec: 180 } });
  await fail(app, '/v1/plan/phase/start', { name: 'x', start_date: '2026-11-06' }, 409, 'active_phase_exists');
  await fail(app, '/v1/plan/phase/close', { phase_id, last_day: '2026-12-01' }, 422, 'invalid_last_day');
  const c = await ok(app, '/v1/plan/phase/close', { phase_id, last_day: '2026-11-05' }); assert.equal(c.end_date, '2026-11-06');
  await fail(app, '/v1/plan/version', { kind: 'rx', phase_id, day: '6.UPPER', exercise: 'Trazioni', expected_version_id: first.version.id, valid_from: '2026-11-05', data: { ...rx, rest_sec: 90 } }, 409, 'phase_closed');
  await fail(app, '/v1/plan/phase/close', { phase_id, last_day: '2026-11-05' }, 409, 'phase_closed');
  await fail(app, '/v1/plan/phase/start', { name: 'Definizione', start_date: '2026-11-05' }, 422, 'overlaps_previous_phase');
  const { phase_id: p2 } = await ok(app, '/v1/plan/phase/start', { name: 'Definizione', goal: 'Ridurre il grasso', method: 'Full body', start_date: '2026-11-06', copy_from: phase_id });
  const v = await ok(app, '/v1/plan'); assert.equal(v.phases.length, 2); assert.equal(v.active.id, p2); assert.equal(v.active.days[0].exercises[0].rest_sec, 180); // stato finale copiato
  const old = (await db.prepare('SELECT valid_to FROM plan_versions WHERE phase_id = ? AND kind = ? ORDER BY id DESC').bind(phase_id, 'rx').first()); assert.equal(old.valid_to, '2026-11-06');
  assert.equal(v.phases.find(p => p.id === phase_id).status, 'closed'); assert.equal(v.phases.find(p => p.id === phase_id).name, 'Massa 1'); // la fase vecchia conserva nome e storico
  assert.equal((await ok(app, `/v1/plan/history?phase_id=${phase_id}`)).versions.length >= 3, true);
});
test('report di fase: salvato alla chiusura e mai ricalcolato', async () => {
  const db = newDb(); let calls = 0;
  const app = mk(db, { jobs: { phaseReport: async (_d, _s, phase, lastDay) => { calls++; return { phase: phase.id, last_day: lastDay, weight: { start: 70 } }; } } });
  const { phase_id } = await ok(app, '/v1/plan/phase/start', { name: 'P', start_date: '2026-11-01' });
  await ok(app, '/v1/plan/phase/close', { phase_id, last_day: '2026-11-05' });
  const r = await ok(app, `/v1/plan/report?phase_id=${phase_id}`); assert.equal(r.report.weight.start, 70); await ok(app, `/v1/plan/report?phase_id=${phase_id}`); assert.equal(calls, 1);
});
test('note: creazione, modifica con storico, cancellazione logica, collegamento alla fase', async () => {
  const { app, phase_id } = await setup();
  const n = await ok(app, '/v1/plan/version', { kind: 'note', data: { date: '2026-11-03', category: 'malattia', title: 'Influenza', text: 'Febbre due giorni' } });
  const id = n.entity_key.slice(5);
  await ok(app, '/v1/plan/version', { kind: 'note', note_id: id, expected_version_id: n.version.id, valid_from: '2026-11-06', data: { date: '2026-11-03', category: 'malattia', title: 'Influenza', text: 'Febbre tre giorni' } });
  let v = await ok(app, '/v1/plan'); assert.equal(v.notes.length, 1); assert.equal(v.notes[0].text, 'Febbre tre giorni'); assert.equal(v.notes[0].versions, 2); assert.equal(v.notes[0].phase_id, phase_id);
  const cur = v.notes[0].version_id;
  await ok(app, '/v1/plan/version', { kind: 'note', note_id: id, expected_version_id: cur, valid_from: '2026-11-07', data: { removed: true } });
  assert.equal((await ok(app, '/v1/plan')).notes.length, 0);
  assert.equal((await ok(app, `/v1/plan/history?entity=note:${id}`)).versions.length, 3);
});
test('sicurezza: il token del telefono non scrive né legge; JSON obbligatorio; Origin esterno rifiutato; campi sconosciuti e valori fuori range', async () => {
  const db = newDb();
  const dev = mk(db, { principal: 'device' }); assert.equal((await call(dev, '/v1/plan')).status, 403); assert.equal((await call(dev, '/v1/plan/phase/start', { name: 'x', start_date: '2026-11-01' })).status, 403);
  const app = mk(db);
  assert.equal((await app(new Request('https://app.test/v1/plan/phase/start', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }))).status, 415);
  assert.equal((await call(app, '/v1/plan/phase/start', { name: 'x', start_date: '2026-11-01' }, { headers: { origin: 'https://evil.test' } })).status, 403);
  assert.equal((await app(new Request('https://app.test/v1/plan/phase/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{no' }))).status, 400);
  assert.equal((await call(app, '/v1/plan', {}, { method: 'DELETE' })).status, 405);
  const { phase_id } = await ok(app, '/v1/plan/phase/start', { name: 'P', start_date: '2026-11-01' });
  await ok(app, '/v1/plan/version', { kind: 'day', phase_id, day: 'A', data: {} });
  const rx = d => ({ kind: 'rx', phase_id, day: 'A', exercise: 'Squat', data: { sets: 3, ...d } });
  for (const d of [{ rir: 2.25 }, { rir: 7 }, { rest_sec: 901 }, { reps_min: 10, reps_max: 5 }, { sets: 0 }, { extra: 1 }, { reps_min: 1.5 }]) await fail(app, '/v1/plan/version', rx(d), 422);
  await fail(app, '/v1/plan/version', { kind: 'rx', phase_id, day: 'A', exercise: 'Squat', data: { rir: 2 } }, 422); // sets obbligatorio
  await fail(app, '/v1/plan/version', { kind: 'rx', phase_id, day: 'Z', exercise: 'Squat', data: { sets: 3 } }, 422, 'day_not_found');
  await fail(app, '/v1/plan/version', { kind: 'note', data: { date: '2026-02-30', category: 'altro', title: 't' } }, 422, 'invalid_note');
  await fail(app, '/v1/plan/version', { kind: 'note', data: { date: '2026-11-01', category: 'boh', title: 't' } }, 422, 'invalid_note');
  await fail(app, '/v1/plan/version', { kind: 'note', data: { date: '2026-11-01', category: 'altro', title: 't', text: 'x'.repeat(5001) } }, 422, 'invalid_note');
  await fail(app, '/v1/plan/version', { kind: 'phase', phase_id, data: { removed: true } }, 422);
});
