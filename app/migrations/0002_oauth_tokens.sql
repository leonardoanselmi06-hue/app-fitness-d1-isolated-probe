-- Token OAuth dei provider (Polar). I token sono CIFRATI (AES-GCM) prima di arrivare qui: vedi src/adapters/polar/oauth.js.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  provider TEXT PRIMARY KEY,
  sealed TEXT NOT NULL,          -- JSON cifrato {access_token, refresh_token}
  expires_at TEXT NOT NULL,      -- istante di scadenza dell'access token (ISO UTC)
  scope TEXT,
  updated_at TEXT NOT NULL
);
