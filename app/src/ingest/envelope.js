import { AppError, insist } from '../core/errors.js';
import { validIsoInstant } from '../core/time.js';

export const DOMAINS = Object.freeze(['training', 'program', 'body', 'nutrition', 'activity', 'cardio', 'sleep', 'recovery']);
export const SOURCES = Object.freeze(['lyfta', 'polar', 'renpho', 'fatsecret', 'samsung_health', 'sleep_as_android', 'health_connect', 'chatgpt_estimate', 'app_fitness', 'synthetic_test']);
const IDENT = /^[A-Za-z0-9_.:@/-]{1,120}$/;
export const isIdent = s => typeof s === 'string' && IDENT.test(s);
const MAX_RECORDS = 2000;

/** Valida una richiesta di ingest proveniente da un adapter server-side fidato. */
export function validateIngest(i) {
  insist(i && typeof i === 'object', 422, 'invalid_ingest');
  const { subject, source_system, source_account, scope_id, request_id, captured_at, records, scope_complete = false } = i;
  insist(isIdent(subject), 422, 'invalid_subject');
  insist(SOURCES.includes(source_system), 422, 'unsupported_source');
  insist(isIdent(source_account) && isIdent(scope_id), 422, 'invalid_scope');
  insist(typeof request_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request_id), 422, 'invalid_request_id');
  insist(validIsoInstant(captured_at), 422, 'invalid_capture_time');
  insist(typeof scope_complete === 'boolean', 422, 'invalid_completeness');
  insist(Array.isArray(records) && records.length <= MAX_RECORDS, 422, 'invalid_records');
  insist(i.artifact instanceof Uint8Array || typeof i.artifact === 'string', 422, 'invalid_artifact');
  const seen = new Set();
  for (const r of records) {
    insist(r && isIdent(r.id) && DOMAINS.includes(r.domain), 422, 'invalid_record');
    insist(r.payload && typeof r.payload === 'object' && !Array.isArray(r.payload), 422, 'invalid_record_payload');
    insist(!seen.has(r.id), 422, 'duplicate_record_id'); seen.add(r.id);
    if (r.observed_at != null && !validIsoInstant(r.observed_at)) throw new AppError(422, 'invalid_observed_time');
  }
  return i;
}
