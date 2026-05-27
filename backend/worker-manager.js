/**
 * Python AI worker lifecycle manager.
 *
 * Spawns Python as child process.
 * Reads stdout line-by-line (newline-delimited JSON).
 * Sends commands via stdin.
 *
 * Implements:
 * - Exponential restart backoff (review fix #4)
 * - Crash-loop prevention (max restarts within window)
 * - Degraded-state fallback
 * - Graceful shutdown
 */

const { spawn } = require('child_process');
const { createInterface } = require('readline');
const { EventEmitter } = require('events');
const config = require('./config');

class WorkerManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.running = false;
    this.state = 'stopped'; // stopped | starting | running | degraded | error

    // Restart backoff tracking
    this.restartTimestamps = [];
    this.restartAttempt = 0;
    this.restartTimer = null;

    // Stats
    this.startedAt = null;
    this.lastEvent = null;
    this.eventCount = 0;
  }

  /**
   * Start the Python AI worker.
   */
  start() {
    if (this.running) {
      this.emit('log', 'Worker already running');
      return false;
    }

    this._clearRestartTimer();
    this.state = 'starting';
    this.emit('state', this.state);

    const args = [
      '-u', // Unbuffered stdout — critical for realtime IPC
      config.workerScript,
      '--camera-index', String(config.cameraIndex),
      '--camera-width', String(config.cameraWidth),
      '--camera-height', String(config.cameraHeight),
      '--frame-skip', String(config.frameSkip),
      '--max-queue', String(config.maxProcessingQueue),
      '--confidence-threshold', String(config.confidenceThreshold),
      '--cooldown', String(config.recognitionCooldownSec),
      '--known-faces-dir', config.knownFacesDir,
    ];

    try {
      this.process = spawn(config.pythonPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      this.state = 'error';
      this.emit('state', this.state);
      this.emit('error', `Failed to spawn worker: ${err.message}`);
      return false;
    }

    this.running = true;
    this.startedAt = Date.now();
    this.eventCount = 0;

    // Read stdout line-by-line — this is the IPC channel
    const rl = createInterface({ input: this.process.stdout });
    rl.on('line', (line) => this._handleLine(line));

    // Capture stderr for diagnostics
    const stderrRl = createInterface({ input: this.process.stderr });
    stderrRl.on('line', (line) => {
      this.emit('worker-stderr', line);
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.running = false;
      this.process = null;

      if (signal === 'SIGTERM' || this.state === 'stopped') {
        // Intentional stop
        this.state = 'stopped';
        this.emit('state', this.state);
        this.emit('log', 'Worker stopped gracefully');
        return;
      }

      // Unexpected crash — attempt restart with backoff
      this.emit('log', `Worker crashed (code=${code}, signal=${signal})`);
      this._scheduleRestart();
    });

    this.process.on('error', (err) => {
      this.running = false;
      this.process = null;
      this.state = 'error';
      this.emit('state', this.state);
      this.emit('error', `Worker process error: ${err.message}`);
      this._scheduleRestart();
    });

    this.emit('log', `Worker started (PID: ${this.process.pid})`);
    return true;
  }

  /**
   * Stop the worker gracefully.
   */
  stop() {
    this._clearRestartTimer();
    this.state = 'stopped';

    if (!this.process) {
      this.running = false;
      this.emit('state', this.state);
      return;
    }

    // Send shutdown command via stdin
    this.sendCommand({ type: 'shutdown' });

    // Give it 3 seconds, then force kill
    const killTimer = setTimeout(() => {
      if (this.process) {
        this.process.kill('SIGKILL');
        this.emit('log', 'Worker force-killed after timeout');
      }
    }, 3000);

    this.process.once('exit', () => {
      clearTimeout(killTimer);
    });

    // Also send SIGTERM
    this.process.kill('SIGTERM');
    this.emit('log', 'Worker stop requested');
  }

  /**
   * Send a JSON command to the worker via stdin.
   */
  sendCommand(cmd) {
    if (!this.process || !this.process.stdin.writable) return false;
    try {
      this.process.stdin.write(JSON.stringify(cmd) + '\n');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current worker status.
   */
  getStatus() {
    return {
      state: this.state,
      running: this.running,
      pid: this.process ? this.process.pid : null,
      uptime: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      eventCount: this.eventCount,
      lastEvent: this.lastEvent,
      restartAttempt: this.restartAttempt,
    };
  }

  // ── Internal ──────────────────────────────────────────

  /**
   * Parse a JSON line from stdout.
   */
  _handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      this.emit('worker-stderr', `[non-json] ${trimmed}`);
      return;
    }

    // Worker confirmed ready
    if (msg.type === 'status' && msg.status === 'ready') {
      this.state = 'running';
      this.restartAttempt = 0; // Reset on successful start
      this.emit('state', this.state);
    }

    this.eventCount++;
    this.lastEvent = Date.now();
    this.emit('event', msg);
  }

  /**
   * Schedule restart with exponential backoff.
   * Prevents crash-loop: max N restarts within M seconds.
   */
  _scheduleRestart() {
    const now = Date.now();
    const windowMs = config.restartWindowSec * 1000;

    // Prune old timestamps outside the window
    this.restartTimestamps = this.restartTimestamps.filter(
      (ts) => now - ts < windowMs
    );

    // Check if we've hit the max restarts in this window
    if (this.restartTimestamps.length >= config.maxWorkerRestarts) {
      this.state = 'degraded';
      this.emit('state', this.state);
      this.emit('error',
        `Worker entered degraded state: ${config.maxWorkerRestarts} crashes in ${config.restartWindowSec}s. Manual restart required.`
      );
      return;
    }

    this.restartTimestamps.push(now);
    this.restartAttempt++;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped)
    const delayMs = Math.min(1000 * Math.pow(2, this.restartAttempt - 1), 16000);

    this.emit('log', `Scheduling restart #${this.restartAttempt} in ${delayMs}ms`);

    this._clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      this.emit('log', `Restarting worker (attempt #${this.restartAttempt})`);
      this.start();
    }, delayMs);
  }

  _clearRestartTimer() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }
}

module.exports = WorkerManager;
