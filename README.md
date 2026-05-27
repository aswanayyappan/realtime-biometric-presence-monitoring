# Real-time Biometric Presence Monitoring System

> **Note:** This project is an **advanced realtime AI prototype** and a **serious experimental engineering prototype**, designed to explore modular realtime inference architectures. It is *not* intended as production-grade software or an enterprise commercial biometric platform.

An experimental, low-latency face recognition and presence monitoring system. This prototype utilizes a dual-runtime architecture, combining the AI and computer vision performance of Python (InsightFace, ONNXRuntime) with the real-time websocket and API capabilities of Node.js.

## System Architecture

```text
Node.js (Express + WebSocket)  ←→  Python Worker (OpenCV + InsightFace)
             ↑                                   ↑
        Mobile Stream + UI               Camera / Model Inference
             ↓                                   ↓
        SQLite Logging                   known_faces/ Embeddings
```

### Key Experimental Features
- **Modular Inference Architecture**: Demonstrates how to decouple heavy AI processing (Python) from real-time client state management (Node.js).
- **Temporal Stability Prototyping**: Implements an experimental temporal voter (3-of-5 frame majority), exponential moving average (EMA) score smoothing, and Intersection over Union (IoU) face tracking.
- **Low-Latency Streaming**: Per-client token-bucket frame throttling to experiment with managing WebSocket backpressure and preventing UI stuttering.
- **Dual-Threshold Rejection**: Sophisticated unknown identity rejection using an experimental dual-threshold accept/confirm system with confidence margin checking.
- **React Dashboard**: Real-time frontend built with React, showcasing confidence graphs, presence states (IDLE, TENTATIVE, CONFIRMED, LOST), and live camera feeds.

---

## Quick Start

### 1. Prerequisites
- **Node.js** 18+
- **Python** 3.11+
- **Webcam** (or mobile camera for the streaming client)

### 2. Installation

Install Node.js dependencies:
```bash
npm install
```

Set up Python virtual environment and dependencies:
```bash
python -m venv venv
# Windows: venv\Scripts\activate
# Unix: source venv/bin/activate
pip install -r requirements.txt
```

### 3. Enroll Faces

Create subdirectories inside `known_faces/` for each identity you want to recognize:
```text
known_faces/
  john_doe/
    photo1.jpg
    photo2.jpg
  jane_smith/
    photo1.jpg
```
*Note: For the highest accuracy, ensure enrollment photos feature only one person, are well-lit, and forward-facing.*

### 4. Configuration

Copy the example environment file and configure it:
```bash
cp .env.example .env
```

| Setting | Default | Description |
|---------|---------|-------------|
| `CAMERA_INDEX` | `0` | Default hardware webcam index. |
| `FRAME_SKIP` | `3` | Process every Nth frame to save CPU. |
| `CONFIDENCE_THRESHOLD` | `0.75` | Final confirmation threshold. |

### 5. Running the System

Start the entire system (Node.js will automatically orchestrate and launch the Python AI worker):
```bash
npm start
```
- **Dashboard UI**: `http://localhost:5173` (If using Vite)
- **API/WebSocket**: `http://localhost:3000`

---

## Project Structure

```text
├── backend/
│   ├── server.js           # Entry point, HTTP & WS Server
│   ├── worker-manager.js   # Python process orchestrator
│   └── ws-broadcaster.js   # Per-client WebSocket frame throttling
├── worker/
│   ├── main.py             # Python entry point & IPC loop
│   ├── pipeline.py         # Temporal voting & tracking pipeline
│   ├── camera.py           # Threaded camera capture
│   └── embeddings.py       # Face embedding manager & margin checks
├── frontend/               # React Dashboard & Phone Stream UI
├── known_faces/            # Identity enrollment directories
└── models/                 # Auto-downloaded ONNX models
```

## AI Pipeline Details
The core experimental recognition system relies on `InsightFace (buffalo_l)` running at 640x640 detection resolution. 
Inference is hardware-accelerated where available via ONNXRuntime providers (CUDA/CPU). The system acts as a testbed for biometric anti-flicker logic, ensuring stable identity locks and preventing single-frame false positives.
