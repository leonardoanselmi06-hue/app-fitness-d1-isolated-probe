// Dossier per l'IA: tutto ciò che l'app ha già calcolato (Coach, confronto tra periodi, aderenza, scheda, note, qualità dei dati), in forma compatta.
// Nessuna identità (niente email o nome), nessun id interno. Le note sono dati dell'utente: il testo è incluso solo se l'interruttore è acceso.
// Deterministico: stesso database = stesso dossier (serve a hash e cache).
import { coachReview } from '../coach/review.js';
import { comparePeriods } from '../compare/periods.js';
import { adherenceView } from '../plan/adherence.js';
import { planView } from '../plan/view.js';
import { localDate } from '../core/time.js';
import { addDays } from '../coach/stats.js';
import { classify, secondaryOf, MUSCLE_LABEL } from '../coach/muscles.js';

const clip = (s, n) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n - 1)}…` : s);
const rest = s => (s == null ? null : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
const muscleTag = name => { const m = classify(name); if (m === 'ignore' || m === 'unmapped') return m === 'unmapped' ? ' [muscolo non riconosciuto]' : ''; const sec = secondaryOf(name); return ` [primario: ${MUSCLE_LABEL[m] ?? m}${sec.length ? `; secondari: ${sec.map(x => MUSCLE_LABEL[x] ?? x).join(', ')}` : ''}]`; };
const rxLine = e => `${e.exercise} ${e.sets}×${e.reps_min ?? '?'}${e.reps_max != null && e.reps_max !== e.reps_min ? `–${e.reps_max}` : ''}${e.rir != null ? ` RIR${e.rir}` : ''}${e.rest_sec != null ? ` rec ${rest(e.rest_sec)}` : ''}${e.method ? ` (${e.method})` : ''}${muscleTag(e.exercise)}`;

function insightBrief(i) {
  const out = { id: i.id, title: i.title, status: i.status, summary: i.summary, evidence: (i.evidence ?? []).slice(0, 8).map(e => clip(e, 260)), action: i.action ?? null };
  if (i.id === 'progression' && i.data?.exercises) out.exercises = i.data.exercises.slice(0, 14).map(e => ({ name: e.name, status: e.status, pct_week: e.pct_week, change_pct: e.change_pct, last: e.last_value, days_since_best: e.days_since_best, sessions_28d: e.n_window, confidence: e.confidence, why_not: e.reason, real_values: e.direct?.available ? { first: e.direct.first, last: e.direct.last, verdict: e.direct.verdict, reasons: e.direct.reasons, recent_sessions: e.direct.trend } : { unavailable: e.direct?.reason ?? null } }));
  if (i.id === 'recovery' && i.data) out.recovery = { last7: i.data.last7, prev7: i.data.prev7, sleep_regularity: i.data.regularity };
  return out;
}

export async function buildDossier(db, subject, { now, sendNotes }) {
  const today = localDate(now.toISOString(), 'Europe/Rome');
  const [review, plan] = await Promise.all([coachReview(db, subject, { now }), planView(db, subject, { today })]);
  const [cmp, adh] = await Promise.all([comparePeriods(db, subject, { days: 14, now }), adherenceView(db, subject, { phaseId: plan.active?.id ?? null, today })]);
  const a = plan.active, vals = review.targets.values;
  const weeksIn = a ? Math.round(((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${a.start_date}T00:00:00Z`)) / 86_400_000 / 7) * 10) / 10 : null;
  const notes = plan.notes.filter(n => n.date >= addDays(today, -90)).slice(0, 25).map(n => (sendNotes ? { date: n.date, category: n.category, title: clip(n.title, 80), text: clip(n.text ?? null, 300) } : { date: n.date, category: n.category }));
  const adhesion = adh.adherence;
  return {
    as_of: today,
    goal_context: a ? { phase: a.name, goal: a.goal ?? null, goal_type: a.goal_type ?? null, declared: !!(a.goal || a.goal_type || a.name), method: a.method ?? null, started: a.start_date, weeks_in: weeksIn } : { phase: null, declared: false, note: 'Nessuna fase attiva: l\'obiettivo dell\'utente NON è dichiarato. I target qui sotto sono default generici, non una sua scelta.' },
    targets: { weight_pct_week: vals.weight_pct_week, protein_g_per_kg: vals.protein_g_per_kg, sets_per_muscle_week: vals.sets_per_muscle_week, strength_sessions_per_week: vals.strength_sessions_per_week, min_weekly_frequency_per_muscle: vals.min_weekly_frequency_per_muscle, sleep_min_hours: vals.sleep_min_hours, source: review.targets.version?.source ?? 'default', note: (review.targets.version?.source ?? 'default') === 'phase' ? 'Valori derivati dal tipo di obiettivo della fase e dalle personalizzazioni dell\'utente.' : 'DEFAULT GENERICI dell\'app (stile massa muscolare), non scelti dall\'utente: non trattarli come carenze.' },
    coach: { summary: review.summary, insights: review.insights.map(insightBrief) },
    compare_14d_vs_previous_14d: { current: cmp.current, previous: cmp.previous, metrics: cmp.metrics.map(m => ({ metric: m.label, unit: m.unit, current: m.current.value, previous: m.previous.value, delta: m.delta, delta_pct: m.delta_pct, n_current: m.current.n, n_previous: m.previous.n })), training: cmp.training ? { sessions: cmp.training.sessions, sets_per_week: cmp.training.sets_total_per_week, muscles: cmp.training.muscles.slice(0, 10) } : null },
    adherence_to_plan: adhesion ? { range: adhesion.range, sessions: adhesion.sessions, sets: adhesion.sets, exercises: adhesion.exercises, reps_in_range_pct: adhesion.reps_in_range_pct, rir_logged_minus_planned: adhesion.rir_diff_avg, rest_as_planned_pct: adhesion.rest_match_pct, days_never_done: adhesion.days_never_done, worst_exercises: adhesion.per_exercise.filter(e => e.completion_pct != null && e.completion_pct < 100).slice(0, 8) } : null,
    plan: a ? a.days.map(d => ({ day: d.label, focus: d.focus ?? null, exercises: d.exercises.map(rxLine) })) : [],
    notes,
    notes_text_included: !!sendNotes,
    data_gaps: review.insights.filter(i => i.status === 'insufficiente').map(i => `${i.title}: ${clip(i.summary, 160)}`),
  };
}
