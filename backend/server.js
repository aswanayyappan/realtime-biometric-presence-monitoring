/**
 * Main server entry point.
 *
 * Wires together:
 * - Express HTTP server
 * - WebSocket broadcaster
 * - Worker manager (Python AI process)
 * - SQLite database
 * - API routes
 *
 * Start: node backend/server.js
 */

const http = require('http');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const db = require('./db');
const WorkerManager = require('./worker-manager');
const WsBroadcaster = require('./ws-broadcaster');
const createApiRouter = require('./routes/api');
const { payloadSizeLimit, requireJson } = require('./middleware/validate');

// ── Init ────────────────────────────────────────────────

console.log('='.repeat(50));
console.log('  Face Recognition MVP');
console.log('='.repeat(50));
console.log(`  Port:       ${config.port}`);
console.log(`  Faces Dir:  ${config.knownFacesDir}`);
console.log(`  DB:         ${config.dbPath}`);
console.log(`  Python:     ${config.pythonPath}`);
console.log(`  Frame Skip: ${config.frameSkip}`);
console.log(`  Threshold:  ${config.confidenceThreshold}`);
console.log('='.repeat(50));

// Initialize database (async — sql.js needs wasm load)
async function startServer() {

await db.init();

// ── Express App ─────────────────────────────────────────

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(payloadSizeLimit(10240));

// Rate limiting — 100 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' },
});
app.use('/api', limiter);

// ── HTTP Server ─────────────────────────────────────────

const server = http.createServer(app);

// ── WebSocket ───────────────────────────────────────────

const broadcaster = new WsBroadcaster(server);

// ── Worker Manager ──────────────────────────────────────

const workerManager = new WorkerManager();

// Forward worker events to WebSocket + DB
workerManager.on('event', (event) => {
  // Broadcast all events to connected clients
  broadcaster.broadcast(event);

  // Log recognition events to database
  if (event.type === 'recognition') {
    if (Array.isArray(event.faces)) {
      for (const face of event.faces) {
        db.logRecognition({
          identity: face.identity,
          confidence: face.confidence,
          isUnknown: face.identity === config.unknownLabel,
          faceCount: event.faces.length,
        });
      }
    }
  }
});

workerManager.on('state', (state) => {
  console.log(`[Worker] State: ${state}`);
  broadcaster.broadcast({ type: 'worker_state', state });
});

workerManager.on('log', (msg) => {
  console.log(`[Worker] ${msg}`);
});

workerManager.on('error', (msg) => {
  console.error(`[Worker] ERROR: ${msg}`);
  broadcaster.broadcast({ type: 'worker_error', message: msg });
});

workerManager.on('worker-stderr', (line) => {
  // Only log non-empty stderr that isn't just model loading noise
  if (line.trim() && !line.includes('Downloading') && !line.includes('100%|')) {
    console.log(`[Worker:stderr] ${line}`);
  }
});

// ── API Routes ──────────────────────────────────────────

app.use('/api', createApiRouter(workerManager, broadcaster, db, config));

// ── Phone Camera Frame Forwarding ───────────────────────
// When a phone sends a camera frame via WebSocket, forward it to the Python worker
broadcaster.onFrame = (base64Data) => {
  workerManager.sendCommand({ type: 'frame', data: base64Data });
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ── Start ───────────────────────────────────────────────

server.listen(config.port, config.host, () => {
  console.log(`\n[Server] Listening on http://${config.host}:${config.port}`);
  console.log(`[Server] WebSocket on ws://${config.host}:${config.port}`);
  console.log(`[Server] API: http://${config.host}:${config.port}/api/status\n`);

  // Auto-start worker
  console.log('[Server] Starting AI worker...');
  workerManager.start();
});

// ── Graceful Shutdown ───────────────────────────────────

function shutdown(signal) {
  console.log(`\n[Server] ${signal} received. Shutting down...`);

  workerManager.stop();
  broadcaster.close();
  db.close();

  server.close(() => {
    console.log('[Server] Closed.');
    process.exit(0);
  });

  // Force exit after 5s
  setTimeout(() => {
    console.log('[Server] Force exit.');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Prevent unhandled promise crashes
process.on('unhandledRejection', (err) => {
  console.error('[Server] Unhandled rejection:', err);
});

} // end startServer()

// Launch
startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
