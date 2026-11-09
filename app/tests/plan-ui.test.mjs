import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtRest, rxLine, diffLines, historyList, planHeader, planScheda, planNotes, planPhases } from '../public/plan.js';
import { buildRequest, parseRest, errorText, rxForm, noteForm, phaseForm, closeForm, dayForm } from '../public/plan-forms.js';

const rx = (o = {}) => ({ day: '6.UPPER', exercise: 'Trazioni', sets: 4, reps_min: 6, reps_max: 10, rir: 2, rest_sec: 150, method: null, note: null, order: 0, ...o });
const view = { today: '2026-11-06', phases: [{ id: 1, status: 'closed', name: 'Mantenimento <b>', start_date: '2026-08-01', end_date: '2026-10-01', goal: 'Ricomposizione', has_report: true }, { id: 2, status: 'active', name: 'Massa 1', start_date: '2026-11-01', end_date: null, goal: 'Aumentare massa', method: 'Upper/Lower' }],
  active: { id: 2, name: 'Massa 1', goal: 'Aumentare massa', method: 'Upper/Lower', start_date: '2026-11-01', phase_version_id: 9, days: [{ key: 'day:2:6-upper', label: '6.UPPER', order: 6, focus: 'Dorso', version_id: 3, versions: 1, exercises: [{ key: 'rx:2:6-upper:trazioni', ...rx(), version_id: 4, versions: 2, pending: { valid_from: '2026-11-12', ...rx({ rest_sec: 180 }) } }] }] },
  notes: [{ note_id: 'n1', version_id: 7, category: 'malattia', title: 'Influenza <script>', text: 'Febbre', date: '2026-11-03', versions: 2 }] };

