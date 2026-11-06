// Archivio del Piano: versioni append-only (mai UPDATE dei dati, solo chiusura dell'intervallo), fasi, lettura.
// Una modifica = batch atomico D1 [chiudi versione aperta, inserisci nuova]; la concorrenza si controlla con expected_version_id.
import { AppError, insist } from '../core/errors.js';
import { stableStringify } from '../core/hash.js';
import { validateData, validDay, slug, KINDS } from './schema.js';

const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const COLS = 'id, subject_id, phase_id, kind, entity_key, valid_from, valid_to, data_json, reason, created_at';
const parse = r => r && { id: r.id, phase_id: r.phase_id, kind: r.kind, entity_key: r.entity_key, valid_from: r.valid_from, valid_to: r.valid_to, data: JSON.parse(r.data_json), reason: r.reason, created_at: r.created_at };
const INSERT = 'INSERT INTO plan_versions (subject_id, phase_id, kind, entity_key, valid_from, valid_to, data_json, reason, created_at)';

export const getPhase = (db, subject, id) => db.prepare('SELECT * FROM phases WHERE subject_id = ? AND id = ?').bind(subject, id).first();
export const openVersion = async (db, subject, key) => parse(await db.prepare(`SELECT ${COLS} FROM plan_versions WHERE subject_id = ? AND entity_key = ? AND valid_to IS NULL`).bind(subject, key).first());
export async function listVersions(db, subject, { entity = null, phaseId = null } = {}) {
  const [sql, bind] = entity ? ['entity_key = ?', entity] : ['phase_id = ?', phaseId];
  const { results } = await db.prepare(`SELECT ${COLS} FROM plan_versions WHERE subject_id = ? AND ${sql} ORDER BY entity_key ASC, valid_from ASC, id ASC`).bind(subject, bind).all();
  return results.map(parse);
}
export async function listNoteVersions(db, subject) {
  const { results } = await db.prepare(`SELECT ${COLS} FROM plan_versions WHERE subject_id = ? AND kind = 'note' ORDER BY entity_key ASC, valid_from ASC, id ASC`).bind(subject).all();
  return results.map(parse);
}
/** Versione in vigore a `day` (intervallo [valid_from, valid_to)). */
export const effective = (vers, day) => vers.find(v => v.valid_from <= day && (v.valid_to == null || day < v.valid_to)) ?? null;

const conflict = e => (/UNIQUE|constraint/i.test(String(e?.message)) ? new AppError(409, 'conflict') : e);

