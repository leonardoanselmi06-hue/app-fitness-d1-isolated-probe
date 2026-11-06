// Regole di allenamento: costanza, volume per muscolo e progressione. Solo serie dirette di forza (vedi muscles.js).
import { addDays, mondayOf, mean, fmt, sgn, insight } from './stats.js';
import { MUSCLE_LABEL, classify, countsAsSet, epley, normalizeName } from './muscles.js';

const MIN_SETS_SESSION = 4;

/** Per ogni allenamento: serie dirette per muscolo, totale e nomi non riconosciuti. */
export function analyzeSessions(sessions) {
  return sessions.map(s => {
    const sets = {}, unmapped = {};
    let total = 0;
    for (const ex of s.exercises) {
      const muscle = classify(ex.name);
      if (muscle === 'ignore') continue;
      const n = (ex.sets ?? []).filter(x => countsAsSet(x, muscle === 'unmapped' ? null : muscle)).length;
      if (!n) continue;
      if (muscle === 'unmapped') { const k = String(ex.name ?? '').trim() || '(senza nome)'; unmapped[k] = (unmapped[k] ?? 0) + n; continue; }
      sets[muscle] = (sets[muscle] ?? 0) + n; total += n;
    }
    return { id: s.id, date: s.date, sets, total, strength: total >= MIN_SETS_SESSION, unmapped };
  });
}

const weekStarts = (today, n) => Array.from({ length: n }, (_, i) => addDays(mondayOf(today), -7 * (n - i))); // ultime n settimane complete
const inWeek = (a, start) => a.date >= start && a.date < addDays(start, 7);

export function adherenceInsight(analyzed, today, targets) {
  const weeks = weekStarts(today, 3), target = targets.strength_sessions_per_week;
  const counts = weeks.map(w => analyzed.filter(a => a.strength && inWeek(a, w)).length);
  const avg = mean(counts), thisWeek = analyzed.filter(a => a.strength && a.date >= mondayOf(today)).length;
  const ev = [`Sedute di forza nelle ultime 3 settimane complete: ${counts.join(' · ')} (media ${fmt(avg, 1)}, obiettivo ${target})`, `Questa settimana finora: ${thisWeek}`, `Seduta di forza = almeno ${MIN_SETS_SESSION} serie dirette di lavoro`];
  const data = { weeks: weeks.map((w, i) => ({ week_start: w, sessions: counts[i] })), avg, target, this_week: thisWeek };
  if (avg < target - 0.5) return insight('training_adherence', 'Costanza degli allenamenti', 'attenzione', `Ti alleni in media ${fmt(avg, 1)} volte a settimana contro le ${target} previste.`, { evidence: ev, action: `Fissa ${target} slot settimanali in agenda: la costanza pesa più di qualsiasi ritocco alla scheda.`, data });
  return insight('training_adherence', 'Costanza degli allenamenti', 'ok', `Costanza in linea (${fmt(avg, 1)} sedute a settimana su ${target}).`, { evidence: ev, data });
}

export function volumeInsight(analyzed, today, targets) {
  const weeks = weekStarts(today, 2), { min, max } = targets.sets_per_muscle_week, minFreq = targets.min_weekly_frequency_per_muscle;
  const muscles = targets.muscles.map(m => {
    const total = analyzed.reduce((a, s) => a + (weeks.some(w => inWeek(s, w)) ? (s.sets[m] ?? 0) : 0), 0);
    const freqSessions = analyzed.filter(s => weeks.some(w => inWeek(s, w)) && (s.sets[m] ?? 0) >= 2).length;
    const sets = total / weeks.length, freq = freqSessions / weeks.length;
    const state = sets < min ? 'basso' : sets > max ? 'alto' : 'ok';
    return { muscle: m, label: MUSCLE_LABEL[m], sets_per_week: sets, sessions_per_week: freq, state, low_freq: sets > 0 && freq < minFreq };
  });
  const unmapped = {};
  for (const s of analyzed) if (weeks.some(w => inWeek(s, w))) for (const [k, v] of Object.entries(s.unmapped)) unmapped[k] = (unmapped[k] ?? 0) + v;
  const ev = muscles.map(x => `${x.label}: ${fmt(x.sets_per_week, 1)} serie/sett., ${fmt(x.sessions_per_week, 1)}× a settimana`);
  ev.push(`Obiettivo: ${min}–${max} serie dirette per muscolo a settimana, almeno ${minFreq}× a settimana`);
  const names = Object.keys(unmapped);
  if (names.length) ev.push(`Esercizi non riconosciuti (non conteggiati): ${names.join(', ')}`);
  const data = { weeks, muscles, unmapped };
  const low = muscles.filter(x => x.state === 'basso'), lowFreq = muscles.filter(x => x.state !== 'basso' && x.low_freq), high = muscles.filter(x => x.state === 'alto');
  if (low.length || lowFreq.length) {
    const parts = low.map(x => `${x.label} (+${Math.ceil(min - x.sets_per_week)} serie)`).concat(lowFreq.map(x => `${x.label} (distribuisci su ${targets.min_weekly_frequency_per_muscle} giorni)`));
    return insight('muscle_volume', 'Volume per muscolo', 'attenzione', `Volume sotto il minimo per ${low.length} muscol${low.length === 1 ? 'o' : 'i'}${lowFreq.length ? ' e frequenza bassa per altri' : ''}: ${[...low, ...lowFreq].map(x => x.label).join(', ')}.`, { evidence: ev, action: `Aggiungi serie dirette alla scheda: ${parts.join(', ')}.`, data });
  }
  if (high.length) return insight('muscle_volume', 'Volume per muscolo', 'info', `Volume alto per ${high.map(x => x.label).join(', ')}: oltre ${max} serie i benefici crescono poco e il recupero costa.`, { evidence: ev, data });
  return insight('muscle_volume', 'Volume per muscolo', 'ok', 'Volume e frequenza in linea per tutti i muscoli.', { evidence: ev, data });
}

