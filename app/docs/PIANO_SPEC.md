# Piano — fasi, scheda versionata, note (bozza DEC-PLAN-001, CANDIDATE)

Stato: direzione approvata dall'utente il 6 nov 2026 ("tutto integrato in app"; Lyfta continua a registrare gli allenamenti, l'app tiene
scheda e storico; AI integrata rimandata). Da registrare nel Decision Register. Non è consulenza medica.

## Cosa cambia rispetto a prima
- L'API non è più di sola lettura: nasce una superficie di **scrittura riservata al proprietario** (JWT Cloudflare Access con email;
  il token del telefono resta limitato a POST /v1/ingest/device). Scrive solo le tabelle del Piano (`phases`, `plan_versions`):
  mai i dati canonici (`current_records`) né i RAW.
- Difese: solo `content-type: application/json` (niente richieste cross-site semplici), `Origin` uguale all'host se presente, corpo ≤ 20 KB,
  validazione rigida per tipo, campi sconosciuti rifiutati.

## Modello (append-only, DEC-DATA-003)
- **Fase** (`phases`): data inizio, data fine (esclusa; NULL = in corso), stato attiva/chiusa, report finale (JSON, scritto una volta alla chiusura).
  Una sola fase attiva (indice unico parziale). Nome, obiettivo e metodologia sono versioni (`kind='phase'`).
- **Scheda**: giorni (`kind='day'`, es. "6.UPPER") ed esercizi prescritti (`kind='rx'`: serie, range ripetizioni, RIR target, recupero in secondi, metodo, nota).
- **Note** (`kind='note'`): data evento, categoria, titolo, testo ≤ 5000; collegate alla fase che contiene la data.
- **Versione** (`plan_versions`): `entity_key`, `valid_from` (incluso), `valid_to` (escluso, NULL = ultima), `data_json` = stato COMPLETO, `reason`.
  Una modifica non sovrascrive: chiude la versione aperta (`valid_to = nuovo valid_from`) e ne inserisce una nuova, in un batch D1 atomico.
  Esempio: recupero trazioni 2:30 → 3:00 dal 12 nov = versione A (fino al 12 nov escluso, 150 s) + versione B (dal 12 nov, 180 s).
  La scheda "attuale" è la versione in vigore oggi; lo storico mostra tutte.
- **Concorrenza**: ogni modifica porta `expected_version_id`; se non è più la versione aperta → 409 (`stale`). Indice unico parziale: una sola versione aperta per entità.
- **Rimozione** = nuova versione con `removed: true` (lo storico resta). Una fase chiusa è congelata: nessuna modifica a giorni/esercizi.
- `valid_from` ≥ inizio fase, ≤ oggi + 60 giorni, e ≥ `valid_from` della versione precedente della stessa entità (stessa data = correzione: la precedente resta nello storico con intervallo vuoto).
- Giorni locali Europe/Rome.

## Cambio fase
`phase/start` (nome, obiettivo, metodologia, data, opzionale copia della scheda della fase precedente) richiede che non ci sia una fase attiva;
`phase/close` (data fine) congela la fase: chiude le versioni aperte con `valid_to = data fine` e salva il **report di fase** (PR C):
peso (inizio, fine, variazione/sett.), kcal medie sui giorni completi, proteine g/kg, sonno medio, passi medi, serie/sett. per muscolo,
sedute/sett., progressione per esercizio (e1RM), recupero medio configurato, metodologia e scheda finale. Il report non si ricalcola da solo.

