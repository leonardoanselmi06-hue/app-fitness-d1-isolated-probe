# Coach — specifica (bozza DEC-COACH-001, CANDIDATE)

Stato: proposta approvata nella direzione dall'utente il 6 nov 2026 (obiettivo: massa muscolare; solo regole deterministiche;
prima parte = obiettivi versionati + revisione settimanale; target inseriti via chat). Da registrare nel Decision Register
(oggi "coaching sofisticato" e "test planner" sono post-V1 salvo nuova decisione). Non si tratta di consulenza medica.

## Principi (derivati dai FROZEN)
- Nessuna AI generativa: ogni consiglio è una regola con soglia esplicita, **evidenza numerica** (valori, date, fonte) e
  stato dei dati. Un consiglio senza dati sufficienti diventa "dati insufficienti", mai un'ipotesi (DEC: AI solo sopra fatti deterministici).
- Valori mancanti = null/assenti, mai zero. Giorni senza record = mancanti, non zero.
- Obiettivi e target versionati con `valid_from`/`valid_to`; mai sovrascritti (DEC-DATA-003). L'API dell'app resta di sola lettura:
  i target li scrive Claude su richiesta dell'utente.
- Le regole non scrivono nei RAW né nei dati canonici. Il Coach legge soltanto.

## Qualità dei dati osservata (motiva le regole)
- Registro alimentare: i pasti stimati da ChatGPT non sono in FatSecret (fonte separata, oggi esclusa): un giorno senza pranzo, cena o colazione/altro
  è incompleto. → regola di completezza (pasti) prima di ogni conclusione energetica; sostituisce l'euristica "sotto il 60% della mediana".
- Peso: rumore giornaliero dell'ordine di ±1 kg, orari di pesata variabili. → trend con intervallo di confidenza (t di Student),
  mai su due pesate; verdetto "incerto" quando l'intervallo copre più esiti.
- Lyfta non fornisce il muscolo per esercizio: mappa esercizio→muscolo mantenuta nel codice; gli esercizi non mappati sono
  segnalati, mai indovinati. Il carico di Lyfta è solo zavorra esterna (DEC-TRAIN-001).

## Target di default (obiettivo massa muscolare) — tutti modificabili
| Chiave | Default | Base (indicazioni generali, da verificare con le fonti primarie) |
|---|---|---|
| weight_gain_pct_week | 0,25–0,5 %/sett. | aumento lento = più massa magra per kg guadagnato (Helms et al., linee guida pratiche) |
| protein_g_per_kg | 1,6–2,2 | plateau ~1,6 g/kg, limite alto ~2,2 (Morton et al. 2018) |
| strength_sessions_per_week | 4 | schema corrente A/B/C/D |
| sets_per_muscle_week | 10–20 serie dirette | ≥10 serie/sett. (Schoenfeld et al. 2017); oltre ~20 rendimenti decrescenti |
| min_weekly_frequency_per_muscle | 2 | frequenza ≥2/sett. non peggiore di 1 a parità di volume (Schoenfeld et al. 2016) |
| sleep_min_hours | 7 | adulti 7–9 h (AASM/SRS) |
| steps_per_day, z2_minutes_per_week | null | nessun obiettivo finché non lo fissa l'utente: nessuna regola |

