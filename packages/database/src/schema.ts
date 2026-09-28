export const SCHEMA_VERSION = 7;

export const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS schema_meta (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  private_key_encrypted TEXT,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  department_id TEXT,
  avatar_url TEXT,
  presence TEXT NOT NULL DEFAULT 'offline',
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organization_id, username)
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL,
  public_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  trust_status TEXT NOT NULL,
  last_seen_at TEXT,
  last_ip TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  organization_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_user_id TEXT,
  actor_device_id TEXT,
  event_type TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(organization_id);
`;

export const MIGRATION_V2 = `
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id TEXT NOT NULL REFERENCES chats(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id),
  sender_user_id TEXT NOT NULL,
  sender_device_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_text TEXT NOT NULL,
  reply_to_id TEXT,
  status TEXT NOT NULL,
  client_nonce TEXT NOT NULL,
  sequence_num INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT,
  UNIQUE(chat_id, client_nonce)
);

CREATE TABLE IF NOT EXISTS message_outbox (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id),
  target_device_id TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS known_peers (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  host TEXT,
  port INTEGER,
  trust_status TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON message_outbox(status, next_retry_at);
`;

export const MIGRATION_V3 = `
CREATE TABLE IF NOT EXISTS file_transfers (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  message_id TEXT,
  sender_user_id TEXT NOT NULL,
  sender_device_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256_hex TEXT NOT NULL,
  chunk_size INTEGER NOT NULL,
  total_chunks INTEGER NOT NULL,
  next_chunk_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL REFERENCES file_transfers(id),
  blob_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_chunk_outbox (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  target_device_id TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT NOT NULL,
  status TEXT NOT NULL,
  UNIQUE(transfer_id, chunk_index, target_device_id)
);

CREATE INDEX IF NOT EXISTS idx_file_transfers_chat ON file_transfers(chat_id);
`;

export const MIGRATION_V4 = `
CREATE TABLE IF NOT EXISTS seen_envelopes (
  sender_device_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (sender_device_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_seen_envelopes_seen_at ON seen_envelopes(seen_at);
`;

// Session validation (on every app start) and attachment/peer lookups were
// doing full table scans — these tables were previously only indexed by
// their primary key, which doesn't help lookups keyed on a different column.
export const MIGRATION_V5 = `
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_known_peers_user ON known_peers(user_id);
`;

export const MIGRATION_V6 = `
ALTER TABLE chat_members ADD COLUMN last_read_at TEXT;
`;

/** Envelopes that are not tied to a chat message (group roster announces). */
export const MIGRATION_V7 = `
CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  target_device_id TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_status ON sync_outbox(status, next_retry_at);
`;
