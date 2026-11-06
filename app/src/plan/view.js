// Lettura del Piano: fase attiva con la scheda IN VIGORE oggi, elenco fasi, note. Solo lettura; i valori mancanti sono null.
import { effective, listVersions } from './store.js';

const group = vers => { const m = new Map(); for (const v of vers) (m.get(v.entity_key) ?? m.set(v.entity_key, []).get(v.entity_key)).push(v); return m; };
const latest = vers => vers.find(v => v.valid_to == null) ?? vers.at(-1);
const brief = (v, vers, today) => ({ version_id: latest(vers).id, valid_from: v.valid_from, versions: vers.length, pending: latest(vers).valid_from > today ? { valid_from: latest(vers).valid_from, ...latest(vers).data } : null });

export async function planView(db, subject, { today }) {
  const { results: phaseRows } = await db.prepare('SELECT id, start_date, end_date, status, report_json IS NOT NULL AS has_report FROM phases WHERE subject_id = ? ORDER BY start_date DESC, id DESC').bind(subject).all();
  const { results: metaRows } = await db.prepare("SELECT phase_id, data_json FROM plan_versions WHERE subject_id = ? AND kind = 'phase' ORDER BY valid_from ASC, id ASC").bind(subject).all();
  const meta = new Map(metaRows.map(r => [r.phase_id, JSON.parse(r.data_json)])); // l'ultima versione per fase vince
  const phases = phaseRows.map(p => ({ id: p.id, start_date: p.start_date, end_date: p.end_date, status: p.status, has_report: !!p.has_report, ...(meta.get(p.id) ?? { name: null, goal: null, method: null }) }));
  const act = phases.find(p => p.status === 'active') ?? null;
  let active = null;
  if (act) {
    const g = group(await listVersions(db, subject, { phaseId: act.id }));
    const phaseVers = g.get(`phase:${act.id}`) ?? [], pv = effective(phaseVers, today) ?? phaseVers[0];
    const days = [];
    for (const [key, vers] of g) {
      if (!key.startsWith('day:')) continue;
      const v = effective(vers, today); if (!v || v.data.removed) continue;
      const exercises = [];
      for (const [k2, v2s] of g) {
        if (!k2.startsWith(`rx:${act.id}:${key.split(':')[2]}:`)) continue;
        const e = effective(v2s, today); if (!e || e.data.removed) continue;
        exercises.push({ key: k2, ...e.data, ...brief(e, v2s, today) });
      }
      exercises.sort((a, b) => a.order - b.order || a.exercise.localeCompare(b.exercise));
      days.push({ key, label: v.data.label, order: v.data.order, focus: v.data.focus, ...brief(v, vers, today), exercises });
    }
    days.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    active = { ...act, phase_version_id: latest(phaseVers).id, name: pv?.data.name ?? act.name, days };
  }
  const { results: noteRows } = await db.prepare("SELECT entity_key FROM plan_versions WHERE subject_id = ? AND kind = 'note' AND valid_to IS NULL").bind(subject).all();
  const notes = [];
  for (const { entity_key } of noteRows) {
    const vers = await listVersions(db, subject, { entity: entity_key }), v = latest(vers);
    if (!v.data.removed) notes.push({ note_id: entity_key.slice(5), version_id: v.id, phase_id: v.phase_id, ...v.data, edited_at: v.created_at, versions: vers.length });
  }
  notes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { today, phases, active, notes: notes.slice(0, 200) };
}

/** Storico completo di un'entità o di una fase (per la schermata "storico"). */
export async function historyView(db, subject, { entity, phase_id }) {
  const vers = entity ? await listVersions(db, subject, { entity }) : await listVersions(db, subject, { phaseId: phase_id });
  return { versions: vers };
}
