/**
 * REST API routes.
 *
 * Endpoints:
 *   GET  /api/status       — worker status + system info
 *   GET  /api/logs         — recent recognition events
 *   GET  /api/identities   — known identity summary
 *   GET  /api/stats        — detection statistics
 *   POST /api/worker/start — start the AI worker
 *   POST /api/worker/stop  — stop the AI worker
 *   POST /api/config       — update runtime thresholds
 */

const { Router } = require('express');
const { validateInt, validateFloat } = require('../middleware/validate');

/**
 * Create API router.
 * @param {import('../worker-manager')} workerManager
 * @param {import('../ws-broadcaster')} broadcaster
 * @param {import('../db')} db
 * @param {object} config
 */
function createApiRouter(workerManager, broadcaster, db, config) {
  const router = Router();

  // ── Status ───────────────────────────────────────────

  router.get('/status', (req, res) => {
    res.json({
      worker: workerManager.getStatus(),
      websocket: broadcaster.getStats(),
      uptime: process.uptime(),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    });
  });

  // ── Recognition Logs ─────────────────────────────────

  router.get('/logs', (req, res) => {
    const limit = validateInt(req.query.limit, 1, 500, 50);
    const logs = db.getRecentLogs(limit);
    res.json({ logs, count: logs.length });
  });

  // ── Identity Summary ─────────────────────────────────

  router.get('/identities', (req, res) => {
    const identities = db.getIdentitySummary();
    res.json({ identities });
  });

  // ── Stats ────────────────────────────────────────────

  router.get('/stats', (req, res) => {
    const stats = db.getStats();
    res.json({ stats });
  });

  // ── Worker Control ───────────────────────────────────

  router.post('/worker/start', (req, res) => {
    const status = workerManager.getStatus();
    if (status.running) {
      return res.status(409).json({ error: 'Worker already running', status });
    }
    if (status.state === 'degraded') {
      // Allow manual restart from degraded state — reset backoff
      workerManager.restartTimestamps = [];
      workerManager.restartAttempt = 0;
    }
    const started = workerManager.start();
    res.json({ started, status: workerManager.getStatus() });
  });

  router.post('/worker/stop', (req, res) => {
    workerManager.stop();
    res.json({ stopped: true, status: workerManager.getStatus() });
  });

  // ── Config Update ────────────────────────────────────

  router.post('/config', (req, res) => {
    const updates = {};

    if (req.body.confidenceThreshold !== undefined) {
      updates.confidenceThreshold = validateFloat(req.body.confidenceThreshold, 0.1, 0.99, config.confidenceThreshold);
    }
    if (req.body.frameSkip !== undefined) {
      updates.frameSkip = validateInt(req.body.frameSkip, 1, 30, config.frameSkip);
    }
    if (req.body.recognitionCooldownSec !== undefined) {
      updates.recognitionCooldownSec = validateInt(req.body.recognitionCooldownSec, 0, 60, config.recognitionCooldownSec);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid config fields provided' });
    }

    // Forward config to running worker
    const sent = workerManager.sendCommand({ type: 'config', ...updates });

    res.json({
      updated: updates,
      sentToWorker: sent,
    });
  });

  return router;
}

module.exports = createApiRouter;
