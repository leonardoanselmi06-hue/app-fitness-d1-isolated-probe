# Fitness App — istruzioni di progetto

## Dove sta cosa
- L'app è in `app/`. Il README nella radice descrive il probe D1 (separato, obsoleto): non usarlo come riferimento.
- Source of Truth = Decision Register nella cartella Drive "app fitness". Prevale su ogni altro documento. Le decisioni FROZEN non si riaprono senza evidenza e aggiornamento del registro.
- Spec nel repo: `app/docs/` (COACH_SPEC, PIANO_SPEC, KNOWLEDGE_BASE, DRIVE_SETUP).

## Comandi
- Test: `cd app && npm test` (Node >= 22.13). Prima di dire "fatto" i test devono passare.
- Zero dipendenze runtime: non aggiungerne e non committare `package-lock.json`.

## Regole del codice
- File <= ~500 righe (DEC-ARCH-004). Modifica minima: non toccare ciò che non serve.
- Niente dati personali reali, niente segreti nel repo, niente deploy production.
- I workflow che usano segreti Cloudflare partono solo con `workflow_dispatch`: mai `push` o `pull_request`.
- Il Readiness Gate DB-RG-001 è NOT PASS: dati reali solo per i sync già approvati dall'utente (Lyfta, Polar, FatSecret).

## Coach e IA
- Principio fondamentale: regole e calcoli (medie, pendenze, soglie, rumore, confidenza, esiti) li esegue il codice in modo deterministico. Il modello riceve valori già calcolati e fa solo spiegazione, confronto e proposta di un'azione.
- Il modello non è nel codice: si configura con le variabili del Worker (`AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_API_KEY`). Non scrivere nomi di modelli nei sorgenti.
- Costo zero per tutta l'app.

## Modo di lavorare
- L'utente lavora da smartphone: non chiedergli di eseguire comandi o installare software sul PC.
- Lavora su un branch e apri una PR. Merge e deploy del Worker sono delegati a Claude, che verifica il risultato.
- Se una decisione già presa sembra sbagliata, valutala criticamente e chiedi all'utente.
