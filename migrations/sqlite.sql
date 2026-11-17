PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS vydo_usage (
 id TEXT PRIMARY KEY, subject TEXT NOT NULL, ip TEXT NOT NULL, created_ms INTEGER NOT NULL,
 state TEXT NOT NULL, refunded INTEGER NOT NULL DEFAULT 0, lease_ms INTEGER NOT NULL, worker TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_subject_window ON vydo_usage(subject,created_ms);
CREATE INDEX IF NOT EXISTS usage_ip_window ON vydo_usage(ip,created_ms);
CREATE INDEX IF NOT EXISTS usage_active ON vydo_usage(state,lease_ms);
CREATE TABLE IF NOT EXISTS vydo_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL, user_id TEXT, expires_ms INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS sessions_user ON vydo_sessions(user_id);
CREATE TABLE IF NOT EXISTS vydo_profiles (user_id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', format TEXT NOT NULL DEFAULT 'mp3', quality TEXT NOT NULL DEFAULT '720');
CREATE TABLE IF NOT EXISTS vydo_history (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, video_id TEXT NOT NULL,
 format TEXT NOT NULL, quality TEXT NOT NULL, status TEXT NOT NULL, created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS history_user_date ON vydo_history(user_id,created_ms DESC);
CREATE TABLE IF NOT EXISTS vydo_rates (id TEXT PRIMARY KEY, rate_key TEXT NOT NULL, created_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rates_key_date ON vydo_rates(rate_key,created_ms);
