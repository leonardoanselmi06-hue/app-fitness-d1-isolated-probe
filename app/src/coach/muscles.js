// Mappa esercizio -> muscolo principale (serie DIRETTE) + muscoli secondari (serie INDIRETTE, contate a parte e con peso ridotto: vedi INDIRECT_WEIGHT).
// Lyfta non fornisce il muscolo: la mappa è nel codice, gli esercizi non riconosciuti vengono elencati, mai indovinati.
export const MUSCLES = ['petto', 'schiena', 'spalle', 'bicipiti', 'tricipiti', 'quadricipiti', 'femorali', 'polpacci', 'addome'];
export const MUSCLE_LABEL = { petto: 'Petto', schiena: 'Schiena', spalle: 'Spalle', bicipiti: 'Bicipiti', tricipiti: 'Tricipiti', quadricipiti: 'Quadricipiti', femorali: 'Femorali', polpacci: 'Polpacci', addome: 'Addome', collo: 'Collo', glutei: 'Glutei' };
export const ISOMETRIC = new Set(['addome', 'collo']); // qui contano anche le serie a tempo

export const normalizeName = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// L'ordine conta: la prima regola che corrisponde vince. null = non è forza (riscaldamento, cardio, stretching, mobilità).
const RULES = [
  [null, /riscaldamento|walking on treadmill|^walking$|stretch|cyclette|run on treadmill|sprint|camminata|corsetta|jumping jack|mobilit|circle|countermovement|battling|^sacco$|farmers|heel touchers|rotazione del tronco|mountain climber/],
  ['collo', /neck|collo/],
  ['polpacci', /calf raise|calves raise/],
  ['tricipiti', /tricep|skull crusher|pushdown|kickback|\bdip\b|close-grip bench|diamond push/],
  ['femorali', /leg curl|romanian|good morning|deadlift/],
  ['bicipiti', /curl/],
  ['addome', /plank|crunch|leg raise|hip raise|knee raise|twist|rollout|pallof|sit-up|hollow|barchetta|dead bug/],
  ['quadricipiti', /squat|leg extension|lunge|leg press/],
  ['spalle', /shoulder press|lateral raise|alzate laterali|front raise|overhead press|military press|face pull|rear delt|shrug/],
  ['schiena', /pull-up|pull up|chin-up|row\b|pulldown|pull-down/],
  ['petto', /bench press|\bfly\b|push-up|push up|chest|pec deck/],
];

/** 'ignore' | 'unmapped' | nome del muscolo. */
export function classify(name) {
  const n = normalizeName(name);
  if (!n) return 'unmapped';
  for (const [muscle, re] of RULES) if (re.test(n)) return muscle ?? 'ignore';
  return 'unmapped';
}

/** Serie che contano come lavoro diretto: non di riscaldamento, con ripetizioni (o durata >= 10 s per gli isometrici).
 *  Il flag `completed` di Lyfta è ignorato: è false per ~90% delle serie realmente registrate. */
export function countsAsSet(set, muscle) {
  if (!set || set.warmup) return false;
  if (typeof set.reps === 'number' && set.reps > 0) return true;
  return ISOMETRIC.has(muscle) && typeof set.duration_sec === 'number' && set.duration_sec >= 10;
}

/** e1RM di Epley per 1..12 ripetizioni con carico esterno > 0; altrimenti null. */
export const epley = (load, reps) => (typeof load === 'number' && load > 0 && Number.isInteger(reps) && reps >= 1 && reps <= 12 ? load * (1 + reps / 30) : null);

/** Peso di una serie indiretta rispetto a una diretta nel "volume efficace". È un'ipotesi di lavoro (la letteratura propone circa 0,5), dichiarata come tale. */
export const INDIRECT_WEIGHT = 0.5;

// Muscoli secondari per esercizio (la prima regola che corrisponde vince; l'ordine conta: le varianti specifiche prima).
const SECONDARY = [
  [/close-grip bench|diamond push|\bdip\b/, ['petto', 'spalle']],
  [/bench press|push-up|push up|chest press|chest/, ['tricipiti', 'spalle']],
  [/shoulder press|overhead press|military press/, ['tricipiti']],
  [/face pull|shrug/, ['schiena']],
  [/pull-up|pull up|chin-up|pulldown|pull-down/, ['bicipiti']],
  [/row\b/, ['bicipiti', 'spalle']],
  [/romanian|good morning|deadlift/, ['glutei', 'schiena']],
  [/lunge/, ['glutei', 'femorali']],
  [/squat|leg press/, ['glutei']],
];

/** Muscoli secondari dell'esercizio ([] se nessuno noto o se non è un esercizio di forza riconosciuto). */
export function secondaryOf(name) {
  const m = classify(name); if (m === 'ignore' || m === 'unmapped') return [];
  const n = normalizeName(name);
  for (const [re, list] of SECONDARY) if (re.test(n)) return list.filter(x => x !== m);
  return [];
}

// Cardio (attività secondarie): corsa, tapis roulant, bici, camminata, ellittica, vogatore, nuoto, corda. Non è lavoro di forza e non conta nelle serie.
const CARDIO = /treadmill|tapis|\bcorsa\b|corsetta|\brun(?:ning)?\b|jog|cyclette|cycling|\bbike\b|ellittic|elliptical|camminata|\bwalking\b|stair|sprint|ergomet|rowing machine|rower|ski erg|assault|\bswim|nuoto|jump rope|corda/;
export const isCardio = name => CARDIO.test(normalizeName(name));
/** Minuti registrati per un esercizio di cardio: somma delle durate delle serie non di riscaldamento. null se non c'è alcuna durata. */
export function cardioMinutes(ex) {
  const secs = (ex?.sets ?? []).filter(x => x && !x.warmup && typeof x.duration_sec === 'number' && x.duration_sec > 0).reduce((a, x) => a + x.duration_sec, 0);
  return secs > 0 ? Math.round((secs / 60) * 10) / 10 : null;
}
