import initSqlJs from 'sql.js';
import { resolve } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';

const DB_PATH = process.env.DB_PATH || resolve('./data/bot.sqlite');
const DATA_DIR = resolve('./data');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

let dbInstance = null;
let isInitialized = false;
let initPromise = null;

async function getDb() {
  if (dbInstance) return dbInstance;
  
  if (!initPromise) {
    initPromise = (async () => {
      const SQL = await initSqlJs({
        locateFile: (file) => `file://${resolve('./')}/${file}`
      });
      
      let db;
      if (existsSync(DB_PATH)) {
        const fileBuffer = readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
      } else {
        db = new SQL.Database();
      }
      
      dbInstance = db;
      isInitialized = true;
      
      // Enable foreign keys
      db.run('PRAGMA foreign_keys = ON;');
      
      // Run schema
      await runSchema(db);
      
      return db;
    })();
  }
  
  return initPromise;
}

async function runSchema(db) {
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
}

function closeDb() {
  if (dbInstance && isInitialized) {
    try {
      const data = dbInstance.export();
      writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) {
      console.error('Failed to save database:', e);
    }
    dbInstance.close();
    dbInstance = null;
    isInitialized = false;
    initPromise = null;
  }
}

// Helper to run SQL and return results as objects
function runQuery(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function runExec(db, sql) {
  db.exec(sql);
}

function runStatement(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  const changes = db.getRowsModified();
  let lastInsertRowid = null;
  
  // Get last insert rowid for INSERT statements
  const upperSql = sql.trim().toUpperCase();
  if (upperSql.startsWith('INSERT')) {
    const result = runQuery(db, 'SELECT last_insert_rowid() as id', []);
    lastInsertRowid = result[0]?.id || null;
  }
  
  stmt.free();
  return { changes, lastInsertRowid };
}

async function runTransaction(fn) {
  const db = await getDb();
  db.run('BEGIN TRANSACTION;');
  try {
    const result = await fn(db);
    db.run('COMMIT;');
    return result;
  } catch (e) {
    db.run('ROLLBACK;');
    throw e;
  }
}

// Create async wrapper functions
async function withDb(fn) {
  const db = await getDb();
  return fn(db);
}

const rateLimits = {
  async get(userId, command) {
    return withDb(db => runQuery(db, 'SELECT * FROM rate_limits WHERE user_id = ? AND command = ?', [userId, command])[0] || null);
  },
  async set(userId, command, count, windowStart, blockedUntil = 0) {
    return withDb(db => runStatement(db, `
      INSERT INTO rate_limits (user_id, command, count, window_start, blocked_until, updated_at)
      VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
      ON CONFLICT(user_id, command) DO UPDATE SET
        count = excluded.count,
        window_start = excluded.window_start,
        blocked_until = excluded.blocked_until,
        updated_at = strftime('%s', 'now')
    `, [userId, command, count, windowStart, blockedUntil]));
  },
  async increment(userId, command) {
    return withDb(db => runStatement(db, `
      UPDATE rate_limits SET count = count + 1, updated_at = strftime('%s', 'now')
      WHERE user_id = ? AND command = ?
    `, [userId, command]));
  },
  async resetWindow(userId, command) {
    return withDb(db => runStatement(db, `
      UPDATE rate_limits SET count = 1, window_start = strftime('%s', 'now'), updated_at = strftime('%s', 'now')
      WHERE user_id = ? AND command = ?
    `, [userId, command]));
  },
  async block(userId, command, blockedUntil) {
    return withDb(db => runStatement(db, `
      UPDATE rate_limits SET blocked_until = ?, updated_at = strftime('%s', 'now')
      WHERE user_id = ? AND command = ?
    `, [blockedUntil, userId, command]));
  },
  async unblock(userId, command) {
    return withDb(db => runStatement(db, `
      UPDATE rate_limits SET blocked_until = 0, updated_at = strftime('%s', 'now')
      WHERE user_id = ? AND command = ?
    `, [userId, command]));
  },
  async cleanup() {
    return withDb(db => runStatement(db, `
      DELETE FROM rate_limits WHERE blocked_until < strftime('%s', 'now') AND count = 0
    `, []));
  },
  async getAllForUser(userId) {
    return withDb(db => runQuery(db, 'SELECT * FROM rate_limits WHERE user_id = ?', [userId]));
  },
};

const users = {
  async get(userId) {
    return withDb(db => runQuery(db, 'SELECT * FROM users WHERE id = ?', [userId])[0] || null);
  },
  async upsert(userId, username, firstName, lastName, languageCode) {
    return withDb(async (db) => {
      const existing = runQuery(db, 'SELECT * FROM users WHERE id = ?', [userId]);
      
      if (existing.length > 0) {
        return runStatement(db, `
          UPDATE users SET 
            username = ?, first_name = ?, last_name = ?, language_code = ?,
            last_seen = strftime('%s', 'now'),
            total_commands = total_commands + 1,
            updated_at = strftime('%s', 'now')
          WHERE id = ?
        `, [username, firstName, lastName, languageCode, userId]);
      } else {
        return runStatement(db, `
          INSERT INTO users (id, username, first_name, last_name, language_code, last_seen, total_commands, updated_at)
          VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'), 1, strftime('%s', 'now'))
        `, [userId, username, firstName, lastName, languageCode]);
      }
    });
  },
  async incrementCommands(userId) {
    return withDb(db => runStatement(db, `
      UPDATE users SET total_commands = total_commands + 1, last_seen = strftime('%s', 'now'), updated_at = strftime('%s', 'now') WHERE id = ?
    `, [userId]));
  },
  async incrementDownloads(userId) {
    return withDb(db => runStatement(db, `
      UPDATE users SET total_downloads = total_downloads + 1, updated_at = strftime('%s', 'now') WHERE id = ?
    `, [userId]));
  },
  async ban(userId, reason) {
    return withDb(db => runStatement(db, `
      UPDATE users SET is_banned = 1, ban_reason = ?, updated_at = strftime('%s', 'now') WHERE id = ?
    `, [reason, userId]));
  },
  async unban(userId) {
    return withDb(db => runStatement(db, `
      UPDATE users SET is_banned = 0, ban_reason = NULL, updated_at = strftime('%s', 'now') WHERE id = ?
    `, [userId]));
  },
  async getAll(limit = 50, offset = 0) {
    return withDb(db => runQuery(db, 'SELECT * FROM users ORDER BY last_seen DESC LIMIT ? OFFSET ?', [limit, offset]));
  },
  async getBanned() {
    return withDb(db => runQuery(db, 'SELECT * FROM users WHERE is_banned = 1', []));
  },
  async count() {
    return withDb(db => {
      const result = runQuery(db, 'SELECT COUNT(*) as count FROM users', []);
      return { count: result[0]?.count || 0 };
    });
  },
  async countBanned() {
    return withDb(db => {
      const result = runQuery(db, 'SELECT COUNT(*) as count FROM users WHERE is_banned = 1', []);
      return { count: result[0]?.count || 0 };
    });
  },
};

const commandStats = {
  async get(command) {
    return withDb(db => runQuery(db, 'SELECT * FROM command_stats WHERE command = ?', [command])[0] || null);
  },
  async record(command, durationMs) {
    return withDb(async (db) => {
      const existing = runQuery(db, 'SELECT * FROM command_stats WHERE command = ?', [command]);
      
      if (existing.length > 0) {
        const row = existing[0];
        const newTotalCalls = row.total_calls + 1;
        const newTotalDuration = row.total_duration_ms + durationMs;
        return runStatement(db, `
          UPDATE command_stats SET 
            total_calls = ?, total_duration_ms = ?, avg_duration_ms = ?,
            min_duration_ms = MIN(min_duration_ms, ?), max_duration_ms = MAX(max_duration_ms, ?),
            last_used = strftime('%s', 'now'), updated_at = strftime('%s', 'now')
          WHERE command = ?
        `, [newTotalCalls, newTotalDuration, newTotalDuration / newTotalCalls, durationMs, durationMs, command]);
      } else {
        return runStatement(db, `
          INSERT INTO command_stats (command, total_calls, total_duration_ms, avg_duration_ms, min_duration_ms, max_duration_ms, last_used, errors, updated_at)
          VALUES (?, 1, ?, ?, ?, ?, strftime('%s', 'now'), 0, strftime('%s', 'now'))
        `, [command, durationMs, durationMs, durationMs, durationMs]);
      }
    });
  },
  async incrementErrors(command) {
    return withDb(db => runStatement(db, `
      UPDATE command_stats SET errors = errors + 1, updated_at = strftime('%s', 'now') WHERE command = ?
    `, [command]));
  },
  async getAll() {
    return withDb(db => runQuery(db, 'SELECT * FROM command_stats ORDER BY total_calls DESC', []));
  },
  async getTop(limit = 10) {
    return withDb(db => runQuery(db, 'SELECT * FROM command_stats ORDER BY total_calls DESC LIMIT ?', [limit]));
  },
};

const downloadHistory = {
  async insert(userId, trackId, title, artist, album, fileSize, durationSec, quality, status) {
    return withDb(async (db) => {
      // Ensure user exists first (foreign key constraint)
      await users.upsert(userId, userId, 'User', '', 'en');
      const result = runStatement(db, `
        INSERT INTO download_history (user_id, track_id, title, artist, album, file_size, duration_sec, quality, status, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
      `, [userId, trackId, title, artist, album, fileSize, durationSec, quality, status]);
      return result.lastInsertRowid;
    });
  },
  async update(id, status, fileSize, durationSec, errorMessage) {
    return withDb(db => runStatement(db, `
      UPDATE download_history SET status = ?, file_size = ?, duration_sec = ?, error_message = ?, completed_at = strftime('%s', 'now')
      WHERE id = ?
    `, [status, fileSize, durationSec, errorMessage, id]));
  },
  async getByUser(userId, limit = 20, offset = 0) {
    return withDb(db => runQuery(db, 'SELECT * FROM download_history WHERE user_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?', [userId, limit, offset]));
  },
  async getRecent(limit = 50) {
    return withDb(db => runQuery(db, 'SELECT * FROM download_history ORDER BY started_at DESC LIMIT ?', [limit]));
  },
  async getStats(userId) {
    return withDb(db => {
      const result = runQuery(db, `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
          SUM(file_size) as total_bytes,
          AVG(file_size) as avg_bytes
        FROM download_history
        WHERE user_id = ?
      `, [userId]);
      return result[0] || { total: 0, success: 0, failed: 0, cancelled: 0, total_bytes: 0, avg_bytes: 0 };
    });
  },
  async cleanupOld(days = 30) {
    return withDb(db => runStatement(db, 'DELETE FROM download_history WHERE started_at < strftime("%s", "now", "-? days")', [days]));
  },
};

const queueEntries = {
  async insert(userId, command, position) {
    return withDb(async (db) => {
      await users.upsert(userId, userId, 'User', '', 'en');
      const result = runStatement(db, `
        INSERT INTO queue_entries (user_id, command, position, status, queued_at)
        VALUES (?, ?, ?, 'waiting', strftime('%s', 'now'))
      `, [userId, command, position]);
      return result.lastInsertRowid;
    });
  },
  async updateStatus(id, status) {
    return withDb(db => runStatement(db, `
      UPDATE queue_entries SET 
        status = ?, 
        started_at = CASE WHEN ? = "processing" THEN strftime("%s", "now") ELSE started_at END, 
        completed_at = CASE WHEN ? IN ("completed", "cancelled", "timeout") THEN strftime("%s", "now") ELSE completed_at END 
      WHERE id = ?
    `, [status, status, status, id]));
  },
  async getWaiting(userId) {
    return withDb(db => runQuery(db, 'SELECT * FROM queue_entries WHERE user_id = ? AND status = "waiting" ORDER BY queued_at ASC', [userId]));
  },
  async getProcessing(userId) {
    return withDb(db => runQuery(db, 'SELECT * FROM queue_entries WHERE user_id = ? AND status = "processing"', [userId]));
  },
  async getById(id) {
    return withDb(db => runQuery(db, 'SELECT * FROM queue_entries WHERE id = ?', [id])[0] || null);
  },
  async getPosition(userId, queueId) {
    return withDb(db => {
      const result = runQuery(db, `
        SELECT COUNT(*) as position FROM queue_entries 
        WHERE user_id = ? AND status = "waiting" AND queued_at < (SELECT queued_at FROM queue_entries WHERE id = ?)
      `, [userId, queueId]);
      return result[0]?.position ?? 0;
    });
  },
  async cleanupOld() {
    return withDb(db => runStatement(db, 'DELETE FROM queue_entries WHERE queued_at < strftime("%s", "now", "-1 day") AND status IN ("completed", "cancelled", "timeout")', []));
  },
};

export const Database = {
  async init() {
    await getDb();
  },
  
  async getDb() {
    return getDb();
  },
  
  closeDb,
  
  rateLimits: {
    get: rateLimits.get,
    set: rateLimits.set,
    increment: rateLimits.increment,
    resetWindow: rateLimits.resetWindow,
    block: rateLimits.block,
    unblock: rateLimits.unblock,
    cleanup: rateLimits.cleanup,
    getAllForUser: rateLimits.getAllForUser,
  },
  
  users: {
    get: users.get,
    upsert: users.upsert,
    incrementCommands: users.incrementCommands,
    incrementDownloads: users.incrementDownloads,
    ban: users.ban,
    unban: users.unban,
    getAll: users.getAll,
    getBanned: users.getBanned,
    count: users.count,
    countBanned: users.countBanned,
  },
  
  commandStats: {
    get: commandStats.get,
    record: commandStats.record,
    incrementErrors: commandStats.incrementErrors,
    getAll: commandStats.getAll,
    getTop: commandStats.getTop,
  },
  
  downloadHistory: {
    insert: downloadHistory.insert,
    update: downloadHistory.update,
    getByUser: downloadHistory.getByUser,
    getRecent: downloadHistory.getRecent,
    getStats: downloadHistory.getStats,
    cleanupOld: downloadHistory.cleanupOld,
  },
  
  queueEntries: {
    insert: queueEntries.insert,
    updateStatus: queueEntries.updateStatus,
    getWaiting: queueEntries.getWaiting,
    getProcessing: queueEntries.getProcessing,
    getById: queueEntries.getById,
    getPosition: queueEntries.getPosition,
    cleanupOld: queueEntries.cleanupOld,
  },
  
  transaction: runTransaction,
};

export default Database;