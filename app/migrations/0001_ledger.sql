-- Ledger idempotente (DEC-DATA-001, DEC-MODEL-009). Compatibile D1/SQLite.
-- I RAW NON stanno qui: D1 conserva indici, metadati, riferimenti (artifact_ref) e dati strutturati (DEC-STORAGE-005).
CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO meta(name, value) VALUES ('generation', 0) ON CONFLICT(name) DO NOTHING;

CREATE TABLE IF NOT EXISTS ingest_operations (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  ingest_key TEXT NOT NULL,
  request_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_account TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  artifact_ref TEXT NOT NULL,
  artifact_bytes INTEGER NOT NULL,
  scope_complete INTEGER NOT NULL,
  status TEXT NOT NULL,
  base_generation INTEGER NOT NULL,
  committed_generation INTEGER,
  modified_count INTEGER NOT NULL DEFAULT 0,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (subject_id, ingest_key),
  UNIQUE (subject_id, request_id)
);

CREATE TABLE IF NOT EXISTS current_records (
  subject_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_account TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  payload_json TEXT,
  payload_hash TEXT,
  revision INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT,
  last_op_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subject_id, source_system, source_account, scope_id, record_id)
);
CREATE INDEX IF NOT EXISTS current_by_domain ON current_records (subject_id, domain, deleted, observed_at);

CREATE TABLE IF NOT EXISTS record_revisions (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_account TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  revision INTEGER NOT NULL,
  tombstone INTEGER NOT NULL,
  payload_json TEXT,
  payload_hash TEXT,
  observed_at TEXT,
  op_id TEXT NOT NULL REFERENCES ingest_operations(id),
  recorded_at TEXT NOT NULL,
  UNIQUE (subject_id, source_system, source_account, scope_id, record_id, revision)
);
