# Pasti stimati da ChatGPT — formato di importazione (versione 1)
Importa dalla scheda Alimentazione → "Pasti stimati da ChatGPT" (incolla il JSON). Le stime restano separate da FatSecret (non entrano nei totali né nelle medie).

Istruzione da dare a ChatGPT: "Rispondi con SOLO questo JSON, uno per ogni pasto, id unico e stabile (es. data-pasto)":
`{"version":1,"meals":[{"id":"2026-11-14-pranzo","date":"2026-11-14","meal":"Lunch","name":"Pasta al pomodoro","description":"80 g a crudo","calories":650,"protein":22,"carbohydrate":100,"fat":16,"fiber":6,"sugar":8,"uncertainty_pct":25}]}`

- `meal`: Breakfast | Lunch | Dinner | Other. `calories` obbligatorie; gli altri nutrienti opzionali (assenti = nulla, mai zero).
- `uncertainty_pct` (0–100) opzionale; se manca vale 25. Data: da oggi a 30 giorni fa. Massimo 50 pasti per invio.
- Idempotente: reimportare lo stesso id identico non cambia nulla; un id con valori diversi crea una nuova revisione. Nessuna cancellazione.
- Importazione automatica da Drive: non attiva (lo scope `drive.file` del Worker non vede file creati da ChatGPT; servirebbe un token con lettura Drive).
