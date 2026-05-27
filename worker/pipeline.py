"""
Face Recognition Pipeline — Stable Production Version.

Upgrades over MVP:
  1. FaceTracker   — IoU-based face tracking. Assigns stable track IDs across frames.
                     Prevents re-matching the same physical face every frame.
  2. TemporalVoter — N-of-M majority vote per track. A recognized identity is only
                     confirmed if it wins in >= 3 of the last 5 frames.
  3. EMA Scoring   — Exponential moving average smooths the confidence score.
                     Eliminates jitter between 0.73 and 0.78 causing constant re-triggers.
  4. Dual Threshold — ACCEPT (0.60) to enter voting, CONFIRM (0.72) EMA score to emit.
  5. Margin Check  — Winner must beat second-best by >= 0.05 (prevents near-tie false positives).
  6. Emit-on-change — Events only emitted when identity state *changes*, not every frame.
                     Eliminates the source of UI flickering.
"""

import time
import numpy as np
import cv2
from collections import deque, Counter

from embeddings import EmbeddingStore

# ── Thresholds ─────────────────────────────────────────────────────────────
ACCEPT_THRESHOLD  = 0.60   # Min per-frame score to enter the vote window
CONFIRM_THRESHOLD = 0.72   # Min EMA score to emit a confirmed identity
MARGIN_MIN        = 0.05   # Winner must beat second-best by this margin
VOTE_WINDOW       = 5      # Rolling window size (frames)
VOTE_REQUIRED     = 3      # Min votes to confirm identity (of VOTE_WINDOW)
EMA_ALPHA         = 0.35   # EMA weight for new score (lower = smoother)

# ── Tracking ───────────────────────────────────────────────────────────────
IOU_MATCH_THRESHOLD = 0.30  # Min IoU to associate a new face with an existing track
TRACK_MAX_MISS      = 10    # Frames before a track expires (no matching detection)


class FaceTrack:
    """
    A single tracked face. Persists across frames via IoU bbox matching.
    Holds the vote window, EMA score, and last emitted state.
    """

    _id_counter = 0

    def __init__(self, bbox):
        FaceTrack._id_counter += 1
        self.track_id = FaceTrack._id_counter

        self.bbox = bbox            # Last known [x1,y1,x2,y2]
        self.miss_count = 0         # Consecutive frames with no matching detection

        # Vote window: stores (identity_or_None, raw_score) tuples
        self.vote_window: deque = deque(maxlen=VOTE_WINDOW)

        # EMA score per identity
        self.ema_scores: dict = {}

        # Last state emitted to prevent duplicate events
        self.last_emitted_identity: str | None = None
        self.last_emitted_ts: float = 0.0

    def update(self, bbox, identity: str | None, raw_score: float):
        """Record a new detection result into the vote window and update EMA."""
        self.bbox = bbox
        self.miss_count = 0

        self.vote_window.append((identity, raw_score))

        # EMA update for this identity
        if identity is not None:
            prev = self.ema_scores.get(identity, raw_score)
            self.ema_scores[identity] = EMA_ALPHA * raw_score + (1 - EMA_ALPHA) * prev

    def get_confirmed_identity(self) -> tuple[str | None, float]:
        """
        Apply temporal voting. Returns (identity, ema_score) if confirmed, else (None, 0.0).
        Conditions:
          - Window must be full (VOTE_WINDOW frames seen)
          - Winner must have >= VOTE_REQUIRED votes
          - Winner's EMA score must be >= CONFIRM_THRESHOLD
        """
        if len(self.vote_window) < VOTE_WINDOW:
            return None, 0.0   # Not enough frames yet

        # Count votes (None = UNKNOWN, skip from known-identity tally)
        known_votes = [ident for ident, _ in self.vote_window if ident is not None]
        if not known_votes:
            return None, 0.0   # All frames were unknown

        counter = Counter(known_votes)
        winner, win_count = counter.most_common(1)[0]

        if win_count < VOTE_REQUIRED:
            return None, 0.0   # No majority

        ema = self.ema_scores.get(winner, 0.0)
        if ema < CONFIRM_THRESHOLD:
            return None, 0.0   # Score too low even with majority

        return winner, round(ema, 4)

    def mark_missing(self):
        """Called when no detection matched this track in the current frame."""
        self.miss_count += 1

    @property
    def is_expired(self) -> bool:
        return self.miss_count >= TRACK_MAX_MISS


