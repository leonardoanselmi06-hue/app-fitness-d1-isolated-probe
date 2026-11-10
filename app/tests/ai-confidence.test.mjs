import test from 'node:test';
import assert from 'node:assert/strict';
import { lowConfidenceAreas, applyConfidenceCaps } from '../src/ai/confidence.js';
import { generateAdvice } from '../src/ai/advice.js';
import { aiConfig } from '../src/ai/provider.js';
import { newDb } from './helpers/d1-shim.mjs';

const ins = (id, status, extra = {}) => ({ id, status, ...extra });
const dossier = insights => ({ coach: { insights } });
const advice = (...ps) => ({ priorities: ps.map(([area, confidence]) => ({ area, confidence })) });

test('area senza insight analitico con dati: tetto "bassa"', () => {
  const d = dossier([ins('weight_trend', 'insufficiente'), ins('sleep', 'ok')]);
  assert.deepEqual([...lowConfidenceAreas(d)], ['peso']);
});
test('basta un insight analitico con dati per togliere il tetto all\'area', () => {
  const d = dossier([ins('energy_balance', 'insufficiente'), ins('protein', 'ok')]);
  assert.equal(lowConfidenceAreas(d).has('alimentazione'), false);
});
test('gli insight di qualità dei dati ("attenzione" anche senza dati) non tolgono il tetto', () => {
  const d = dossier([ins('weight_trend', 'insufficiente'), ins('weighin_protocol', 'attenzione'), ins('freshness', 'info')]);
  assert.equal(lowConfidenceAreas(d).has('peso'), true);
});
test('progressione: almeno metà degli esercizi con fiducia bassa limita allenamento e scheda', () => {
  const ex = c => ({ name: 'x', confidence: c });
  const half = dossier([ins('progression', 'ok', { exercises: [ex('bassa'), ex('alta')] })]);
  const few = dossier([ins('progression', 'ok', { exercises: [ex('bassa'), ex('alta'), ex('alta')] })]);
  assert.deepEqual([...lowConfidenceAreas(half)].sort(), ['allenamento', 'scheda']);
  assert.equal(lowConfidenceAreas(few).size, 0);
});
test('applyConfidenceCaps: abbassa solo ciò che supera il tetto e conserva il valore dichiarato', () => {
  const d = dossier([ins('sleep', 'insufficiente')]);
  const a = advice(['sonno', 'alta'], ['sonno', 'bassa'], ['peso', 'alta']);
  assert.equal(applyConfidenceCaps(a, d), 1);
  assert.deepEqual(a.priorities.map(p => p.confidence), ['bassa', 'bassa', 'alta']);
  assert.equal(a.priorities[0].confidence_declared, 'alta'); assert.equal('confidence_declared' in a.priorities[1], false);
});
test('dossier vuoto o senza insight: nessun tetto, nessun errore', () => {
  assert.equal(applyConfidenceCaps(advice(['peso', 'alta']), {}), 0);
  assert.equal(applyConfidenceCaps(advice(['peso', 'alta']), dossier([])), 0);
});
test('generateAdvice: con database vuoto la confidenza "alta" del modello viene ridotta a "bassa"', async () => {
  const db = await newDb();
  const payload = { summary: 'Quadro generale sufficientemente lungo per validare.', priorities: [{ area: 'peso', title: 'Pesati ogni giorno', why: 'Dati scarsi.', evidence: [], actions: ['Pesati ogni mattina per 14 giorni'], confidence: 'alta', check_in_days: 14 }], watch: [], questions: [] };
  const fetchFn = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }], usageMetadata: {} }), { status: 200 });
  const res = await generateAdvice(db, 'owner', { cfg: aiConfig({ AI_PROVIDER: 'gemini', AI_MODEL: 'm', AI_API_KEY: 'k' }), fetchFn, now: new Date('2026-11-06T12:00:00Z'), body: {} });
  const p = res.advice.priorities[0];
  assert.equal(p.confidence, 'bassa'); assert.equal(p.confidence_declared, 'alta');
});
