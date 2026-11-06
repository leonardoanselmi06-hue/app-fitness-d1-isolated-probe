// Base di conoscenza per l'IA: sintesi (parafrasi, non copie) di fonti riconosciute, ciascuna con livello di verifica.
// level 'letta'  = pagina aperta e letta in questa ricerca (6 novembre 2026).
// level 'nota'   = affermazione di letteratura corrente la cui pagina non si è potuta aprire in questa sessione (blocco del sito): da confermare prima di farne una regola rigida.
// Le affermazioni sono generali (popolazioni studiate: in prevalenza adulti 18–35 anni, studi di 6–10 settimane): i dati dell'utente prevalgono sempre.
export const SOURCES = Object.freeze({
  S1: { ref: 'Helms, Aragon, Fitschen 2014, J Int Soc Sports Nutr: preparazione di gara per bodybuilder natural', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4033492/', level: 'letta' },
  S2: { ref: 'Slater, Dieter, Marsh, Helms, Shaw, Iraki 2019, Front Nutr: serve un surplus calorico per massimizzare l\'ipertrofia?', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6710320', level: 'letta' },
  S3: { ref: 'Nuckols 2022, Stronger By Science: quando il volume smette di rendere', url: 'https://www.strongerbyscience.com/?p=56687', level: 'letta' },
  S4: { ref: 'Schoenfeld, Ogborn, Krieger 2016, Sports Med: frequenza di allenamento e ipertrofia (meta-analisi)', url: 'https://pubmed.ncbi.nlm.nih.gov/27102172/', level: 'letta' },
  S5: { ref: 'Henselmans: analisi della meta-analisi 2018 di Schoenfeld e Grgic sulla frequenza', url: 'https://mennohenselmans.com/training-frequency-2018-meta-analysis-review/', level: 'letta' },
  S6: { ref: 'Nuckols 2021, Stronger By Science: frequenza e forza', url: 'https://www.strongerbyscience.com/?p=52765', level: 'letta' },
  S7: { ref: 'Roberts 2025 (Biolayne Reps 32) su Robinson et al.: vicinanza al cedimento, forza e ipertrofia', url: 'https://biolayne.com/reps/issue-32/the-failure-factor-the-relationship-between-proximity-to-failure-and-strength-and-hypertrophy/', level: 'letta' },
  S8: { ref: 'Singer et al. 2024, Front Sports Act Living: recuperi tra le serie e ipertrofia', url: 'https://frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/abstract', level: 'letta' },
  S9: { ref: 'Chen et al. 2024, J Exerc Sci Fit: allenamento concorrente, meta-analisi in rete di 40 studi', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10767279', level: 'letta' },
  S10: { ref: 'Knowles et al. 2018, J Sci Med Sport: sonno insufficiente e forza (sintesi di Science for Sport)', url: 'https://www.scienceforsport.com/how-sleep-impacts-strength-gains-and-what-we-can-do-about-it/', level: 'letta' },
  S11: { ref: 'ISSN position stand 2017 su proteine ed esercizio (Jäger et al.)', url: 'https://pubmed.ncbi.nlm.nih.gov/28642676/', level: 'nota' },
  S12: { ref: 'Ralston et al. 2017, Sports Med: serie settimanali e forza (meta-analisi)', url: 'https://pubmed.ncbi.nlm.nih.gov/28755103/', level: 'nota' },
  S13: { ref: 'Schoenfeld et al. 2021: rivalutazione del continuum delle ripetizioni (carichi per forza, ipertrofia, resistenza locale)', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7927075/', level: 'nota' },
  S14: { ref: 'Bell et al. 2023, Sports Med Open: consenso Delphi sullo scarico (deload)', url: 'https://shura.shu.ac.uk/32417/', level: 'nota' },
  S15: { ref: 'OMS 2020: linee guida su attività fisica e sedentarietà', url: 'https://www.who.int/publications/i/item/9789240015128', level: 'nota' },
});

export const KNOWLEDGE = Object.freeze([
  { id: 'K1', topic: 'volume', claims: [
    'Per l\'ipertrofia circa 12–20 serie dirette per muscolo a settimana bastano alla maggior parte dei lavoratori efficienti; oltre circa 20 i rendimenti calano molto ma non si azzerano (per esempio da 15 a 30 serie la crescita può salire solo di circa il 20 %). Il tricipite ha mostrato un vantaggio sopra 20 serie, il bicipite no.',
    'Il volume ottimale è individuale: se i progressi si fermano e ci si sente logori si riduce, se ci si sente freschi si può aumentare. Gli studi duravano 6–8 settimane, su 18–35 anni con almeno un anno di allenamento: per principianti la soglia è più bassa.',
  ], sources: ['S3'], level: 'letta' },
  { id: 'K2', topic: 'volume', claims: [
    'Più serie settimanali sono associate a maggiori guadagni di ipertrofia e di forza, con rendimenti decrescenti; per l\'ipertrofia i gruppi con 10 o più serie settimanali hanno guadagnato più di quelli con meno serie.',
  ], sources: ['S12'], level: 'nota' },
  { id: 'K3', topic: 'frequenza', claims: [
    'Per l\'ipertrofia ogni muscolo andrebbe allenato almeno 2 volte a settimana (meta-analisi: effetto 0,49 contro 0,30); se 3 volte sia meglio di 2 non è chiaro.',
    'A volume uguale la differenza tra frequenze alte e basse è piccola (effetto circa 0,07). Frequenze più alte aiutano soprattutto a distribuire il volume e a mantenere la qualità delle serie.',
  ], sources: ['S4', 'S5'], level: 'letta' },
  { id: 'K4', topic: 'frequenza', claims: [
    'Per la forza, a volume uguale la frequenza non cambia in modo rilevante i guadagni nei lavoratori allenati; una volta a settimana può andare bene sotto le 10 serie per muscolo. Frequenze maggiori sono utili per distribuire il volume (per esempio 5 serie di squat 3 volte contro 15 in una seduta).',
    'La risposta individuale varia: chi recupera più lentamente può stare meglio con frequenze più basse.',
  ], sources: ['S6'], level: 'letta' },
  { id: 'K5', topic: 'intensità', claims: [
    'Per l\'ipertrofia la crescita aumenta man mano che le serie si avvicinano al cedimento; per la forza le differenze legate alla vicinanza al cedimento sono trascurabili. Chi punta alla forza ha quindi più margine per tenere RIR più alti e ridurre la fatica.',
  ], sources: ['S7'], level: 'letta' },
  { id: 'K6', topic: 'intensità', claims: [
    'Il continuum "poche ripetizioni = forza, molte = ipertrofia" va letto con cautela: l\'ipertrofia si ottiene in un intervallo molto ampio di carichi purché le serie siano vicine al cedimento; per la forza massimale i carichi pesanti restano specifici (la forza è anche abilità sull\'alzata).',
  ], sources: ['S13'], level: 'nota' },
  { id: 'K7', topic: 'recuperi', claims: [
    'Per l\'ipertrofia recuperi oltre 60 secondi hanno dato un piccolo vantaggio e oltre 90 secondi nessun vantaggio chiaro: il beneficio sembra venire dal mantenere il carico di lavoro nelle serie successive. La revisione non ha valutato la forza e non ha dati su sollevatori molto allenati; l\'esercizio può cambiare la prescrizione (i multiarticolari pesanti stancano di più).',
  ], sources: ['S8'], level: 'letta' },
  { id: 'K8', topic: 'nutrizione massa', claims: [
    'Proteine per chi si allena con i pesi: circa 1,6–2,2 g/kg/die; sopra circa 2,2 nessun vantaggio aggiunto e oltre 2,5 sostenuti c\'è un dubbio di sicurezza. Per pasto circa 0,3 g/kg ogni 3–5 ore (indicazione provvisoria).',
    'Il surplus necessario per massimizzare l\'ipertrofia è sconosciuto: si parte in modo prudente con circa 360–480 kcal al giorno sopra il mantenimento e si corregge in base a composizione corporea e forza. Grassi 20–35 % dell\'energia, non sotto il 15–20 %; carboidrati 4–7 g/kg per chi fa pesi; almeno 3 pasti principali. Diete chetogeniche o molto povere di carboidrati sono associate a guadagni peggiori.',
  ], sources: ['S2'], level: 'letta' },
  { id: 'K9', topic: 'nutrizione', claims: [
    'La stima generale delle proteine per chi si allena è di circa 1,4–2,0 g/kg/die; la distribuzione nei pasti conta meno del totale giornaliero.',
  ], sources: ['S11'], level: 'nota' },
  { id: 'K10', topic: 'definizione', claims: [
    'Per perdere grasso conservando muscolo conviene perdere circa lo 0,5–1 % del peso corporeo a settimana: più in fretta aumenta la perdita di massa magra, soprattutto nei più magri.',
    'Proteine 2,3–3,1 g/kg di massa magra al giorno (più alte quanto più si è magri e quanto più grande è il deficit); grassi 15–30 % delle calorie, carboidrati con il resto. Il deficit va rivalutato man mano che il peso scende (l\'adattamento metabolico lo riduce). La frequenza dei pasti (3–6, almeno circa 20 g di proteine ciascuno) conta poco se il totale è giusto.',
    'Le diete molto restrittive espongono a disturbi alimentari e di immagine corporea: se compaiono segnali va suggerito di parlarne con un professionista.',
  ], sources: ['S1'], level: 'letta' },
  { id: 'K11', topic: 'sonno', claims: [
    'Una sola notte di sonno perso non ha ridotto in modo significativo la forza massima; più notti consecutive di sonno ridotto sembrano peggiorare soprattutto i movimenti multiarticolari. Le prove sull\'effetto ormonale e sulla crescita muscolare sono limitate.',
    'Pratica suggerita nei periodi di sonno scarso: pisolino prima dell\'allenamento, allenarsi più tardi, adattare i carichi, caffeina prima della seduta ma non dal pomeriggio.',
  ], sources: ['S10'], level: 'letta' },
  { id: 'K12', topic: 'cardio concorrente', claims: [
    'Aggiungere cardio ai pesi riduce in media la forza massima degli arti inferiori rispetto ai soli pesi; con la corsa a intervalli ad alta intensità la perdita è minima (effetto −0,08, non significativo), mentre con corsa continua moderata (−0,25) e ciclismo continuo moderato (−0,38) è significativa. Sulla massa muscolare le differenze non sono significative. Gli studi usavano 2–3 sedute settimanali, in prevalenza uomini allenati e nella stessa seduta.',
    'Prassi comune (NON dedotta dallo studio): per chi punta alla forza delle gambe separare il cardio intenso dalle sedute di gambe pesanti e preferire il cardio facile a bassa intensità; qui il cardio resta una scelta per salute e condizione fisica.',
  ], sources: ['S9'], level: 'letta' },
  { id: 'K13', topic: 'scarico', claims: [
    'Lo scarico è una riduzione pianificata e temporanea del carico di allenamento (volume e/o intensità), tipicamente di circa una settimana, usata per gestire la fatica; si valuta quando prestazioni in calo, sonno e recupero peggiorano insieme (il consenso esperto non fissa una regola unica).',
  ], sources: ['S14'], level: 'nota' },
  { id: 'K14', topic: 'salute generale', claims: [
    'Adulti: 150–300 minuti a settimana di attività aerobica moderata (o 75–150 vigorosa) e rafforzamento muscolare almeno 2 giorni a settimana.',
  ], sources: ['S15'], level: 'nota' },
]);

/** Testo compatto per il prompt. Ogni blocco porta il suo id: l'IA può citarlo in `sources`. */
export function knowledgeText() {
  return KNOWLEDGE.map(k => `[${k.id}] (${k.topic}; ${k.level === 'letta' ? 'fonte letta' : 'fonte nota, da confermare'}; ${k.sources.join(', ')}) ${k.claims.join(' ')}`).join('\n');
}
export const knowledgeIds = () => KNOWLEDGE.map(k => k.id);

/** Markdown della base di conoscenza (per il Project e per la lettura umana). */
export function knowledgeMarkdown() {
  const src = Object.entries(SOURCES).map(([id, s]) => `- **${id}** ${s.ref} — ${s.url} _(${s.level === 'letta' ? 'pagina letta' : 'pagina non apribile in questa sessione: da confermare'})_`).join('\n');
  const body = KNOWLEDGE.map(k => `### ${k.id} · ${k.topic}\n${k.claims.map(c => `- ${c}`).join('\n')}\nFonti: ${k.sources.join(', ')} · livello: ${k.level}`).join('\n\n');
  return `# Base di conoscenza dell'IA (ricerca del 6 novembre 2026)\n\nSintesi in parafrasi di fonti riconosciute. Sono indicazioni generali, non prescrizioni personali: i dati dell'utente prevalgono. Le voci "nota" vanno confermate aprendo la fonte prima di trasformarle in regole rigide.\n\n## Voci\n\n${body}\n\n## Fonti\n\n${src}\n`;
}

/** Per ogni id usato in un consiglio: argomento, fonti con link e livello (la PWA le mostra). */
export function knowledgeIndex(advice) {
  const ids = new Set((advice?.priorities ?? []).flatMap(p => p.sources ?? [])), out = {};
  for (const k of KNOWLEDGE) if (ids.has(k.id)) out[k.id] = { topic: k.topic, level: k.level, sources: k.sources.map(id => ({ ref: SOURCES[id].ref, url: SOURCES[id].url, level: SOURCES[id].level })) };
  return out;
}