test('formattazione: recupero m:ss, riga della prescrizione', () => {
  assert.equal(fmtRest(150), '2:30'); assert.equal(fmtRest(180), '3:00'); assert.equal(fmtRest(null), '—');
  assert.equal(rxLine(rx()), '4 serie × 6–10 · RIR 2 · rec 2:30');
  assert.equal(rxLine(rx({ reps_min: 8, reps_max: 8, rir: 1.5, rest_sec: null, method: 'top set' })), '4 serie × 8 · RIR 1,5 · top set');
  assert.equal(rxLine(rx({ reps_min: null, reps_max: null, rir: null, rest_sec: null })), '4 serie');
});
test('differenze tra versioni: recupero 2:30 → 3:00, ripetizioni, rimozione, campi invariati ignorati', () => {
  assert.deepEqual(diffLines('rx', rx(), rx({ rest_sec: 180 })), ['recupero 2:30 → 3:00']);
  assert.deepEqual(diffLines('rx', rx(), rx({ rir: 1, reps_max: 12 })), ['ripetizioni 6–10 → 6–12', 'RIR 2 → 1']);
  assert.deepEqual(diffLines('rx', rx(), { removed: true }), ['rimosso']);
  assert.deepEqual(diffLines('rx', rx(), rx()), []);
});
test('storico: intervalli con fine inclusiva, motivo, versione iniziale, correzione stesso giorno', () => {
  const v = [{ valid_from: '2026-11-01', valid_to: '2026-11-12', data: rx(), reason: null }, { valid_from: '2026-11-12', valid_to: null, data: rx({ rest_sec: 180 }), reason: 'recupero <più> lungo' }];
  const h = historyList('rx', v);
  assert.match(h, /dal 1 nov 2026 al 11 nov 2026/); assert.match(h, /dal 12 nov 2026 · in vigore/); assert.match(h, /recupero 2:30 → 3:00/); assert.match(h, /Versione iniziale: 4 serie/); assert.match(h, /recupero &lt;più&gt; lungo/);
  assert.ok(h.indexOf('12 nov') < h.indexOf('1 nov')); // la più recente in alto
  assert.match(historyList('rx', [{ valid_from: '2026-11-05', valid_to: '2026-11-05', data: rx(), reason: null }]), /sostituita lo stesso giorno/);
  assert.match(historyList('rx', []), /Nessuna versione/);
});
test('viste: fase, scheda con modifica programmata, note, fasi passate; tutto escapato', () => {
  assert.match(planHeader(view), /Massa 1/); assert.match(planHeader(view), /data-act="phase-close"/);
  assert.match(planHeader({ ...view, active: null }), /Nessuna fase attiva/); assert.match(planHeader({ ...view, active: null }), /data-act="phase-new"/);
  const s = planScheda(view); assert.match(s, /6\.UPPER/); assert.match(s, /Trazioni/); assert.match(s, /rec 2:30/); assert.match(s, /dal 12 nov: recupero 2:30 → 3:00/); assert.match(s, /2 versioni/); assert.match(s, /data-act="rx-new" data-day="6.UPPER"/);
  assert.match(planScheda({ ...view, active: { ...view.active, days: [] } }), /Scheda vuota/);
  const n = planNotes(view); assert.match(n, /Influenza &lt;script&gt;/); assert.ok(!n.includes('<script>')); assert.match(n, /data-act="hist"/);
  assert.match(planNotes({ ...view, notes: [] }), /Nessuna nota/);
  const p = planPhases(view); assert.match(p, /Mantenimento &lt;b&gt;/); assert.match(p, /30 set 2026/); assert.match(p, /data-act="report"/); assert.equal(planPhases({ ...view, phases: [view.phases[1]] }), '');
});
test('moduli: campi, valori precompilati, niente HTML iniettato', () => {
  const e = { ...rx({ exercise: 'A"B' }), version_id: 4 };
  const f = rxForm({ mode: 'edit', day: '6.UPPER', e, today: '2026-11-06', phaseStart: '2026-11-01', phaseId: 2 });
  assert.match(f, /data-submit="rx-edit"/); assert.match(f, /data-version="4"/); assert.match(f, /data-phase-id="2"/); assert.match(f, /value="2:30"/); assert.match(f, /A&quot;B/); assert.match(f, /rx-remove/); assert.match(f, /name="valid_from" value="2026-11-06" min="2026-11-01"/);
  assert.ok(!rxForm({ mode: 'new', day: 'X', today: '2026-11-06', phaseStart: '2026-11-01', phaseId: 2 }).includes('rx-remove'));
  assert.match(noteForm({ today: '2026-11-06' }), /data-submit="note-new"/); assert.match(noteForm({ n: view.notes[0], today: '2026-11-06' }), /note-edit/);
  assert.match(phaseForm({ mode: 'new', today: '2026-11-06', closed: [view.phases[0]] }), /Parti dalla scheda di/); assert.ok(!phaseForm({ mode: 'new', today: '2026-11-06', closed: [] }).includes('copy_from'));
  assert.match(closeForm({ a: view.active, today: '2026-11-06' }), /Ultimo giorno/); assert.match(dayForm({ mode: 'new', today: '2026-11-06', phaseStart: '2026-11-01', phaseId: 2 }), /data-submit="day-new"/);
});
test('richieste: da valori del modulo a body API, recupero m:ss, rimozione, fase', () => {
  assert.equal(parseRest('2:30'), 150); assert.equal(parseRest(''), null); assert.ok(Number.isNaN(parseRest('2.5'))); assert.ok(Number.isNaN(parseRest('2:75')));
  const v = { exercise: 'Trazioni', sets: '4', reps_min: '6', reps_max: '10', rir: '1.5', rest: '3:00', method: '', note: '', valid_from: '2026-11-12', reason: 'più recupero' };
  const r = buildRequest('rx-edit', v, { phaseId: '2', day: '6.UPPER', version: '4' });
  assert.equal(r.path, '/v1/plan/version'); assert.deepEqual(r.body, { kind: 'rx', phase_id: 2, day: '6.UPPER', exercise: 'Trazioni', valid_from: '2026-11-12', expected_version_id: 4, reason: 'più recupero', data: { sets: 4, reps_min: 6, reps_max: 10, rir: 1.5, rest_sec: 180, method: null, note: null } });
  assert.deepEqual(buildRequest('rx-remove', v, { phaseId: '2', day: '6.UPPER', version: '4' }).body.data, { removed: true });
  assert.equal(buildRequest('rx-new', v, { phaseId: '2', day: 'A' }).body.expected_version_id, null);
  assert.throws(() => buildRequest('rx-new', { ...v, rest: 'tre' }, { phaseId: '2', day: 'A' }), /m:ss/);
  assert.deepEqual(buildRequest('note-edit', { date: '2026-11-03', category: 'malattia', title: 't', text: '' }, { version: '7', id: 'n1' }).body, { kind: 'note', expected_version_id: 7, note_id: 'n1', data: { date: '2026-11-03', category: 'malattia', title: 't', text: null } });
  assert.equal(buildRequest('phase-new', { name: 'P', goal: '', method: '', start_date: '2026-11-06', copy_from: '1' }, {}).body.copy_from, 1);
  assert.equal(buildRequest('phase-close', { last_day: '2026-11-05' }, { phase: '2' }).path, '/v1/plan/phase/close');
  assert.equal(buildRequest('phase-edit', { name: 'P2', goal: '', method: 'm', valid_from: '2026-11-06', reason: '' }, { phase: '2', version: '9' }).body.kind, 'phase');
});
test('errori: messaggi in italiano per i codici del server', () => {
  assert.match(errorText('stale'), /cambiato/); assert.match(errorText('invalid_rx'), /non validi/); assert.match(errorText('boh'), /Riprova/); assert.match(errorText('phase_closed'), /chiusa/);
});

