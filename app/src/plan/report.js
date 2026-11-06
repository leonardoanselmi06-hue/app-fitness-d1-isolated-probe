// Report di fase: snapshot deterministico scritto UNA volta alla chiusura (non si ricalcola mai da solo).
// Riusa le stesse viste/regole del Coach e della PWA (stessi numeri). Dati insufficienti = null, mai zero; ogni sezione dichiara i limiti.
import { localDate } from '../core/time.js';
import { nutritionView, sleepView, stepsView } from '../analytics/daily-views.js';
import { addDays, daysBetween, mean, round, linreg } from '../coach/stats.js';
import { loadSessionsBetween } from '../coach/data.js';
import { analyzeSessions, exerciseSeries } from '../coach/rules-training.js';
import { MUSCLE_LABEL } from '../coach/muscles.js';
import { classifyAll } from '../coach/progression.js';
import { listVersions, effective } from './store.js';
import { computeAdherence, adherenceSummary } from './adherence.js';

const noon = d => new Date(`${d}T12:00:00Z`); // "adesso" fittizio: il giorno dopo l'ultimo giorno, così l'ultimo giorno è completo
const inRange = (d, a, b) => d != null && d >= a && d <= b;

export async function weightsAndFat(db, subject, start, last) {
  const { results } = await db.prepare("SELECT observed_at, payload_json FROM current_records WHERE subject_id = ? AND domain = 'body' AND deleted = 0 AND observed_at >= ? AND observed_at <= ? ORDER BY observed_at ASC")
    .bind(subject, `${addDays(start, -1)}T00:00:00Z`, `${addDays(last, 2)}T00:00:00Z`).all();
  const w = new Map(), f = new Map();
  for (const r of results) {
    const p = JSON.parse(r.payload_json), time = p.time ?? r.observed_at, date = p.local_date ?? localDate(time);
    if (!inRange(date, start, last)) continue;
    if (p.metric === 'body_weight_kg' && Number.isFinite(p.kg) && p.kg > 0) w.set(date, p.kg);
    if (p.metric === 'body_fat_pct' && Number.isFinite(p.pct)) f.set(date, p.pct);
  }
  return { weights: [...w.entries()].map(([date, kg]) => ({ date, kg })), fat: [...f.entries()].map(([date, pct]) => ({ date, pct })) };
}
const kEdge = n => Math.max(1, Math.min(3, Math.floor(n / 2))); // primi/ultimi k valori senza sovrapposizione
const edge = (xs, k) => ({ first: mean(xs.slice(0, k)), last: mean(xs.slice(-k)) });

function weightSection(ws, start) {
  if (!ws.length) return { n_days: 0, start_kg: null, end_kg: null, change_kg: null, rate_pct_week: null, note: 'Nessuna pesata nella fase.' };
  const k = kEdge(ws.length), e = edge(ws.map(x => x.kg), k);
  const span = daysBetween(ws[0].date, ws.at(-1).date), reg = ws.length >= 4 && span >= 14 ? linreg(ws.map(x => ({ x: daysBetween(start, x.date), y: x.kg }))) : null;
  return { n_days: ws.length, start_kg: round(e.first, 2), end_kg: round(e.last, 2), change_kg: round(e.last - e.first, 2), rate_pct_week: reg ? round((reg.slope * 7 / reg.mean_y) * 100, 2) : null, note: reg ? null : 'Servono almeno 4 giorni di pesate su 14 giorni per il ritmo settimanale.', basis: `media dei primi/ultimi ${k} giorni con pesata` };
}

async function nutritionSection(db, subject, start, last, avgKg) {
  const days = [], seen = new Set(); let end = last;
  while (end >= start) {
    const span = Math.min(60, daysBetween(start, end) + 1), v = await nutritionView(db, subject, { days: span, now: noon(addDays(end, 1)) });
    for (const d of v.by_day) if (inRange(d.date, start, end) && !seen.has(d.date)) { seen.add(d.date); days.push(d); }
    end = addDays(end, -span);
  }
  const complete = days.filter(d => d.completeness.complete === true), kcal = complete.map(d => d.totals.calories).filter(x => x != null), pro = complete.map(d => d.totals.protein).filter(x => x != null);
  const cal = daysBetween(start, last) + 1, protein = mean(pro);
  return { calendar_days: cal, logged_days: days.length, complete_days: complete.length, avg_kcal: kcal.length ? round(mean(kcal), 0) : null, avg_protein_g: pro.length ? round(protein, 0) : null, protein_g_per_kg: protein != null && avgKg ? round(protein / avgKg, 2) : null, note: complete.length < 10 ? 'Meno di 10 giorni completi: medie poco affidabili.' : null };
}

