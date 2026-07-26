# Shruthi — AI Educational Telecalling Agent

A production-quality AI educational counselor that behaves like a real professional female counselor answering incoming calls. Supports both **voice** and **text** conversations.

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

Open `frontend/index.html` in your browser, or serve it with:
```bash
# Using Python
cd frontend
python -m http.server 5500
# Then open http://localhost:5500
```

---

## 🏗️ Architecture

```
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
   Edge-TTS (Shruthi)
         │
         ▼
   Audio Response
```

---

## 📁 Project Structure

```
backend/
├── app.py                  # FastAPI entry point
├── routes/
│   ├── chat_route.py       # POST /chat (voice pipeline)
│   ├── text_chat_route.py  # POST /text-chat + /text-chat/stream
│   ├── stt_route.py        # POST /speech-to-text
│   ├── tts_route.py        # POST /text-to-speech
│   ├── history_route.py    # GET /history, POST /reset-session
│   └── health_route.py     # GET /health
├── services/
│   ├── llm_service.py      # Groq LLM (with retry + streaming)
│   ├── stt_service.py      # Whisper Large V3 Turbo
│   ├── tts_service.py      # Edge-TTS ShrutiNeural
│   └── prompt_service.py   # System prompt loader
├── memory/
│   └── session_memory.py   # In-memory conversation history
├── models/
│   └── schemas.py          # Pydantic request/response models
├── utils/
│   ├── config.py           # Settings from .env
│   └── logger.py           # Structured logging
├── prompts/
│   └── system_prompt.txt   # Shruthi's personality & knowledge
├── logs/                   # Auto-generated log files
├── static/audio/           # TTS audio output files
├── requirements.txt
└── .env

frontend/
├── index.html
├── style.css
└── script.js
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | System health check |
| POST | `/speech-to-text` | Audio → text (Whisper) |
| POST | `/text-to-speech` | Text → MP3 audio |
| POST | `/chat` | Full voice pipeline (audio in, audio out) |
| POST | `/text-chat` | Text in, text + audio URL out |
| POST | `/text-chat/stream` | Streaming text response (SSE) |
| GET | `/history/{session_id}` | Get conversation history |
| POST | `/reset-session/{session_id}` | Clear session history |
| POST | `/new-session` | Create new session |
| GET | `/conversation-logs` | View recent conversation logs |

Interactive API docs: http://127.0.0.1:8000/docs

---

## ✨ Features

- **Voice + Text** — Seamlessly switch between voice and text input
- **Whisper Large V3 Turbo** — Fast, accurate speech recognition via Groq
- **Llama 3.3 70B** — Intelligent, natural responses via Groq
- **Edge-TTS ShrutiNeural** — Natural Telugu-accented English voice
- **Conversation Memory** — Remembers context within the session
- **Human Interruption** — Click mic while AI speaks to interrupt
- **Smart Silence Detection** — Auto-stops recording after silence
- **Voice Activity Detection** — Smooth start/stop detection
- **Streaming Responses** — Text streams as it's generated
- **Auto-retry** — Reconnects if Groq API temporarily fails
- **Structured Logging** — All conversations logged to JSONL
- **Session Management** — Multiple isolated sessions supported

---

## 🎨 UI Features

- Premium glassmorphism design
- Animated avatar (listening/thinking/speaking states)
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
TTS_VOICE=te-IN-ShrutiNeural
HOST=127.0.0.1
PORT=8000
SESSION_TIMEOUT_MINUTES=30
MAX_HISTORY_TURNS=20
LOG_LEVEL=INFO
```

To change Shruthi's behavior, edit `backend/prompts/system_prompt.txt` — no code changes needed.

---

## 📋 Requirements

- Python 3.10+
- Modern browser (Chrome/Edge recommended for best WebRTC support)
- Groq API key (free tier available)
- Internet connection (for Groq API + Edge-TTS)