/** Salva una nuova versione di un'entità. `r`: {kind, phase_id, day, exercise, note_id, expected_version_id, valid_from, data, reason}. */
export async function saveVersion(db, subject, r, { today, nowIso }) {
  insist(r && KINDS.includes(r.kind), 422, 'invalid_kind');
  const data = validateData(r.kind, r.data);
  const valid_from = r.valid_from ?? today;
  insist(validDay(valid_from) && valid_from <= addDays(today, 60), 422, 'invalid_valid_from');
  insist(r.reason == null || (typeof r.reason === 'string' && r.reason.length <= 200), 422, 'invalid_reason');
  insist(r.expected_version_id == null || Number.isInteger(r.expected_version_id), 422, 'invalid_expected');
  let phase = null, key, stored, phaseId = null;
  const name = (v, max, code) => { insist(typeof v === 'string' && v.trim().length >= 1 && v.length <= max && slug(v).length > 0, 422, code); return v.trim(); };
  if (r.kind === 'note') {
    const id = r.note_id ?? crypto.randomUUID(); insist(typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id), 422, 'invalid_note_id');
    key = `note:${id}`; stored = data;
  } else {
    insist(Number.isInteger(r.phase_id), 422, 'invalid_phase_id');
    phase = await getPhase(db, subject, r.phase_id); insist(phase, 404, 'phase_not_found'); insist(phase.status === 'active', 409, 'phase_closed');
    insist(valid_from >= phase.start_date, 422, 'before_phase_start'); phaseId = phase.id;
    if (r.kind === 'phase') { key = `phase:${phase.id}`; stored = data; }
    else {
      const day = name(r.day, 40, 'invalid_day'), dayKey = `day:${phase.id}:${slug(day)}`;
      if (r.kind === 'day') { key = dayKey; stored = { label: day, ...data }; }
      else {
        const dayRow = await openVersion(db, subject, dayKey); insist(dayRow && !dayRow.data.removed, 422, 'day_not_found');
        const ex = name(r.exercise, 80, 'invalid_exercise'); key = `rx:${phase.id}:${slug(day)}:${slug(ex)}`; stored = { day: dayRow.data.label, exercise: ex, ...data };
      }
    }
  }
  const open = await openVersion(db, subject, key);
  if (data.removed) { insist(open && !open.data.removed, 422, 'nothing_to_remove'); stored = { ...open.data, removed: true }; }
  if (r.expected_version_id == null) insist(!open, 409, 'exists');
  else { insist(open && open.id === r.expected_version_id, 409, 'stale'); insist(valid_from >= open.valid_from, 422, 'valid_from_before_previous'); }  // stessa data = correzione: la versione precedente resta nello storico con intervallo vuoto
  if (open) { const a = { ...open.data }, b = { ...stored }; insist(stableStringify(a) !== stableStringify(b), 422, 'no_change'); }
  if (r.kind === 'note') phaseId = (await db.prepare('SELECT id FROM phases WHERE subject_id = ? AND start_date <= ? AND (end_date IS NULL OR ? < end_date) ORDER BY start_date DESC').bind(subject, data.date ?? open?.data?.date ?? valid_from, data.date ?? open?.data?.date ?? valid_from).first())?.id ?? null;
  const row = [subject, phaseId, r.kind, key, valid_from, null, stableStringify(stored), r.reason ?? null, nowIso];
  const stmts = [];
  if (open) stmts.push(db.prepare('UPDATE plan_versions SET valid_to = ? WHERE id = ? AND subject_id = ? AND valid_to IS NULL').bind(valid_from, open.id, subject));
  stmts.push(db.prepare(`${INSERT} SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${open ? '(SELECT changes()) = 1' : '1 = 1'}`).bind(...row));
  let res; try { res = await db.batch(stmts); } catch (e) { throw conflict(e); }
  insist((res.at(-1).meta?.changes ?? 1) === 1, 409, 'stale'); // versione cambiata nel frattempo: nulla è stato modificato
  return { entity_key: key, version: await openVersion(db, subject, key) };
}

