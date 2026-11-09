// Aderenza alla scheda: confronta, seduta per seduta, ciò che la scheda IN VIGORE quel giorno prescriveva con ciò che Lyfta ha registrato.
// Solo lettura e deterministico. Dati mancanti = null (mai 0). Il confronto usa le versioni del Piano: se il recupero passa da 2:30 a 3:00
// il 12 novembre, le sedute prima di quella data si confrontano con 2:30 e quelle dopo con 3:00.
// Limiti dichiarati: il flag `completed` di Lyfta è ignorato; una sostituzione è solo "probabile" (stesso muscolo principale);
// non esiste un calendario, quindi "saltato" vale per un esercizio dentro una seduta fatta, non per un giorno mai svolto.
import { getPhase, listVersions, effective } from './store.js';
import { slug } from './schema.js';
import { loadSessionsBetween } from '../coach/data.js';
import { classify, countsAsSet, isCardio, cardioMinutes } from '../coach/muscles.js';
import { analyzeSessions } from '../coach/rules-training.js';
import { addDays, mondayOf, mean, round } from '../coach/stats.js';

const pct = (a, b) => (b > 0 ? round((a / b) * 100, 0) : null);
const muscleOf = name => { const m = classify(name); return m === 'unmapped' || m === 'ignore' ? null : m; };
const workSets = ex => (ex.sets ?? []).filter(s => countsAsSet(s, muscleOf(ex.name)));
const grouped = vers => { const g = new Map(); for (const v of vers) (g.get(v.entity_key) ?? g.set(v.entity_key, []).get(v.entity_key)).push(v); return g; };

/** Una seduta contro la sua scheda del giorno. `presc` = prescrizioni in vigore (dati), `ex` = esercizi registrati da Lyfta. */
export function compareSession(presc, exercises) {
  const done = new Map();
  for (const ex of exercises) {
    const k = slug(String(ex.name ?? '')); if (!k) continue;
    const cur = done.get(k) ?? { name: String(ex.name).trim(), muscle: classify(ex.name), sets: [], rest: null };
    cur.sets.push(...workSets(ex)); if (cur.rest == null && ex.configured_rest_sec > 0) cur.rest = ex.configured_rest_sec; done.set(k, cur);
  }
  const used = new Set(), rows = [];
  for (const p of presc) {
    const k = slug(p.exercise), d = done.get(k); used.add(k);
    if (isCardio(p.exercise) || p.duration_min != null) { // attività secondaria: si confrontano i minuti, non le serie
      const ex = exercises.filter(e => slug(String(e.name ?? '')) === k), min = ex.length ? round(ex.reduce((a, e) => a + (cardioMinutes(e) ?? 0), 0), 1) : 0, any = ex.some(e => (e.sets ?? []).some(x => !x.warmup && (x.duration_sec > 0 || x.distance > 0)));
      const target = p.duration_min ?? null, status = !any ? 'saltato' : target != null && min < target * 0.8 ? 'parziale' : 'completo';
      rows.push({ exercise: p.exercise, kind: 'cardio', minutes_prescribed: target, minutes_done: any ? (min > 0 ? min : null) : 0, status, sets_prescribed: 0, sets_done: 0, reps: null, rir_target: null, rir_logged: null, rir_sets: 0, rir_diff: null, rest_prescribed: null, rest_logged: null, rest_match: null, replaced_by: null, _rirDiffs: [] });
      continue;
    }
    const sets = d ? d.sets : [], n = sets.length;
    const lo = p.reps_min ?? 0, hi = p.reps_max ?? Infinity, hasRange = p.reps_min != null || p.reps_max != null;
    const reps = sets.filter(s => typeof s.reps === 'number' && s.reps > 0);
    const rirs = sets.map(s => s.rir).filter(r => typeof r === 'number');
    const need = p.sets * (p.per_side ? 2 : 1); // per lato: Lyfta registra una serie per ciascun lato
    rows.push({
      exercise: p.exercise, sets_prescribed: need, sets_done: n, status: n === 0 ? 'saltato' : n < need ? 'parziale' : 'completo', replaced_by: null,
      reps: hasRange && reps.length ? { below: reps.filter(s => s.reps < lo).length, in: reps.filter(s => s.reps >= lo && s.reps <= hi).length, above: reps.filter(s => s.reps > hi).length } : null,
      rir_target: p.rir ?? null, rir_logged: rirs.length ? round(mean(rirs), 1) : null, rir_sets: rirs.length, rir_diff: p.rir != null && rirs.length ? round(mean(rirs) - p.rir, 1) : null,
      rest_prescribed: p.rest_sec ?? null, rest_logged: n ? d.rest : null, rest_match: n && p.rest_sec != null && d.rest != null ? p.rest_sec === d.rest : null, // un esercizio non svolto non ha un recupero da confrontare
      _rirDiffs: p.rir != null ? rirs.map(r => r - p.rir) : [],
    });
  }
  let extras = [...done.entries()].filter(([k, d]) => !used.has(k) && d.muscle !== 'ignore' && !isCardio(d.name) && d.sets.length > 0).map(([, d]) => ({ exercise: d.name, sets: d.sets.length, muscle: d.muscle }));
  for (const r of rows) {
    if (r.status !== 'saltato') continue;
    const m = muscleOf(r.exercise); if (!m) continue;
    const i = extras.findIndex(e => e.muscle === m); if (i < 0) continue;
    r.status = 'sostituito'; r.replaced_by = extras[i].exercise; extras = extras.filter((_, j) => j !== i);
  }
  return { rows, extras: extras.map(({ exercise, sets }) => ({ exercise, sets })) };
}

