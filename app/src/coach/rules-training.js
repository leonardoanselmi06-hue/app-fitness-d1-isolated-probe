// Regole di allenamento: costanza, volume per muscolo e progressione. Solo serie dirette di forza (vedi muscles.js).
import { addDays, mondayOf, mean, fmt, sgn, insight } from './stats.js';
import { MUSCLE_LABEL, INDIRECT_WEIGHT, classify, countsAsSet, epley, normalizeName, secondaryOf } from './muscles.js';
import { classifyAll } from './progression.js';

const MIN_SETS_SESSION = 4;

/** Per ogni allenamento: serie dirette per muscolo, totale e nomi non riconosciuti. */
export function analyzeSessions(sessions) {
  return sessions.map(s => {
    const sets = {}, indirect = {}, unmapped = {};
    let total = 0;
    for (const ex of s.exercises) {
      const muscle = classify(ex.name);
      if (muscle === 'ignore') continue;
      const n = (ex.sets ?? []).filter(x => countsAsSet(x, muscle === 'unmapped' ? null : muscle)).length;
      if (!n) continue;
      if (muscle === 'unmapped') { const k = String(ex.name ?? '').trim() || '(senza nome)'; unmapped[k] = (unmapped[k] ?? 0) + n; continue; }
      sets[muscle] = (sets[muscle] ?? 0) + n; total += n;
      for (const m2 of secondaryOf(ex.name)) indirect[m2] = (indirect[m2] ?? 0) + n;
    }
    return { id: s.id, date: s.date, sets, indirect, total, strength: total >= MIN_SETS_SESSION, unmapped };
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
    const ind = analyzed.reduce((a, s) => a + (weeks.some(w => inWeek(s, w)) ? (s.indirect?.[m] ?? 0) : 0), 0);
    const sets = total / weeks.length, indirect = ind / weeks.length, eff = sets + INDIRECT_WEIGHT * indirect, freq = freqSessions / weeks.length;
    const state = eff < min ? 'basso' : sets > max ? 'alto' : 'ok'; // le serie indirette (peso ridotto) evitano falsi "basso" ma non producono "alto"
    return { muscle: m, label: MUSCLE_LABEL[m], sets_per_week: sets, indirect_sets_per_week: indirect, effective_sets_per_week: eff, sessions_per_week: freq, state, low_freq: sets > 0 && freq < minFreq };
  });
  const unmapped = {};
  for (const s of analyzed) if (weeks.some(w => inWeek(s, w))) for (const [k, v] of Object.entries(s.unmapped)) unmapped[k] = (unmapped[k] ?? 0) + v;
  const ev = muscles.map(x => `${x.label}: ${fmt(x.sets_per_week, 1)} serie dirette/sett.${x.indirect_sets_per_week > 0 ? ` + ${fmt(x.indirect_sets_per_week, 1)} indirette (efficaci ${fmt(x.effective_sets_per_week, 1)})` : ''}, ${fmt(x.sessions_per_week, 1)}× a settimana`);
  ev.push(`Obiettivo: ${min}–${max} serie per muscolo a settimana (dirette + ${INDIRECT_WEIGHT} × indirette dei muscoli secondari), almeno ${minFreq}× a settimana`);
  const names = Object.keys(unmapped);
  if (names.length) ev.push(`Esercizi non riconosciuti (non conteggiati): ${names.join(', ')}`);
  const data = { weeks, muscles, unmapped };
  const low = muscles.filter(x => x.state === 'basso'), lowFreq = muscles.filter(x => x.state !== 'basso' && x.low_freq), high = muscles.filter(x => x.state === 'alto');
  if (low.length || lowFreq.length) {
    const parts = low.map(x => `${x.label} (+${Math.ceil(min - x.effective_sets_per_week)} serie)`).concat(lowFreq.map(x => `${x.label} (distribuisci su ${targets.min_weekly_frequency_per_muscle} giorni)`));
    return insight('muscle_volume', 'Volume per muscolo', 'attenzione', `Volume sotto il minimo per ${low.length} muscol${low.length === 1 ? 'o' : 'i'}${lowFreq.length ? ' e frequenza bassa per altri' : ''}: ${[...low, ...lowFreq].map(x => x.label).join(', ')}.`, { evidence: ev, action: `Aggiungi serie dirette alla scheda: ${parts.join(', ')}.`, data });
  }
  if (high.length) return insight('muscle_volume', 'Volume per muscolo', 'info', `Volume alto per ${high.map(x => x.label).join(', ')}: oltre ${max} serie i benefici crescono poco e il recupero costa.`, { evidence: ev, data });
  return insight('muscle_volume', 'Volume per muscolo', 'ok', 'Volume e frequenza in linea per tutti i muscoli.', { evidence: ev, data });
}

