// Regole su peso, protocollo di pesata, sonno e freschezza dei dati. Ogni esito riporta l'evidenza numerica.
import { addDays, daysBetween, linreg, mean, fmt, sgn, insight } from './stats.js';

const pctWeek = (slopePerDay, meanKg) => (slopePerDay * 7 / meanKg) * 100;

/** Trend del peso su una finestra: regressione sulle pesate giornaliere. null se i dati non bastano. */
export function weightRegression(daily, today, windowDays, { minPoints = 4, minSpan = 14 } = {}) {
  const from = addDays(today, -(windowDays - 1));
  const pts = daily.filter(w => w.date >= from && w.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (pts.length < minPoints) return { reg: null, n: pts.length, span: pts.length ? daysBetween(pts[0].date, pts.at(-1).date) : 0 };
  const span = daysBetween(pts[0].date, pts.at(-1).date);
  if (span < minSpan) return { reg: null, n: pts.length, span };
  const reg = linreg(pts.map(w => ({ x: daysBetween(pts[0].date, w.date), y: w.kg })));
  return { reg, n: pts.length, span };
}

export function weightTrendInsight(weights, today, targets) {
  const { reg, n, span } = weightRegression(weights.daily, today, 28);
  const goal = targets.weight_pct_week ?? targets.weight_gain_pct_week, massa = (targets.goal_type ?? 'massa') === 'massa';
  if (!reg) return { trend: null, insight: insight('weight_trend', 'Andamento del peso', 'insufficiente', `Servono almeno 4 pesate distribuite su 14 giorni: negli ultimi 28 ne ho ${n} su ${span} giorni.`, { evidence: [`Pesate giornaliere (28 g): ${n}`] }) };
  const m = reg.mean_y, est = pctWeek(reg.slope, m), lo = pctWeek(reg.ci[0], m), hi = pctWeek(reg.ci[1], m);
  let verdict, status, summary;
  if (hi < -1) { verdict = 'calo_rapido'; status = 'attenzione'; summary = massa ? `Il peso sta scendendo più di 1% a settimana (${sgn(est, 2)} %/sett.): per un obiettivo di massa è un segnale da controllare.` : `Il peso sta scendendo più di 1% a settimana (${sgn(est, 2)} %/sett.): un ritmo così rapido rischia di costare massa muscolare.`; }
  else if (hi < goal.min) { verdict = 'sotto'; status = 'attenzione'; summary = massa ? `Il peso cresce meno dell'obiettivo (${sgn(est, 2)} %/sett. contro ${fmt(goal.min, 2)}–${fmt(goal.max, 2)}).` : `Il peso scende più del previsto (${sgn(est, 2)} %/sett. contro ${sgn(goal.min, 2)}…${sgn(goal.max, 2)}).`; }
  else if (lo > goal.max) { verdict = 'sopra'; status = 'attenzione'; summary = massa ? `Il peso cresce più in fretta dell'obiettivo (${sgn(est, 2)} %/sett. contro ${fmt(goal.min, 2)}–${fmt(goal.max, 2)}): rischio di più grasso che muscolo.` : `Il peso sale o scende meno del previsto (${sgn(est, 2)} %/sett. contro ${sgn(goal.min, 2)}…${sgn(goal.max, 2)}).`; }
  else if (lo >= goal.min && hi <= goal.max) { verdict = 'dentro'; status = 'ok'; summary = massa ? `Il peso cresce in linea con l'obiettivo (${sgn(est, 2)} %/sett.).` : `Il peso si muove in linea con l'obiettivo (${sgn(est, 2)} %/sett.).`; }
  else { verdict = 'incerto'; status = 'info'; summary = `Il trend (${sgn(est, 2)} %/sett.) è troppo incerto per dire se sei in linea: l'intervallo copre più esiti.`; }
  const evidence = [
    `Pendenza 28 g: ${sgn(est, 2)} %/sett. (intervallo 95%: ${sgn(lo, 2)} … ${sgn(hi, 2)})`,
    `${n} pesate su ${span} giorni, peso medio ${fmt(m, 1)} kg`, `Obiettivo: ${massa ? `${fmt(goal.min, 2)}–${fmt(goal.max, 2)}` : `${sgn(goal.min, 2)} … ${sgn(goal.max, 2)}`} %/sett.${targets.goal_type ? ` (${targets.goal_type})` : ''}`,
  ];
  const long = weightRegression(weights.daily, today, 84, { minPoints: 6, minSpan: 42 }).reg;
  if (long) evidence.push(`Su 84 g: ${sgn(pctWeek(long.slope, long.mean_y), 2)} %/sett.`);
  return { trend: { reg, est, lo, hi, verdict }, insight: insight('weight_trend', 'Andamento del peso', status, summary, { evidence, data: { verdict, pct_week: est, ci: [lo, hi], n, span } }) };
}

export function weighinInsight(weights, today) {
  const from = addDays(today, -27);
  const raw = weights.raw.filter(w => w.date >= from && w.date <= today);
  const outside = raw.filter(w => w.hour < 6 || w.hour >= 10).length;
  const share = raw.length ? outside / raw.length : null;
  const ev = [`Pesate negli ultimi 28 giorni: ${raw.length}`, share == null ? 'Fascia 6–10: nessun dato' : `Fuori dalla fascia 6–10: ${outside} su ${raw.length}`];
  const action = 'Pesati 3–4 mattine a settimana, dopo il bagno e prima di colazione: il trend diventa molto più affidabile.';
  if (raw.length < 8) return insight('weighin_protocol', 'Regolarità delle pesate', 'attenzione', `Poche pesate (${raw.length} in 28 giorni, ne servono almeno 8).`, { evidence: ev, action });
  if (share > 0.3) return insight('weighin_protocol', 'Regolarità delle pesate', 'attenzione', 'Molte pesate fuori dalla fascia del mattino: il rumore giornaliero nasconde il trend.', { evidence: ev, action });
  return insight('weighin_protocol', 'Regolarità delle pesate', 'ok', 'Pesate regolari e per lo più al mattino.', { evidence: ev });
}

export function freshnessInsight(weights, today) {
  const last = weights.daily.at(-1);
  if (!last) return insight('freshness', 'Aggiornamento dei dati', 'info', 'Nessuna pesata negli ultimi 90 giorni.');
  const age = daysBetween(last.date, today);
  return age > 7 ? insight('freshness', 'Aggiornamento dei dati', 'info', `L'ultima pesata risale a ${age} giorni fa (${last.date}).`, { evidence: [`Ultima pesata: ${last.date}, ${fmt(last.kg, 1)} kg`] }) : null;
}

export function sleepInsight(sleep, targets) {
  const need = targets.sleep_min_hours * 60;
  const nights = sleep.nights.filter(n => !n.short).slice(-7);
  if (nights.length < 4) return insight('sleep', 'Sonno', 'insufficiente', `Servono almeno 4 notti recenti: ne ho ${nights.length}.`, { evidence: [`Notti regolari considerate: ${nights.length}`] });
  const avg = mean(nights.map(n => n.duration_min)), under6 = nights.filter(n => n.duration_min < 360).length;
  const ev = [`Media ultime ${nights.length} notti: ${fmt(avg / 60, 1)} h (obiettivo ≥ ${fmt(targets.sleep_min_hours, 1)} h)`, `Notti sotto le 6 h: ${under6}`];
  if (avg < need) return insight('sleep', 'Sonno', 'attenzione', `Dormi in media ${fmt(avg / 60, 1)} h: sotto l'obiettivo di ${fmt(targets.sleep_min_hours, 1)} h, e il recupero muscolare ne risente.`, { evidence: ev, action: `Anticipa l'andare a letto di ${Math.max(15, Math.round((need - avg) / 15) * 15)} minuti per portare la media a ${fmt(targets.sleep_min_hours, 1)} h.`, data: { avg_min: Math.round(avg), under6 } });
  return insight('sleep', 'Sonno', 'ok', `Sonno in linea (${fmt(avg / 60, 1)} h in media).`, { evidence: ev, data: { avg_min: Math.round(avg), under6 } });
}
