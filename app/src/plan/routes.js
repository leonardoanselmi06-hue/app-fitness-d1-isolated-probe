// Endpoint del Piano, SOLO proprietario (il router scarta prima il token del telefono). Scrittura: solo JSON, Origin coerente, corpo piccolo.
import { AppError, insist } from '../core/errors.js';
import { localDate } from '../core/time.js';
import { saveVersion, startPhase, closePhase, getPhase, importDays } from './store.js';
import { suggestFromLyfta } from './lyfta-suggest.js';
import { validDay } from './schema.js';
import { adherenceView } from './adherence.js';
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
    if (path === '/v1/plan/suggest') {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to') ?? today;
      insist(validDay(from) && validDay(to) && from <= to, 422, 'invalid_range'); return await suggestFromLyfta(db, subject, { from, to });
    }
    if (path === '/v1/plan/adherence') {
      const raw = url.searchParams.get('phase_id'), pid = raw == null ? null : Number.parseInt(raw, 10);
      insist(raw == null || Number.isInteger(pid), 422, 'invalid_query'); return await adherenceView(db, subject, { phaseId: pid, today });
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
  if (path === '/v1/plan/import-lyfta') {
    insist(validDay(body.from) && validDay(body.to) && body.from <= body.to && Array.isArray(body.titles) && body.titles.length <= 12 && body.titles.every(t => typeof t === 'string'), 422, 'invalid_import');
    const sug = await suggestFromLyfta(db, subject, { from: body.from, to: body.to });
    return await importDays(db, subject, body, sug.days.filter(d => body.titles.includes(d.title)), ctx); // il server ricalcola: il client sceglie solo i titoli
  }
  if (path === '/v1/plan/phase/start') return await startPhase(db, subject, body, ctx);
  if (path === '/v1/plan/phase/close') {
    const phase = Number.isInteger(body.phase_id) ? await getPhase(db, subject, body.phase_id) : null;
    const report = buildReport && phase && /^\d{4}-\d{2}-\d{2}$/.test(String(body.last_day)) ? await buildReport(db, subject, phase, body.last_day) : null;
    return await closePhase(db, subject, body, { ...ctx, report });
  }
  throw new AppError(404, 'not_found');
}
