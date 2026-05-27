"""
IPC layer — stdio JSON line protocol.

Sends events to Node.js via stdout (one JSON per line).
Reads commands from Node.js via stdin.
"""

import sys
import json
import threading
import time


class IPC:
    """Bidirectional stdio IPC with Node.js."""

    def __init__(self):
        self._lock = threading.Lock()
        self._command_handlers = {}
        self._stdin_thread = None
        self._running = False

    def emit(self, event_type, data=None):
        """Send a JSON event to Node.js via stdout."""
        msg = {
            'type': event_type,
            'timestamp': int(time.time() * 1000),
        }
        if data:
            msg.update(data)

        line = json.dumps(msg, separators=(',', ':'))

        with self._lock:
            try:
                sys.stdout.write(line + '\n')
                sys.stdout.flush()
            except (BrokenPipeError, OSError):
                # Parent process is gone
                self._running = False

    def on_command(self, command_type, handler):
        """Register a handler for incoming commands from Node.js."""
        self._command_handlers[command_type] = handler

    def start_listening(self):
        """Start background thread to read stdin commands."""
        self._running = True
        self._stdin_thread = threading.Thread(target=self._read_stdin, daemon=True)
        self._stdin_thread.start()

    def stop(self):
        """Stop listening."""
        self._running = False

    def _read_stdin(self):
        """Read JSON commands from stdin, dispatch to handlers."""
        try:
            for line in sys.stdin:
                if not self._running:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    cmd = json.loads(line)
                    cmd_type = cmd.get('type', '')
                    handler = self._command_handlers.get(cmd_type)
                    if handler:
                        handler(cmd)
                    elif cmd_type == 'shutdown':
                        self._running = False
                        break
                except json.JSONDecodeError:
                    self.emit('error', {'message': f'Invalid command JSON: {line[:100]}'})
        except (EOFError, OSError):
            self._running = False

    @property
    def is_running(self):
        return self._running
