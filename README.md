# Doneswari AI Telecaller

A production-quality AI educational counsellor that behaves like a real professional female counsellor answering incoming calls. Supports both **voice** and **text** conversations.

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Configure API Keys

Edit `backend/.env`:

```env
GROQ_API_KEY=your_actual_groq_api_key_here
```

Get your free Groq API key at: https://console.groq.com

### 3. Start the Backend

```bash
cd backend
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

### 4. Open the Frontend

```bash
cd frontend
npm run dev
# Then open http://localhost:5176
```

---

## 🌐 Production Deployment

This project is a split single-app repo:

- **Frontend** → Netlify: `https://dllp.netlify.app`
- **Backend** → Render: `https://d-tech-pid6.onrender.com`

### Frontend (Netlify)

- `netlify.toml` at repo root is the Netlify site config.
- Vite bakes `VITE_API_URL` / `VITE_WS_URL` at build time, so deployed builds target the backend origin automatically.
- Do not override `VITE_API_URL`/`VITE_WS_URL` in the Netlify UI unless you are intentionally pointing the same-site static frontend at a different backend.

### Backend (Render)

- `backend/render.yaml` is the Render web service config and must list every Netlify origin that can call the backend across origins (REST + upgraded WebSocket).
- CORS is controlled by `ALLOWED_ORIGINS` in `backend/app/config/settings.py` + `backend/.env` (rendered into Render env via `backend/render.yaml`).
- Set secrets in the Render dashboard, not committed in the repo (`sync: false`):
  - `GROQ_API_KEY`
  - `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID` defaults to the backend's configured ElevenLabs voice.

---

## 🏗️ Architecture

```text
AI Educational Telecalling Agent

        HTML + CSS + JavaScript
               │
         Fetch API Calls
               │
               ▼
     FastAPI (Python Backend)
               │
  ┌────────────┼────────────┐
  │            │            │
  ▼            ▼            ▼
Whisper STT  Memory    Prompt Manager
  │            │            │
  └──────┬─────┴──────┬─────┘
         ▼            ▼
    Groq LLM    Session Context
         │
         ▼
   Edge-TTS / ElevenLabs (premium voice)
         │
         ▼
   Audio Response
```

---

## 📁 Project Structure

```text
backend/
├── app.py                  # FastAPI entry point
├── config/
│   └── settings.py         # Unified Pydantic settings (CORS, TTS, ElevenLabs)
├── app/                    # API routers, services, voice pipeline, RAG, telephony
├── requirements.txt
├── render.yaml             # Render web service configuration
└── .env.example            # Environment template (tracked)

frontend/
├── index.html
├── src/
│   ├── services/
│   │   ├── api.ts          # REST client (baked from VITE_API_URL)
│   │   └── voiceWebSocket.ts
│   └── pages/
│       └── Agent.tsx       # Voice agent UI
└── package.json
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | System health check |
| GET | `/ready` | Service readiness check |
| GET | `/api/status` | Real-time system diagnostics & credentials status |
| POST | `/api/chat` | REST text conversation with RAG retrieval, citations, and TTS audio |
| POST | `/api/chat/stream` | Server-Sent Events (SSE) streaming text chat |
| GET | `/api/chat/history/{session_id}` | Retrieve multi-turn chat session history |
| POST | `/api/chat/clear` | Clear chat session history |
| POST | `/insert` or `/api/knowledge/insert` | Ingest institutional knowledge document into vector store |
| POST | `/api/knowledge/test-retrieval` | Test RAG retrieval query and return ranked chunks with scores |
| GET | `/api/knowledge/documents` | List indexed institutional documents |
| DELETE | `/api/knowledge/documents/{id}` | Remove a document from the knowledge base |
| POST | `/api/knowledge/documents/{id}/reindex` | Trigger re-indexing of a document |
| WS | `/api/ws/voice/{agent_id}` | Real-time low-latency voice WebSocket pipeline |

Interactive API docs: `http://<backend>:8000/docs`

---

## ✨ Features

- **Voice + Text** — seamlessly switch between voice and text
- **Whisper Large V3 Turbo** — fast speech recognition via Groq
- **Groq LLM** — intelligent, natural responses
- **Edge-TTS / ElevenLabs** — natural voice generation with a warm professional Indian female neural voice
- **Conversation Memory** — remembers context within a session
- **Human Interruption** — click mic while AI speaks to interrupt
- **Smart Silence Detection** — auto-stops recording after silence
- **Voice Activity Detection** — smooth start/stop detection
- **Streaming Responses** — text streams as it is generated
- **Auto-retry** — reconnects if Groq API temporarily fails
- **Structured Logging** — all conversations logged to JSONL
- **Session Management** — multiple isolated sessions supported

---

## 🎨 UI Features

- Premium glassmorphism design
- Animated avatar (listening/speaking states)
- Microphone pulse animation while recording
- Waveform animation while speaking
- Thinking dots animation
- Chat bubbles with timestamps
- Toast notifications
- Fully responsive (desktop + tablet + mobile)

---

## ⚙️ Configuration

All settings in `backend/.env`:

```env
GROQ_API_KEY=           # Required: your Groq API key
GROQ_STT_MODEL=whisper-large-v3-turbo
GROQ_LLM_MODEL=llama-3.3-70b-versatile
ELEVENLABS_API_KEY=     # Optional: premium voice engine
ELEVENLABS_VOICE_ID=    # default ElevenLabs voice id
HOST=127.0.0.1
PORT=8000
DEBUG=false
```

To change the agent behaviour, edit `backend/prompts/system_prompt.txt` — no code changes needed.

---

## 📋 Requirements

- Python 3.10+
- Node 20+
- Modern browser (Chrome/Edge recommended for best WebRTC support)
- Groq API key (free tier available)
- Internet connection (for Groq API + Edge-TTS / ElevenLabs)
