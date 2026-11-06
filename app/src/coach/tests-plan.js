// Pianificatore dei test: cadenza fissa dall'ultima esecuzione (targets.tests_done) o dall'inizio della versione dei target.
import { addDays, daysBetween } from './stats.js';

const TESTS = [
  { id: 'logging_calibration', title: 'Taratura del diario alimentare', every_days: 84, steps: [
    'Per 7 giorni consecutivi registra tutto quello che mangi e bevi, compresi i pasti stimati e fuori casa.',
    'Pesati ogni mattina dopo il bagno e prima di colazione.',
    'A fine settimana la stima del fabbisogno energetico diventa affidabile.'] },
  { id: 'rep_test', title: 'Test di forza sugli esercizi principali', every_days: 56, steps: [
    'Per ogni esercizio principale esegui una sola serie col carico di lavoro, fermandoti a 1–2 ripetizioni dal cedimento.',
    'Segna ripetizioni e RIR in Lyfta: la forza massima stimata (Epley) si calcola da sola.',
    'Stessa ora e stesso ordine delle volte precedenti; non farlo con meno di 6 ore di sonno o con dolore.'] },
  { id: 'measurements', title: 'Misure corporee', every_days: 14, steps: [
    'Misura vita, braccio, petto e coscia a digiuno, sempre negli stessi punti.',
    'Dimmele in chat: per ora non c\'è un campo nell\'app e le registro io.'] },
];

export function planTests({ today, targets, version, loggingBad }) {
  return TESTS.map(t => {
    const base = targets.tests_done[t.id] ?? version?.valid_from ?? null;
    const dueDate = base ? addDays(base, t.every_days) : null;
    const dueByCadence = dueDate == null || dueDate <= today;
    const forced = t.id === 'logging_calibration' && loggingBad;
    const due = dueByCadence || forced;
    return {
      id: t.id, title: t.title, due, due_date: forced ? today : dueDate,
      reason: forced ? 'Il diario alimentare è incompleto: senza taratura non posso consigliarti le calorie.' : base ? (due ? `Ultima volta: ${base} (ogni ${t.every_days / 7} settimane).` : `Prossimo tra ${daysBetween(today, dueDate)} giorni.`) : 'Mai eseguito.',
      steps: t.steps,
    };
  });
}
