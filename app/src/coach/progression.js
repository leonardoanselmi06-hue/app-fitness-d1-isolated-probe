// Progressione dei carichi (bozza DEC-COACH-002, CANDIDATE). Deterministica; dati insufficienti = esito esplicito, mai un numero inventato.
// Indicatore per esposizione (una seduta di un esercizio): e1RM di Epley con carico esterno, altrimenti ripetizioni. Se il RIR è registrato
// nella gran parte delle serie si usa la forma "aggiustata" (ripetizioni + RIR): salire di carico arrivando più vicino al cedimento NON vale
// come miglioramento. Senza RIR si usa la forma semplice e la fiducia è bassa.
// Stallo: finestra di 28 giorni con almeno 3 esposizioni comparabili distribuite su almeno 21 giorni; altrimenti "insufficiente".
import { classify, countsAsSet, epley, normalizeName } from './muscles.js';
import { addDays, daysBetween, mean, round, linreg, fmt } from './stats.js';

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

// ---- Confronto diretto sui valori reali (carico, ripetizioni, RIR, serie), senza passare solo dall'e1RM ----
// Esempi che deve riconoscere: 8×3 a 20 kg → 8×3 a 24 kg (carico su); 8×3 → 10×3 a 20 kg (ripetizioni su);
// 8×3 a 20 kg RIR 1 → RIR 2 (stesso lavoro con più margine = su). Ripetizioni "efficaci" = ripetizioni + RIR (solo se il RIR c'è in entrambe).
const TOL_KG = 0.01, E1RM_BAND = 1.5, MIN_DIRECT_SPAN = 7;
export function exposureSummary(x) {
  const loads = x.sets.map(s => s.load).filter(l => l != null), top = loads.length ? Math.max(...loads) : null;
  const at = top != null ? x.sets.filter(s => s.load != null && s.load >= top - TOL_KG) : x.sets, rirs = at.map(s => s.rir).filter(r => r != null);
  return { date: x.date, load: top, sets: at.length, reps: round(mean(at.map(s => s.reps)), 1), rir: rirs.length >= at.length / 2 ? round(mean(rirs), 1) : null };
}
const eff = (x, useRir) => x.reps + (useRir ? x.rir : 0);
export function compareDirect(a, b) {
  const useRir = a.rir != null && b.rir != null, reasons = [];
  let verdict = 'same';
  const sameLoad = a.load == null || b.load == null ? a.load === b.load : Math.abs(a.load - b.load) < TOL_KG;
  if (a.load == null !== (b.load == null)) return { verdict: 'unclear', reasons: ['uno dei due confronti senza carico esterno'] };
  if (!sameLoad) {
    const e = x => x.load * (1 + Math.min(12, eff(x, useRir)) / 30), pct = ((e(b) - e(a)) / e(a)) * 100;
    verdict = pct >= E1RM_BAND ? 'up' : pct <= -E1RM_BAND ? 'down' : 'same';
    reasons.push(`carico ${fmt(a.load, 1)} → ${fmt(b.load, 1)} kg`);
    if (Math.abs(b.reps - a.reps) >= 0.5) reasons.push(`ripetizioni ${fmt(a.reps, 1)} → ${fmt(b.reps, 1)}`);
    if (useRir && a.rir !== b.rir) reasons.push(`RIR ${fmt(a.rir, 1)} → ${fmt(b.rir, 1)}`);
    return { verdict, reasons };
  }
  const d = eff(b, useRir) - eff(a, useRir);
  if (d >= 1) verdict = 'up'; else if (d <= -1) verdict = 'down';
  else if (b.sets > a.sets) { verdict = 'up'; reasons.push(`serie ${a.sets} → ${b.sets}`); }
  if (Math.abs(b.reps - a.reps) >= 0.5) reasons.push(`ripetizioni ${fmt(a.reps, 1)} → ${fmt(b.reps, 1)}`);
  if (useRir && a.rir !== b.rir) reasons.push(`RIR ${fmt(a.rir, 1)} → ${fmt(b.rir, 1)}`);
  return { verdict, reasons };
}
export const summaryText = x => `${x.load != null ? `${fmt(x.load, 1)} kg` : 'corpo libero'} ${x.sets}×${fmt(x.reps, 1)}${x.rir != null ? ` RIR ${fmt(x.rir, 1)}` : ''}`;
function directOf(exp, today) {
  const from = addDays(today, -WINDOW_DAYS), win = exp.exposures.filter(x => x.date > from && x.date <= today).map(exposureSummary);
  if (win.length < 2) return { available: false, reason: `${win.length} esposizion${win.length === 1 ? 'e' : 'i'} nella finestra (ne servono 2)` };
  const first = win[0], last = win.at(-1), span = daysBetween(first.date, last.date);
  if (span < MIN_DIRECT_SPAN) return { available: false, reason: `prima e ultima seduta a soli ${span} giorni (ne servono ${MIN_DIRECT_SPAN})` };
  const c = compareDirect(first, last);
  return { available: true, verdict: c.verdict, reasons: c.reasons, first, last, text: `${summaryText(first)} → ${summaryText(last)}`, trend: win.slice(-6) };
}

/** Esito per esercizio alla data `today`. */
export function classifyExercise(exp, today) {
  const { metric, adjusted, points } = seriesOf(exp), from = addDays(today, -WINDOW_DAYS);
  const win = points.filter(p => p.date > from && p.date <= today), prior = points.filter(p => p.date <= from);
  const base = { direct: directOf(exp, today), name: exp.name, muscle: exp.muscle, metric, rir_used: adjusted, n_window: win.length, status: 'insufficiente', reason: null, pct_week: null, change_pct: null, last_value: win.at(-1)?.value ?? null, best_value: null, best_date: null, days_since_best: null, confidence: adjusted ? 'alta' : 'bassa' };
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