function trainingSection(sessions, start, last) {
  const g = classifyAll(sessions, last), overall = { key: g.key, label: g.label, evaluable: g.evaluable, counts: g.counts, window_days: g.window_days }; // ultime 4 settimane della fase
  const an = analyzeSessions(sessions), strength = an.filter(a => a.strength), weeks = Math.max(1, (daysBetween(start, last) + 1) / 7);
  const sets = {}; for (const a of strength) for (const [m, n] of Object.entries(a.sets)) sets[m] = (sets[m] ?? 0) + n;
  const perWeek = Object.fromEntries(Object.entries(sets).map(([m, n]) => [MUSCLE_LABEL[m] ?? m, round(n / weeks, 1)]));
  const rests = [], rirs = [];
  for (const s of sessions) for (const ex of s.exercises) { const ws = (ex.sets ?? []).filter(x => !x.warmup && x.reps > 0); if (!ws.length) continue; if (ex.configured_rest_sec > 0) rests.push(ex.configured_rest_sec); for (const x of ws) if (typeof x.rir === 'number') rirs.push(x.rir); }
  const prog = [];
  for (const ex of exerciseSeries(sessions)) {
    const pts = ex.points.sort((a, b) => (a.date < b.date ? -1 : 1)); if (pts.length < 4) continue;
    const useLoad = pts.filter(p => p.e1rm != null).length >= pts.length / 2, vals = pts.filter(p => (useLoad ? p.e1rm != null : true)).map(p => (useLoad ? p.e1rm : p.reps)); if (vals.length < 4) continue;
    const k = Math.min(3, Math.floor(vals.length / 2)), e = edge(vals, k), pct = ((e.last - e.first) / e.first) * 100;
    prog.push({ exercise: ex.name, metric: useLoad ? 'e1rm_kg' : 'reps', first: round(e.first, 1), last: round(e.last, 1), pct: round(pct, 1), sessions: pts.length, trend: pct >= 1.5 ? 'progresso' : pct <= -1.5 ? 'calo' : 'stabile' });
  }
  return { sessions_total: sessions.length, sessions_strength: strength.length, strength_per_week: round(strength.length / weeks, 1), sets_per_muscle_week: perWeek, avg_rest_sec: rests.length ? round(mean(rests), 0) : null, avg_rir_logged: rirs.length ? round(mean(rirs), 1) : null, rir_sets_with_value: rirs.length, progression: prog.sort((a, b) => b.pct - a.pct), progression_overall: overall };
}

/** `phase`: riga di `phases`; `lastDay`: ultimo giorno incluso. */
export async function buildPhaseReport(db, subject, phase, lastDay) {
  const start = phase.start_date, days = daysBetween(start, lastDay) + 1, span = Math.min(365, days + 1), now = noon(addDays(lastDay, 1));
  const { weights, fat } = await weightsAndFat(db, subject, start, lastDay);
  const w = weightSection(weights, start);
  const [nutrition, sleepV, stepsV, sessions, vers] = await Promise.all([
    nutritionSection(db, subject, start, lastDay, w.start_kg != null ? mean(weights.map(x => x.kg)) : null),
    sleepView(db, subject, { days: span, now }), stepsView(db, subject, { days: span, now }),
    loadSessionsBetween(db, subject, start, lastDay), listVersions(db, subject, { phaseId: phase.id }),
  ]);
  const nights = sleepV.nights.filter(n => inRange(n.date, start, lastDay) && !n.short), st = stepsV.series.filter(s => inRange(s.date, start, lastDay));
  const byKey = new Map(); for (const v of vers) (byKey.get(v.entity_key) ?? byKey.set(v.entity_key, []).get(v.entity_key)).push(v);
  const meta = effective(byKey.get(`phase:${phase.id}`) ?? [], lastDay)?.data ?? {}, endDay = addDays(lastDay, 1);
  const finalOf = list => list.filter(v => v.valid_from < endDay).at(-1) ?? list.at(-1);
  const scheda = [...byKey].filter(([k]) => k.startsWith('day:')).map(([k, list]) => ({ d: finalOf(list), k })).filter(x => x.d && !x.d.data.removed).sort((a, b) => a.d.data.order - b.d.data.order)
    .map(({ d, k }) => ({ label: d.data.label, exercises: [...byKey].filter(([k2]) => k2.startsWith(`rx:${phase.id}:${k.split(':')[2]}:`)).map(([, l]) => ({ v: finalOf(l), n: l.length })).filter(x => !x.v.data.removed).sort((a, b) => a.v.data.order - b.v.data.order).map(({ v, n }) => ({ exercise: v.data.exercise, sets: v.data.sets, reps_min: v.data.reps_min, reps_max: v.data.reps_max, rir: v.data.rir, rest_sec: v.data.rest_sec, method: v.data.method, versions: n })) }));
  const { results: noteRows } = await db.prepare("SELECT data_json FROM plan_versions WHERE subject_id = ? AND kind = 'note' AND valid_to IS NULL").bind(subject).all();
  const notes = noteRows.map(r => JSON.parse(r.data_json)).filter(n => !n.removed && inRange(n.date, start, lastDay)).sort((a, b) => (a.date < b.date ? -1 : 1)).map(n => ({ date: n.date, category: n.category, title: n.title }));
  return {
    report_version: 1, phase: { id: phase.id, name: meta.name ?? null, goal: meta.goal ?? null, method: meta.method ?? null },
    period: { start, last_day: lastDay, days, weeks: round(days / 7, 1) }, weight: w,
    body_fat: { n: fat.length, start_pct: fat.length ? round(edge(fat.map(x => x.pct), kEdge(fat.length)).first, 1) : null, end_pct: fat.length ? round(edge(fat.map(x => x.pct), kEdge(fat.length)).last, 1) : null },
    nutrition, sleep: { nights: nights.length, avg_min: nights.length ? round(mean(nights.map(n => n.duration_min)), 0) : null },
    steps: { days: st.length, avg: st.length ? round(mean(st.map(s => s.count)), 0) : null },
    training: trainingSection(sessions, start, lastDay), adherence: adherenceSummary(computeAdherence({ phase, versions: vers, sessions, start, last: lastDay })), scheda, scheda_changes: [...byKey].filter(([k]) => k.startsWith('rx:')).reduce((n, [, l]) => n + l.length - 1, 0), notes,
  };
}
