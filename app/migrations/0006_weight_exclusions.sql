-- Registro delle esclusioni di pesate decise dal proprietario nell'app (append-only). La lista attiva resta in meta('excluded_weights'),
-- che l'ingestione del telefono già rispetta; qui resta chi/quando/perché (DEC-DATA-003).
CREATE TABLE IF NOT EXISTS weight_exclusion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  instant TEXT NOT NULL,                  -- istante ISO della pesata (observed_at)
  action TEXT NOT NULL CHECK (action IN ('exclude', 'restore')),
  kg REAL,                                -- valore al momento dell'azione (solo per mostrarlo)
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS weight_exclusion_log_instant ON weight_exclusion_log (subject_id, instant, id);
