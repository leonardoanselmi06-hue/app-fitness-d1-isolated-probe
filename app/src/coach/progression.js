// Progressione dei carichi (bozza DEC-COACH-002, CANDIDATE). Deterministica; dati insufficienti = esito esplicito, mai un numero inventato.
// Indicatore per esposizione (una seduta di un esercizio): e1RM di Epley con carico esterno, altrimenti ripetizioni. Se il RIR è registrato
// nella gran parte delle serie si usa la forma "aggiustata" (ripetizioni + RIR): salire di carico arrivando più vicino al cedimento NON vale
// come miglioramento. Senza RIR si usa la forma semplice e la fiducia è bassa.
// Stallo: finestra di 28 giorni con almeno 3 esposizioni comparabili distribuite su almeno 21 giorni; altrimenti "insufficiente".
import { classify, countsAsSet, epley, normalizeName } from './muscles.js';
import { addDays, daysBetween, mean, round, linreg } from './stats.js';

export const WINDOW_DAYS = 28, MIN_EXPOSURES = 3, MIN_SPAN_DAYS = 21, LONG_STALL_DAYS = 42, RIR_SHARE = 2 / 3;
export const GLOBAL_LABEL = { progressing: 'IN PROGRESSIONE', stable: 'STABILE', stalling: 'IN STALLO', declining: 'IN CALO', mixed: 'MISTA', insufficient: 'DATI INSUFFICIENTI' };

/** Esposizioni per esercizio: [{name, muscle, exposures:[{date, sets:[{reps, load, rir}]}]}], solo serie dirette di lavoro. */
export function buildExposures(sessions) {
  const map = new Map();
  for (const s of sessions) for (const ex of s.exercises) {
    const muscle = classify(ex.name);
    if (muscle === 'ignore' || muscle === 'unmapped' || muscle === 'addome' || muscle === 'collo') continue;
    const sets = (ex.sets ?? []).filter(x => countsAsSet(x, muscle)).map(x => ({ reps: x.reps, load: typeof x.external_load_kg === 'number' && x.external_load_kg > 0 ? x.external_load_kg : null, rir: typeof x.rir === 'number' && x.rir >= 0 ? x.rir : null }));
    if (!sets.length) continue;
    const key = normalizeName(ex.name), e = map.get(key) ?? map.set(key, { name: String(ex.name).trim(), muscle, byDate: new Map() }).get(key);
    (e.byDate.get(s.date) ?? e.byDate.set(s.date, []).get(s.date)).push(...sets); // due blocchi lo stesso giorno = una esposizione
  }
  return [...map.values()].map(e => ({ name: e.name, muscle: e.muscle, exposures: [...e.byDate].map(([date, sets]) => ({ date, sets })).sort((a, b) => (a.date < b.date ? -1 : 1)) }));
}

/** Valori comparabili: {metric:'e1rm_kg'|'reps', adjusted, points:[{date, value, rir_share}]}. */
export function seriesOf(exp) {
  const loaded = exp.exposures.filter(x => x.sets.some(s => s.load != null));
  const useLoad = loaded.length >= exp.exposures.length / 2;
  const sets = exp.exposures.flatMap(x => x.sets).filter(s => (useLoad ? s.load != null && s.reps <= 12 : true));
  const adjusted = sets.length > 0 && sets.filter(s => s.rir != null).length / sets.length >= RIR_SHARE;
  const points = [];
  for (const x of exp.exposures) {
    const ss = x.sets.filter(s => (useLoad ? s.load != null && s.reps <= 12 : true) && (!adjusted || s.rir != null));
    if (!ss.length) continue;
    const val = s => { const r = adjusted ? s.reps + s.rir : s.reps; return useLoad ? epley(s.load, Math.min(r, 12)) : r; }; // oltre 12 ripetizioni Epley non è affidabile: tetto a 12
    const vals = ss.map(val).filter(v => v != null && v > 0); if (!vals.length) continue;
    points.push({ date: x.date, value: Math.max(...vals), rir_share: ss.filter(s => s.rir != null).length / ss.length });
  }
  return { metric: useLoad ? 'e1rm_kg' : 'reps', adjusted, points };
}

