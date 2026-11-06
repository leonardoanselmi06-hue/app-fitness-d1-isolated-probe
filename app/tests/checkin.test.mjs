import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { recoveryIndex, validateCheckin, checkinAverages } from '../src/checkin/store.js';
import { sleepRegularity } from '../src/analytics/sleep-regularity.js';
import { recoveryInsight } from '../src/coach/rules-recovery.js';
import { addDays } from '../src/coach/stats.js';
import { checkinForm, checkinSummary, checkinList, buildCheckinRequest, errorText } from '../public/checkin.js';
import { sleepSummary } from '../public/views-daily.js';
import { newDb } from './helpers/d1-shim.mjs';

const NOW = new Date('2026-11-06T12:00:00Z'), TODAY = '2026-11-06';
const mk = (db, principal = 'owner') => createApp({ db, auth: { authenticate: async () => ({ subject: 'owner', principal }) }, jobs: {}, now: () => NOW });
const call = async (app, path, body, headers = { 'content-type': 'application/json' }) => { const r = await app(new Request(`https://app.test${path}`, { method: body ? 'POST' : 'GET', headers: body ? headers : {}, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, json: await r.json() }; };
const ci = (o = {}) => ({ sleep_quality: 4, readiness: 4, fatigue: 2, soreness: 2, stress: 2, ...o });

test('indice di recupero: 0–100, stanchezza/indolenzimento/stress invertiti, servono 3 valori', () => {
  assert.equal(recoveryIndex(ci({ sleep_quality: 5, readiness: 5, fatigue: 1, soreness: 1, stress: 1 })), 100);
  assert.equal(recoveryIndex(ci({ sleep_quality: 1, readiness: 1, fatigue: 5, soreness: 5, stress: 5 })), 0);
  assert.equal(recoveryIndex({ sleep_quality: 3, readiness: 3, fatigue: 3, soreness: null, stress: null }), 50);
  assert.equal(recoveryIndex({ sleep_quality: 3, readiness: 3, fatigue: null, soreness: null, stress: null }), null);
});
test('validazione: 1..5 interi o null, almeno un valore, campi sconosciuti rifiutati', () => {
  assert.deepEqual(validateCheckin({ day: TODAY, fatigue: 3 }), { sleep_quality: null, readiness: null, fatigue: 3, soreness: null, stress: null });
  for (const bad of [{}, { fatigue: 0 }, { fatigue: 6 }, { fatigue: 2.5 }, { fatigue: '3' }, { fatigue: 3, mood: 1 }]) assert.throws(() => validateCheckin(bad));
});
test('API: salva, correzione = nuova versione (vale l\'ultima), nessuna modifica rifiutata, limiti di data', async () => {
  const db = newDb(), app = mk(db);
  assert.deepEqual((await call(app, '/v1/checkin')).json.entries, []);
  const a = await call(app, '/v1/checkin', ci()); assert.equal(a.status, 200); assert.equal(a.json.day, TODAY); assert.equal(a.json.index, 75);
  assert.equal((await call(app, '/v1/checkin', ci())).json.error, 'no_change');
  assert.equal((await call(app, '/v1/checkin', ci({ fatigue: 4 }))).status, 200);
  const g = (await call(app, '/v1/checkin')).json; assert.equal(g.entries.length, 1); assert.equal(g.entries[0].fatigue, 4); assert.equal(g.entries[0].versions, 2); assert.equal(g.today_entry.day, TODAY);
  assert.equal((await call(app, '/v1/checkin', ci({ day: '2026-10-25' }))).status, 200); // 12 giorni fa
  assert.equal((await call(app, '/v1/checkin', ci({ day: '2026-10-20' }))).json.error, 'invalid_day'); // 17 giorni fa
  assert.equal((await call(app, '/v1/checkin', ci({ day: '2026-11-07' }))).json.error, 'invalid_day'); // futuro
  assert.equal((await call(app, '/v1/checkin', ci({ day: '2026-02-30' }))).json.error, 'invalid_day');
  assert.equal((await call(app, '/v1/checkin', { day: TODAY })).json.error, 'empty_checkin');
  assert.equal((await call(app, '/v1/checkin', { ...ci(), extra: 1 })).json.error, 'invalid_checkin');
  const { results } = await db.prepare('SELECT COUNT(*) AS n FROM checkin_versions').all(); assert.equal(results[0].n, 3); // lo storico resta
});
test('API: solo proprietario, solo JSON, Origin coerente; il telefono non può scrivere né leggere', async () => {
  const db = newDb(), app = mk(db);
  assert.equal((await call(app, '/v1/checkin', ci(), { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await call(app, '/v1/checkin', ci(), { 'content-type': 'application/json', origin: 'https://evil.test' })).status, 403);
  assert.equal((await call(app, '/v1/checkin', ci(), { 'content-type': 'application/json', origin: 'https://app.test' })).status, 200);
  const r = await app(new Request('https://app.test/v1/checkin', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })); assert.equal(r.status, 405);
  const phone = mk(db, 'device'); assert.equal((await call(phone, '/v1/checkin', ci())).status, 403); assert.equal((await call(phone, '/v1/checkin')).status, 403);
  const big = await app(new Request('https://app.test/v1/checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(3000) }) })); assert.equal(big.status, 413);
});
test('medie: ultimi 7 e 7 precedenti, null con meno di 3 check-in', () => {
  const list = Array.from({ length: 14 }, (_, i) => { const d = ci({ fatigue: i < 7 ? 4 : 2 }); return { day: addDays(TODAY, -(13 - i)), ...d, index: recoveryIndex(d) }; });
  const { last7, prev7 } = checkinAverages(list, TODAY); assert.equal(last7.n, 7); assert.equal(last7.fatigue, 2); assert.equal(prev7.fatigue, 4); assert.ok(last7.index > prev7.index);
  assert.equal(checkinAverages(list.slice(-2), TODAY).last7.index, null);
});

const night = (bed, wake, o = {}) => ({ start_local: bed, end_local: wake, short: false, ...o });
test('regolarità del sonno: letto oltre la mezzanotte senza spezzare, soglie, minimo 7 notti, notti brevi escluse', () => {
  const reg = Array.from({ length: 10 }, (_, i) => night(['23:30', '23:45', '00:10', '23:50'][i % 4], ['07:00', '07:10', '06:55', '07:05'][i % 4]));
  const r = sleepRegularity(reg); assert.equal(r.label, 'regolare'); assert.ok(r.bed_sd_min < 20); assert.match(r.bed_mean, /^23:|^00:/);
  const irr = sleepRegularity(Array.from({ length: 10 }, (_, i) => night(i % 2 ? '22:00' : '01:30', i % 2 ? '06:00' : '10:00'))); assert.equal(irr.label, 'irregolare');
  const mod = sleepRegularity(Array.from({ length: 10 }, (_, i) => night(i % 2 ? '22:45' : '00:45', '07:00'))); assert.equal(mod.label, 'moderata');
  assert.equal(sleepRegularity(reg.slice(0, 6)).label, null); assert.equal(sleepRegularity(reg.slice(0, 6)).n, 6);
  assert.equal(sleepRegularity([...reg.slice(0, 6), night('03:00', '04:00', { short: true })]).n, 6);
  assert.equal(sleepRegularity([]).bed_sd_min, null);
});

const entries = (n, o = {}, from = 0) => Array.from({ length: n }, (_, i) => { const d = ci(o); return { day: addDays(TODAY, -(i + from)), ...d, index: recoveryIndex(d) }; });
const prog = overall => ({ data: { overall } });
test('insight recupero: senza check-in dichiara e non attribuisce; nessuna azione (non insistere)', () => {
  const i = recoveryInsight(entries(2), TODAY, { progression: prog('declining') });
  assert.equal(i.status, 'insufficiente'); assert.equal(i.action, null); assert.match(i.evidence.join(' '), /non lo attribuisco alla stanchezza/);
  assert.equal(recoveryInsight([], TODAY).evidence.length, 1);
});
test('insight recupero: ok, segnali (stanchezza alta, prontezza bassa, calo dell\'indice, orari irregolari), collegamento alla progressione', () => {
  assert.equal(recoveryInsight(entries(10), TODAY).status, 'ok');
  const tired = recoveryInsight(entries(10, { fatigue: 5 }), TODAY); assert.equal(tired.status, 'attenzione'); assert.match(tired.summary, /stanchezza alta/); assert.ok(tired.action);
  assert.match(recoveryInsight(entries(10, { readiness: 2 }), TODAY).summary, /prontezza bassa/);
  const drop = recoveryInsight([...entries(7), ...entries(7, { sleep_quality: 2, readiness: 3, fatigue: 3, soreness: 3, stress: 3 }, 7)].sort((a, b) => (a.day < b.day ? -1 : 1)).map((e, _, all) => e), TODAY);
  assert.equal(drop.status, 'ok'); // il peggioramento è nei 7 giorni PRECEDENTI: ora va meglio
  const worse = recoveryInsight([...entries(7, { sleep_quality: 2, readiness: 3, fatigue: 3, soreness: 3, stress: 3 }), ...entries(7, {}, 7)], TODAY); assert.match(worse.summary, /indice in calo/);
  const irr = recoveryInsight(entries(8), TODAY, { sleep: { regularity: { n: 10, label: 'irregolare', bed_mean: '00:10', bed_sd_min: 90, wake_mean: '08:00', wake_sd_min: 70 } } }); assert.match(irr.summary, /orari del sonno irregolari/);
  assert.match(recoveryInsight(entries(10), TODAY, { progression: prog('stalling') }).evidence.join(' '), /non lo spiega/);
  assert.match(recoveryInsight(entries(10, { fatigue: 4, readiness: 2, sleep_quality: 2, stress: 4, soreness: 4 }), TODAY, { progression: prog('declining') }).evidence.join(' '), /compatibile, non dimostrato/);
});

test('coach review: include recupero (dai check-in salvati) e regolarità; senza check-in non genera azioni', async () => {
  const db = newDb(), app = mk(db);
  const r0 = (await call(app, '/v1/coach/review')).json; const rec0 = r0.insights.find(i => i.id === 'recovery'); assert.equal(rec0.status, 'insufficiente'); assert.ok(!r0.actions.some(a => a.id === 'recovery'));
  for (let k = 0; k < 6; k++) await call(app, '/v1/checkin', ci({ day: addDays(TODAY, -k), fatigue: 5 }));
  const rec = (await call(app, '/v1/coach/review')).json.insights.find(i => i.id === 'recovery'); assert.equal(rec.status, 'attenzione'); assert.equal(rec.data.entries, 6);
});

test('PWA: form (valori preselezionati, limiti data), riepilogo, elenco, richiesta, errori', () => {
  const d = { today: TODAY, window_days: 30, today_entry: { day: TODAY, ...ci(), versions: 1 }, last7: { n: 5, index: 70, sleep_quality: 4, readiness: 3.5, fatigue: 2, soreness: 2.4, stress: 2 }, prev7: { n: 4, index: 60, sleep_quality: 3, readiness: null, fatigue: 3, soreness: 3, stress: 3 }, entries: [{ day: TODAY, ...ci(), index: 75, versions: 2 }, { day: '2026-11-05', sleep_quality: null, readiness: 3, fatigue: null, soreness: null, stress: 4, index: null, versions: 1 }] };
  const f = checkinForm(d); assert.match(f, /min="2026-10-23" max="2026-11-06"/); assert.match(f, /name="fatigue" value="2" checked/); assert.match(f, /Aggiorna il check-in di oggi/);
  assert.match(checkinForm({ ...d, today_entry: null }), /Salva il check-in/);
  const s = checkinSummary(d); assert.match(s, /70\/100/); assert.match(s, /\+10 rispetto ai 7 giorni prima/); assert.match(s, /2,4\/5/);
  assert.match(checkinSummary({ ...d, last7: { ...d.last7, n: 2 } }), /ne ho 2/);
  const l = checkinList(d); assert.match(l, /2 versioni/); assert.match(l, /Sonno — · Prontezza 3/); assert.match(checkinList({ entries: [] }), /Nessun check-in/);
  const vals = { day: TODAY, fatigue: '3', readiness: '' }; const body = buildCheckinRequest(k => vals[k] ?? null);
  assert.deepEqual(body, { day: TODAY, sleep_quality: null, readiness: null, fatigue: 3, soreness: null, stress: null });
  assert.match(errorText('no_change'), /Nessuna modifica/); assert.match(errorText('boh'), /Riprova/);
});
test('PWA: regolarità nel riepilogo del sonno', () => {
  const d = { count: 10, short_count: 0, avg_min_7: 420, n_7: 7, delta_min_7: null, avg_min_window: 420, longest: { date: TODAY, duration_min: 480 }, shortest: { date: TODAY, duration_min: 360 }, stages_7: null, regularity: { n: 10, label: 'regolare', bed_mean: '23:40', bed_sd_min: 20, wake_mean: '07:05', wake_sd_min: 10 } };
  assert.match(sleepSummary(d), /Regolarità orari.*regolare/s); assert.match(sleepSummary(d), /letto 23:40 ±20 min/);
  assert.match(sleepSummary({ ...d, regularity: { n: 4, label: null } }), /servono almeno 7 notti \(ne ho 4\)/);
  assert.ok(!sleepSummary({ ...d, regularity: undefined }).includes('Regolarità'));
});
