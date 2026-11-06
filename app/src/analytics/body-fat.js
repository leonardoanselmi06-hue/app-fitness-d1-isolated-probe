// Grasso corporeo (Health Connect, scritto da Renpho): serie giornaliera e statistiche. Mancante = null, mai zero.
const DAY_MS = 86_400_000;
const round = (v, n) => (v == null ? null : Math.round(v * 10 ** n) / 10 ** n);
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** `points` = [{time, local_date, pct, origin}] in ordine cronologico. */
export function bodyFatStats(points) {
  if (!points.length) return { count: 0, latest: null, avg_7d: null, avg_prev_7d: null, delta_7d: null, change_in_window: null, daily: [] };
  const byDay = new Map();
  for (const p of points) byDay.set(p.local_date ?? p.time.slice(0, 10), p); // ultima misura del giorno
  const daily = [...byDay.entries()].map(([date, p]) => ({ date, pct: p.pct }));
  const latest = points.at(-1), t = Date.parse(latest.time);
  const within = (a, b) => points.filter(p => { const x = Date.parse(p.time); return x > t - b * DAY_MS && x <= t - a * DAY_MS; }).map(p => p.pct);
  const a7 = within(0, 7), p7 = within(7, 14);
  const avg7 = round(mean(a7), 1), avgPrev = round(mean(p7), 1);
  return {
    count: points.length, latest: { pct: latest.pct, time: latest.time, local_date: latest.local_date },
    avg_7d: avg7, avg_prev_7d: avgPrev, delta_7d: avg7 != null && avgPrev != null ? round(avg7 - avgPrev, 1) : null,
    change_in_window: points.length > 1 ? round(latest.pct - points[0].pct, 1) : null, daily,
  };
}
