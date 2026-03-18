-- Planned SQLite schema for rs-openclaw daemon.

CREATE TABLE IF NOT EXISTS file_state (
  path TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  mtime_ns INTEGER NOT NULL,
  content_hash TEXT,
  remote_etag TEXT,
  remote_version_id TEXT,
  last_synced_at TEXT,
  deleted_flag INTEGER NOT NULL DEFAULT 0,
  conflict_flag INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS event_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  event_type TEXT NOT NULL,
  enqueue_at TEXT NOT NULL,
  merged_flag INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued'
);

CREATE TABLE IF NOT EXISTS lock_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  holder_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  host TEXT NOT NULL,
  pid INTEGER NOT NULL,
  acquired_at TEXT NOT NULL,
  released_at TEXT,
  steal_flag INTEGER NOT NULL DEFAULT 0,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS sync_run_log (
  run_id TEXT PRIMARY KEY,
  trigger_source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  uploaded_count INTEGER NOT NULL DEFAULT 0,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  pulled_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  lock_wait_ms INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL
);
