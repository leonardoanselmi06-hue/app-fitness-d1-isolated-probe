// Endpoint del Piano, SOLO proprietario (il router scarta prima il token del telefono). Scrittura: solo JSON, Origin coerente, corpo piccolo.
import { AppError, insist } from '../core/errors.js';
import { localDate } from '../core/time.js';
import { saveVersion, startPhase, closePhase, getPhase } from './store.js';
import { planView, historyView } from './view.js';

const MAX_BODY = 20 * 1024;

export async function planRoute(request, url, { db, subject, now, buildReport = null }) {
  const nowDate = now(), nowIso = nowDate.toISOString(), today = localDate(nowIso, 'Europe/Rome'), path = url.pathname;
  if (request.method === 'GET') {
    if (path === '/v1/plan') return await planView(db, subject, { today });
    if (path === '/v1/plan/history') {
      const entity = url.searchParams.get('entity'), pid = Number.parseInt(url.searchParams.get('phase_id'), 10);
      insist(entity || Number.isInteger(pid), 422, 'invalid_query');
      return await historyView(db, subject, { entity, phase_id: pid });
    }
    if (path === '/v1/plan/report') {
      const pid = Number.parseInt(url.searchParams.get('phase_id'), 10), p = Number.isInteger(pid) ? await getPhase(db, subject, pid) : null;
      insist(p, 404, 'phase_not_found'); return { phase_id: p.id, report: p.report_json ? JSON.parse(p.report_json) : null };
    }
    throw new AppError(404, 'not_found');
  }
  if (request.method !== 'POST') throw new AppError(405, 'method_not_allowed');
  insist((request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'), 415, 'unsupported_media_type');
  const origin = request.headers.get('origin'); insist(origin == null || origin === url.origin, 403, 'forbidden_origin');
  const text = await request.text(); insist(text.length <= MAX_BODY, 413, 'payload_too_large');
  let body; try { body = JSON.parse(text); } catch { throw new AppError(400, 'invalid_json'); }
  insist(body && typeof body === 'object' && !Array.isArray(body), 422, 'invalid_body');
  const ctx = { today, nowIso };
  if (path === '/v1/plan/version') return await saveVersion(db, subject, body, ctx);
  if (path === '/v1/plan/phase/start') return await startPhase(db, subject, body, ctx);
  if (path === '/v1/plan/phase/close') {
    const phase = Number.isInteger(body.phase_id) ? await getPhase(db, subject, body.phase_id) : null;
    const report = buildReport && phase && /^\d{4}-\d{2}-\d{2}$/.test(String(body.last_day)) ? await buildReport(db, subject, phase, body.last_day) : null;
    return await closePhase(db, subject, body, { ...ctx, report });
  }
  throw new AppError(404, 'not_found');
}
