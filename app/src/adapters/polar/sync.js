// Sync Polar (server-side, sola lettura). Finestra mobile di POLAR_SYNC_DAYS giorni: 1 chiamata di lista (≤90 giorni, senza features),
// poi il dettaglio (campioni+zone, limite Polar: 1 giorno per richiesta) solo per le sessioni NON ancora dettagliate in D1,
// al massimo MAX_DETAIL per esecuzione (limite di subrequest del Worker). Le restanti restano 'pending' e si completano alle esecuzioni successive.
// scope_complete è SEMPRE false: un sync su finestra non cancella mai nulla (Polar non è usato per tombstone).
import { ingest } from '../../ingest/ledger.js';
import { sha256Hex } from '../../core/hash.js';
import { normalizeSession, sessionId } from './normalize.js';

export const MAX_DETAIL = 6;
const iso = ms => new Date(ms).toISOString().slice(0, 19);
const dayStart = d => `${d}T00:00:00`;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

async function doneIds(db, subject) {
  const rs = await db.prepare(`SELECT record_id FROM current_records WHERE subject_id = ? AND source_system = 'polar' AND deleted = 0 AND json_extract(payload_json, '$.hr_detail.status') IN ('ok','none')`).bind(subject).all();
  return new Set((rs.results ?? []).map(r => r.record_id));
}

async function detailFor(get, raw, session, tryDays) {
  const id = sessionId(session);
  for (const d of tryDays) {
    const r = await get('/training-sessions/list', { from: dayStart(d), to: dayStart(addDays(d, 1)), features: ['samples', 'zones'] });
    const found = (r.trainingSessions ?? []).find(x => sessionId(x) === id);
    if (!found) continue;
    const has = (found.exercises ?? []).some(e => e.samples?.samples?.length || e.zones?.length);
    if (!has) return { status: 'none', exercises: found.exercises ?? [] };
    const bytes = JSON.stringify({ session: id, exercises: (found.exercises ?? []).map(e => ({ id: e.identifier?.id ?? null, samples: e.samples ?? null, zones: e.zones ?? null })) });
    const sha = await sha256Hex(bytes);
    const put = await raw.put(sha, bytes);
    return { status: 'ok', raw_ref: put.ref, raw_sha256: sha, exercises: found.exercises ?? [] };
  }
  return null; // non trovato: resta pending
}

export async function syncPolar({ db, raw, now = () => new Date().toISOString() }, { get, subject = 'owner', account = 'polar-user', days = 60, request_id, captured_at, maxDetail = MAX_DETAIL }) {
  const nowMs = Date.parse(captured_at);
  const win = Math.min(Math.max(days, 1), 89);
  const from = dayStart(iso(nowMs - win * 86400000).slice(0, 10)), to = dayStart(iso(nowMs + 86400000).slice(0, 10));
  const list = await get('/training-sessions/list', { from, to });
  const sessions = (list.trainingSessions ?? []).filter(s => sessionId(s));
  const done = await doneIds(db, subject);
  const todo = sessions.filter(s => !done.has(`session:${sessionId(s)}`));
  const records = [];
  let detailed = 0, remaining = 0;
  for (const s of todo) {
    let detail = null;
    if (detailed < maxDetail) {
      const day = String(s.startTime ?? '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) { detail = await detailFor(get, raw, s, [day, addDays(day, 1), addDays(day, -1)]); if (detail) detailed++; }
    }
    if (!detail) remaining++;
    records.push(normalizeSession(s, detail));
  }
  if (!records.length) return { ok: true, listed: sessions.length, new_sessions: 0, detailed: 0, remaining: 0, receipt: null };
  const receipt = await ingest({ db, raw, now }, {
    subject, source_system: 'polar', source_account: account, scope_id: 'sessions', request_id, captured_at,
    // L'artefatto include lo stato dei dettagli: l'ingest_key dipende dall'artefatto, quindi un avanzamento dei dettagli NON è un replay
    artifact: JSON.stringify({ list, detail_state: records.map(r => [r.id, r.payload.hr_detail.status, r.payload.hr_detail.raw_sha256]) }), records, scope_complete: false,
  });
  return { ok: true, listed: sessions.length, new_sessions: records.length, detailed, remaining, receipt };
}
