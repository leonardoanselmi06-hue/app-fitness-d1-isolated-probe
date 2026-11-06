// Statistica minima e deterministica per il Coach (nessuna dipendenza). Valori non calcolabili = null, mai 0.
export const DAY_MS = 86_400_000;
export const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
export const calendarDays = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
export const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const median = xs => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const round = (x, d = 1) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
export const roundTo = (x, step) => (x == null || !Number.isFinite(x) ? null : Math.round(x / step) * step);

// Lunedì della settimana di una data (YYYY-MM-DD).
export const mondayOf = d => { const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; return addDays(d, -dow); };

// t di Student bilaterale 95% per i gradi di libertà 1..30; oltre usa 1.96.
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
export const tCrit95 = df => (df < 1 ? null : df <= 30 ? T95[df - 1] : 1.96);

/** Regressione lineare y ~ x con errore standard della pendenza. Servono almeno 3 punti con x distinti. */
export function linreg(points) {
  const n = points.length;
  if (n < 3) return null;
  const mx = mean(points.map(p => p.x)), my = mean(points.map(p => p.y));
  const sxx = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx;
  const intercept = my - slope * mx;
  const sse = points.reduce((a, p) => a + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const se = Math.sqrt(sse / (n - 2) / sxx);
  const t = tCrit95(n - 2);
  return { n, slope, intercept, se, ci: [slope - t * se, slope + t * se], mean_y: my };
}

// Formattazione italiana per i testi di evidenza (virgola decimale, segno esplicito).
export const fmt = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : String(Math.round(x * 10 ** d) / 10 ** d).replace('.', ','));
export const sgn = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${fmt(Math.abs(x), d)}`);

// Forma comune di ogni consiglio del Coach.
export const PRIORITY = Object.freeze({ nutrition_logging: 10, training_adherence: 9, weight_trend: 8, muscle_volume: 7, energy_balance: 7, progression: 6, protein: 6, sleep: 5, recovery: 5, weighin_protocol: 4, freshness: 3 });
export const insight = (id, title, status, summary, { evidence = [], action = null, data = null } = {}) =>
  ({ id, title, status, priority: PRIORITY[id] ?? 0, summary, evidence, action, data }); // status: ok | attenzione | info | insufficiente
