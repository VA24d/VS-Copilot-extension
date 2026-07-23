export const SCHEMA_USER_VERSION = 3;

export const DDL = `
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  request_id TEXT,
  source TEXT CHECK(source IN ('passive','participant')),
  workspace_hash TEXT,
  workspace_path TEXT,
  timestamp INTEGER,
  category TEXT,
  language TEXT,
  model_id TEXT,
  agent_id TEXT,
  agent_name TEXT,
  prompt_text TEXT,
  response_text TEXT,
  attachments_json TEXT,
  copilot_credits REAL,
  schema_version_seen INTEGER,
  created_at INTEGER,
  UNIQUE(session_id, request_id, source)
);

CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
CREATE INDEX IF NOT EXISTS idx_requests_category ON requests(category);
CREATE INDEX IF NOT EXISTS idx_requests_language ON requests(language);

CREATE TABLE IF NOT EXISTS ingestion_state (
  file_path TEXT PRIMARY KEY,
  last_mtime_ms INTEGER,
  last_size_bytes INTEGER,
  last_request_count INTEGER,
  last_processed_at INTEGER,
  schema_version_seen INTEGER,
  parse_error_count INTEGER,
  last_error TEXT
);
`;