class FaceTracker:
    """
    Manages a pool of FaceTrack objects across frames using IoU matching.
    """

    def __init__(self):
        self.tracks: dict[int, FaceTrack] = {}  # track_id → FaceTrack

    def update(self, detections: list[dict]) -> list[tuple[FaceTrack, dict]]:
        """
        Associate current frame detections with existing tracks via IoU.

        detections: list of dicts with 'bbox' key (raw InsightFace detection)
        Returns: list of (FaceTrack, detection_dict) pairs
        """
        # Mark all tracks as potentially missing first
        for track in self.tracks.values():
            track.mark_missing()

        matched_pairs: list[tuple[FaceTrack, dict]] = []
        unmatched_detections = list(detections)

        for track in list(self.tracks.values()):
            best_iou = 0.0
            best_det = None
            for det in unmatched_detections:
                iou = _iou(track.bbox, det['bbox'])
                if iou > best_iou:
                    best_iou = iou
                    best_det = det

            if best_det is not None and best_iou >= IOU_MATCH_THRESHOLD:
                track.miss_count = 0  # Reset miss (we're updating it)
                matched_pairs.append((track, best_det))
                unmatched_detections.remove(best_det)

        # New tracks for unmatched detections
        for det in unmatched_detections:
            track = FaceTrack(det['bbox'])
            self.tracks[track.track_id] = track
            matched_pairs.append((track, det))

        # Expire dead tracks
        for tid in [tid for tid, t in self.tracks.items() if t.is_expired]:
            del self.tracks[tid]

        return matched_pairs

    def get_track(self, track_id: int) -> FaceTrack | None:
        return self.tracks.get(track_id)

    def clear(self):
        self.tracks.clear()


def _iou(bbox_a, bbox_b) -> float:
    """Compute Intersection over Union for two [x1,y1,x2,y2] bounding boxes."""
    ax1, ay1, ax2, ay2 = bbox_a
    bx1, by1, bx2, by2 = bbox_b

    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)

    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    if inter == 0:
        return 0.0

    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


