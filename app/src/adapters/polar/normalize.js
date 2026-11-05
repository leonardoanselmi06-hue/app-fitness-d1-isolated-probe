// Normalizzatore Polar AccessLink v4 -> record canonici 'cardio' (DEC-CARDIO-001). Contratto verificato sul payload reale
// con il probe di sola struttura (5 nov 2026): sessione = { identifier:{id}, startTime, timezoneOffsetMinutes, durationMillis,
// hrAvg, hrMax, calories, sport:{id}, trainingBenefit, recoveryTimeMillis (stringa), product, application, exercises[] };
// con features: exercises[].samples.samples[{type,intervalMillis,values[]}] e exercises[].zones[{type,zones[{lowerLimit,higherLimit,inZone}]}].
import { num, absent } from '../lyfta/normalize.js';
import { localDate } from '../../core/time.js';

export const ADAPTER_VERSION = 'polar-normalizer/0.1.0';
const str = v => (absent(v) ? null : String(v));

// startTime è locale senza fuso + timezoneOffsetMinutes: istante = locale − offset. ASSUNZIONE da confermare (time_semantics).
export function polarInstant(startTime, offsetMin) {
  if (typeof startTime !== 'string' || !Number.isFinite(offsetMin)) return null;
  const m = startTime.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?$/);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}${m[3] ?? ''}Z`) - offsetMin * 60000;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export const sessionId = s => (absent(s?.identifier?.id) ? null : String(s.identifier.id));

export function summarizeDetail(exercises) {
  const series = [], zones = [];
  (exercises ?? []).forEach((ex, ei) => {
    for (const x of ex.samples?.samples ?? []) series.push({ exercise: ei, type: str(x.type), interval_ms: num(x.intervalMillis), count: Array.isArray(x.values) ? x.values.length : 0 });
    for (const z of ex.zones ?? []) zones.push({ exercise: ei, type: str(z.type), zones: (z.zones ?? []).map(q => ({ lower: num(q.lowerLimit), upper: num(q.higherLimit), in_zone: num(q.inZone) })) });
  });
  return { series, zones };
}

/** @param detail null (nessun dettaglio ancora) | { status:'ok'|'none', raw_ref?, raw_sha256?, exercises } */
export function normalizeSession(s, detail = null) {
  const id = sessionId(s);
  if (!id) throw new Error('polar_session_without_id');
  const offset = num(s.timezoneOffsetMinutes);
  const startAt = polarInstant(s.startTime, offset);
  const d = detail ? summarizeDetail(detail.exercises) : null;
  return {
    id: `session:${id}`,
    domain: 'cardio',
    observed_at: startAt,
    payload: {
      adapter_version: ADAPTER_VERSION,
      native_session_id: id,
      sport: str(s.sport?.id),
      start_local: str(s.startTime),
      timezone_offset_min: offset,
      start_at: startAt,
      local_date: startAt ? localDate(startAt) : null,
      time_semantics: 'local_naive_minus_offset_assumed', // da confrontare con Lyfta attorno al cambio ora
      duration_ms: num(s.durationMillis),
      calories: num(s.calories),
      hr_avg: num(s.hrAvg),
      hr_max: num(s.hrMax),
      training_benefit: str(s.trainingBenefit),
      recovery_time_ms: num(s.recoveryTimeMillis),
      device_model: str(s.product?.modelName),
      exercises: (s.exercises ?? []).map(e => ({ id: str(e.identifier?.id), sport: str(e.sport?.id), duration_ms: num(e.durationMillis), calories: num(e.calories) })),
      // DEC-STORAGE-004: la serie al secondo sta nel RAW su Drive; qui solo riferimento, hash e riepilogo
      hr_detail: detail
        ? { status: detail.status, raw_ref: detail.raw_ref ?? null, raw_sha256: detail.raw_sha256 ?? null, series: d.series, zones: d.zones, zone_unit: 'unverified' }
        : { status: 'pending', raw_ref: null, raw_sha256: null, series: [], zones: [], zone_unit: 'unverified' },
    },
  };
}
