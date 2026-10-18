-- 005: application settings, including the optional user-supplied LLM key (stored encrypted, never returned to the browser).
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  encrypted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
