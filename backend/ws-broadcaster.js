/**
 * WebSocket broadcaster.
 *
 * Handles:
 * - Client connections with heartbeat
 * - Rate-limited event broadcasting (review fix #5)
 * - Message schema versioning
 * - Dead client cleanup
 */

const { WebSocketServer } = require('ws');
const config = require('./config');

class WsBroadcaster {
  constructor(server) {
    this.wss = new WebSocketServer({ server });
    this.clients = new Set();

    // Rate limiting: track events per second
    this._eventWindow = [];
    this._maxRate = config.wsMaxEventRate; // max events/sec broadcast

    // Phone camera frame callback — wired by server.js
    this.onFrame = null;

    // Per-client frame throttle: Map<clientId, lastFrameTs>
    // Each client is independently capped at ~6.7fps (150ms min gap)
    this._clientLastFrame = new Map();
    this._frameThrottleMs = 150;

    this._setupServer();
  }

  _setupServer() {
    this.wss.on('connection', (ws, req) => {
      const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
      ws._clientId = clientId;
      ws._alive = true;

      this.clients.add(ws);
      console.log(`[WS] Client connected: ${clientId} (total: ${this.clients.size})`);

      // Send welcome with current state
      this._send(ws, {
        type: 'connected',
        version: 1,
        clientId,
        timestamp: Date.now(),
      });

      // Heartbeat pong
      ws.on('pong', () => {
        ws._alive = true;
      });

      // Handle incoming messages from clients (phone camera frames)
      ws.on('message', (rawData) => {
        try {
          // Reject oversized payloads (max 500KB to prevent DoS)
          if (rawData.length > 512_000) return;

          const msg = JSON.parse(rawData.toString());
          if (msg.type === 'frame' && msg.data && this.onFrame) {
            // Per-client token bucket throttle
            const now = Date.now();
            const lastFrame = this._clientLastFrame.get(ws._clientId) || 0;
            if (now - lastFrame < this._frameThrottleMs) {
              return; // Drop frame — this client sent too recently
            }
            this._clientLastFrame.set(ws._clientId, now);
            this.onFrame(msg.data);
          }
        } catch {
          // Ignore non-JSON messages (e.g. ping/pong binary)
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this._clientLastFrame.delete(ws._clientId);
        console.log(`[WS] Client disconnected: ${ws._clientId} (total: ${this.clients.size})`);
      });

      ws.on('error', (err) => {
        console.error(`[WS] Client error ${clientId}:`, err.message);
        this.clients.delete(ws);
      });
    });

    // Heartbeat interval — kill dead connections
    this._heartbeat = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws._alive) {
          this.clients.delete(ws);
          return ws.terminate();
        }
        ws._alive = false;
        ws.ping();
      });
    }, config.wsHeartbeatIntervalMs);
  }

  /**
   * Broadcast an event to all connected clients.
   * Rate-limited to prevent frontend event spam.
   */
  broadcast(event) {
    // Rate limiting — drop if over max rate
    const now = Date.now();
    this._eventWindow = this._eventWindow.filter((t) => now - t < 1000);
    if (this._eventWindow.length >= this._maxRate) {
      return; // Drop event — rate exceeded
    }
    this._eventWindow.push(now);

    const message = {
      version: 1,
      ...event,
      timestamp: event.timestamp || Date.now(),
    };

    const payload = JSON.stringify(message);

    for (const ws of this.clients) {
      this._sendRaw(ws, payload);
    }
  }

  /**
   * Send to a specific client.
   */
  _send(ws, data) {
    this._sendRaw(ws, JSON.stringify(data));
  }

  _sendRaw(ws, payload) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(payload, (err) => {
        if (err) {
          this.clients.delete(ws);
        }
      });
    }
  }

  /**
   * Get connection stats.
   */
  getStats() {
    return {
      connectedClients: this.clients.size,
      eventsPerSec: this._eventWindow.length,
      maxRate: this._maxRate,
    };
  }

  /**
   * Shutdown.
   */
  close() {
    clearInterval(this._heartbeat);
    this.wss.close();
  }
}

module.exports = WsBroadcaster;
