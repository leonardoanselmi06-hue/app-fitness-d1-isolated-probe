-- Piano: fasi e scheda VERSIONATE (DEC-DATA-003, append-only). Scritte solo dal proprietario via app (DEC-PLAN-001, CANDIDATE).
-- Una modifica non sovrascrive: chiude la versione aperta (valid_to = nuovo valid_from, ESCLUSO) e ne inserisce una nuova.
CREATE TABLE IF NOT EXISTS phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  start_date TEXT NOT NULL,               -- giorno locale Europe/Rome, incluso
  end_date TEXT,                          -- ESCLUSO; NULL = in corso
  status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
  report_json TEXT,                       -- snapshot alla chiusura, scritto una sola volta
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS phases_one_active ON phases (subject_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS plan_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  phase_id INTEGER,                       -- fase di appartenenza (note: fase che contiene la data dell'evento, se esiste)
  kind TEXT NOT NULL CHECK (kind IN ('phase', 'day', 'rx', 'note')),
  entity_key TEXT NOT NULL,               -- phase:<id> | day:<id>:<giorno> | rx:<id>:<giorno>:<esercizio> | note:<uuid>
  valid_from TEXT NOT NULL,               -- incluso
  valid_to TEXT,                          -- escluso; NULL = versione più recente
  data_json TEXT NOT NULL,                -- stato COMPLETO della versione
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS plan_versions_one_open ON plan_versions (subject_id, entity_key) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS plan_versions_phase ON plan_versions (subject_id, phase_id, kind);
