import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { ingest } from '../src/ingest/ledger.js';
import { MemoryRawStore } from '../src/storage/rawstore.js';
import { addDays } from '../src/coach/stats.js';
import { compareView } from '../public/compare.js';
import { newDb } from './helpers/d1-shim.mjs';

const NOW = new Date('2026-11-06T12:00:00Z'), TODAY = '2026-11-06';
let rid = 0; const uuid = () => `80000000-0000-4000-8000-${String(++rid).padStart(12, '0')}`;
const put = (db, source_system, scope_id, records) => ingest({ db, raw: new MemoryRawStore(), now: () => NOW.toISOString() }, { subject: 'owner', source_system, source_account: 'a', scope_id, request_id: uuid(), captured_at: NOW.toISOString(), artifact: JSON.stringify(records), records, scope_complete: false });
const mk = db => createApp({ db, auth: { authenticate: async () => ({ subject: 'owner', principal: 'owner' }) }, jobs: {}, now: () => NOW });
const get = async (app, p) => { const r = await app(new Request(`https://app.test${p}`)); return { status: r.status, json: await r.json() }; };
const ago = k => addDays(TODAY, -k);
const set = (reps, kg) => ({ reps, external_load_kg: kg, rir: 2, warmup: false, duration_sec: null });

async function seed(db) {
  // peso: periodo attuale (0..13 giorni fa) 72 kg, precedente (14..27) 71 kg, una pesata al giorno ogni 2 giorni
  await put(db, 'health_connect', 'weight', Array.from({ length: 28 }, (_, k) => k).filter(k => k % 2 === 0).map(k => ({ id: `weight:${k}`, domain: 'body', observed_at: `${ago(k)}T06:30:00.000Z`, payload: { metric: 'body_weight_kg', kg: k < 14 ? 72 : 71, time: `${ago(k)}T06:30:00.000Z`, local_date: ago(k), origin: 'x' } })));
  // alimentazione: giorni completi 1..4 fa = 2800 kcal; 15..18 fa = 2600 kcal; il giorno di oggi parziale (non conta)
  const food = (d, meal, kcal, n) => ({ id: `fs:${d}:${meal}:${n}`, domain: 'nutrition', observed_at: `${d}T10:00:00.000Z`, payload: { local_date: d, meal, name: meal, nutrients: { calories: kcal, protein: kcal / 20 } } });
  const nut = []; for (const k of [1, 2, 3, 4, 15, 16, 17, 18]) { const kc = k < 14 ? 2800 : 2600; nut.push(food(ago(k), 'Breakfast', kc * 0.25, 1), food(ago(k), 'Lunch', kc * 0.4, 2), food(ago(k), 'Dinner', kc * 0.35, 3)); }
  nut.push(food(TODAY, 'Breakfast', 400, 1));
  await put(db, 'fatsecret', 'day:x', nut);
  // sessioni: 3 nel periodo attuale (bench), 2 nel precedente
  const sess = k => ({ id: `lyfta:${ago(k)}`, domain: 'training', observed_at: `${ago(k)}T17:00:00.000Z`, payload: { local_date: ago(k), title: 'A', exercises: [{ name: 'Barbell Bench Press', configured_rest_sec: 150, sets: [set(8, 60), set(8, 60), set(8, 60), set(8, 60)] }] } });
  await put(db, 'lyfta', 'full', [2, 5, 9, 16, 22].map(sess));
  // passi: attuale 8000, precedente 6000 (giorni conclusi)
  await put(db, 'health_connect', 'steps', Array.from({ length: 28 }, (_, i) => i + 1).map(k => ({ id: `steps:${ago(k)}`, domain: 'activity', observed_at: null, payload: { metric: 'steps_total', local_date: ago(k), count: k <= 13 ? 8000 : 6000, origins: [] } })));
}

test('confronto 14 giorni: peso, calorie (solo giorni completi), passi, sedute e serie per muscolo', async () => {
  const db = newDb(), app = mk(db); await seed(db);
  const r = await get(app, '/v1/compare?days=14'); assert.equal(r.status, 200); const d = r.json, m = k => d.metrics.find(x => x.key === k);
  assert.equal(d.days, 14); assert.deepEqual(d.current, { from: ago(13), to: TODAY }); assert.deepEqual(d.previous, { from: ago(27), to: ago(14) });
  assert.equal(m('weight').current.value, 72); assert.equal(m('weight').previous.value, 71); assert.equal(m('weight').delta, 1); assert.equal(m('weight').delta_pct, 1.4);
  assert.equal(m('kcal').current.value, 2800); assert.equal(m('kcal').current.n, 4); assert.equal(m('kcal').previous.value, 2600); assert.equal(m('kcal').delta, 200); // oggi (parziale) escluso
  assert.equal(m('steps').current.value, 8000); assert.equal(m('steps').previous.value, 6000); assert.equal(m('steps').delta_pct, 33.3);
  assert.equal(d.training.sessions.current, 3); assert.equal(d.training.sessions.previous, 2); assert.equal(d.training.sessions.delta, 1);
  const petto = d.training.muscles.find(x => x.muscle === 'petto'); assert.equal(petto.current, 6); assert.equal(petto.previous, 4); // 12 e 8 serie in 14 giorni = 6 e 4 a settimana
});
test('dati insufficienti in un periodo: valore del periodo con pochi dati e delta = null, mai zero', async () => {
  const db = newDb(), app = mk(db); await seed(db);
  const d = (await get(app, '/v1/compare?days=7')).json, m = k => d.metrics.find(x => x.key === k);
  assert.equal(d.days, 7); assert.equal(m('weight').current.n, 4); assert.equal(m('weight').previous.n, 3); assert.equal(m('weight').delta, 0); // pesate ogni 2 giorni: 4 e 3, entrambi i periodi bastano; 72 contro 72
  assert.equal(m('sleep').current.value, null); assert.equal(m('sleep').delta, null); assert.equal(m('sleep').current.n, 0);
  assert.equal(m('recovery').delta, null); assert.equal(m('fat').current.value, null);
});
test('giorni non validi tornano a 14; senza dati: tutto null e allenamento null', async () => {
  const db = newDb(), app = mk(db);
  const d = (await get(app, '/v1/compare?days=5')).json; assert.equal(d.days, 14); assert.equal((await get(app, '/v1/compare')).json.days, 14);
  assert.ok(d.metrics.every(x => x.current.value === null && x.delta === null)); assert.equal(d.training, null);
});
test('PWA: righe, frecce, chip, escape, dati mancanti', async () => {
  const db = newDb(), app = mk(db); await seed(db);
  const d = (await get(app, '/v1/compare?days=14')).json, h = compareView(d);
  assert.match(h, /data-cmp="14" aria-pressed="true"/); assert.match(h, /data-cmp="7" aria-pressed="false"/); assert.match(h, /72,00 kg/); assert.match(h, /▲ 1,00 kg \(\+1,4%\)/); assert.match(h, /8\.000 passi/);
  assert.match(h, /confronto non disponibile/); assert.match(h, /Sedute di forza/); assert.match(h, /Petto/);
  const none = compareView({ ...d, training: null, metrics: [{ key: 'weight', label: 'Peso <b>', unit: 'kg', current: { value: null, n: 0 }, previous: { value: null, n: 0 }, delta: null, delta_pct: null }] }); assert.match(none, /Peso &lt;b&gt;/); assert.match(none, /Nessun allenamento/);
});
