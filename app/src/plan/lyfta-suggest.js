// Proposta di scheda dalle sedute Lyfta (sola lettura): per ogni titolo di allenamento, l'ultima seduta del periodo.
// L'utente sceglie cosa importare e poi corregge: nulla qui è un'inferenza sul "vero" programma, sono i dati registrati.
import { loadSessionsBetween } from '../coach/data.js';
import { classify } from '../coach/muscles.js';

const work = ex => (ex.sets ?? []).filter(s => !s.warmup && ((typeof s.reps === 'number' && s.reps > 0) || (typeof s.duration_sec === 'number' && s.duration_sec >= 10)));
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
      if (!name || name.length > 80 || !ws.length || classify(name) === 'ignore' || seen.has(key)) continue; seen.add(key);
      const reps = ws.map(s => s.reps).filter(r => Number.isInteger(r) && r > 0), rirs = ws.map(s => s.rir).filter(r => typeof r === 'number' && r >= 0 && r <= 6 && Number.isInteger(r * 2));
      exercises.push({ exercise: name, sets: Math.min(ws.length, 20), reps_min: reps.length ? Math.min(...reps) : null, reps_max: reps.length ? Math.max(...reps) : null, rir: mode(rirs), rest_sec: Number.isInteger(ex.configured_rest_sec) && ex.configured_rest_sec > 0 && ex.configured_rest_sec <= 900 ? ex.configured_rest_sec : null, method: null });
    }
    if (exercises.length) days.push({ title, sessions: list.length, first_date: list[0].date, last_date: last.date, exercises });
  }
  return days.sort((a, b) => a.title.localeCompare(b.title, 'it', { numeric: true })).slice(0, 12).map((d, i) => ({ ...d, order: i }));
}

export async function suggestFromLyfta(db, subject, { from, to }) {
  return { from, to, days: suggestDays(await loadSessionsBetween(db, subject, from, to)) };
}
