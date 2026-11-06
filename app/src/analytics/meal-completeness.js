// Regola di completezza di un giorno di diario (decisione utente, 6 nov 2026):
// un giorno è COMPLETO se ha Pranzo e Cena e almeno uno tra Colazione e Altro, e nessuna voce senza calorie
// (un totale con voci senza calorie sarebbe sottostimato). Altrimenti è INCOMPLETO e non entra in medie né in stime.
// Il giorno in corso non si valuta (complete = null): può ancora ricevere pasti.
export const MEALS = Object.freeze(['Breakfast', 'Lunch', 'Dinner', 'Other']);
export const MEAL_IT = Object.freeze({ Breakfast: 'Colazione', Lunch: 'Pranzo', Dinner: 'Cena', Other: 'Altro', Breakfast_or_Other: 'Colazione o Altro' });
const norm = m => (MEALS.includes(m) ? m : 'Other'); // etichette sconosciute valgono "Altro"

export function dayCompleteness(meals, { noCalorieEntries = 0, partial = false } = {}) {
  const present = new Set([...meals].map(norm));
  const missing = [];
  if (!present.has('Lunch')) missing.push('Lunch');
  if (!present.has('Dinner')) missing.push('Dinner');
  if (!present.has('Breakfast') && !present.has('Other')) missing.push('Breakfast_or_Other');
  const c = { complete: partial ? null : missing.length === 0 && noCalorieEntries === 0, missing, no_calorie_entries: noCalorieEntries };
  return { ...c, reason: c.complete === null ? '' : incompleteReason(c) };
}

/** Testo italiano per i motivi ("manca il pranzo"), usato anche nelle evidenze del Coach. */
export function incompleteReason(c) {
  const parts = c.missing.map(m => (m === 'Breakfast_or_Other' ? 'manca colazione o altro' : `manca ${m === 'Lunch' ? 'il pranzo' : 'la cena'}`));
  if (c.no_calorie_entries > 0) parts.push(`${c.no_calorie_entries} ${c.no_calorie_entries === 1 ? 'voce senza calorie' : 'voci senza calorie'}`);
  return parts.join(', ');
}