## Stato di implementazione (6 nov 2026, in produzione)
- API: `GET /v1/plan`, `/v1/plan/history?entity=|phase_id=`, `/v1/plan/report?phase_id=`, `/v1/plan/suggest?from=&to=`; `POST /v1/plan/version`, `/phase/start`, `/phase/close`, `/import-lyfta`.
- PWA: tab **Piano** (fase attiva, scheda in vigore con modifiche programmate, storico per esercizio, note, fasi passate con report e scheda finale, importazione da Lyfta).
- **Importazione da Lyfta**: per ogni titolo di allenamento nel periodo, l'ultima seduta → serie di lavoro (riscaldamenti esclusi), range ripetizioni, RIR più frequente, recupero configurato. Il server ricalcola la proposta: il client sceglie solo i titoli. Una sola scrittura atomica; reimportare salta ciò che esiste.
- **Report di fase** (alla chiusura, `report_version` 1): peso (media primi/ultimi k giorni, ritmo %/sett. con regressione se ≥4 giorni su ≥14), grasso corporeo, kcal e proteine (solo giorni completi), sonno (notti regolari), passi, sedute di forza e serie per muscolo/sett., recupero medio configurato, RIR medio registrato, progressione per esercizio (e1RM, ≥4 sedute), scheda finale, numero di modifiche, note del periodo. Sezioni senza dati = null con nota.
- Vincolo di progetto: poche query D1 per richiesta (il piano Free di Cloudflare ne limita il numero): viste e import usano query aggregate e un solo batch.
- Per rifare lo storico di una fase passata (es. la scheda 1–6 di agosto–ottobre): avvia una fase con la data di inizio di allora, importa da Lyfta con lo stesso periodo, chiudi con l'ultimo giorno. Le fasi non possono sovrapporsi.

## Fuori ambito (per ora)
Registrazione delle serie nell'app (resta Lyfta); AI integrata; confronto automatico prescritto/eseguito (dopo il report di fase).

## Aggiornamento 6 nov 2026 (sera) — in produzione
- **Aderenza alla scheda** (`GET /v1/plan/adherence`, sezione nel Piano, riepilogo nel report): ogni seduta Lyfta è confrontata con la scheda IN VIGORE quel giorno (titolo = nome del giorno): serie, ripetizioni nel range, RIR registrato − previsto, recupero, esercizi saltati/parziali/sostituiti (stesso muscolo, ipotesi), extra, giorni mai svolti.
- **Progressione** (DEC-COACH-002 CANDIDATE): finestra 28 giorni, ≥3 esposizioni su ≥21 giorni; e1RM aggiustato per RIR se registrato nei ≥2/3 delle serie; stato per esercizio e classificazione globale (IN PROGRESSIONE / STABILE / IN STALLO ≥42 giorni dal massimo / IN CALO / MISTA / DATI INSUFFICIENTI).
- **Recupero** (DEC-RECOVERY-001 CANDIDATE): `POST/GET /v1/checkin` (5 valori 1–5, append-only, correzioni con storico, fino a 14 giorni indietro), indice 0–100, regolarità del sonno (SD letto/risveglio, ≥7 notti), insight del Coach che non attribuisce cali alla stanchezza senza check-in.
- **Esclusione pesate** da app (`POST /v1/weights/exclude|restore`): lista in `meta('excluded_weights')` + registro `weight_exclusion_log`, tombstone immediato nel ledger; il ripristino torna con la prossima sincronizzazione del telefono.
- **Confronto tra periodi** (`GET /v1/compare?days=7|14|28`): peso, grasso, calorie e proteine (giorni completi), sonno, passi, recupero, sedute e serie per muscolo; delta solo con dati sufficienti in entrambi i periodi.
- **Target nelle fasi**: la versione `phase` può avere `goal_type` (massa/forza/mantenimento/definizione) e `targets` (ritmo peso con segno, proteine, serie, sedute, frequenza, sonno). Il Coach legge: fase attiva → `coach_targets` storico → default (`tests_done` resta dalla riga storica). Il report di fase salva i target.

## Cardio e attività secondarie (v1)
- Corsa, cardio e simili si inseriscono come un **giorno della scheda** (per esempio "Corsa") con esercizi dal nome di Lyfta (per esempio "Run on Treadmill"), 1 serie e **durata in minuti** (`duration_min` nella versione `rx`, 1–600). L'importazione da Lyfta riconosce il cardio e propone la durata dell'ultima seduta.
- Il confronto è per **minuti**, non per serie: completo, parziale (< 80 % dei minuti previsti) o saltato. I giorni composti solo da cardio sono "secondari": non entrano in serie fatte, ripetizioni, RIR e recuperi, né nelle settimane di forza. La distanza non è usata (unità non documentata in Lyfta).
- `adherence.cardio`: sedute e minuti registrati in Lyfta nel periodo (anche con un titolo non in scheda, e dentro altre sedute); `adherence.secondary`: minuti fatti e previsti dei giorni secondari. Il cardio non è mai una seduta di forza né un esercizio "extra".
- Il dossier dell'IA li riceve con la dicitura "cardio, attività secondaria"; il prompt v5 le valuta rispetto a obiettivo e recupero (K12).
