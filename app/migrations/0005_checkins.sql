-- Check-in giornaliero di recupero (5 valori 1–5 inseriti dal proprietario nell'app). Append-only: una correzione aggiunge una riga,
-- vale l'ultima per giorno; le precedenti restano come storico. Scritto solo da POST /v1/checkin (DEC-RECOVERY-001, CANDIDATE).
CREATE TABLE IF NOT EXISTS checkin_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  day TEXT NOT NULL,                      -- giorno locale Europe/Rome a cui si riferisce il check-in
  data_json TEXT NOT NULL,                -- {sleep_quality, readiness, fatigue, soreness, stress}: interi 1..5 o null
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS checkin_versions_day ON checkin_versions (subject_id, day, id);
