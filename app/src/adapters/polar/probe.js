// Struttura (chiavi, tipi, lunghezze) del payload Polar reale per verificare il contratto. NESSUN valore: né nomi, né date, né misure.
export function shape(v, depth = 4) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return depth ? { array: v.length, item: v.length ? shape(v[0], depth - 1) : null } : 'array';
  if (typeof v === 'object') return depth ? Object.fromEntries(Object.keys(v).sort().map(k => [k, shape(v[k], depth - 1)])) : 'object';
  return typeof v;
}
const day = d => d.toISOString().slice(0, 10);

export async function probePolar(get, now = new Date()) {
  const to = new Date(now.getTime() + 86400000), from = new Date(now.getTime() - 60 * 86400000);
  const list = await get('/training-sessions/list', { from: day(from), to: day(to) });
  const sessions = list.trainingSessions ?? [];
  const out = { window_days: 60, top_level: shape(Object.fromEntries(Object.entries(list).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 1) : v]))), sessions: sessions.length, session_shape: sessions.length ? shape(sessions[0]) : null, features: null };
  if (sessions.length) {
    const d0 = String(sessions[0].startTime ?? '').slice(0, 10); // giorno così come scritto da Polar
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d0)) { out.features = 'startTime non nel formato atteso'; return out; }
    const f = await get('/training-sessions/list', { from: d0, to: day(new Date(Date.parse(`${d0}T00:00:00Z`) + 86400000)), features: ['samples', 'zones'] });
    const s = (f.trainingSessions ?? [])[0];
    out.features = s ? { exercise_shape: shape(s.exercises?.[0] ?? null, 5) } : 'nessuna sessione nel giorno scelto';
  }
  return out;
}
