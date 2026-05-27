"""
Main entry point — Python AI Worker.

Orchestrates:
  1. Load config
  2. Load models (once)
  3. Start threaded camera capture
  4. Start IPC listener
  5. Run processing loop (consumer)
  6. Emit events to Node.js

Usage:
  python worker/main.py --camera-index 0 --frame-skip 3
  python worker/main.py --test
"""

import sys
import os
import time
import signal

# Ensure worker/ is in path for local imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import load_config
from ipc import IPC
from camera import Camera
from pipeline import FaceRecognitionPipeline


def main():
    cfg = load_config()
    ipc = IPC()

    # ── Self-test mode ───────────────────────────────────
    if cfg.test:
        run_self_test(cfg, ipc)
        return

    # ── Startup ──────────────────────────────────────────
    ipc.emit('status', {'status': 'starting', 'config': vars(cfg)})

    # ── Load models ──────────────────────────────────────
    pipeline = FaceRecognitionPipeline(
        confidence_threshold=cfg.confidence_threshold,
        cooldown_sec=cfg.cooldown,
        known_faces_dir=cfg.known_faces_dir,
    )

    try:
        load_stats = pipeline.load_models(ipc=ipc)
        ipc.emit('status', {
            'status': 'models_loaded',
            'load_stats': load_stats,
        })
    except Exception as e:
        ipc.emit('error', {'message': f'Failed to load models: {str(e)}'})
        sys.exit(1)

    # ── Start camera ─────────────────────────────────────
    camera = Camera(
        camera_index=cfg.camera_index,
        width=cfg.camera_width,
        height=cfg.camera_height,
        frame_skip=cfg.frame_skip,
        max_queue=cfg.max_queue,
    )

    if not camera.start():
        ipc.emit('error', {'message': f'Failed to open camera {cfg.camera_index}'})
        sys.exit(1)

    ipc.emit('status', {'status': 'camera_ready', 'camera_index': cfg.camera_index})

    # ── Start IPC command listener ───────────────────────
    def handle_config_update(cmd):
        pipeline.update_config(**cmd)
        ipc.emit('status', {'status': 'config_updated'})

    def handle_phone_frame(cmd):
        """Receive a phone camera frame (base64 JPEG) and inject into camera queue."""
        frame_data = cmd.get('data', '')
        if frame_data:
            camera.inject_frame(frame_data)

    ipc.on_command('config', handle_config_update)
    ipc.on_command('frame', handle_phone_frame)
    ipc.start_listening()

    # ── Signal ready ─────────────────────────────────────
    ipc.emit('status', {'status': 'ready'})

    # ── Graceful shutdown ────────────────────────────────
    running = True

    def handle_shutdown(*args):
        nonlocal running
        running = False

    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)

    # ── Heartbeat tracking ───────────────────────────────
    last_heartbeat = time.time()
    heartbeat_interval = 10  # seconds

    # ── Main processing loop (consumer) ──────────────────
    try:
        while running and ipc.is_running:
            frame = camera.get_frame()

            if frame is None:
                # No frame ready — brief sleep to avoid busy-wait
                time.sleep(0.01)

                # Send periodic heartbeat
                now = time.time()
                if now - last_heartbeat >= heartbeat_interval:
                    ipc.emit('heartbeat', {
                        'camera_fps': camera.fps,
                        'pipeline_stats': pipeline.get_stats(),
                    })
                    last_heartbeat = now

                continue

            # ── Process frame ────────────────────────────
            faces = pipeline.process_frame(frame)

            # ── Emit results ─────────────────────────────
            # Only emit if at least one face had a state change.
            # This is the core anti-flicker gate: identical states
            # on consecutive frames are silently dropped.
            changed_faces = [f for f in faces if f.get('state_changed', False)]

            if changed_faces:
                ipc.emit('recognition', {
                    'faces': changed_faces,
                    'face_count': len(faces),
                    'camera_fps': camera.fps,
                })

            # Heartbeat
            now = time.time()
            if now - last_heartbeat >= heartbeat_interval:
                ipc.emit('heartbeat', {
                    'camera_fps': camera.fps,
                    'pipeline_stats': pipeline.get_stats(),
                })
                last_heartbeat = now

            # Explicit frame cleanup
            del frame
            del faces

    except KeyboardInterrupt:
        pass
    except Exception as e:
        ipc.emit('error', {'message': f'Processing loop error: {str(e)}'})
    finally:
        # ── Cleanup ──────────────────────────────────────
        ipc.emit('status', {'status': 'shutting_down'})
        camera.stop()
        ipc.stop()


def run_self_test(cfg, ipc):
    """
    Self-test mode: load models, process a test frame, verify pipeline works.
    Exit code 0 = success, 1 = failure.
    """
    print('[TEST] Starting self-test...', file=sys.stderr)

    pipeline = FaceRecognitionPipeline(
        confidence_threshold=cfg.confidence_threshold,
        cooldown_sec=0,
        known_faces_dir=cfg.known_faces_dir,
    )

    try:
        load_stats = pipeline.load_models()
        print(f'[TEST] Models loaded in {load_stats["load_time_sec"]}s', file=sys.stderr)
        print(f'[TEST] Known identities: {load_stats["known_faces"].get("identities", "?")}', file=sys.stderr)
        print(f'[TEST] ONNX providers: {load_stats["providers"]}', file=sys.stderr)
    except Exception as e:
        print(f'[TEST] FAILED to load models: {e}', file=sys.stderr)
        sys.exit(1)

    # Try capturing one frame
    import cv2
    cap = cv2.VideoCapture(cfg.camera_index)
    if cap.isOpened():
        ret, frame = cap.read()
        cap.release()
        if ret and frame is not None:
            results = pipeline.process_frame(frame)
            print(f'[TEST] Processed frame: {len(results)} faces detected', file=sys.stderr)
        else:
            print('[TEST] Camera opened but could not read frame', file=sys.stderr)
    else:
        print(f'[TEST] Could not open camera {cfg.camera_index} (non-fatal)', file=sys.stderr)

    print('[TEST] Self-test PASSED', file=sys.stderr)
    sys.exit(0)


if __name__ == '__main__':
    main()