/** Miglior valore per esercizio e seduta: e1RM (Epley) se c'è carico esterno, altrimenti ripetizioni. */
function exerciseSeries(sessions) {
  const map = new Map();
  for (const s of sessions) {
    for (const ex of s.exercises) {
      const muscle = classify(ex.name);
      if (muscle === 'ignore' || muscle === 'unmapped' || muscle === 'addome' || muscle === 'collo') continue;
      const sets = (ex.sets ?? []).filter(x => countsAsSet(x, muscle));
      if (!sets.length) continue;
      const e1 = Math.max(0, ...sets.map(x => epley(x.external_load_kg, x.reps) ?? 0)), reps = Math.max(...sets.map(x => x.reps));
      const key = normalizeName(ex.name);
      if (!map.has(key)) map.set(key, { name: String(ex.name).trim(), muscle, points: [] });
      map.get(key).points.push({ date: s.date, e1rm: e1 > 0 ? e1 : null, reps });
    }
  }
  return [...map.values()];
}

export function progressionInsight(sessions) {
  const rows = [];
  for (const ex of exerciseSeries(sessions)) {
    const pts = ex.points.sort((a, b) => (a.date < b.date ? -1 : 1));
    if (pts.length < 6) continue;
    const useLoad = pts.filter(p => p.e1rm != null).length >= pts.length / 2;
    const vals = pts.filter(p => (useLoad ? p.e1rm != null : true)).map(p => (useLoad ? p.e1rm : p.reps)).slice(-6);
    if (vals.length < 6) continue;
    const prev = mean(vals.slice(0, 3)), last = mean(vals.slice(3));
    if (!(prev > 0)) continue;
    const pct = ((last - prev) / prev) * 100;
    rows.push({ name: ex.name, metric: useLoad ? 'e1rm_kg' : 'reps', prev, last, pct, trend: pct >= 1.5 ? 'progresso' : pct <= -1.5 ? 'calo' : 'stabile' });
  }
  if (rows.length < 3) return insight('progression', 'Progressione dei carichi', 'insufficiente', `Servono almeno 3 esercizi con 6 sedute negli ultimi 84 giorni: ne ho ${rows.length}.`, { evidence: [`Esercizi valutabili: ${rows.length}`] });
  const count = t => rows.filter(r => r.trend === t).length, stalled = rows.filter(r => r.trend !== 'progresso');
  const ev = [`In progresso: ${count('progresso')} · stabili: ${count('stabile')} · in calo: ${count('calo')} (su ${rows.length}, ultime 3 sedute contro le 3 precedenti)`,
    ...rows.slice().sort((a, b) => a.pct - b.pct).slice(0, 5).map(r => `${r.name}: ${sgn(r.pct, 1)}% (${r.metric === 'e1rm_kg' ? 'e1RM' : 'ripetizioni'})`)];
  const data = { exercises: rows };
  if (stalled.length / rows.length >= 0.4) {
    const names = stalled.sort((a, b) => a.pct - b.pct).slice(0, 3).map(r => r.name).join(', ');
    return insight('progression', 'Progressione dei carichi', 'attenzione', `${stalled.length} esercizi su ${rows.length} non stanno progredendo.`, { evidence: ev, action: `Per ${names}: prova a salire di una ripetizione per serie a parità di carico, poi aumenta il peso.`, data });
  }
  return insight('progression', 'Progressione dei carichi', 'ok', `La maggior parte degli esercizi progredisce (${count('progresso')} su ${rows.length}).`, { evidence: ev, data });
}
