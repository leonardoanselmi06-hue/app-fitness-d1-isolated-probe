// Probe SOLO STRUTTURA del payload Lyfta reale. Il repo è pubblico e i log sono pubblici: NON stampa mai valori
// (niente nomi esercizi, titoli, date, pesi, note). Stampa: nomi dei campi, tipi, conteggi di presenza, numeri di paginazione.
import { lyftaFetchPage } from '../src/adapters/lyfta/client.js';
import { pullAllWorkouts } from '../src/adapters/lyfta/sync.js';

const key = process.env.LYFTA_API_KEY;
if (!key) { console.error('::error::Secret LYFTA_API_KEY mancante nel repo'); process.exit(1); }
const fetchPage = lyftaFetchPage({ apiKey: key, limit: 100 });
const t = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const bump = (m, k, ty) => { const e = (m[k] ??= { n: 0, types: {} }); e.n++; e.types[ty] = (e.types[ty] || 0) + 1; };

const first = await fetchPage(1);
console.log('Chiavi di primo livello:', Object.fromEntries(Object.entries(first).map(([k, v]) => [k, t(v)])));
console.log('Paginazione (solo numeri):', Object.fromEntries(['count', 'total_records', 'total_pages', 'current_page', 'limit'].map(k => [k, first[k] ?? 'ASSENTE'])));

const pulled = await pullAllWorkouts(fetchPage);
console.log('Sync completo secondo i controlli dell\'adapter:', pulled.complete, pulled.reason ?? '', '| workout letti:', pulled.workouts.length);

const W = {}, E = {}, S = {}; const setTypes = {}; let ex = 0, sets = 0;
for (const w of pulled.workouts) {
  for (const [k, v] of Object.entries(w)) if (k !== 'exercises') bump(W, k, t(v));
  for (const e of w.exercises || []) {
    ex++; for (const [k, v] of Object.entries(e)) if (k !== 'sets') bump(E, k, t(v));
    for (const s of e.sets || []) { sets++; for (const [k, v] of Object.entries(s)) bump(S, k, t(v)); const id = String(s.set_type_id); setTypes[id] = (setTypes[id] || 0) + 1; }
  }
}
console.log(`Totali: ${pulled.workouts.length} workout, ${ex} esercizi, ${sets} serie`);
console.log('Campi workout :', JSON.stringify(W));
console.log('Campi esercizio:', JSON.stringify(E));
console.log('Campi serie    :', JSON.stringify(S));
console.log('Distribuzione set_type_id:', JSON.stringify(setTypes));
const named = pulled.workouts.flatMap(w => w.exercises || []).filter(e => e.excercise_name != null && e.excercise_name !== '').length;
console.log('Esercizi con `excercise_name` valorizzato:', named, '/', ex);

// ---- Forma dei valori `duration` per tipo di esercizio (solo CATEGORIE, mai valori) ----
const shape = v => {
  if (v === null) return 'json-null';
  if (v === undefined) return 'assente';
  if (typeof v === 'number') return v === 0 ? 'numero-0' : 'numero>0';
  if (typeof v !== 'string') return typeof v;
  const s = v.trim();
  if (s === '') return 'stringa-vuota';
  if (s.toLowerCase() === 'null') return 'stringa-"null"';
  if (/^0+(\.0+)?$/.test(s)) return 'stringa-0';
  if (/^\d+(\.\d+)?$/.test(s)) return `cifre(${s.length})`;
  if (/^\d+:\d{2}(:\d{2})?$/.test(s)) return 'formato-hh:mm';
  return 'altro-formato';
};
const groups = {};
for (const w of pulled.workouts) for (const e of w.exercises || []) {
  const g = `${e.exercise_type}${/plank/i.test(String(e.excercise_name)) ? '+plank' : ''}`;
  groups[g] ??= { sets: 0, duration: {}, reps: {}, weight: {}, distance: {}, is_completed: {} };
  for (const s of e.sets || []) {
    const G = groups[g]; G.sets++;
    for (const k of ['duration', 'reps', 'weight', 'distance']) { const sh = shape(s[k]); G[k][sh] = (G[k][sh] || 0) + 1; }
    const c = String(s.is_completed); G.is_completed[c] = (G.is_completed[c] || 0) + 1;
  }
}
console.log('Forma dei valori per tipo di esercizio:', JSON.stringify(groups, null, 1));

// ---- Struttura dei valori duration "a due/tre parti": solo numero di parti e massimi per componente (aggregati) ----
const comp = {};
for (const w of pulled.workouts) for (const e of w.exercises || []) for (const s of e.sets || []) {
  const m = typeof s.duration === 'string' && /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s.duration.trim());
  if (!m) continue;
  const g = `${e.exercise_type}${/plank/i.test(String(e.excercise_name)) ? '+plank' : ''}`;
  const c = (comp[g] ??= { n: 0, parti2: 0, parti3: 0, max1: 0, max2: 0, max3: 0, prima_parte_larghezze: {} });
  c.n++; if (m[3] === undefined) c.parti2++; else c.parti3++;
  c.max1 = Math.max(c.max1, Number(m[1])); c.max2 = Math.max(c.max2, Number(m[2])); if (m[3] !== undefined) c.max3 = Math.max(c.max3, Number(m[3]));
  const wd = String(m[1].length); c.prima_parte_larghezze[wd] = (c.prima_parte_larghezze[wd] || 0) + 1;
}
console.log('Componenti duration (massimi aggregati):', JSON.stringify(comp));
