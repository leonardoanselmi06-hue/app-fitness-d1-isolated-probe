# Pasti stimati da ChatGPT — formato di importazione (versione 1)
Importa dalla scheda Alimentazione → "Pasti stimati da ChatGPT" (incolla il JSON). Le stime restano separate da FatSecret (non entrano nei totali né nelle medie).

Istruzione da dare a ChatGPT: "Rispondi con SOLO questo JSON, uno per ogni pasto, id unico e stabile (es. data-pasto)":
`{"version":1,"meals":[{"id":"2026-11-14-pranzo","date":"2026-11-14","meal":"Lunch","name":"Pasta al pomodoro","description":"80 g a crudo","calories":650,"protein":22,"carbohydrate":100,"fat":16,"fiber":6,"sugar":8,"uncertainty_pct":25}]}`

- `meal`: Breakfast | Lunch | Dinner | Other. `calories` obbligatorie; gli altri nutrienti opzionali (assenti = nulla, mai zero).
- `uncertainty_pct` (0–100) opzionale; se manca vale 25. Data: da oggi a 30 giorni fa. Massimo 50 pasti per invio.
- Idempotente: reimportare lo stesso id identico non cambia nulla; un id con valori diversi crea una nuova revisione. Nessuna cancellazione.

## Importazione automatica da una cartella Drive (sola lettura, solo quella cartella)
Gli scope OAuth di Drive non si limitano a una cartella (drive.readonly = tutto il Drive). Per questo si usa un **account di servizio**: vede solo ciò che gli condividi.
1. Google Cloud (stesso progetto di Drive) → IAM → Account di servizio → crea (nessun ruolo) → Chiavi → Aggiungi chiave → JSON. Abilita già la *Google Drive API*.
2. In Drive crea la cartella (es. `App fitness/Pasti ChatGPT`) e condividila con l'email dell'account di servizio come **Visualizzatore**. ChatGPT scrive i file `.json` (formato v1) in quella cartella.
3. Secret del repo GitHub: `GOOGLE_SA_KEY` = contenuto del file JSON della chiave; `ESTIMATES_FOLDER_ID` = ID della cartella (dall'URL). Poi un deploy del Worker.
Comportamento: cron (mattina e sera) e pulsante "Importa dalla cartella Drive". Legge solo i `.json` modificati negli ultimi 35 giorni (max 10 file per giro); un file non valido viene saltato e contato; nessun file viene toccato.