import { reportView } from '../public/plan-report.js';
import { importForm } from '../public/plan-forms.js';
test('report di fase: sezioni, formattazione italiana, null come "—", testo escapato', () => {
  const r = { phase: { name: 'Massa <1>', goal: 'g', method: 'm' }, period: { start: '2026-10-05', last_day: '2026-11-04', weeks: 4.4 }, weight: { start_kg: 70.15, end_kg: 71.05, change_kg: 0.9, rate_pct_week: 0.31, note: null }, body_fat: { n: 2, start_pct: 22.4, end_pct: 21.8 },
    nutrition: { avg_kcal: 2200, avg_protein_g: 140, protein_g_per_kg: 1.98, complete_days: 3, calendar_days: 31, note: 'Meno di 10 giorni completi: medie poco affidabili.' }, sleep: { avg_min: 450, nights: 2 }, steps: { avg: 9000, days: 2 },
    training: { sessions_total: 8, sessions_strength: 4, strength_per_week: 0.9, avg_rest_sec: 183, avg_rir_logged: 1.7, rir_sets_with_value: 20, sets_per_muscle_week: { Petto: 3.6 }, progression: [{ exercise: 'Bench <x>', metric: 'e1rm_kg', first: 60, last: 66, pct: 10, sessions: 4, trend: 'progresso' }] },
    scheda: [{ label: 'A', exercises: [{ exercise: 'Bench', sets: 4, reps_min: 6, reps_max: 10, rir: 2, rest_sec: 195 }] }], scheda_changes: 3, notes: [{ date: '2026-10-20', category: 'malattia', title: 'Influenza' }] };
  const h = reportView(r);
  assert.match(h, /Massa &lt;1&gt;/); assert.match(h, /70,2 → 71,1 kg/); assert.match(h, /\+0,9 kg/); assert.match(h, /\+0,31 %\/sett\./); assert.match(h, /3 giorni completi su 31/); assert.match(h, /3:03/); assert.match(h, /7 h 30 min/);
  assert.match(h, /\+10%/); assert.match(h, /2\.200 kcal/); assert.match(h, /<strong>9\.000<\/strong>/); assert.match(h, /Bench &lt;x&gt;/); assert.match(h, /Bench: 4 serie × 6–10 · RIR 2 · rec 3:15/); assert.match(h, /poco affidabili/); assert.match(h, /Influenza/); assert.ok(!h.includes('<x>'));
  const empty = reportView({ ...r, weight: { start_kg: null, end_kg: null, change_kg: null, rate_pct_week: null, note: 'Nessuna pesata nella fase.' }, nutrition: { ...r.nutrition, avg_kcal: null }, training: { ...r.training, avg_rest_sec: null, avg_rir_logged: null, progression: [], sets_per_muscle_week: {} } });
  assert.match(empty, /— → — kg/); assert.match(empty, /ritmo non calcolabile/); assert.ok(!empty.includes('NaN')); assert.match(reportView(null), /Nessun report/);
});
test('importazione da Lyfta: modulo con caselle e richiesta con i soli titoli scelti', () => {
  const sug = { from: '2026-10-05', to: '2026-11-06', days: [{ title: 'A - Upper <1>', sessions: 4, last_date: '2026-10-30', exercises: [{ exercise: 'Bench' }, { exercise: 'Plank' }] }, { title: 'Una tantum', sessions: 1, last_date: '2026-10-15', exercises: [{ exercise: 'Curl' }] }] };
  const f = importForm({ sug, phase: { id: 2 } });
  assert.match(f, /name="t0" value="A - Upper &lt;1&gt;" checked/); assert.ok(!/name="t1"[^>]*checked/.test(f)); assert.match(f, /data-submit="import"/); assert.match(f, /import-refresh/); assert.match(importForm({ sug: { ...sug, days: [] }, phase: { id: 2 } }), /Nessun allenamento di forza/);
  assert.deepEqual(buildRequest('import', { from: '2026-10-05', to: '2026-11-06', t0: 'A - Upper <1>', t2: 'B' }, { phaseId: '2' }), { path: '/v1/plan/import-lyfta', body: { phase_id: 2, from: '2026-10-05', to: '2026-11-06', titles: ['A - Upper <1>', 'B'] } });
  assert.match(planScheda({ ...view, active: { ...view.active, days: [] } }), /data-act="import"/); assert.match(planScheda(view), /data-act="import"/);
});
