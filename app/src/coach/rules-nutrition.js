// Regole di alimentazione: completezza del diario, proteine e stima del fabbisogno energetico.
// Prima si valuta se il diario è affidabile: senza giorni completi nessuna conclusione energetica.
import { addDays, calendarDays, mean, roundTo, fmt, insight } from './stats.js';

const KCAL_PER_KG = 7700;

/** Giorni (oggi escluso) classificati in complete / incomplete / missing con la regola dei pasti (analytics/meal-completeness.js):
 *  completo = pranzo + cena + almeno uno tra colazione e altro, senza voci senza calorie. */
export function nutritionQuality(nutrition, today, spanDays = 28) {
  const byDate = new Map(nutrition.by_day.map(d => [d.date, d]));
  const days = calendarDays(addDays(today, -spanDays), addDays(today, -1)).map(date => {
    const e = byDate.get(date);
    if (!e) return { date, state: 'missing', kcal: null, protein: null, reason: 'nessun pasto registrato' };
    return { date, state: e.completeness.complete ? 'complete' : 'incomplete', kcal: e.totals.calories > 0 ? e.totals.calories : null, protein: e.totals.protein, reason: e.completeness.reason };
  });
  return { days };
}

const shortD = d => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
export function nutritionLoggingInsight(q, today) {
  const last14 = q.days.filter(d => d.date >= addDays(today, -14));
  const logged = last14.filter(d => d.state !== 'missing'), incomplete = last14.filter(d => d.state === 'incomplete'), complete = last14.filter(d => d.state === 'complete');
  const ev = [`Giorni completi: ${complete.length} su 14 (completo = pranzo, cena e almeno colazione o altro)`, `Giorni registrati ma incompleti: ${incomplete.length} · senza alcuna voce: ${last14.length - logged.length}`];
  if (incomplete.length) ev.push(`Da ricontrollare: ${incomplete.slice(-5).map(d => `${shortD(d.date)} (${d.reason})`).join('; ')}`);
  const action = 'Registra tutti i pasti, anche quelli stimati: servono almeno pranzo, cena e una tra colazione e altro. Senza giorni completi non posso stimare il tuo fabbisogno.';
  const data = { complete: complete.length, logged: logged.length, incomplete: incomplete.length };
  if (complete.length < 10) return insight('nutrition_logging', 'Completezza del diario', 'attenzione', `Solo ${complete.length} giorni su 14 hanno il diario completo (ne servono almeno 10).`, { evidence: ev, action, data });
  return insight('nutrition_logging', 'Completezza del diario', 'ok', 'Diario completo nella maggior parte dei giorni: posso usare i dati alimentari.', { evidence: ev, data });
}

export function proteinInsight(q, weights, today, targets) {
  const days = q.days.filter(d => d.date >= addDays(today, -14) && d.state === 'complete' && d.protein != null);
  const recent = weights.daily.filter(w => w.date >= addDays(today, -28));
  const kg = mean(recent.filter(w => w.date >= addDays(today, -14)).map(w => w.kg)) ?? mean(recent.map(w => w.kg));
  if (days.length < 5 || kg == null) return insight('protein', 'Proteine', 'insufficiente', `Servono almeno 5 giorni completi e un peso recente: ho ${days.length} giorni${kg == null ? ' e nessun peso' : ''}.`, { evidence: [`Giorni completi (14 g): ${days.length}`] });
  const avg = mean(days.map(d => d.protein)), perKg = avg / kg, { min, max } = targets.protein_g_per_kg;
  const ev = [`Media: ${fmt(avg, 0)} g/giorno su ${days.length} giorni completi`, `Peso di riferimento: ${fmt(kg, 1)} kg → ${fmt(perKg, 2)} g/kg (obiettivo ${fmt(min, 1)}–${fmt(max, 1)})`];
  const data = { g_per_kg: perKg, avg_g: avg, n: days.length };
  if (perKg < min) return insight('protein', 'Proteine', 'attenzione', `Proteine sotto il minimo (${fmt(perKg, 2)} g/kg).`, { evidence: ev, action: `Aggiungi circa ${Math.max(5, roundTo(min * kg - avg, 5))} g di proteine al giorno (ad esempio un pasto proteico in più).`, data });
  if (perKg > max) return insight('protein', 'Proteine', 'info', `Proteine sopra il range (${fmt(perKg, 2)} g/kg): non serve di più, puoi usare lo spazio per carboidrati.`, { evidence: ev, data });
  return insight('protein', 'Proteine', 'ok', `Proteine in linea (${fmt(perKg, 2)} g/kg).`, { evidence: ev, data });
}

