/**
 * SQLite database layer using sql.js (pure JavaScript — no native compilation).
 * Recognition event logging + query helpers.
 * Auto-creates tables on init. Zero config.
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const config = require('./config');

let db = null;
let dbReady = null; // Promise that resolves when db is initialized

/**
 * Initialize the database. Returns a promise.
 */
async function init() {
  // Ensure data directory exists
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const SQL = await initSqlJs();

  // Load existing database file if it exists
  let fileBuffer = null;
  if (fs.existsSync(config.dbPath)) {
    fileBuffer = fs.readFileSync(config.dbPath);
  }

  db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS recognition_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identity TEXT NOT NULL,
      confidence REAL NOT NULL,
      is_unknown INTEGER NOT NULL DEFAULT 0,
      face_count INTEGER NOT NULL DEFAULT 1,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_identity ON recognition_logs(identity)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_created_at ON recognition_logs(created_at)`);

  // Auto-save every 30 seconds
  setInterval(() => _saveToDisk(), 30000);

  return db;
}

/**
 * Ensure db is ready (call init if needed).
 */
async function ensureReady() {
  if (db) return;
  if (!dbReady) {
    dbReady = init();
  }
  await dbReady;
}

/**
 * Save database to disk.
 */
function _saveToDisk() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(config.dbPath, buffer);
  } catch (err) {
    console.error('[DB] Save error:', err.message);
  }
}

/**
 * Log a recognition event.
 */
function logRecognition({ identity, confidence, isUnknown, faceCount }) {
  if (!db) return;

  db.run(
    `INSERT INTO recognition_logs (identity, confidence, is_unknown, face_count)
     VALUES (?, ?, ?, ?)`,
    [
      identity || config.unknownLabel,
      confidence || 0,
      isUnknown ? 1 : 0,
      faceCount || 1,
    ]
  );
}

/**
 * Get recent recognition logs.
 * @param {number} limit - Max rows to return (default 50, max 500)
 */
function getRecentLogs(limit = 50) {
  if (!db) return [];

  limit = Math.min(Math.max(1, limit), 500);

  const stmt = db.prepare(`
    SELECT id, identity, confidence, is_unknown, face_count, timestamp
    FROM recognition_logs
    ORDER BY created_at DESC
    LIMIT ?
  `);

  stmt.bind([limit]);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

/**
 * Get unique identities with last-seen time and total count.
 */
function getIdentitySummary() {
  if (!db) return [];

  const stmt = db.prepare(`
    SELECT
      identity,
      COUNT(*) as total_detections,
      MAX(timestamp) as last_seen,
      ROUND(AVG(confidence), 3) as avg_confidence
    FROM recognition_logs
    WHERE is_unknown = 0
    GROUP BY identity
    ORDER BY last_seen DESC
  `);

  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

/**
 * Get detection stats.
 */
function getStats() {
  if (!db) return {};

  const stmt = db.prepare(`
    SELECT
      COUNT(*) as total_events,
      SUM(CASE WHEN is_unknown = 1 THEN 1 ELSE 0 END) as unknown_count,
      SUM(CASE WHEN is_unknown = 0 THEN 1 ELSE 0 END) as known_count,
      ROUND(AVG(confidence), 3) as avg_confidence
    FROM recognition_logs
  `);

  let row = {};
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

/**
 * Close the database connection and save.
 */
function close() {
  if (db) {
    _saveToDisk();
    db.close();
    db = null;
  }
}

module.exports = { init, ensureReady, logRecognition, getRecentLogs, getIdentitySummary, getStats, close };
