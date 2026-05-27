/**
 * Centralized configuration loader.
 * Single source of truth — reads .env, applies defaults, validates.
 * Every module imports config from here. No fragmented env reads.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function envInt(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

function envFloat(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseFloat(v);
  return Number.isNaN(n) ? fallback : n;
}

function envStr(key, fallback) {
  return process.env[key] || fallback;
}

const config = Object.freeze({
  // Server
  port: envInt('PORT', 3000),
  host: envStr('HOST', '127.0.0.1'),

  // Python worker
  pythonPath: envStr('PYTHON_PATH', 'python'),
  cameraIndex: envInt('CAMERA_INDEX', 0),
  cameraWidth: envInt('CAMERA_WIDTH', 640),
  cameraHeight: envInt('CAMERA_HEIGHT', 480),
  frameSkip: envInt('FRAME_SKIP', 3),
  maxProcessingQueue: envInt('MAX_PROCESSING_QUEUE', 5),

  // Recognition
  confidenceThreshold: envFloat('CONFIDENCE_THRESHOLD', 0.45),
  unknownLabel: envStr('UNKNOWN_LABEL', 'UNKNOWN'),
  recognitionCooldownSec: envInt('RECOGNITION_COOLDOWN_SEC', 5),
  knownFacesDir: path.resolve(__dirname, '..', envStr('KNOWN_FACES_DIR', './known_faces')),

  // Worker lifecycle — restart backoff
  maxWorkerRestarts: envInt('MAX_WORKER_RESTARTS', 5),
  restartWindowSec: envInt('RESTART_WINDOW_SEC', 60),

  // WebSocket
  wsHeartbeatIntervalMs: envInt('WS_HEARTBEAT_INTERVAL_MS', 30000),
  wsMaxEventRate: envInt('WS_MAX_EVENT_RATE', 10),

  // Database
  dbPath: path.resolve(__dirname, '..', envStr('DB_PATH', './data/recognition.db')),

  // Worker script path
  workerScript: path.resolve(__dirname, '..', 'worker', 'main.py'),
});

module.exports = config;
