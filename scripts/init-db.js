import initSqlJs from 'sql.js';
import { resolve } from 'path';
import { mkdirSync, existsSync, writeFileSync } from 'fs';

const DB_PATH = process.env.DB_PATH || resolve('./data/bot.sqlite');
const DATA_DIR = resolve('./data');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const SQL = await initSqlJs({
  locateFile: (file) => `file://${resolve('./')}/${file}`
});

const db = new SQL.Database();

const schema = `
-- Rate limiting table
CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  command TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  window_start INTEGER NOT NULL,
  blocked_until INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  UNIQUE(user_id, command)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_command ON rate_limits(user_id, command);
CREATE INDEX IF NOT EXISTS idx_rate_limits_blocked_until ON rate_limits(blocked_until);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT,
  is_banned INTEGER DEFAULT 0,
  ban_reason TEXT,
  total_commands INTEGER DEFAULT 0,
  total_downloads INTEGER DEFAULT 0,
  first_seen INTEGER DEFAULT (strftime('%s', 'now')),
  last_seen INTEGER DEFAULT (strftime('%s', 'now')),
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen);
CREATE INDEX IF NOT EXISTS idx_users_is_banned ON users(is_banned);

-- Command statistics
CREATE TABLE IF NOT EXISTS command_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command TEXT NOT NULL UNIQUE,
  total_calls INTEGER DEFAULT 0,
  total_duration_ms INTEGER DEFAULT 0,
  avg_duration_ms REAL DEFAULT 0,
  min_duration_ms INTEGER DEFAULT 0,
  max_duration_ms INTEGER DEFAULT 0,
  last_used INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Download history
CREATE TABLE IF NOT EXISTS download_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  track_id TEXT,
  title TEXT,
  artist TEXT,
  album TEXT,
  file_size INTEGER,
  duration_sec INTEGER,
  quality TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_download_history_user_id ON download_history(user_id);
CREATE INDEX IF NOT EXISTS idx_download_history_status ON download_history(status);
CREATE INDEX IF NOT EXISTS idx_download_history_started_at ON download_history(started_at);

-- Queue tracking
CREATE TABLE IF NOT EXISTS queue_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  command TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT DEFAULT 'waiting',
  queued_at INTEGER DEFAULT (strftime('%s', 'now')),
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_queue_entries_user_status ON queue_entries(user_id, status);
`;

db.exec(schema);

const data = db.export();
writeFileSync(DB_PATH, Buffer.from(data));

console.log('✅ Database initialized at:', DB_PATH);
console.log('✅ Tables created: rate_limits, users, command_stats, download_history, queue_entries');

db.close();