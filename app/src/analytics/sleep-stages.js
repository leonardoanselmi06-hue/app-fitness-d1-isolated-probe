// Fasi del sonno da Health Connect (SleepSessionRecord). Il telefono invia segmenti compatti [tipo, offset_min, durata_min]
// rispetto all'inizio della sessione; il server ricava i minuti per fase (non si fida di riepiloghi del client).
// Tipi Health Connect: 0 sconosciuto, 1 sveglio, 2 sonno generico, 3 fuori dal letto, 4 leggero, 5 profondo, 6 REM, 7 sveglio a letto.
// Regola dei dati: una sessione ha fasi solo se compaiono almeno DUE tra leggero/profondo/REM (un sonno reale le alterna; una sola fase,
// es. "leggero 407, profondo 0, REM 0", è una registrazione senza dati di fase). Altrimenti minuti = null, mai zero inventati.
export const STAGE_AWAKE = [1, 3, 7];
export const MAX_SEGMENTS = 1500, MAX_SPAN_MIN = 36 * 60;

export function validSegments(segs) {
  if (!Array.isArray(segs) || segs.length > MAX_SEGMENTS) return false;
  return segs.every(s => Array.isArray(s) && s.length === 3 && s.every(Number.isInteger)
    && s[0] >= 0 && s[0] <= 7 && s[1] >= 0 && s[1] <= MAX_SPAN_MIN && s[2] > 0 && s[2] <= MAX_SPAN_MIN);
}

/** Minuti per fase. `staged` = ci sono fasi reali; altrimenti tutti i minuti sono null. */
export function summarizeStages(segs) {
  const min = t => segs.filter(s => s[0] === t).reduce((a, s) => a + s[2], 0);
  const light = min(4), deep = min(5), rem = min(6);
  const staged = [light, deep, rem].filter(m => m > 0).length >= 2;
  if (!staged) return { staged: false, light_min: null, deep_min: null, rem_min: null, awake_min: null, asleep_stage_min: null };
  const awake = STAGE_AWAKE.filter(t => t !== 3).reduce((a, t) => a + min(t), 0); // "fuori dal letto" non è sonno né veglia a letto
  return { staged: true, light_min: light, deep_min: deep, rem_min: rem, awake_min: awake, asleep_stage_min: light + deep + rem + min(2) };
}

/** Sessione di fasi che meglio si sovrappone a una notte (almeno il 60 % della più corta), o null. */
export function matchStages(night, sessions) {
  const a0 = Date.parse(night.start_at), a1 = Date.parse(night.end_at ?? night.start_at);
  let best = null, bestOv = 0;
  for (const s of sessions) {
    const ov = Math.min(a1, s.end) - Math.max(a0, s.start);
    if (ov > bestOv && ov >= 0.6 * Math.min(a1 - a0, s.end - s.start)) { best = s; bestOv = ov; }
  }
  return best;
}