/** Miglior valore per esercizio e seduta: e1RM (Epley) se c'è carico esterno, altrimenti ripetizioni. */
export function exerciseSeries(sessions) {
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

export function progressionInsight(sessions, today = sessions.at(-1)?.date ?? null) {
  if (!today) return insight('progression', 'Progressione dei carichi', 'insufficiente', 'Nessun allenamento registrato: non posso valutare la progressione.', { evidence: ['Esercizi valutabili: 0'] });
  const g = classifyAll(sessions, today), ev = g.exercises.filter(r => r.status !== 'insufficiente'), unit = r => (r.metric === 'e1rm_kg' ? 'e1RM' : 'ripetizioni');
  const directTxt = r => (r.direct?.available ? ` · valori reali: ${r.direct.text}${r.direct.verdict === 'up' ? ' (migliora)' : r.direct.verdict === 'down' ? ' (peggiora)' : r.direct.verdict === 'same' ? ' (invariato)' : ''}${r.direct.reasons.length ? `; ${r.direct.reasons.join(', ')}` : ''}` : '');
  const lines = ev.slice(0, 8).map(r => `${r.name}: ${r.status} (${sgn(r.pct_week, 1)}% a settimana, ${unit(r)} ${fmt(r.last_value, 1)}, ${r.n_window} sedute${r.status === 'ferma' && r.days_since_best != null ? `, ultimo massimo ${r.days_since_best} giorni fa` : ''}${r.confidence === 'bassa' ? ', RIR mancante: fiducia bassa' : ''})${directTxt(r)}`);
  const evidence = [`Classificazione: ${g.label} · in progresso ${g.counts.progressing}, fermi ${g.counts.stalled}, in calo ${g.counts.declining} su ${g.evaluable} valutabili (finestra ${g.window_days} giorni, almeno 3 sedute su 21 giorni)`, ...lines];
  if (g.counts.insufficient) evidence.push(`Non valutabili: ${g.counts.insufficient} (troppo poche sedute recenti)`);
  const low = ev.filter(r => r.confidence === 'bassa').length; if (low > 0 && low >= ev.length / 2) evidence.push('Il RIR manca in molte serie: senza RIR un aumento di carico può nascondere un impegno maggiore. Registralo in Lyfta.');
  const data = { overall: g.key, label: g.label, counts: g.counts, exercises: g.exercises };
  const worst = ev.filter(r => r.status !== 'in progresso').slice(0, 3).map(r => r.name).join(', ');
  if (g.key === 'insufficient') return insight('progression', 'Progressione dei carichi', 'insufficiente', `Servono almeno 3 esercizi con 3 sedute su 21 giorni nelle ultime 4 settimane: ne ho ${g.evaluable}.`, { evidence, data });
  if (g.key === 'declining') return insight('progression', 'Progressione dei carichi', 'attenzione', `Prestazioni in calo su ${g.counts.declining} esercizi su ${g.evaluable}.`, { evidence, action: `Prima di cambiare la scheda verifica sonno, calorie, giorni di riposo e le note del periodo. Esercizi: ${worst}.`, data });
  if (g.key === 'stalling') return insight('progression', 'Progressione dei carichi', 'attenzione', `Progressione in stallo: ${g.counts.stalled} esercizi su ${g.evaluable} senza nuovi massimi da oltre 6 settimane.`, { evidence, action: `Per ${worst}: prova a salire di una ripetizione per serie a parità di carico, poi aumenta il peso. Se persiste, rivedi volume e recupero della fase.`, data });
  if (g.key === 'progressing') return insight('progression', 'Progressione dei carichi', 'ok', `Progressione in corso (${g.counts.progressing} esercizi su ${g.evaluable}).`, { evidence, data });
  if (g.key === 'stable') return insight('progression', 'Progressione dei carichi', 'info', `Prestazioni stabili su ${g.counts.stalled} esercizi su ${g.evaluable}: nessun calo, nessun nuovo massimo recente.`, { evidence, data });
  return insight('progression', 'Progressione dei carichi', 'info', `Quadro misto: ${g.counts.progressing} in progresso, ${g.counts.stalled} fermi, ${g.counts.declining} in calo.`, { evidence, data });
}
