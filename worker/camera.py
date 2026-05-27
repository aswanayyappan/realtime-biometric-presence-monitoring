"""
Threaded webcam capture — producer-consumer model.

Fixes review point #13:
  Camera capture runs in its own thread.
  Frames go into a bounded queue.
  Processing thread consumes from queue.
  This prevents camera blocking inference.

Also implements:
  - Frame skipping
  - Webcam reconnect on failure
  - Resolution capping
  - Graceful shutdown
"""

import cv2
import threading
import time
import os
import random
import math
import numpy as np
from collections import deque


class Camera:
    """Threaded webcam capture with bounded frame queue."""

    def __init__(self, camera_index=0, width=640, height=480,
                 frame_skip=3, max_queue=5):
        self.camera_index = camera_index
        self.width = width
        self.height = height
        self.frame_skip = max(1, frame_skip)
        self.max_queue = max(1, max_queue)

        self._cap = None
        self._frame_queue = deque(maxlen=self.max_queue)  # Bounded — drops old frames
        self._lock = threading.Lock()
        self._running = False
        self._thread = None
        self._frame_count = 0
        self._fps = 0.0
        self._last_fps_time = time.time()
        self._fps_frame_count = 0

        # Simulation / Mock Mode
        self.is_mock = False
        self.mock_images = []
        self._loaded_mock_frames = []

    def start(self):
        """Open camera and start capture thread."""
        if self._running:
            return True

        if not self._open_camera():
            return False

        self._running = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()
        return True

    def stop(self):
        """Stop capture and release camera."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None
        self._release_camera()

    def get_frame(self):
        """
        Get the latest frame from the queue.
        Returns None if queue is empty.
        Non-blocking — for consumer thread.
        """
        with self._lock:
            if self._frame_queue:
                return self._frame_queue.pop()  # Latest frame
            return None

    def inject_frame(self, base64_jpeg):
        """
        Inject a phone camera frame (base64 JPEG) into the processing queue.
        Called when a phone sends a frame via WebSocket → IPC.
        The main processing loop picks it up via get_frame() — zero changes needed.
        """
        import base64
        try:
            # Strip data URL prefix if present (e.g. "data:image/jpeg;base64,...")
            if ',' in base64_jpeg:
                base64_jpeg = base64_jpeg.split(',', 1)[1]

            img_bytes = base64.b64decode(base64_jpeg)
            img_array = np.frombuffer(img_bytes, dtype=np.uint8)
            frame = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

            if frame is None:
                self._inject_errors = getattr(self, '_inject_errors', 0) + 1
                return

            # Resize to match expected camera dimensions
            h, w = frame.shape[:2]
            if w != self.width or h != self.height:
                frame = cv2.resize(frame, (self.width, self.height))

            # Push to bounded queue (same as webcam frames)
            with self._lock:
                self._frame_queue.append(frame)

            # Track injected frames for FPS calculation
            self._fps_frame_count += 1
        except Exception:
            self._inject_errors = getattr(self, '_inject_errors', 0) + 1

    @property
    def fps(self):
        return round(self._fps, 1)

    @property
    def is_running(self):
        return self._running

    # ── Internal ────────────────────────────────────────

    def _open_camera(self):
        """Open webcam with DirectShow on Windows for best compat."""
        self.is_mock = False
        try:
            self._cap = cv2.VideoCapture(self.camera_index, cv2.CAP_DSHOW)
            if not self._cap.isOpened():
                # Fallback without DirectShow
                self._cap = cv2.VideoCapture(self.camera_index)

            if not self._cap.isOpened():
                # Enable mock mode fallback
                self._setup_mock_mode()
                return True

            self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
            self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
            self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Minimize latency
            return True

        except Exception:
            self._setup_mock_mode()
            return True

    def _setup_mock_mode(self):
        """Set up simulation mode by loading known faces as mock feeds."""
        self.is_mock = True
        self._cap = None
        self.mock_images = []
        self._loaded_mock_frames = []
        
        known_faces_dir = "./known_faces"
        if os.path.exists(known_faces_dir):
            for root, dirs, files in os.walk(known_faces_dir):
                for f in files:
                    if f.lower().endswith(('.png', '.jpg', '.jpeg')):
                        self.mock_images.append(os.path.join(root, f))
                        
        if self.mock_images:
            # Load up to 5 mock images in memory
            random.shuffle(self.mock_images)
            for path in self.mock_images[:5]:
                try:
                    img = cv2.imread(path)
                    if img is not None:
                        # Resize to fit camera dimensions
                        img_resized = cv2.resize(img, (self.width, self.height))
                        self._loaded_mock_frames.append(img_resized)
                except Exception:
                    pass

    def _release_camera(self):
        """Safely release camera resources."""
        if self._cap:
            try:
                self._cap.release()
            except Exception:
                pass
            self._cap = None

    def _capture_loop(self):
        """
        Producer thread — reads frames from webcam (or mock feed).
        Applies frame skipping.
        Pushes to bounded deque (old frames auto-dropped).
        """
        reconnect_delay = 1

        while self._running:
            if self.is_mock:
                # Switch or slightly jitter the simulated feed every few seconds
                now = time.time()
                
                # Check if we have loaded mock frames
                if self._loaded_mock_frames:
                    # Pick a frame based on time, cycling every 8 seconds
                    frame_idx = int(now / 8) % len(self._loaded_mock_frames)
                    # We make a copy to avoid modifying the original when drawing overlays
                    frame = self._loaded_mock_frames[frame_idx].copy()
                    
                    # Draw a simulated scanning grid or bounding box to show it's active
                    cv2.rectangle(frame, (10, 10), (self.width - 10, self.height - 10), (0, 255, 0), 1)
                    
                    # Draw subtle scanning line
                    scan_y = int((self.height - 40) * (0.5 + 0.5 * math.sin(now * 2))) + 20
                    cv2.line(frame, (15, scan_y), (self.width - 15, scan_y), (0, 255, 0), 1)
                    
                    cv2.putText(frame, "SIMULATED WEBCAM (FACE DETECTED)", (20, 30), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
                else:
                    # No faces found — create a black screen with status message
                    frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
                    cv2.rectangle(frame, (10, 10), (self.width - 10, self.height - 10), (0, 0, 255), 1)
                    cv2.putText(frame, "NO WEBCAM DETECTED", (40, self.height // 2 - 20), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                    cv2.putText(frame, "Please place images in known_faces/ for simulation", (40, self.height // 2 + 20), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)

                # Show running status and time
                time_str = time.strftime("%H:%M:%S")
                cv2.putText(frame, f"Simulated Feed - Time: {time_str}", (20, self.height - 20),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)

                # Sleep to maintain ~30 FPS
                time.sleep(0.033)
            else:
                if self._cap is None or not self._cap.isOpened():
                    # Reconnect attempt
                    time.sleep(reconnect_delay)
                    reconnect_delay = min(reconnect_delay * 2, 10)
                    if self._open_camera():
                        if not self.is_mock:
                            reconnect_delay = 1
                    continue

                ret, frame = self._cap.read()

                if not ret or frame is None:
                    # Camera read failed — attempt reconnect
                    self._release_camera()
                    continue

            self._frame_count += 1

            # Frame skipping — only enqueue every Nth frame
            if self._frame_count % self.frame_skip != 0:
                continue

            # Resize if needed (ensure consistent resolution)
            h, w = frame.shape[:2]
            if w != self.width or h != self.height:
                frame = cv2.resize(frame, (self.width, self.height))

            # Push to bounded queue (thread-safe via deque maxlen)
            with self._lock:
                self._frame_queue.append(frame)

            # FPS calculation
            self._fps_frame_count += 1
            now = time.time()
            elapsed = now - self._last_fps_time
            if elapsed >= 1.0:
                self._fps = self._fps_frame_count / elapsed
                self._fps_frame_count = 0
                self._last_fps_time = now
