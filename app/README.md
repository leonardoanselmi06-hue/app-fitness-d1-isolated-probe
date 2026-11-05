# App Fitness

Backend Cloudflare Worker + D1 e PWA mobile-first. **Zero dipendenze runtime.** Stato: ambiente di prova, **solo dati sintetici**.
Source of Truth del progetto: cartella Drive "app fitness" (Decision Register prevale su ogni altro documento).

Codice ripristinato dallo snapshot del commit `607a9c8` (1 novembre 2026). Le icone PNG sono segnaposto rigenerati.

## Stato (Fase 1, DEC-ROADMAP-001)
| Componente | Stato |
|---|---|
| Ledger idempotente D1-compatibile (`src/ingest/ledger.js`) | implementato, testato su emulatore D1 |
| Adapter Lyfta (normalizzazione + sync paginato) | implementato su fixture SINTETICHE; nomi campi non documentati marcati UNVERIFIED |
| Auth Cloudflare Access (JWT RS256), fail-closed | implementata, testata offline con chiavi generate nei test |
| API `/v1` sola lettura + PWA shell | implementate |
| Migrazione `0001_ledger.sql` su D1 di test | applicata il 3 novembre 2026 (solo schema, nessun dato) |
| RawStore su Google Drive (DEC-STORAGE-005) | **NON implementato**: serve OAuth Google lato server |
| Test su D1 REALE (batch, CAS, concorrenza) | workflow pronto (`d1-ledger-test.yml`, solo manuale), **non ancora eseguito**: l'emulatore non è evidenza di comportamento D1 |
| ACK realmente perso (disconnessione di rete) | **NON simulato**: lo scenario verifica solo il recupero dello stato per `operation_id` |
| Renpho/FatSecret CSV, sonno provvisorio, Polar | da fare |

## Test
`npm test` (Node ≥ 22.13), da questa cartella. Il D1 è emulato con `node:sqlite` (`tests/helpers/d1-shim.mjs`): serve solo a verificare la logica; il comportamento di Cloudflare D1 va provato sul database di test.

## Test su D1 reale (workflow manuale)
`.github/workflows/d1-ledger-test.yml`, solo `workflow_dispatch` (Actions → "D1 ledger test (manuale)" → Run workflow). Richiede i secret `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.
- `phase=preflight`: controlla token, database di test e nome Worker. **Sola lettura**, nessun deploy.
- `phase=run`: deploy di un Worker temporaneo (un solo binding D1 di test, nessuna route), esegue gli scenari di `tests/d1-remote/scenarios.js`, elimina le righe sintetiche del run (prefisso `d1t-<run_id>-`) ed elimina il Worker verificandone l'assenza. Se la pulizia non è verificata il job fallisce: non è un PASS.
- Il contatore `meta.generation` del database di test resta incrementato dopo un run.
- Gli stessi scenari girano anche sull'emulatore in `npm test` (`tests/d1-scenarios.test.mjs`), per distinguere un difetto dell'harness da un comportamento di D1.

## Regole
- Niente dati personali reali, niente segreti nel repo, niente deploy production.
- Il client non può dichiarare `scope_complete`: lo calcola l'adapter server-side.
- File ≤ ~500 righe (DEC-ARCH-004).
- Il probe diagnostico D1 nella radice del repo è separato da questa cartella.
