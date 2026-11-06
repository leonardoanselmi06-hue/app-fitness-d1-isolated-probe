// Confronto tra periodi: ultimi N giorni (7/14/28) contro gli N precedenti, per peso, grasso, calorie e proteine (solo giorni completi),
// allenamento (sedute e serie per muscolo), sonno, passi, recupero percepito. Solo lettura, deterministico.
// Regole: dato mancante = null (mai 0); il confronto esiste solo con abbastanza osservazioni in ENTRAMBI i periodi; nessun giudizio (su/giù non è bene/male).
import { localDate } from '../core/time.js';
import { addDays, mean, round, calendarDays } from '../coach/stats.js';
import { nutritionView, sleepView, stepsView } from '../analytics/daily-views.js';
import { loadSessionsBetween } from '../coach/data.js';
import { analyzeSessions } from '../coach/rules-training.js';
import { MUSCLE_LABEL } from '../coach/muscles.js';
import { weightsAndFat } from '../plan/report.js';
import { loadCheckins } from '../checkin/store.js';

export const PERIODS = [7, 14, 28];
const MIN_N = { weight: 2, fat: 2, kcal: 3, protein: 3, sleep: 3, steps: 3, recovery: 3 };

/** items: [{date, v}] → confronto. `from*`/`to*` inclusi. */
function metric(key, label, unit, dec, items, win) {
  const take = (a, b) => items.filter(i => i.date >= a && i.date <= b && i.v != null).map(i => i.v);
  const cur = take(win.curFrom, win.today), prev = take(win.prevFrom, win.prevTo);
  const enough = cur.length >= MIN_N[key] && prev.length >= MIN_N[key];
  const c = cur.length >= MIN_N[key] ? round(mean(cur), dec) : null, p = prev.length >= MIN_N[key] ? round(mean(prev), dec) : null;
  return { key, label, unit, current: { value: c, n: cur.length }, previous: { value: p, n: prev.length }, delta: enough ? round(c - p, dec) : null, delta_pct: enough && p > 0 ? round(((c - p) / p) * 100, 1) : null };
}

export async function comparePeriods(db, subject, { days, now }) {
  const n = PERIODS.includes(days) ? days : 14, today = localDate(now.toISOString(), 'Europe/Rome');
  const win = { today, curFrom: addDays(today, -(n - 1)), prevTo: addDays(today, -n), prevFrom: addDays(today, -(2 * n - 1)) };
  const [wf, nut, sleep, steps, sessions, checkins] = await Promise.all([
    weightsAndFat(db, subject, win.prevFrom, today), nutritionView(db, subject, { days: 2 * n, now }), sleepView(db, subject, { days: 2 * n + 1, now }),
    stepsView(db, subject, { days: Math.max(7, 2 * n), now }), loadSessionsBetween(db, subject, win.prevFrom, today), loadCheckins(db, subject, win.prevFrom, today),
  ]);
  const completeDays = nut.by_day.filter(d => d.completeness.complete === true);
  const metrics = [
    metric('weight', 'Peso', 'kg', 2, wf.weights.map(w => ({ date: w.date, v: w.kg })), win),
    metric('fat', 'Grasso corporeo', '%', 1, wf.fat.map(f => ({ date: f.date, v: f.pct })), win),
    metric('kcal', 'Calorie (giorni completi)', 'kcal', 0, completeDays.map(d => ({ date: d.date, v: d.totals.calories })), win),
    metric('protein', 'Proteine (giorni completi)', 'g', 0, completeDays.map(d => ({ date: d.date, v: d.totals.protein })), win),
    metric('sleep', 'Sonno (notti regolari)', 'min', 0, sleep.nights.filter(x => !x.short && x.date).map(x => ({ date: x.date, v: x.duration_min })), win),
    metric('steps', 'Passi (giorni conclusi)', 'passi', 0, steps.series.filter(s => s.date < today).map(s => ({ date: s.date, v: s.count })), win),
    metric('recovery', 'Indice di recupero', '/100', 0, checkins.map(c => ({ date: c.day, v: c.index })), win),
  ];
  // Allenamento: conteggi reali (zero sedute è un dato vero solo se esistono dati Lyfta nel periodo complessivo; altrimenti null).
  const an = analyzeSessions(sessions), inWin = (a, b) => an.filter(x => x.date >= a && x.date <= b), haveAny = an.length > 0;
  const part = (a, b) => { const xs = inWin(a, b).filter(x => x.strength), sets = {}; for (const x of xs) for (const [m, k] of Object.entries(x.sets)) sets[m] = (sets[m] ?? 0) + k; return { sessions: xs.length, sets }; };
  const cur = part(win.curFrom, today), prev = part(win.prevFrom, win.prevTo), perWeek = k => round((k * 7) / n, 1);
  const muscles = Object.keys({ ...cur.sets, ...prev.sets }).map(m => ({ muscle: m, label: MUSCLE_LABEL[m] ?? m, current: perWeek(cur.sets[m] ?? 0), previous: perWeek(prev.sets[m] ?? 0), delta: round(perWeek(cur.sets[m] ?? 0) - perWeek(prev.sets[m] ?? 0), 1) })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label));
  return {
    days: n, periods: PERIODS, today, current: { from: win.curFrom, to: today }, previous: { from: win.prevFrom, to: win.prevTo }, metrics,
    training: haveAny ? { sessions: { current: cur.sessions, previous: prev.sessions, delta: cur.sessions - prev.sessions }, sets_total_per_week: { current: perWeek(Object.values(cur.sets).reduce((a, b) => a + b, 0)), previous: perWeek(Object.values(prev.sets).reduce((a, b) => a + b, 0)) }, muscles } : null,
    calendar_days: calendarDays(win.curFrom, today).length,
    note: 'Un confronto compare solo se ci sono abbastanza osservazioni in entrambi i periodi. Su e giù non indicano bene o male.',
  };
}
