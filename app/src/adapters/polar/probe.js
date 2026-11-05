// Struttura (chiavi, tipi, lunghezze) del payload Polar reale per verificare il contratto. NESSUN valore: né nomi, né date, né misure.
export function shape(v, depth = 4) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return depth ? { array: v.length, item: v.length ? shape(v[0], depth - 1) : null } : 'array';
  if (typeof v === 'object') return depth ? Object.fromEntries(Object.keys(v).sort().map(k => [k, shape(v[k], depth - 1)])) : 'object';
  return typeof v;
}
// Polar v4 vuole data-ora ISO senza fuso né 'Z' (AAAA-MM-GGTHH:mm:ss); 'to' è esclusivo.
const day = d => `${d.toISOString().slice(0, 10)}T00:00:00`;

export async function probePolar(get, now = new Date()) {
  const to = new Date(now.getTime() + 86400000), from = new Date(now.getTime() - 60 * 86400000);
  const list = await get('/training-sessions/list', { from: day(from), to: day(to) });
  const sessions = list.trainingSessions ?? [];
  const out = { window_days: 60, top_level: shape(Object.fromEntries(Object.entries(list).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 1) : v]))), sessions: sessions.length, session_shape: sessions.length ? shape(sessions[0]) : null, features: null };
  if (sessions.length) {
    const d0 = String(sessions[0].startTime ?? '').slice(0, 10); // giorno così come scritto da Polar
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d0)) { out.features = 'startTime non nel formato atteso'; return out; }
    const from = `${d0}T00:00:00`, to = day(new Date(Date.parse(`${d0}T00:00:00Z`) + 86400000));
    // Il formato di 'features' non è documentato con certezza: si provano varianti e si riporta solo la struttura.
    const variants = { ripetuto: ['samples', 'zones'], virgola: 'samples,zones', solo_zones: ['zones'] };
    out.features = {};
    for (const [name, features] of Object.entries(variants)) {
      try {
        const f = await get('/training-sessions/list', { from, to, features });
        const s = (f.trainingSessions ?? [])[0];
        out.features[name] = s ? { session_keys: Object.keys(s).sort(), exercise_shape: shape(s.exercises?.[0] ?? null, 6) } : 'nessuna sessione';
      } catch (e) { out.features[name] = { errore: e.code, upstream_status: e.extra?.upstream_status ?? null }; }
    }
  }
  return out;
}
