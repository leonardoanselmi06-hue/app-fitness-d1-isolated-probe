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

## Fuori ambito (per ora)
Registrazione delle serie nell'app (resta Lyfta); AI integrata; confronto automatico prescritto/eseguito (dopo il report di fase).
