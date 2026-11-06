// Ingest dal collector Android (Health Connect): POST /v1/ingest/device, solo con service token Cloudflare Access (principal 'device').
// Il server NON si fida del client: valida tipi e intervalli, ricava soggetto/ora/request_id da sé, non accetta MAI scope_complete
// (una finestra letta dal telefono non è verificabile come completa => nessuna cancellazione). Il corpo ricevuto è l'artefatto RAW (Drive).
// Corpo: { device_id, steps:[{date:'AAAA-MM-GG', count, origins:[pkg]}], weights:[{id, time, kg, origin}], sleep:[{id, start_ms, end_ms, ...}] }
import { AppError, insist } from '../core/errors.js';
import { ingest } from '../ingest/ledger.js';
import { validIsoInstant, localDate } from '../core/time.js';

const MAX_BYTES = 1024 * 1024, MAX_ITEMS = 400;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PKG = /^[A-Za-z0-9_.]{1,100}$/;
const ID = /^[A-Za-z0-9_.:@/-]{1,100}$/;
const SHORT_NIGHT_MS = 3 * 3600 * 1000; // sotto le 3 ore: probabile riposino o registrazione interrotta
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseDeviceBody(text, nowMs) {
  insist(text.length <= MAX_BYTES, 413, 'payload_too_large');
  let b; try { b = JSON.parse(text); } catch { throw new AppError(400, 'invalid_json'); }
  insist(b && typeof b === 'object' && !Array.isArray(b), 422, 'invalid_body');
  insist(!('scope_complete' in b) && !('subject' in b), 422, 'forbidden_field'); // il client non decide completezza né soggetto
  insist(typeof b.device_id === 'string' && ID.test(b.device_id), 422, 'invalid_device');
  const steps = b.steps ?? [], weights = b.weights ?? [], sleep = b.sleep ?? [];
  insist(Array.isArray(steps) && Array.isArray(weights) && Array.isArray(sleep) && steps.length + weights.length + sleep.length > 0 && steps.length <= MAX_ITEMS && weights.length <= MAX_ITEMS && sleep.length <= MAX_ITEMS, 422, 'invalid_items');
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
  const seenZ = new Set(), numOrNull = v => v == null || num(v) != null;
  for (const z of sleep) {
    insist(z && Number.isInteger(z.start_ms) && z.start_ms > 1.4e12 && z.start_ms <= nowMs + 36 * 3600 * 1000 && z.id === String(z.start_ms) && !seenZ.has(z.id), 422, 'invalid_sleep'); seenZ.add(z.id);
    insist(Number.isInteger(z.end_ms) && z.end_ms >= z.start_ms && z.end_ms - z.start_ms <= 36 * 3600 * 1000, 422, 'invalid_sleep');
    insist(z.latest_end_ms == null || Number.isInteger(z.latest_end_ms), 422, 'invalid_sleep');
    insist(z.tz == null || (typeof z.tz === 'string' && /^[A-Za-z0-9_/+:.-]{1,64}$/.test(z.tz)), 422, 'invalid_sleep');
    for (const k of ['rating', 'quality', 'snore', 'cycles', 'len_adjust', 'noise_level', 'length_raw']) insist(numOrNull(z[k]), 422, 'invalid_sleep');
  }
  return { device_id: b.device_id, steps, weights, sleep };
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
      // Pesate escluse dal proprietario (es. cancellate nell'app Renpho ma rimaste in Health Connect): lista di istanti ISO in meta('excluded_weights').
      let excluded = new Set();
      try { const row = await db.prepare("SELECT value FROM meta WHERE name = 'excluded_weights'").first(); if (row?.value) excluded = new Set(JSON.parse(row.value)); } catch { /* lista assente o illeggibile: nessuna esclusione */ }
      const keep = b.weights.filter(w => !excluded.has(new Date(w.time).toISOString()));
      let drop_ids = [];
      if (excluded.size) {
        const { results } = await db.prepare("SELECT record_id, observed_at FROM current_records WHERE subject_id = 'owner' AND source_system = 'health_connect' AND source_account = ? AND scope_id = 'weight' AND deleted = 0").bind(b.device_id).all();
        drop_ids = results.filter(r => excluded.has(r.observed_at)).map(r => r.record_id);
      }
      out.weights = await ingest({ db, raw, now }, { ...base, scope_id: 'weight', request_id: crypto.randomUUID(), artifact: JSON.stringify(keep), drop_ids,
        records: keep.map(w => ({ id: `weight:${w.id}`, domain: 'body', observed_at: new Date(w.time).toISOString(), payload: { metric: 'body_weight_kg', kg: w.kg, time: new Date(w.time).toISOString(), local_date: localDate(w.time), origin: w.origin ?? null } })) });
    }
    if (b.sleep.length) {
      out.sleep = await ingest({ db, raw, now }, { ...base, source_system: 'sleep_as_android', scope_id: 'sleep', request_id: crypto.randomUUID(), artifact: JSON.stringify({ schema: 2, sleep: b.sleep }),
        records: b.sleep.map(z => ({ id: `sleep:${z.id}`, domain: 'sleep', observed_at: new Date(z.start_ms).toISOString(), payload: {
          start_at: new Date(z.start_ms).toISOString(), end_at: new Date(z.end_ms).toISOString(), local_date: localDate(new Date(z.end_ms).toISOString()), timezone: z.tz ?? null,
          duration_min: Math.round((z.end_ms - z.start_ms) / 60000), short: z.end_ms - z.start_ms < SHORT_NIGHT_MS, latest_end_at: z.latest_end_ms ? new Date(z.latest_end_ms).toISOString() : null,
          rating: z.rating ?? null, quality: z.quality ?? null, snore: z.snore ?? null, cycles: z.cycles ?? null, len_adjust_raw: z.len_adjust ?? null, noise_level: z.noise_level ?? null, length_raw: z.length_raw ?? null,
          identity: 'provider_startTime', time_semantics: 'epoch_ms' } })) });
    }
    return { ok: true, ...out };
  };
}
