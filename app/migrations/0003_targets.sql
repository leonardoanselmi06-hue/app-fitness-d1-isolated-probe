-- Obiettivi e target del Coach, VERSIONATI (DEC-DATA-003): una riga per versione, mai sovrascritta.
-- La versione in vigore è quella con valid_from <= oggi e valid_to NULL o futuro. Scritta solo su richiesta del proprietario
-- (non esiste endpoint di scrittura nell'app); letta dal Coach in sola lettura.
CREATE TABLE IF NOT EXISTS coach_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  valid_from TEXT NOT NULL,       -- giorno locale (Europe/Rome), YYYY-MM-DD
  valid_to TEXT,                  -- NULL = in vigore fino a nuova versione
  phase TEXT NOT NULL,            -- es. 'massa'
  goal TEXT NOT NULL,             -- descrizione leggibile
  targets_json TEXT NOT NULL,     -- soglie che sovrascrivono i default (vedi docs/COACH_SPEC.md)
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS coach_targets_subject_from ON coach_targets (subject_id, valid_from);