## Regole (id, soglie, esito)
| Id | Dati | Esito |
|---|---|---|
| nutrition_logging | ultimi 14 g (oggi escluso) | **Giorno completo = pranzo + cena + almeno uno tra colazione e altro, senza voci senza calorie** (regola dell'utente, 6 nov 2026; "Altro" vale come colazione; etichette sconosciute valgono "Altro"; il giorno in corso non si valuta). Attenzione se i giorni completi su 14 sono <10. Solo i giorni completi entrano nelle medie e nelle stime |
| weight_trend | media giornaliera, finestra 28 g (≥4 giorni in ≥14 g di arco) e 84 g | regressione lineare; intervallo al 95 % rispetto a 0,25–0,5 %/sett.: sotto / dentro / sopra / incerto. Calo >1 %/sett. = avviso a parte |
| weighin_protocol | pesate 28 g | attenzione se <8 pesate o >30 % fuori dalla fascia 6–10 (Europe/Rome) |
| protein | giorni completi 14 g; peso medio 14 g | g/kg rispetto a 1,6–2,2 |
| energy_balance | giorni completi 28 g + trend peso | fabbisogno = media kcal − pendenza×7700/7; confidenza alta (≥14 giorni, ±≤300 kcal), media (≥10, ±≤500), altrimenti bassa. Con confidenza bassa **nessun numero consigliato**. Mai sotto 1800 kcal; stima fuori 1500–5000 = non plausibile |
| training_adherence | ultime 3 settimane complete (lun–dom) | seduta di forza = ≥4 serie dirette su esercizi di forza; attenzione se media < target−0,5 |
| muscle_volume | ultime 2 settimane complete | serie dirette/sett. per muscolo principale vs 10–20; frequenza ≥2; esercizi non mappati elencati |
| progression | ultimi 84 g, esercizi con ≥6 sedute | e1RM (Epley, serie 1–12 rip.) o ripetizioni se senza carico; media ultime 3 vs 3 precedenti: ≥+1,5 % progresso, ≤−1,5 % calo, altrimenti stabile. Attenzione se ≥40 % degli esercizi (≥3) non progredisce |
| sleep | ultime 7 notti regolari (≥3 h) | media vs 7 h; conta le notti <6 h |
| freshness | ultima pesata | info se >7 giorni |

Priorità per la revisione settimanale: nutrition_logging 10 › training_adherence 9 › weight_trend 8 › muscle_volume 7 ›
energy_balance 7 › progression 6 › protein 6 › sleep 5 › weighin_protocol 4 › freshness 3. Le azioni sono le prime 3 regole in "attenzione".

## Guardrail
- Nessuna diagnosi o indicazione medica; sintomi o perdita di peso involontaria → rimando al medico.
- Soglie prudenti: nessun target sotto 1800 kcal; calo >1 %/sett. e aumento >0,75 %/sett. generano avviso, non spinta.
- Ogni insight mostra "perché" (evidenza) e il limite dei dati.

## Test planner (cadenza da `valid_from` o da `last_done`)
- `logging_calibration` (12 sett.; subito se nutrition_logging è in attenzione): 7 giorni con registrazione completa, pasti stimati inclusi.
- `rep_test` (8 sett.): una serie per esercizio principale, con il carico di lavoro, **fermandosi a 1–2 ripetizioni dal cedimento**; reps e RIR in Lyfta; e1RM con Epley; stessa ora e ordine; non farlo con <6 h di sonno o dolore.
- `measurements` (2 sett.): vita, braccio, petto, coscia. Oggi non tracciabile nell'app (nessun dominio): promemoria manuale.

## Limiti noti
- Mappa muscoli parziale (nomi Lyfta oggi in uso); i range di ripetizioni della scheda non sono nei dati.
- Il trend peso richiede pesate regolari; con il rumore attuale spesso dà "incerto".
- Le soglie sono linee guida generali, non prescrizioni personali.

## Verifica (acceptance)
Test automatici per ogni regola con dati sintetici (esiti ok/attenzione/insufficiente, casi limite, nessun NaN/zero inventato),
per il caricamento da D1 (target versionati, tabella assente → default) e per il rendering. Controllo visivo a 390 px.

## Nota dati Lyfta (verificata su D1, 6 nov 2026)
- `is_completed` è false per ~90% delle serie registrate (da maggio 2025) ed è true quasi solo sulle serie a tempo/cardio: il flag NON è usato né per i conteggi né per le etichette. Una serie di lavoro conta se ha ripetizioni (o ≥10 s per addome/collo).
- La durata delle serie a tempo arriva come testo "m:ss" (es. "0:40", "1:00"; minuti anche oltre 59). Fino al 6 nov 2026 non veniva letta (restava null): corretto in `durationSec`; i record già salvati si aggiornano alla prossima sincronizzazione Lyfta. Le serie di plank contano per l'addome (≥10 s).

## Consigli dell'IA (v1, `src/ai/`)
- Il server costruisce un **dossier** deterministico (obiettivo/fase, target, insight del Coach, confronto 14 gg, aderenza alla scheda, scheda, note, lacune dei dati, consigli precedenti con riscontro dell'utente). Il modello **ragiona soltanto sul dossier**; nessuna identità nel dossier. Il testo delle note parte solo se `ai_send_notes` è attivo (default sì, interruttore nella PWA).
- Risposta JSON validata (riassunto, ≤5 priorità con area, perché, evidenze, azioni misurabili, fiducia, orizzonte di verifica; da tenere d'occhio; domande). Un solo nuovo tentativo se il formato è errato. I numeri citati come evidenza sono verificati contro il dossier (±1 %): quelli non trovati sono segnalati con ⚠, non scartati.
- Ogni consiglio è salvato (`ai_advice`: impronta e dossier, modello, versione del prompt, risposta, non verificati, token). Riscontro per priorità: seguito / in parte / non seguito / non utile (`ai_advice_feedback`).
- Cache 6 h sull'impronta dei soli dati (non con tema o `force`); tetto 8 analisi per giorno UTC.
- Configurazione solo da variabili del Worker: `AI_PROVIDER` (gemini|openai), `AI_MODEL`, `AI_API_KEY` (secret), `AI_BASE_URL` (https, solo openai). Gli errori espongono solo codici.
- Endpoint solo proprietario: `GET /v1/ai/status`, `POST /v1/ai/advice {focus?, force?}`, `GET /v1/ai/advice?id=`, `POST /v1/ai/settings {send_notes}`, `POST /v1/ai/feedback`. Non è consulenza medica.

## Progressione sui valori reali e muscoli secondari (v1)
- Oltre all'e1RM, per ogni esercizio si confrontano la prima e l'ultima seduta della finestra di 28 giorni (almeno 2 sedute a 7 giorni di distanza) sui valori reali: carico più alto, serie al carico più alto, ripetizioni medie, RIR medio. Ripetizioni "efficaci" = ripetizioni + RIR (solo se il RIR c'è in entrambe). Progressi: 20 kg 8×3 → 24 kg 8×3; 8×3 → 10×3 a 20 kg; stesso lavoro con RIR 1 → 2; più serie allo stesso carico. Se il carico cambia, l'arbitro è l'e1RM con banda ±1,5 %. Il confronto è un'informazione in più (`direct`): lo stato `status` resta quello dell'e1RM (prudente, 3 sedute su 21 giorni).
- Ogni esercizio ha un muscolo primario (serie dirette) e dei secondari (serie indirette, `SECONDARY` in `muscles.js`). Il volume efficace = dirette + 0,5 × indirette (ipotesi di lavoro) serve per evitare falsi "sotto il minimo"; "volume alto" usa solo le serie dirette.
- L'obiettivo è quello scritto dall'utente nella fase (nome, obiettivo, metodo, tipo). L'app non lo sostituisce con un default: se la fase non c'è, o i target sono i default, il dossier lo dichiara e l'IA lo tratta come ipotesi. Prompt v3.