/** Nuova fase. `copy_from`: id di una fase chiusa di cui copiare lo stato FINALE di giorni ed esercizi. */
export async function startPhase(db, subject, r, { today, nowIso }) {
  const meta = validateData('phase', { name: r.name, goal: r.goal, method: r.method, goal_type: r.goal_type, targets: r.targets });
  insist(validDay(r.start_date) && r.start_date <= addDays(today, 60), 422, 'invalid_start_date');
  insist(!(await db.prepare("SELECT id FROM phases WHERE subject_id = ? AND status = 'active'").bind(subject).first()), 409, 'active_phase_exists');
  const last = await db.prepare('SELECT MAX(end_date) AS e FROM phases WHERE subject_id = ?').bind(subject).first();
  insist(!last?.e || r.start_date >= last.e, 422, 'overlaps_previous_phase');
  const id = ((await db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM phases').first()).m) + 1;
  const stmts = [db.prepare("INSERT INTO phases (id, subject_id, start_date, end_date, status, created_at) VALUES (?, ?, ?, NULL, 'active', ?)").bind(id, subject, r.start_date, nowIso),
    db.prepare(`${INSERT} VALUES (?, ?, 'phase', ?, ?, NULL, ?, NULL, ?)`).bind(subject, id, `phase:${id}`, r.start_date, stableStringify(meta), nowIso)];
  if (r.copy_from != null) {
    insist(Number.isInteger(r.copy_from), 422, 'invalid_copy_from');
    const src = await getPhase(db, subject, r.copy_from); insist(src && src.status === 'closed', 422, 'invalid_copy_from');
    const finals = new Map(); for (const v of await listVersions(db, subject, { phaseId: src.id })) if (v.kind === 'day' || v.kind === 'rx') finals.set(v.entity_key, v); // ultima per entità (ordine valid_from)
    const dayGone = v => { const d = finals.get(`day:${src.id}:${v.entity_key.split(':')[2]}`); return v.kind === 'rx' && (!d || d.data.removed === true); } // esercizi di giorni rimossi/assenti: non si copiano
    for (const v of finals.values()) if (!v.data.removed && !dayGone(v)) stmts.push(db.prepare(`${INSERT} VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`).bind(subject, id, v.kind, v.entity_key.replace(`:${src.id}:`, `:${id}:`), r.start_date, stableStringify(v.data), `Copiata dalla fase ${src.id}`, nowIso));
  }
  try { await db.batch(stmts); } catch (e) { throw conflict(e); }
  return { phase_id: id };
}

/** Chiude la fase: `last_day` = ultimo giorno incluso; end_date (escluso) = giorno dopo. `report` = snapshot (o null). */
export async function closePhase(db, subject, r, { today, nowIso, report = null }) {
  insist(Number.isInteger(r.phase_id), 422, 'invalid_phase_id');
  const phase = await getPhase(db, subject, r.phase_id); insist(phase, 404, 'phase_not_found'); insist(phase.status === 'active', 409, 'phase_closed');
  insist(validDay(r.last_day) && r.last_day >= phase.start_date && r.last_day <= today, 422, 'invalid_last_day');
  const end = addDays(r.last_day, 1);
  const res = await db.batch([
    db.prepare("UPDATE phases SET status = 'closed', end_date = ?, closed_at = ?, report_json = ? WHERE id = ? AND subject_id = ? AND status = 'active'").bind(end, nowIso, report && stableStringify(report), phase.id, subject),
    db.prepare("UPDATE plan_versions SET valid_to = CASE WHEN valid_from > ? THEN valid_from ELSE ? END WHERE subject_id = ? AND phase_id = ? AND kind IN ('phase', 'day', 'rx') AND valid_to IS NULL").bind(end, end, subject, phase.id),
  ]);
  insist((res[0].meta?.changes ?? 1) === 1, 409, 'phase_closed');
  return { phase_id: phase.id, end_date: end };
}

/** Importa giorni ed esercizi proposti da Lyfta (`days` = suggerimento già calcolato dal server) nella fase attiva: UNA sola scrittura atomica.
 *  Le entità già presenti vengono saltate (reimportare è sicuro). */
export async function importDays(db, subject, r, days, { today, nowIso }) {
  insist(Number.isInteger(r.phase_id), 422, 'invalid_phase_id');
  const phase = await getPhase(db, subject, r.phase_id); insist(phase, 404, 'phase_not_found'); insist(phase.status === 'active', 409, 'phase_closed');
  const valid_from = r.valid_from ?? phase.start_date; insist(validDay(valid_from) && valid_from >= phase.start_date && valid_from <= addDays(today, 60), 422, 'invalid_valid_from');
  const { results } = await db.prepare('SELECT entity_key FROM plan_versions WHERE subject_id = ? AND phase_id = ? AND valid_to IS NULL').bind(subject, phase.id).all();
  const have = new Set(results.map(x => x.entity_key)), stmts = [], out = { days_added: 0, exercises_added: 0, skipped: 0 };
  const add = (kind, key, stored) => { if (have.has(key)) { out.skipped++; return false; } have.add(key); stmts.push(db.prepare(`${INSERT} VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`).bind(subject, phase.id, kind, key, valid_from, stableStringify(stored), 'Importata da Lyfta', nowIso)); return true; };
  for (const d of days) {
    const dk = slug(d.title); if (!dk) continue;
    if (add('day', `day:${phase.id}:${dk}`, { label: d.title, ...validateData('day', { order: d.order, focus: null }) })) out.days_added++;
    d.exercises.forEach((e, i) => { const ek = slug(e.exercise); if (ek && add('rx', `rx:${phase.id}:${dk}:${ek}`, { day: d.title, exercise: e.exercise, ...validateData('rx', { order: Math.min(i, 30), sets: e.sets, reps_min: e.reps_min, reps_max: e.reps_max, rir: e.rir, rest_sec: e.rest_sec, ...(e.duration_min != null ? { duration_min: e.duration_min } : {}), method: null, note: null }) })) out.exercises_added++; });
  }
  if (stmts.length) { try { await db.batch(stmts); } catch (e) { throw conflict(e); } }
  return out;
}
