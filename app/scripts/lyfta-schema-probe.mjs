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
