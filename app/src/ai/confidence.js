// Tetto di confidenza deciso dal codice (principio: soglie e confidenza le calcola il codice, il modello spiega).
// Il modello può dichiarare una confidenza più bassa, mai più alta di quella che i dati calcolati dal Coach permettono.

// Insight ANALITICI del Coach (id) che sostengono ogni area: usano "insufficiente" quando mancano i dati per calcolare.
// Sono esclusi gli insight di qualità dei dati (nutrition_logging, weighin_protocol, freshness) e training_adherence / muscle_volume:
// il loro stato "attenzione" vale anche quando non c'è nessun dato, quindi non dice se esiste una base di calcolo.
const AREA_INSIGHTS = {
  allenamento: ['progression'],
  scheda: ['progression'],
  alimentazione: ['energy_balance', 'protein'],
  peso: ['weight_trend'],
  sonno: ['sleep'],
  recupero: ['recovery'],
};

/** Aree in cui la confidenza non può superare "bassa". */
export function lowConfidenceAreas(dossier) {
  const insights = dossier?.coach?.insights ?? [], low = new Set();
  // 1. Nessun insight dell'area ha dati sufficienti: il Coach stesso non sa dire nulla di calcolato.
  for (const [area, ids] of Object.entries(AREA_INSIGHTS)) {
    const rel = insights.filter(i => ids.includes(i.id));
    if (rel.length && rel.every(i => i.status === 'insufficiente')) low.add(area);
  }
  // 2. Progressione: almeno metà degli esercizi con fiducia bassa (stessa soglia di rules-training.js).
  const ex = insights.find(i => i.id === 'progression')?.exercises ?? [];
  if (ex.length && ex.filter(e => e.confidence === 'bassa').length >= ex.length / 2) { low.add('allenamento'); low.add('scheda'); }
  return low;
}

/** Abbassa a "bassa" le priorità sopra il tetto. Conserva il valore dichiarato dal modello in `confidence_declared`. Ritorna quante ne ha cambiate. */
export function applyConfidenceCaps(advice, dossier) {
  const low = lowConfidenceAreas(dossier); let changed = 0;
  for (const p of advice.priorities) {
    if (low.has(p.area) && p.confidence !== 'bassa') { p.confidence_declared = p.confidence; p.confidence = 'bassa'; changed++; }
  }
  return changed;
}
