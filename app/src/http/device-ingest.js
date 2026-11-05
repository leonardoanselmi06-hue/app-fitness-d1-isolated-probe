// Ingest dal collector Android (Health Connect): POST /v1/ingest/device, solo con service token Cloudflare Access (principal 'device').
// Il server NON si fida del client: valida tipi e intervalli, ricava soggetto/ora/request_id da sé, non accetta MAI scope_complete
// (una finestra letta dal telefono non è verificabile come completa => nessuna cancellazione). Il corpo ricevuto è l'artefatto RAW (Drive).
// Corpo: { device_id, steps:[{date:'AAAA-MM-GG', count, origins:[pkg]}], weights:[{id, time, kg, origin}] }
import { AppError, insist } from '../core/errors.js';
import { ingest } from '../ingest/ledger.js';
import { validIsoInstant, localDate } from '../core/time.js';

const MAX_BYTES = 1024 * 1024, MAX_ITEMS = 400;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PKG = /^[A-Za-z0-9_.]{1,100}$/;
const ID = /^[A-Za-z0-9_.:@/-]{1,100}$/;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseDeviceBody(text, nowMs) {
  insist(text.length <= MAX_BYTES, 413, 'payload_too_large');
  let b; try { b = JSON.parse(text); } catch { throw new AppError(400, 'invalid_json'); }
  insist(b && typeof b === 'object' && !Array.isArray(b), 422, 'invalid_body');
  insist(!('scope_complete' in b) && !('subject' in b), 422, 'forbidden_field'); // il client non decide completezza né soggetto
  insist(typeof b.device_id === 'string' && ID.test(b.device_id), 422, 'invalid_device');
  const steps = b.steps ?? [], weights = b.weights ?? [];
  insist(Array.isArray(steps) && Array.isArray(weights) && steps.length + weights.length > 0 && steps.length <= MAX_ITEMS && weights.length <= MAX_ITEMS, 422, 'invalid_items');
  const maxDay = new Date(nowMs + 36 * 3600 * 1000).toISOString().slice(0, 10), seenS = new Set(), seenW = new Set();
  for (const s of steps) {
    insist(s && typeof s.date === 'string' && DAY.test(s.date) && s.date <= maxDay && s.date >= '2015-01-01' && !seenS.has(s.date), 422, 'invalid_steps'); seenS.add(s.date);
    insist(Number.isInteger(s.count) && s.count >= 0 && s.count <= 200000, 422, 'invalid_steps');
    insist(Array.isArray(s.origins ?? []) && (s.origins ?? []).length <= 10 && (s.origins ?? []).every(o => typeof o === 'string' && PKG.test(o)), 422, 'invalid_steps');
  }
  for (const w of weights) {
    insist(w && typeof w.id === 'string' && ID.test(w.id) && !seenW.has(w.id), 422, 'invalid_weight'); seenW.add(w.id);
    insist(validIsoInstant(w.time) && Date.parse(w.time) <= nowMs + 36 * 3600 * 1000, 422, 'invalid_weight');
    insist(num(w.kg) != null && w.kg >= 20 && w.kg <= 400, 422, 'invalid_weight');
    insist(w.origin == null || (typeof w.origin === 'string' && PKG.test(w.origin)), 422, 'invalid_weight');
  }
  return { device_id: b.device_id, steps, weights };
}

export function deviceIngest({ db, raw, now = () => new Date().toISOString(), enabled = false }) {
  return async function handle(request) {
    if (!enabled) throw new AppError(503, 'device_ingest_disabled'); // spento per default (Readiness Gate): serve DEVICE_INGEST_ENABLED="true"
    const text = await request.text();
    const t = now();
    const b = parseDeviceBody(text, Date.parse(t));
    const base = { subject: 'owner', source_system: 'health_connect', source_account: b.device_id, captured_at: t, scope_complete: false };
    const out = {};
    if (b.steps.length) {
      out.steps = await ingest({ db, raw, now }, { ...base, scope_id: 'steps', request_id: crypto.randomUUID(), artifact: JSON.stringify(b.steps),
        records: b.steps.map(s => ({ id: `steps:${s.date}`, domain: 'activity', observed_at: null, payload: { metric: 'steps_total', local_date: s.date, count: s.count, origins: s.origins ?? [], time_semantics: 'device_local_day', dedup: 'health_connect_aggregate' } })) });
    }
    if (b.weights.length) {
      out.weights = await ingest({ db, raw, now }, { ...base, scope_id: 'weight', request_id: crypto.randomUUID(), artifact: JSON.stringify(b.weights),
        records: b.weights.map(w => ({ id: `weight:${w.id}`, domain: 'body', observed_at: new Date(w.time).toISOString(), payload: { metric: 'body_weight_kg', kg: w.kg, time: new Date(w.time).toISOString(), local_date: localDate(w.time), origin: w.origin ?? null } })) });
    }
    return { ok: true, ...out };
  };
}
