# Collegare Google Drive (RAW) — da fare una volta
Il Worker scrive su Drive con un **refresh token OAuth** (scope `drive.file`: vede solo i file creati dall'app, in una cartella `AppFitness-RAW` che crea da sola).
Non usare un service account: non ha quota su un Drive personale.

Secret richiesti (Cloudflare Worker e/o GitHub, MAI nel repo né in chat): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. Opzionale: `DRIVE_FOLDER_ID`.

1. Google Cloud Console → nuovo progetto → abilita *Google Drive API*.
2. Schermata consenso OAuth: tipo *External*, aggiungi il tuo account, scope `.../auth/drive.file`. **Pubblica in "In production"**: in "Testing" il refresh token scade dopo 7 giorni.
3. Credenziali → *OAuth client ID* → tipo *Web application* con redirect `https://developers.google.com/oauthplayground`.
4. OAuth Playground → ingranaggio → "Use your own OAuth credentials" → scope `https://www.googleapis.com/auth/drive.file` → Authorize → Exchange → copia il *refresh token*.
5. Salva i tre valori come secret del Worker.

Comportamento: senza i tre secret l'archivio RAW risponde 503 (fail-closed). Se il token viene revocato: 503 `raw_store_auth_failed`.