export function energyInsight(q, trend, today, targets) {
  const days = q.days.filter(d => d.state === 'complete');
  if (days.length < 10 || !trend) return insight('energy_balance', 'Fabbisogno energetico', 'insufficiente', `Per stimare il fabbisogno servono almeno 10 giorni completi e un trend del peso: ho ${days.length} giorni${trend ? '' : ' e nessun trend'}.`, { evidence: [`Giorni completi (28 g): ${days.length}`] });
  const intake = mean(days.map(d => d.kcal)), { reg } = trend;
  const tdee = intake - reg.slope * KCAL_PER_KG, half = ((reg.ci[1] - reg.ci[0]) / 2) * KCAL_PER_KG;
  const confidence = days.length >= 14 && half <= 300 ? 'alta' : half <= 500 ? 'media' : 'bassa';
  const ev = [`Apporto medio: ${fmt(intake, 0)} kcal su ${days.length} giorni completi`, `Fabbisogno stimato: ${fmt(tdee, 0)} kcal (± ${fmt(half, 0)}, confidenza ${confidence})`];
  const data = { intake_kcal: intake, tdee_kcal: tdee, half_width_kcal: half, confidence };
  if (tdee < 1500 || tdee > 5000) return insight('energy_balance', 'Fabbisogno energetico', 'insufficiente', 'La stima del fabbisogno non è plausibile: probabilmente il diario è incompleto o il peso troppo variabile.', { evidence: ev, data });
  if (confidence === 'bassa') return insight('energy_balance', 'Fabbisogno energetico', 'insufficiente', `La stima del fabbisogno è ancora troppo incerta (± ${fmt(half, 0)} kcal): non ti do un numero finché non migliorano diario e pesate.`, { evidence: ev, data });
  const kg = reg.mean_y, { min, max } = targets.weight_gain_pct_week;
  const surplus = pct => (pct / 100) * kg * KCAL_PER_KG / 7;
  const lo = Math.max(1800, roundTo(tdee + surplus(min), 50)), hi = Math.max(lo, roundTo(tdee + surplus(max), 50));
  ev.push(`Per ${fmt(min, 2)}–${fmt(max, 2)} %/sett. servono circa ${lo}–${hi} kcal/giorno`);
  Object.assign(data, { target_kcal: [lo, hi] });
  if (intake < lo - 150) return insight('energy_balance', 'Fabbisogno energetico', 'attenzione', `Mangi meno di quanto serve per crescere (${fmt(intake, 0)} contro ${lo}–${hi} kcal).`, { evidence: ev, action: `Porta l'apporto verso ${lo}–${hi} kcal al giorno (oggi ${fmt(intake, 0)}), aggiungendo ad esempio una colazione o uno spuntino più calorico.`, data });
  if (intake > hi + 150) return insight('energy_balance', 'Fabbisogno energetico', 'attenzione', `Mangi più di quanto serve per il ritmo scelto (${fmt(intake, 0)} contro ${lo}–${hi} kcal).`, { evidence: ev, action: `Riporta l'apporto verso ${lo}–${hi} kcal al giorno (oggi ${fmt(intake, 0)}).`, data });
  return insight('energy_balance', 'Fabbisogno energetico', 'ok', `Apporto in linea con l'obiettivo (${fmt(intake, 0)} kcal; indicati ${lo}–${hi}).`, { evidence: ev, data });
}
