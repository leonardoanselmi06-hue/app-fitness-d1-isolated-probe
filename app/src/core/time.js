// Contratto temporale (DEC-TIME-001, CANDIDATE): istanti in UTC, bucket personali in Europe/Rome.
export const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
export const validIsoInstant = s => typeof s === 'string' && ISO_INSTANT.test(s) && Number.isFinite(Date.parse(s));

export function localDate(iso, timeZone = 'Europe/Rome') {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error('invalid_instant');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// Lyfta restituisce workout_perform_date senza offset; interpretata come UTC
// (VERIFIED_FOR_OBSERVED_CEST_DATES, comportamento al cambio DST ancora PENDING).
export function utcNaiveToInstant(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z)?$/);
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}${m[3] ?? ''}Z`;
  return validIsoInstant(iso) ? new Date(iso).toISOString() : null;
}
