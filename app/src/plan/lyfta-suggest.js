// Proposta di scheda dalle sedute Lyfta (sola lettura): per ogni titolo di allenamento, l'ultima seduta del periodo.
// L'utente sceglie cosa importare e poi corregge: nulla qui è un'inferenza sul "vero" programma, sono i dati registrati.
import { loadSessionsBetween } from '../coach/data.js';
import { classify, isCardio, cardioMinutes } from '../coach/muscles.js';

const work = ex => (ex.sets ?? []).filter(s => !s.warmup && ((typeof s.reps === 'number' && s.reps > 0) || (typeof s.duration_sec === 'number' && s.duration_sec >= 10)));
const SIDE = /\b(side|laterale|unilateral|single[- ]arm|single[- ]leg)\b/i; // ipotesi: Lyfta non distingue destra/sinistra, l'utente conferma nel modulo
const median = xs => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mode = xs => { const c = new Map(); for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null; };

export function suggestDays(sessions) {
  const byTitle = new Map();
  for (const s of sessions) if (s.title) (byTitle.get(s.title.trim().slice(0, 40)) ?? byTitle.set(s.title.trim().slice(0, 40), []).get(s.title.trim().slice(0, 40))).push(s);
  const days = [];
  for (const [title, list] of byTitle) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = list.at(-1), seen = new Set(), exercises = [];
    for (const ex of last.exercises) {
      const name = String(ex.name ?? '').trim(), ws = work(ex), key = name.toLowerCase();
      if (!name || name.length > 80 || !ws.length || (classify(name) === 'ignore' && !isCardio(name)) || seen.has(key)) continue; seen.add(key);
      if (isCardio(name)) { const min = cardioMinutes(ex); exercises.push({ exercise: name, sets: 1, reps_min: null, reps_max: null, rir: null, rest_sec: null, duration_min: min != null ? Math.min(600, Math.max(1, Math.round(min))) : null, method: null }); continue; } // cardio: attività secondaria con durata
      const reps = ws.map(s => s.reps).filter(r => Number.isInteger(r) && r > 0), rirs = ws.map(s => s.rir).filter(r => typeof r === 'number' && r >= 0 && r <= 6 && Number.isInteger(r * 2));
      const holds = ws.filter(s => !(s.reps > 0) && s.duration_sec >= 10).map(s => s.duration_sec);
      if (holds.length && holds.length === ws.length) { // esercizio a tempo (plank): tenuta per serie, nessun range di ripetizioni
        const side = SIDE.test(name) && ws.length % 2 === 0;
        exercises.push({ exercise: name, sets: Math.min(side ? ws.length / 2 : ws.length, 20), hold_sec: Math.min(900, Math.max(5, Math.round(median(holds)))), ...(side ? { per_side: true } : {}), reps_min: null, reps_max: null, rir: null, rest_sec: Number.isInteger(ex.configured_rest_sec) && ex.configured_rest_sec > 0 && ex.configured_rest_sec <= 900 ? ex.configured_rest_sec : null, method: null }); continue;
      }
      exercises.push({ exercise: name, sets: Math.min(ws.length, 20), reps_min: reps.length ? Math.min(...reps) : null, reps_max: reps.length ? Math.max(...reps) : null, rir: mode(rirs), rest_sec: Number.isInteger(ex.configured_rest_sec) && ex.configured_rest_sec > 0 && ex.configured_rest_sec <= 900 ? ex.configured_rest_sec : null, method: null });
    }
    if (exercises.length) days.push({ title, sessions: list.length, first_date: list[0].date, last_date: last.date, exercises });
  }
  return days.sort((a, b) => a.title.localeCompare(b.title, 'it', { numeric: true })).slice(0, 12).map((d, i) => ({ ...d, order: i }));
}

export async function suggestFromLyfta(db, subject, { from, to }) {
  return { from, to, days: suggestDays(await loadSessionsBetween(db, subject, from, to)) };
}
