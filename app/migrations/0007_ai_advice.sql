-- Consigli generati dall'IA integrata (append-only). Ogni riga conserva il dossier inviato (hash + contenuto), il modello e la risposta
-- validata: serve a capire in seguito cosa è stato consigliato, su quali dati, e se è stato seguito. Nessuna chiave API qui.
CREATE TABLE IF NOT EXISTS ai_advice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'weekly', 'phase_close')),
  focus TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  dossier_hash TEXT NOT NULL,
  dossier_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  unverified INTEGER NOT NULL DEFAULT 0,   -- numeri citati come evidenza che non risultano nel dossier
  tokens_in INTEGER,
  tokens_out INTEGER
);
CREATE INDEX IF NOT EXISTS ai_advice_subject_created ON ai_advice (subject_id, created_at);
-- Esito dichiarato dall'utente per ogni priorità (vale l'ultimo per advice_id + idx).
CREATE TABLE IF NOT EXISTS ai_advice_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  advice_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('seguito', 'parziale', 'non_seguito', 'non_utile')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_advice_feedback_advice ON ai_advice_feedback (subject_id, advice_id, idx, id);
