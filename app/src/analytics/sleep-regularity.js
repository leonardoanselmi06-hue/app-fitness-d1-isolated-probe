// Regolarità degli orari del sonno sulle ultime 14 notti regolari (servono almeno 7). Deviazione standard di orario di letto e di risveglio, in minuti.
// L'orario di letto si misura dalle 18:00 per non spezzare le notti a cavallo della mezzanotte. Soglie indicative (non cliniche):
// ≤ 45 min regolare, ≤ 75 moderata, oltre irregolare (si usa il valore peggiore tra letto e risveglio).
const mins = hhmm => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = xs => Math.sqrt(mean(xs.map(x => (x - mean(xs)) ** 2)));
const clock = m => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(Math.round(((m % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`;
export const MIN_NIGHTS = 7;

export function sleepRegularity(nights) {
  const xs = nights.filter(n => !n.short).slice(-14), bed = [], wake = [];
  for (const n of xs) { const b = mins(n.start_local), w = mins(n.end_local); if (b == null || w == null) continue; bed.push(((b - 1080) + 1440) % 1440); wake.push(w); }
  const none = { n: bed.length, bed_sd_min: null, wake_sd_min: null, bed_mean: null, wake_mean: null, label: null };
  if (bed.length < MIN_NIGHTS) return none;
  const bsd = Math.round(sd(bed)), wsd = Math.round(sd(wake)), worst = Math.max(bsd, wsd);
  return { n: bed.length, bed_sd_min: bsd, wake_sd_min: wsd, bed_mean: clock(mean(bed) + 1080), wake_mean: clock(mean(wake)), label: worst <= 45 ? 'regolare' : worst <= 75 ? 'moderata' : 'irregolare' };
}