/** `versions`: tutte le versioni della fase; `sessions`: sedute Lyfta nel periodo [start, last]. */
export function computeAdherence({ phase, versions, sessions, start, last }) {
  const g = grouped(versions), rxByDay = new Map();
  for (const [k, vs] of g) if (k.startsWith('rx:')) { const ds = k.split(':')[2]; (rxByDay.get(ds) ?? rxByDay.set(ds, []).get(ds)).push(vs); }
  const matched = [], unmatched = new Map(), strengthIds = new Set(analyzeSessions(sessions).filter(a => a.strength).map(a => a.id));
  let otherUnmatched = 0;
  for (const s of sessions) {
    if (s.date < start || s.date > last) continue;
    const ds = slug(String(s.title ?? '').trim().slice(0, 40)), dv = ds ? effective(g.get(`day:${phase.id}:${ds}`) ?? [], s.date) : null;
    if (!dv || dv.data.removed) { if (strengthIds.has(s.id)) unmatched.set(s.title ?? '(senza titolo)', (unmatched.get(s.title ?? '(senza titolo)') ?? 0) + 1); else otherUnmatched++; continue; }
    const presc = []; for (const vs of rxByDay.get(ds) ?? []) { const rv = effective(vs, s.date); if (rv && !rv.data.removed) presc.push(rv.data); }
    presc.sort((a, b) => a.order - b.order || a.exercise.localeCompare(b.exercise));
    const { rows, extras } = compareSession(presc, s.exercises);
    const secondary = rows.length > 0 && rows.every(r => r.kind === 'cardio');
    if (secondary) {
      const mp = rows.reduce((a, r) => a + (r.minutes_prescribed ?? 0), 0), md = rows.reduce((a, r) => a + Math.min(r.minutes_done ?? 0, r.minutes_prescribed ?? (r.minutes_done ?? 0)), 0), any = rows.some(r => r.status !== 'saltato');
      matched.push({ date: s.date, title: s.title, day: dv.data.label, secondary: true, completion_pct: mp > 0 ? pct(md, mp) : (any ? 100 : 0), minutes_prescribed: mp || null, minutes_done: round(rows.reduce((a, r) => a + (r.minutes_done ?? 0), 0), 1), sets_prescribed: 0, sets_done: 0, exercises: rows, extras });
      continue;
    }
    const sp = rows.reduce((a, r) => a + r.sets_prescribed, 0), sd = rows.reduce((a, r) => a + Math.min(r.sets_done, r.sets_prescribed), 0);
    matched.push({ date: s.date, title: s.title, day: dv.data.label, completion_pct: pct(sd, sp), sets_prescribed: sp, sets_done: sd, exercises: rows, extras });
  }
  // Totali
  let sp = 0, sd = 0, repsIn = 0, repsAll = 0, restOk = 0, restAll = 0, subs = 0, skipped = 0, partial = 0; const rirDiffs = [];
  const perDay = new Map(), perEx = new Map();
  const sec = { sessions: 0, minutes_done: 0, minutes_prescribed: 0, skipped: 0 };
  for (const m of matched) {
    if (m.secondary) {
      sec.sessions++; sec.minutes_done += m.minutes_done ?? 0; sec.minutes_prescribed += m.minutes_prescribed ?? 0; sec.skipped += m.exercises.filter(r => r.status === 'saltato').length;
      const d = perDay.get(m.day) ?? perDay.set(m.day, { day: m.day, secondary: true, sessions: 0, last_date: null, sp: 0, sd: 0 }).get(m.day);
      d.sessions++; d.last_date = m.date; d.sp += m.minutes_prescribed ?? 0; d.sd += Math.min(m.minutes_done ?? 0, m.minutes_prescribed ?? (m.minutes_done ?? 0)); continue;
    }
    const d = perDay.get(m.day) ?? perDay.set(m.day, { day: m.day, sessions: 0, last_date: null, sp: 0, sd: 0 }).get(m.day);
    d.sessions++; d.last_date = m.date; d.sp += m.sets_prescribed; d.sd += m.sets_done; sp += m.sets_prescribed; sd += m.sets_done;
    for (const r of m.exercises) {
      if (r.status === 'saltato') skipped++; else if (r.status === 'parziale') partial++; else if (r.status === 'sostituito') subs++;
      const e = perEx.get(`${m.day}|${slug(r.exercise)}`) ?? perEx.set(`${m.day}|${slug(r.exercise)}`, { day: m.day, exercise: r.exercise, exposures: 0, sp: 0, sd: 0, skipped: 0, repsIn: 0, repsAll: 0, restOk: 0, restAll: 0, rir: [] }).get(`${m.day}|${slug(r.exercise)}`);
      e.exposures++; e.sp += r.sets_prescribed; e.sd += Math.min(r.sets_done, r.sets_prescribed); if (r.status === 'saltato' || r.status === 'sostituito') e.skipped++;
      if (r.reps) { const t = r.reps.below + r.reps.in + r.reps.above; repsAll += t; repsIn += r.reps.in; e.repsAll += t; e.repsIn += r.reps.in; }
      if (r.rest_match != null) { restAll++; if (r.rest_match) restOk++; e.restAll++; if (r.rest_match) e.restOk++; }
      rirDiffs.push(...r._rirDiffs); e.rir.push(...r._rirDiffs);
    }
  }
  for (const m of matched) for (const r of m.exercises) delete r._rirDiffs;
  const per_day = [...perDay.values()].map(d => ({ day: d.day, ...(d.secondary ? { secondary: true } : {}), sessions: d.sessions, last_date: d.last_date, completion_pct: pct(d.sd, d.sp) })).sort((a, b) => a.day.localeCompare(b.day, 'it', { numeric: true }));
  const per_exercise = [...perEx.values()].map(e => ({ day: e.day, exercise: e.exercise, exposures: e.exposures, completion_pct: pct(e.sd, e.sp), skipped: e.skipped, reps_in_range_pct: pct(e.repsIn, e.repsAll), rir_diff: e.rir.length ? round(mean(e.rir), 1) : null, rest_match_pct: pct(e.restOk, e.restAll) }))
    .sort((a, b) => (a.completion_pct ?? 101) - (b.completion_pct ?? 101) || b.exposures - a.exposures || a.exercise.localeCompare(b.exercise));
  // Cardio registrato in Lyfta nel periodo (in scheda o no): sedute e minuti, anche per settimana. Non conta come lavoro di forza.
  const cardioSessions = sessions.filter(x => x.date >= start && x.date <= last).map(x => ({ date: x.date, title: x.title, minutes: round(x.exercises.filter(e => isCardio(e.name)).reduce((a, e) => a + (cardioMinutes(e) ?? 0), 0), 1), has: x.exercises.some(e => isCardio(e.name)) })).filter(x => x.has);
  const spanWeeks = Math.max(1, (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 / 7 + 1 / 7);
  const cardio = { sessions: cardioSessions.length, minutes: round(cardioSessions.reduce((a, x) => a + x.minutes, 0), 0), sessions_per_week: round(cardioSessions.length / spanWeeks, 1), minutes_per_week: round(cardioSessions.reduce((a, x) => a + x.minutes, 0) / spanWeeks, 0), recent: cardioSessions.slice(-6).map(({ date, title, minutes }) => ({ date, title, minutes: minutes || null })), note: 'Minuti = somma delle durate registrate in Lyfta; la distanza non è usata (unità non documentata).' };
  const planDays = []; for (const [k, vs] of g) if (k.startsWith('day:')) { const v = effective(vs, last) ?? vs.at(-1); if (v && !v.data.removed) planDays.push(v.data.label); }
  const done = new Set(matched.map(m => m.day));
  const weeks = []; for (let w = mondayOf(start); w <= last; w = addDays(w, 7)) weeks.push({ week_start: w, sessions: matched.filter(m => !m.secondary && m.date >= w && m.date < addDays(w, 7)).length, partial: w < start || addDays(w, 6) > last });
  return {
    range: { from: start, to: last }, plan_days: planDays.length, cardio, secondary: { ...sec, minutes_done: round(sec.minutes_done, 0), minutes_prescribed: sec.minutes_prescribed || null, completion_pct: pct(Math.min(sec.minutes_done, sec.minutes_prescribed || sec.minutes_done), sec.minutes_prescribed) },
    sessions: { matched: matched.length, unmatched_strength: [...unmatched.values()].reduce((a, b) => a + b, 0), unmatched_other: otherUnmatched },
    sets: { prescribed: sp, done: sd, completion_pct: pct(sd, sp) },
    exercises: { skipped, partial, substituted: subs },
    reps_in_range_pct: pct(repsIn, repsAll), rir_diff_avg: rirDiffs.length ? round(mean(rirDiffs), 1) : null, rir_sets: rirDiffs.length,
    rest_match_pct: pct(restOk, restAll), rest_compared: restAll,
    days_never_done: planDays.filter(d => !done.has(d)).sort((a, b) => a.localeCompare(b, 'it', { numeric: true })),
    unmatched_titles: [...unmatched].map(([title, n]) => ({ title, sessions: n })).sort((a, b) => b.sessions - a.sessions).slice(0, 8),
    per_day, per_exercise, weeks, recent: matched.slice().reverse().slice(0, 12),
    note: matched.length < 3 ? 'Meno di 3 sedute confrontabili: le percentuali sono poco significative.' : null,
  };
}

/** Versione compatta per il report di fase (senza dettaglio delle sedute). */
export const adherenceSummary = a => ({ cardio: a.cardio, secondary: a.secondary, sessions: a.sessions, sets: a.sets, exercises: a.exercises, reps_in_range_pct: a.reps_in_range_pct, rir_diff_avg: a.rir_diff_avg, rest_match_pct: a.rest_match_pct, days_never_done: a.days_never_done, per_day: a.per_day, worst_exercises: a.per_exercise.filter(e => e.completion_pct != null && e.completion_pct < 100).slice(0, 8) });

/** Vista per la PWA: fase richiesta (o attiva). 3 query D1 in tutto. */
export async function adherenceView(db, subject, { phaseId, today }) {
  const phase = phaseId != null ? await getPhase(db, subject, phaseId) : await db.prepare("SELECT * FROM phases WHERE subject_id = ? AND status = 'active'").bind(subject).first();
  if (!phase) return { phase_id: null, adherence: null };
  const last = phase.end_date ? addDays(phase.end_date, -1) : today;
  if (last < phase.start_date) return { phase_id: phase.id, adherence: null };
  const [versions, sessions] = await Promise.all([listVersions(db, subject, { phaseId: phase.id }), loadSessionsBetween(db, subject, phase.start_date, last)]);
  return { phase_id: phase.id, adherence: computeAdherence({ phase, versions, sessions, start: phase.start_date, last }) };
}
