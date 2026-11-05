// Normalizzatore FatSecret -> record canonici 'nutrition' (una voce di diario = un record). Contratto verificato sul payload reale
// con il probe di sola struttura (5 nov 2026): food_entry{ food_entry_id, food_entry_name, food_entry_description, date_int, meal, food_id,
// serving_id, number_of_units, calories, carbohydrate, protein, fat, saturated_fat, (poly|mono)unsaturated_fat, cholesterol, sodium, potassium,
// fiber, sugar, vitamin_a, vitamin_c, calcium, iron } — tutti stringhe. Il diario ha solo la DATA (nessun orario): observed_at resta null.
import { num, absent } from '../lyfta/normalize.js';

export const ADAPTER_VERSION = 'fatsecret-normalizer/0.1.0';
export const NUTRIENTS = Object.freeze(['calories', 'carbohydrate', 'protein', 'fat', 'saturated_fat', 'polyunsaturated_fat', 'monounsaturated_fat', 'cholesterol', 'sodium', 'potassium', 'fiber', 'sugar', 'vitamin_a', 'vitamin_c', 'calcium', 'iron']);
const str = v => (absent(v) ? null : String(v));

export const dateFromInt = n => new Date(Number(n) * 86400000).toISOString().slice(0, 10);
export const intFromDate = d => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
export const asArray = v => (v == null ? [] : [v].flat());

export function normalizeEntry(e) {
  const id = str(e.food_entry_id);
  if (!id) throw new Error('fatsecret_entry_without_id');
  const di = num(e.date_int);
  return {
    id: `entry:${id}`,
    domain: 'nutrition',
    observed_at: null,
    payload: {
      adapter_version: ADAPTER_VERSION,
      native_entry_id: id,
      local_date: di == null ? null : dateFromInt(di),
      meal: str(e.meal),
      name: str(e.food_entry_name),
      description: str(e.food_entry_description),
      food_id: str(e.food_id),
      serving_id: str(e.serving_id),
      number_of_units: num(e.number_of_units),
      nutrients: Object.fromEntries(NUTRIENTS.map(k => [k, num(e[k])])), // assente = null, mai 0
    },
  };
}
