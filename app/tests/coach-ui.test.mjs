import test from 'node:test';
import assert from 'node:assert/strict';
import { coachHeader, coachActions, coachInsights, coachTests } from '../public/coach.js';

const base = {
  as_of: '2026-11-06', summary: { attention: 1, ok: 2, insufficient: 1 }, disclaimer: 'Non consulenza medica.',
  targets: { using_defaults: false, version: { phase: 'massa', goal: 'Aumentare <massa>', valid_from: '2026-11-01' } },
  actions: [{ id: 'nutrition_logging', title: 'Completezza del diario', text: 'Registra <tutti> i pasti.' }],
  insights: [
    { id: 'nutrition_logging', title: 'Completezza del diario', status: 'attenzione', summary: 'Solo 5 giorni su 14.', evidence: ['Giorni: 5 su 14'], action: 'Registra i pasti.' },
    { id: 'sleep', title: 'Sonno', status: 'ok', summary: 'In linea.', evidence: [], action: null },
    { id: 'energy_balance', title: 'Fabbisogno', status: 'insufficiente', summary: 'Poco affidabile.', evidence: ['n=3'], action: null },
  ],
  tests: [{ id: 'rep_test', title: 'Test di forza', due: true, reason: 'Mai eseguito.', steps: ['Uno', 'Due <b>'] }, { id: 'measurements', title: 'Misure', due: false, reason: 'Prossimo tra 5 giorni.', steps: ['Misura'] }],
};

test('coach: intestazione con fase, oppure target generici; HTML escapato', () => {
  const h = coachHeader(base);
  assert.match(h, /Fase: massa/); assert.match(h, /Aumentare &lt;massa&gt;/); assert.match(h, /6 nov 2026|6 novembre 2026/); assert.ok(!h.includes('<massa>'));
  const g = coachHeader({ ...base, targets: { using_defaults: true, version: null } });
  assert.match(g, /Target generici/); assert.match(g, /valori generici/);
});

test('coach: azioni numerate, nessuna azione, revisione con stato e motivazioni', () => {
  const a = coachActions(base); assert.match(a, /<ol class="actions">/); assert.match(a, /Registra &lt;tutti&gt; i pasti/);
  assert.match(coachActions({ ...base, actions: [] }), /sei in linea/);
  const i = coachInsights(base);
  assert.match(i, /Da sistemare/); assert.match(i, /In linea/); assert.match(i, /Dati insufficienti/); assert.match(i, /Perché/); assert.match(i, /Cosa fare/);
  assert.equal((i.match(/<details class="wcard" open>/g) ?? []).length, 1); // si apre da solo solo ciò che va sistemato
  assert.ok(!/NaN|undefined|null/.test(i));
});

test('coach: test con stato "da fare" e istruzioni; disclaimer', () => {
  const t = coachTests(base);
  assert.match(t, /Da fare/); assert.match(t, /Non ancora/); assert.match(t, /Due &lt;b&gt;/); assert.match(t, /Non consulenza medica/);
  assert.equal((t.match(/<details class="wcard" open>/g) ?? []).length, 1);
});
