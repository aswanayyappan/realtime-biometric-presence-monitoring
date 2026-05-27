"""
Known-face embedding manager.

Scans known_faces/ directory at startup.
Generates embeddings ONCE, caches in memory.
Handles multiple images per identity (averaged embedding).
Gracefully skips corrupted images.

Directory structure:
  known_faces/
    john/
      img1.jpg
      img2.jpg
    alice/
      img1.jpg
"""

import os
import cv2
import numpy as np
import time


SUPPORTED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}

# Mandatory Enrollment Pipeline Constants
MIN_FACE_SIZE = 100
MIN_DET_CONF = 0.7
MIN_BLUR_VARIANCE = 50.0

class EmbeddingStore:
    """Pre-computed face embedding database."""

    def __init__(self, known_faces_dir, face_analyzer):
        self.known_faces_dir = known_faces_dir
        self.face_analyzer = face_analyzer

        # identity_name -> averaged embedding vector (normalized)
        self.embeddings = {}
        # identity_name -> count of images loaded
        self.image_counts = {}

    def load_all(self):
        """
        Scan known_faces/ and compute embeddings for all identities.
        Called ONCE at startup. Returns stats dict.
        """
        start = time.time()
        total_images = 0
        failed_images = 0
        identities = 0
        rejection_reasons = {}

        if not os.path.isdir(self.known_faces_dir):
            return {
                'identities': 0,
                'total_images': 0,
                'failed_images': 0,
                'load_time_sec': 0,
            }

        print("\n--- Starting Face Enrollment Pipeline ---")
        for identity_name in os.listdir(self.known_faces_dir):
            identity_dir = os.path.join(self.known_faces_dir, identity_name)
            if not os.path.isdir(identity_dir):
                continue

            embeddings_for_identity = []
            identity_rejections = []

            for img_name in os.listdir(identity_dir):
                ext = os.path.splitext(img_name)[1].lower()
                if ext not in SUPPORTED_EXTENSIONS:
                    continue

                img_path = os.path.join(identity_dir, img_name)
                total_images += 1

                emb, reject_reason = self._extract_embedding(img_path)
                if emb is not None:
                    embeddings_for_identity.append(emb)
                else:
                    failed_images += 1
                    identity_rejections.append(reject_reason)
                    rejection_reasons[reject_reason] = rejection_reasons.get(reject_reason, 0) + 1

            valid_count = len(embeddings_for_identity)
            rejected_count = len(identity_rejections)
            print(f"[{identity_name}] Enrolled: {valid_count} | Rejected: {rejected_count}")
            if rejected_count > 0:
                reason_summary = {}
                for r in identity_rejections:
                    # Keep only the base reason (strip details in parentheses)
                    base_r = r.split(' ')[0]
                    reason_summary[base_r] = reason_summary.get(base_r, 0) + 1
                print(f"  -> Rejections: {reason_summary}")

            if embeddings_for_identity:
                # Average all embeddings for this identity, then normalize
                avg_emb = np.mean(embeddings_for_identity, axis=0)
                avg_emb = avg_emb / np.linalg.norm(avg_emb)

                self.embeddings[identity_name] = avg_emb
                self.image_counts[identity_name] = len(embeddings_for_identity)
                identities += 1
            else:
                print(f"[{identity_name}] FAILED to enroll (no valid images).")

        elapsed = round(time.time() - start, 2)
        print("-----------------------------------------\n")

        return {
            'identities': identities,
            'total_images': total_images,
            'failed_images': failed_images,
            'load_time_sec': elapsed,
            'identity_names': list(self.embeddings.keys()),
            'rejection_reasons': rejection_reasons,
        }

    def match(self, query_embedding, threshold=0.45):
        """
        Compare a query embedding against all known identities.
        Returns (identity_name, confidence, margin) where margin = winner_score - second_best_score.
        Returns (None, 0.0, 0.0) if no match above threshold.

        Uses cosine similarity (embeddings are pre-normalized).
        margin check lets the pipeline reject near-tie false positives.
        """
        if not self.embeddings or query_embedding is None:
            return None, 0.0, 0.0

        # Normalize query
        query_norm = query_embedding / np.linalg.norm(query_embedding)

        scores = []
        for identity, known_emb in self.embeddings.items():
            score = float(np.dot(query_norm, known_emb))
            scores.append((score, identity))

        scores.sort(reverse=True)

        best_score, best_identity = scores[0]
        second_score = scores[1][0] if len(scores) > 1 else 0.0
        margin = best_score - second_score

        if best_score >= threshold:
            return best_identity, round(best_score, 4), round(margin, 4)

        return None, round(best_score, 4), round(margin, 4)


    def _extract_embedding(self, img_path):
        """
        Extract face embedding from a single image with strict validation.
        Returns (embedding, None) on success, or (None, rejection_reason) on failure.
        """
        try:
            img = cv2.imread(img_path)
            if img is None:
                return None, "corrupted"

            # 1. Blur Check
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            variance = cv2.Laplacian(gray, cv2.CV_64F).var()
            if variance < MIN_BLUR_VARIANCE:
                return None, f"blurry ({variance:.1f})"

            # InsightFace expects BGR (OpenCV default)
            faces = self.face_analyzer.get(img)
            
            # 2. Multi-face Check
            if not faces:
                return None, "no_face"
            if len(faces) > 1:
                return None, f"multiple_faces ({len(faces)})"

            face = faces[0]

            # 3. Confidence Check
            if face.det_score < MIN_DET_CONF:
                return None, f"low_confidence ({face.det_score:.2f})"

            # 4. Size Check
            x1, y1, x2, y2 = face.bbox
            w, h = x2 - x1, y2 - y1
            if w < MIN_FACE_SIZE or h < MIN_FACE_SIZE:
                return None, f"too_small ({int(w)}x{int(h)})"

            # 5. Partial Face Check (must be fully within bounds with margin)
            img_h, img_w = img.shape[:2]
            margin = 5
            if x1 < margin or y1 < margin or x2 > img_w - margin or y2 > img_h - margin:
                return None, "partial_face_out_of_bounds"

            # 6. Pose Check (if available)
            if hasattr(face, 'pose') and face.pose is not None:
                pitch, yaw, roll = face.pose
                if abs(pitch) > 30 or abs(yaw) > 30:
                    return None, f"extreme_angle (p:{int(pitch)} y:{int(yaw)})"

            emb = face.embedding
            if emb is None or len(emb) == 0:
                return None, "no_embedding"

            return emb.astype(np.float32), None

        except Exception as e:
            return None, f"error: {str(e)}"

    @property
    def identity_count(self):
        return len(self.embeddings)

    @property
    def identity_names(self):
        return list(self.embeddings.keys())
