import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { ingest } from '../src/ingest/ledger.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { aiConfig, callModel, extractJson } from '../src/ai/provider.js';
import { validateAdvice, verifyEvidence, DAILY_LIMIT } from '../src/ai/advice.js';
import { buildDossier } from '../src/ai/dossier.js';
import { adviceBody, aiView } from '../public/ai.js';
import { newDb } from './helpers/d1-shim.mjs';

const NOW = new Date('2026-11-06T12:00:00Z');
let rid = 0; const uuid = () => `90000000-0000-4000-8000-${String(++rid).padStart(12, '0')}`;
const put = (db, scope_id, records) => ingest({ db, raw: new MemoryRawStore(), now: () => NOW.toISOString() }, { subject: 'owner', source_system: 'health_connect', source_account: 'a', scope_id, request_id: uuid(), captured_at: NOW.toISOString(), artifact: JSON.stringify(records), records, scope_complete: false });
const GOOD = { summary: 'Quadro generale sufficientemente lungo per validare.', priorities: [{ area: 'peso', title: 'Pesati ogni giorno', why: 'Dati scarsi.', evidence: [{ label: 'Sedute previste', value: '4 a settimana' }], actions: ['Pesati ogni mattina per 14 giorni'], confidence: 'bassa', check_in_days: 14 }], watch: ['Sonno'], questions: ['Hai dolori?'] };
const fakeFetch = (payload, log = []) => async (url, init) => { log.push({ url, init }); return new Response(JSON.stringify(payload(url)), { status: 200 }); };
const gem = text => () => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
const mk = (db, { principal = 'owner', env = { AI_PROVIDER: 'gemini', AI_MODEL: 'm', AI_API_KEY: 'k' }, f } = {}) => createApp({ db, auth: { authenticate: async () => ({ subject: 'owner', principal }) }, jobs: {}, now: () => NOW, ai: { config: aiConfig(env), fetch: f } });
const call = async (app, p, body, extra = {}) => { const r = await app(new Request(`https://app.test${p}`, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.test', ...extra }, body: JSON.stringify(body) })); return { status: r.status, json: await r.json() }; };

test('configurazione: solo da env; openai richiede https', () => {
  assert.equal(aiConfig({}).configured, false);
  assert.equal(aiConfig({ AI_PROVIDER: 'gemini', AI_MODEL: 'm', AI_API_KEY: 'k' }).configured, true);
  assert.equal(aiConfig({ AI_PROVIDER: 'openai', AI_MODEL: 'm', AI_API_KEY: 'k', AI_BASE_URL: 'http://x.io/v1' }).configured, false);
  assert.equal(aiConfig({ AI_PROVIDER: 'openai', AI_MODEL: 'm', AI_API_KEY: 'k', AI_BASE_URL: 'https://api.xkiro.com/v1/' }).baseUrl, 'https://api.xkiro.com/v1');
});
test('adattatori: Gemini usa header chiave; openai usa Bearer e riprova senza response_format', async () => {
  const log = [], f = fakeFetch(gem('{"a":1}'), log);
  const g = await callModel(aiConfig({ AI_PROVIDER: 'gemini', AI_MODEL: 'gm', AI_API_KEY: 'KEY' }), { system: 's', user: 'u' }, f);
  assert.equal(g.tokens_in, 10); assert.equal(log[0].init.headers['x-goog-api-key'], 'KEY'); assert.ok(!log[0].url.includes('KEY'));
  let n = 0; const calls = [];
  const f2 = async (url, init) => { calls.push(JSON.parse(init.body)); return ++n === 1 ? new Response('{}', { status: 400 }) : new Response(JSON.stringify({ choices: [{ message: { content: '{"b":2}' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }), { status: 200 }); };
  const o = await callModel(aiConfig({ AI_PROVIDER: 'openai', AI_MODEL: 'x', AI_API_KEY: 'K', AI_BASE_URL: 'https://gw.test/v1' }), { system: 's', user: 'u' }, f2);
  assert.equal(o.text, '{"b":2}'); assert.ok(calls[0].response_format); assert.equal(calls[1].response_format, undefined);
});
test('errori del provider: solo codici, mai corpo o chiave', async () => {
  const cfg = aiConfig({ AI_PROVIDER: 'gemini', AI_MODEL: 'm', AI_API_KEY: 'SECRET' });
  await assert.rejects(callModel(cfg, { system: 's', user: 'u' }, async () => new Response('SECRET body', { status: 429 })), e => e.status === 429 && e.code === 'ai_rate_limited' || e.message === 'ai_rate_limited');
  await assert.rejects(callModel(cfg, { system: 's', user: 'u' }, async () => { throw new Error('SECRET'); }), e => !String(e.message).includes('SECRET'));
});
test('extractJson tollera recinti markdown e testo attorno', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 }); assert.deepEqual(extractJson('ecco: {"a":2} fine'), { a: 2 }); assert.equal(extractJson('niente'), null);
});
test('validazione e verifica dei numeri', () => {
  assert.ok(validateAdvice(structuredClone(GOOD))); assert.equal(validateAdvice({ ...GOOD, priorities: [] }), null);
  assert.equal(validateAdvice({ ...GOOD, priorities: [{ ...GOOD.priorities[0], area: 'x' }] }), null);
  const a = validateAdvice(structuredClone(GOOD)); a.priorities[0].evidence = [{ label: 'a', value: '72,0 kg' }, { label: 'b', value: '1.250 kcal' }, { label: 'c', value: '99 kg' }, { label: 'd', value: '2026-11-06' }];
  assert.equal(verifyEvidence(a, { w: 72, k: 1250 }), 1); assert.deepEqual(a.priorities[0].evidence.map(e => e.verified), [true, true, false, true]);
});
test('solo proprietario, solo JSON con Origin; il telefono riceve 403', async () => {
  const db = newDb();
  assert.equal((await call(mk(db, { principal: 'device' }), '/v1/ai/status')).status, 403);
  assert.equal((await call(mk(db, { principal: 'device' }), '/v1/ai/advice', {})).status, 403);
  const app = mk(db, { f: fakeFetch(gem(JSON.stringify(GOOD))) });
  assert.equal((await call(app, '/v1/ai/advice', {}, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await call(app, '/v1/ai/advice', { foo: 1 })).status, 422);
});
test('non configurata: stato e 503', async () => {
  const app = mk(newDb(), { env: {} }); assert.equal((await call(app, '/v1/ai/status')).json.configured, false); assert.equal((await call(app, '/v1/ai/advice', {})).status, 503);
});
test('consiglio: salvato, cache, force, limite giornaliero, feedback e precedente nel dossier', async () => {
  const db = newDb(); await put(db, 'weight', [{ id: 'w1', domain: 'body', observed_at: '2026-11-05T06:00:00.000Z', payload: { metric: 'body_weight_kg', kg: 72, time: '2026-11-05T06:00:00.000Z', local_date: '2026-11-05', origin: 'x' } }]);
  const log = []; const app = mk(db, { f: fakeFetch(gem('```json\n' + JSON.stringify(GOOD) + '\n```'), log) });
  const a = await call(app, '/v1/ai/advice', {}); assert.equal(a.status, 200); assert.equal(a.json.cached, false); assert.equal(a.json.unverified, 0); assert.equal(log.length, 1);
  assert.ok(!log[0].init.body.includes('leonardo')); // nessuna identità nel dossier
  const b = await call(app, '/v1/ai/advice', {}); assert.equal(b.json.cached, true); assert.equal(log.length, 1);
  const fb = await call(app, '/v1/ai/feedback', { advice_id: a.json.id, index: 0, status: 'seguito' }); assert.equal(fb.status, 200);
  assert.equal((await call(app, '/v1/ai/feedback', { advice_id: a.json.id, index: 3, status: 'seguito' })).status, 422);
  assert.equal((await call(app, '/v1/ai/feedback', { advice_id: a.json.id, index: 0, status: 'boh' })).status, 422);
  const st = (await call(app, '/v1/ai/status')).json; assert.equal(st.latest.feedback[0], 'seguito'); assert.equal(st.used_today, 1);
  const c = await call(app, '/v1/ai/advice', { force: true }); assert.equal(c.json.cached, false); assert.match(log[1].init.body, /seguito/); // il riscontro entra nel dossier
  while ((await call(app, '/v1/ai/status')).json.used_today < DAILY_LIMIT) await call(app, '/v1/ai/advice', { force: true });
  assert.equal((await call(app, '/v1/ai/advice', { force: true })).status, 429);
});
test('risposta non valida: un solo nuovo tentativo, poi 502', async () => {
  let n = 0; const app = mk(newDb(), { f: async () => { n++; return new Response(JSON.stringify(gem('non json')()), { status: 200 }); } });
  const r = await call(app, '/v1/ai/advice', {}); assert.equal(r.status, 502); assert.equal(r.json.error, 'ai_invalid_response'); assert.equal(n, 2);
});
test('note: il testo parte solo se attivo', async () => {
  const db = newDb(), noteRow = async () => { /* inserisce una nota nel piano tramite API */ };
  const app = mk(db, { f: fakeFetch(gem(JSON.stringify(GOOD))) });
  const on = await buildDossier(db, 'owner', { now: NOW, sendNotes: true }), off = await buildDossier(db, 'owner', { now: NOW, sendNotes: false });
  assert.equal(on.notes_text_included, true); assert.equal(off.notes_text_included, false); void noteRow;
  assert.equal((await call(app, '/v1/ai/settings', { send_notes: false })).json.send_notes, false); assert.equal((await call(app, '/v1/ai/status')).json.send_notes, false);
  assert.equal((await call(app, '/v1/ai/settings', { send_notes: 'x' })).status, 422);
});
test('query D1 per richiesta di consiglio sotto il limite', async () => {
  const db = newDb(); let n = 0; const orig = db.prepare.bind(db); db.prepare = (...a) => { n++; return orig(...a); };
  const app = mk(db, { f: fakeFetch(gem(JSON.stringify(GOOD))) }); await call(app, '/v1/ai/advice', {}); assert.ok(n <= 40, `query: ${n}`);
});
test('PWA: rendering, escape, numeri non verificati, non configurata', async () => {
  const a = validateAdvice(structuredClone(GOOD)); a.priorities[0].title = '<b>x</b>'; a.priorities[0].evidence[0].verified = false;
  const h = adviceBody({ id: 1, created_at: '2026-11-06T10:00:00Z', model: 'm', advice: a, unverified: 1 }, ['parziale']);
  assert.match(h, /&lt;b&gt;x/); assert.match(h, /⚠/); assert.match(h, /data-ai-status="parziale" aria-pressed="true"/); assert.match(h, /fiducia bassa/);
  assert.match(aiView({ configured: false }), /AI_API_KEY/);
  assert.match(aiView({ configured: true, provider: 'gemini', model: 'm', send_notes: true, used_today: 1, daily_limit: 8, latest: null, history: [] }), /Analizza ora/);
});

import { KNOWLEDGE, SOURCES, knowledgeIds, knowledgeIndex, knowledgeMarkdown } from '../src/ai/knowledge.js';
import { SYSTEM_PROMPT } from '../src/ai/advice.js';
test('base di conoscenza: id unici, fonti https esistenti, livelli dichiarati, presente nel prompt', () => {
  assert.equal(new Set(knowledgeIds()).size, KNOWLEDGE.length);
  for (const k of KNOWLEDGE) { assert.ok(k.claims.length && k.sources.length); assert.ok(['letta', 'nota'].includes(k.level)); for (const s of k.sources) { assert.ok(SOURCES[s], s); assert.match(SOURCES[s].url, /^https:\/\//); } if (k.level === 'letta') assert.ok(k.sources.every(s => SOURCES[s].level === 'letta'), k.id); }
  assert.match(SYSTEM_PROMPT, /\[K1\]/); assert.match(SYSTEM_PROMPT, /da confermare/); assert.match(knowledgeMarkdown(), /## Fonti/);
});
test('consiglio: le fonti citate sono solo id noti; la PWA le mostra come link con il livello', () => {
  const a = validateAdvice({ ...structuredClone(GOOD), priorities: [{ ...GOOD.priorities[0], sources: ['K1', 'K99', 'K13', 5] }] });
  assert.deepEqual(a.priorities[0].sources, ['K1', 'K13']);
  const h = adviceBody({ id: 1, created_at: '2026-11-06T10:00:00Z', model: 'm', advice: a, unverified: 0, knowledge: knowledgeIndex(a) }, null);
  assert.match(h, /<a href="https:\/\/www\.strongerbyscience\.com/); assert.match(h, /rel="noopener noreferrer"/); assert.match(h, /\(da confermare\)/);
});