/** Esito per esercizio alla data `today`. */
export function classifyExercise(exp, today) {
  const { metric, adjusted, points } = seriesOf(exp), from = addDays(today, -WINDOW_DAYS);
  const win = points.filter(p => p.date > from && p.date <= today), prior = points.filter(p => p.date <= from);
  const base = { name: exp.name, muscle: exp.muscle, metric, rir_used: adjusted, n_window: win.length, status: 'insufficiente', reason: null, pct_week: null, change_pct: null, last_value: win.at(-1)?.value ?? null, best_value: null, best_date: null, days_since_best: null, confidence: adjusted ? 'alta' : 'bassa' };
  const span = win.length ? daysBetween(win[0].date, win.at(-1).date) : 0;
  if (win.length < MIN_EXPOSURES) return { ...base, reason: `${win.length} esposizion${win.length === 1 ? 'e' : 'i'} negli ultimi ${WINDOW_DAYS} giorni (ne servono ${MIN_EXPOSURES})` };
  if (span < MIN_SPAN_DAYS) return { ...base, reason: `esposizioni concentrate in ${span} giorni (ne servono ${MIN_SPAN_DAYS})` };
  const reg = linreg(win.map(p => ({ x: daysBetween(win[0].date, p.date), y: p.value })));
  const pctWeek = reg && reg.mean_y > 0 ? (reg.slope * 7 / reg.mean_y) * 100 : null;
  const first2 = mean(win.slice(0, 2).map(p => p.value)), last2 = mean(win.slice(-2).map(p => p.value)), change = first2 > 0 ? ((last2 - first2) / first2) * 100 : null;
  const bestPrior = prior.length ? Math.max(...prior.map(p => p.value)) : null, bestWin = Math.max(...win.map(p => p.value));
  const newBest = bestPrior != null && bestWin >= bestPrior * 1.01;
  const all = [...prior, ...win], top = Math.max(...all.map(p => p.value)), bestPoint = all.find(p => p.value >= top * 0.99); // il primo giorno in cui ha raggiunto il massimo: da lì "nessun nuovo massimo"
  let status = 'ferma';
  if (pctWeek != null && change != null && pctWeek <= -1 && change <= -3) status = 'in calo';
  else if (pctWeek != null && ((newBest && pctWeek >= 0) || (pctWeek >= 0.5 && change != null && change >= 1))) status = 'in progresso';
  return { ...base, status, pct_week: round(pctWeek, 2), change_pct: round(change, 1), last_value: round(win.at(-1).value, 1), best_value: round(top, 1), best_date: bestPoint.date, days_since_best: daysBetween(bestPoint.date, today), confidence: mean(win.map(p => p.rir_share)) >= RIR_SHARE && adjusted ? 'alta' : 'bassa' };
}

/** Classificazione globale su tutti gli esercizi valutabili. */
export function classifyAll(sessions, today) {
  const rows = buildExposures(sessions).map(e => classifyExercise(e, today)), ev = rows.filter(r => r.status !== 'insufficiente');
  const n = ev.length, c = s => ev.filter(r => r.status === s).length, counts = { progressing: c('in progresso'), stalled: c('ferma'), declining: c('in calo'), insufficient: rows.length - n };
  let key;
  if (n < 3) key = 'insufficient';
  else if (counts.declining / n >= 0.4) key = 'declining';
  else if (counts.progressing / n >= 0.5 && counts.declining / n <= 0.2) key = 'progressing';
  else if (counts.stalled / n >= 0.5 && counts.declining / n <= 0.2 && counts.progressing / n < 0.3) {
    const stalled = ev.filter(r => r.status === 'ferma'), long = stalled.filter(r => (r.days_since_best ?? 0) >= LONG_STALL_DAYS).length;
    key = long / stalled.length >= 0.5 ? 'stalling' : 'stable';
  } else key = 'mixed';
  return { key, label: GLOBAL_LABEL[key], evaluable: n, counts, window_days: WINDOW_DAYS, exercises: rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.pct_week ?? 0) - (b.pct_week ?? 0) || a.name.localeCompare(b.name)) };
}
const ORDER = { 'in calo': 0, ferma: 1, 'in progresso': 2, insufficiente: 3 };