class FaceRecognitionPipeline:
    """Full detection + recognition pipeline with temporal stability."""

    def __init__(
        self,
        confidence_threshold=0.45,  # Kept for API compat; overridden by ACCEPT_THRESHOLD
        cooldown_sec=5,
        known_faces_dir="./known_faces",
        unknown_label="UNKNOWN",
    ):
        # Keep for runtime config API compatibility
        self.confidence_threshold = confidence_threshold
        self.cooldown_sec = cooldown_sec
        self.known_faces_dir = known_faces_dir
        self.unknown_label = unknown_label

        # Models — loaded once
        self._insightface = None
        self._embedding_store = None

        # Tracker — persists across frames
        self._tracker = FaceTracker()

        # Stats
        self.frames_processed = 0
        self.faces_detected = 0
        self.total_inference_ms = 0

    def load_models(self, ipc=None):
        """Load all models. Called ONCE at startup."""
        start = time.time()

        if ipc:
            ipc.emit("status", {"status": "loading", "step": "Loading InsightFace buffalo_l..."})

        import insightface
        from insightface.app import FaceAnalysis

        providers = self._get_onnx_providers()
        self._insightface = FaceAnalysis(
            name="buffalo_l",
            root="./models",
            providers=providers,
        )
        # 640x640 — buffalo_l's native resolution for maximum accuracy
        self._insightface.prepare(ctx_id=0, det_size=(640, 640))

        if ipc:
            ipc.emit("status", {"status": "loading", "step": "Loading known face embeddings..."})

        self._embedding_store = EmbeddingStore(self.known_faces_dir, self._insightface)
        load_stats = self._embedding_store.load_all()

        elapsed = round(time.time() - start, 2)

        return {
            "load_time_sec": elapsed,
            "providers": providers,
            "known_faces": load_stats,
        }

    def process_frame(self, frame):
        """
        Process a single frame. Returns list of face result dicts.

        Result format:
        {
          'track_id': int,
          'identity': str,          # confirmed identity or 'UNKNOWN'
          'confidence': float,       # EMA-smoothed score
          'bbox': [x1, y1, x2, y2],
          'is_unknown': bool,
          'state': str,              # 'confirming' | 'confirmed' | 'unknown'
          'state_changed': bool,     # True only when identity/state changed
          'inference_ms': float,
        }
        """
        if frame is None or self._insightface is None:
            return []

        t_start = time.time()

        # ── Step 1: InsightFace detect + embed ─────────────
        try:
            faces = self._insightface.get(frame)
        except Exception:
            faces = []

        # ── Step 2: Build detection dicts ──────────────────
        raw_detections = []
        for face in (faces or []):
            bbox = face.bbox.astype(int).tolist()
            det_conf = float(face.det_score)

            if det_conf < 0.50:
                continue
            x1, y1, x2, y2 = bbox
            if (x2 - x1) < 30 or (y2 - y1) < 30:
                continue
            if face.embedding is None:
                continue

            raw_detections.append({
                'bbox': bbox,
                'det_conf': det_conf,
                'embedding': face.embedding,
            })

        # ── Step 3: Associate with tracks ──────────────────
        track_pairs = self._tracker.update(raw_detections)

        # ── Step 4: Match + vote per track ─────────────────
        results = []
        inference_ms = (time.time() - t_start) * 1000

        for track, det in track_pairs:
            bbox = det['bbox']
            embedding = det['embedding']

            # Match with dual-threshold and margin check
            identity, score, margin = self._embedding_store.match(
                embedding,
                threshold=ACCEPT_THRESHOLD,
            )

            # Reject if margin too small (near-tie between identities)
            if identity is not None and margin < MARGIN_MIN:
                identity = None
                score = 0.0

            # Feed into track's vote window
            track.update(bbox, identity, score)

            # Get temporally confirmed result
            confirmed_identity, ema_score = track.get_confirmed_identity()

            # Determine state
            if confirmed_identity is not None:
                state = 'confirmed'
                emit_identity = confirmed_identity
                is_unknown = False
            elif len(track.vote_window) < VOTE_WINDOW:
                state = 'confirming'
                emit_identity = self.unknown_label
                is_unknown = True
            else:
                state = 'unknown'
                emit_identity = self.unknown_label
                is_unknown = True

            # Detect state change (emit-on-change logic)
            state_key = (emit_identity, state)
            state_changed = (state_key != (track.last_emitted_identity, getattr(track, '_last_state', None)))
            if state_changed:
                track.last_emitted_identity = emit_identity
                track._last_state = state
                track.last_emitted_ts = time.time()

            results.append({
                'track_id': track.track_id,
                'identity': emit_identity,
                'confidence': ema_score,
                'bbox': bbox,
                'is_unknown': is_unknown,
                'state': state,
                'state_changed': state_changed,
                'cooldown_skipped': False,  # Kept for schema compat
                'inference_ms': round(inference_ms, 1),
            })

        # Stats
        self.frames_processed += 1
        self.faces_detected += len(results)
        self.total_inference_ms += inference_ms

        return results

    def update_config(self, **kwargs):
        """Update runtime config (from Node.js command)."""
        if "confidenceThreshold" in kwargs:
            self.confidence_threshold = float(kwargs["confidenceThreshold"])
        if "recognitionCooldownSec" in kwargs:
            self.cooldown_sec = int(kwargs["recognitionCooldownSec"])

    def get_stats(self):
        """Return pipeline performance stats."""
        avg_ms = 0
        if self.frames_processed > 0:
            avg_ms = round(self.total_inference_ms / self.frames_processed, 1)
        return {
            "frames_processed": self.frames_processed,
            "faces_detected": self.faces_detected,
            "avg_inference_ms": avg_ms,
            "active_tracks": len(self._tracker.tracks),
            "known_identities": self._embedding_store.identity_count
            if self._embedding_store
            else 0,
        }

    # ── Internal ────────────────────────────────────────

    def _make_unknown_result(self, bbox, det_conf, match_conf=0.0):
        return {
            "identity": self.unknown_label,
            "confidence": match_conf,
            "bbox": bbox,
            "is_unknown": True,
            "detection_conf": round(det_conf, 3),
        }

    def _get_onnx_providers(self):
        """Auto-detect GPU availability. Falls back to CPU if no CUDA."""
        try:
            import onnxruntime
            available = onnxruntime.get_available_providers()
            if "CUDAExecutionProvider" in available:
                return ["CUDAExecutionProvider", "CPUExecutionProvider"]
        except Exception:
            pass
        return ["CPUExecutionProvider"]
