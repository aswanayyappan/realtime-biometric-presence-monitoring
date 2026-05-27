"""
Centralized config for the Python AI worker.
Reads from CLI args (passed by Node.js worker-manager).
Single source of truth — no scattered env reads.
"""

import argparse
import os


def load_config():
    """Parse CLI args into a config namespace."""
    parser = argparse.ArgumentParser(description='Face Recognition AI Worker')

    parser.add_argument('--camera-index', type=int, default=0)
    parser.add_argument('--camera-width', type=int, default=640)
    parser.add_argument('--camera-height', type=int, default=480)
    parser.add_argument('--frame-skip', type=int, default=3)
    parser.add_argument('--max-queue', type=int, default=5)
    parser.add_argument('--confidence-threshold', type=float, default=0.45)
    parser.add_argument('--cooldown', type=int, default=5)
    parser.add_argument('--known-faces-dir', type=str, default='./known_faces')
    parser.add_argument('--test', action='store_true', help='Run self-test then exit')

    cfg = parser.parse_args()
    cfg.known_faces_dir = os.path.abspath(cfg.known_faces_dir)

    return cfg
