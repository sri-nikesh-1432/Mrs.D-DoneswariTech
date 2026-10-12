# DONESWARI AI TELECALLER — MASTER TODO

## 🔴 P0 — CORE PIPELINE (Must work for MVP)

### RAG & Knowledge
- [x] PDF upload endpoint (`POST /api/agents/{id}/documents`)
- [x] PDF extraction with PyMuPDF (page-level metadata preserved)
- [x] Document cleaning (headers, footers, whitespace)
- [x] Semantic chunking (300–800 tokens, section-aware)
- [x] Chunk metadata: chunk_id, page_number, section, category, agent_id
- [x] Embeddings with sentence-transformers (all-MiniLM-L6-v2)
- [x] FAISS vector store (agent-isolated: `knowledge/agent_{id}/index`)
- [x] Retrieval pipeline: query → embed → FAISS → rerank → top-k chunks
- [x] RAG grounding: answer ONLY from retrieved context, never invent
- [x] Knowledge validation: auto-test retrieval after indexing
- [x] Training status polling (`GET /api/agents/{id}/knowledge/status`)

### Agent Brain
- [x] Dynamic system prompt from skills spec (37 skills)
- [x] `build_dynamic_system_prompt()` — full skills spec
- [x] `build_skills_system_prompt()` — compact form for voice (<120 tokens)
- [x] `FEW_SHOT_EXAMPLES` — behavioral style examples
- [x] `build_prompt()` — assembles full message list for LLM
- [x] skills.md — master skills specification file
- [x] Groq LLM integration with model fallback chain
- [x] `stream_chat_fast()` — ultra-low-latency streaming for voice
- [x] Conversation memory (last 8 turns + structured slots)
- [x] Objection detection and handling
- [x] Lead scoring (HOT/WARM/COLD/CALLBACK/NOT_INTERESTED)
- [x] Parent vs student conversation mode detection
- [x] Multilingual: English, Telugu, Hindi (native script)
- [x] Language detection and locking per conversation

### Voice Pipeline
- [x] WebSocket voice endpoint (`/ws/voice/{agent_id}`)
- [x] Server-side VAD (energy-based, adaptive turn detection)
- [x] Groq Whisper STT (whisper-large-v3-turbo)
- [x] Edge TTS (en-IN-NeerjaNeural, streaming)
- [x] Barge-in / interruption support (cancel in-flight turn)
- [x] Parallel RAG + LLM streaming (RAG fires before LLM blocks)
- [x] Per-sentence TTS streaming (first audio < 700ms target)
- [x] Phantom input prevention (echo, backchannel, noise filtering)
- [x] Duplicate utterance tracking
- [x] Latency instrumentation (STT/RAG/LLM/TTS per-turn metrics)
- [x] Audio response cache (first-sentence MP3 for repeat questions)

### Frontend — Core Flow
- [x] TrainLanding page: upload → train → ready (warm ivory design)
- [x] Training progress screen (real backend stages, no fake progress)
- [x] Agent ready screen (chunks, capabilities, CTA buttons)
- [x] AgentTest page: voice orb, real waveform, transcript, barge-in
- [x] AgentOverview: knowledge upload, training panel, save/publish
- [x] Sidebar navigation (agent-scoped + global)
- [x] Voice WebSocket client (`voiceWebSocket.ts`)
- [x] Real waveform visualization (mic + playback amplitude)
- [x] Agent orb states: idle / listening / thinking / speaking

---

## 🟠 P1 — IMPORTANT (Ship soon after P0)

### Prompt & Skills
- [x] skills.md master specification (37 skills documented)
- [x] prompt_builder.py rebuilt with full skills spec
- [x] groq_service.py wired to build_skills_system_prompt
- [ ] Institution profile extraction after indexing (JSON: courses, fees, hostel, etc.)
- [ ] Automatic FAQ generation from document sections
- [ ] Knowledge evaluation report (pass rate, grounded %, insufficient %)
- [ ] Conversation state machine: GREETING→DISCOVER→ANSWER→OBJECTION→CLOSE

### Agent Configuration
- [x] Agent CRUD (create, read, update, delete)
- [x] Save Changes validation gate (name + knowledge + vector index + voice)
- [x] Publish / Pause workflow
- [x] Agent status lifecycle: DRAFT → PROCESSING → READY → PUBLISHED → PAUSED
- [ ] Agent voice selector UI (pick from ElevenLabs or Edge TTS voices)
- [ ] Agent language selector (EN / TE / HI)
- [ ] Custom greeting message per agent

### Lead & Memory
- [x] Conversation memory (in-memory per WebSocket session)
- [x] Call finalization: persist CallHistory + CallReport at disconnect
- [ ] Lead extraction: name, course, location, hostel, budget, callback
- [ ] Lead status display in voice UI (HOT/WARM/COLD badge)
- [ ] Structured memory slots: caller_name, course_interest, hostel_required, etc.
- [ ] Callback request detection and capture

### UI Polish
- [x] Warm ivory design system (#faf9f7, #c8a96e, #1a1a1a)
- [x] Framer Motion page transitions
- [x] Skeleton loading states
- [ ] Voice UI: show live lead status (interest, concern, language)
- [ ] Voice UI: show RAG source ("Admissions · Page 14")
- [ ] Call summary screen after conversation ends
- [ ] Error states: upload failure, no text, API failure, voice failure
- [ ] Toast notifications for all async actions

---

## 🟡 P2 — TELEPHONY (Next phase after web voice works)

- [ ] Twilio integration (`POST /api/telephony/incoming`)
- [ ] Twilio inbound call webhook
- [ ] Twilio outbound call initiation
- [ ] Call state management (ringing, connected, completed, failed)
- [ ] Caller identification from Twilio metadata
- [ ] Call recording (opt-in, legally compliant)
- [ ] Transcript generation per call
- [ ] Call duration tracking
- [ ] Telephony status dashboard
- [ ] Phone number configuration UI
- [ ] Test call from AgentOverview (real phone rings)

---

## 🟡 P2 — ANALYTICS (After telephony)

- [ ] Real call analytics (only from actual call records)
- [ ] Calls today / connected / hot leads / callbacks
- [ ] Per-agent analytics: interest distribution, objection types, language breakdown
- [ ] Latency dashboard: STT/RAG/LLM/TTS per-turn metrics
- [ ] Lead funnel visualization
- [ ] Call history with full transcript view
- [ ] Export leads as CSV

---

## 🟢 P3 — PRODUCTION HARDENING (Later)

- [ ] PostgreSQL migration (replace SQLite)
- [ ] Qdrant vector DB (replace FAISS for multi-instance)
- [ ] ElevenLabs voice integration (replace Edge TTS for premium voice)
- [ ] ElevenLabs Conversational AI agent option
- [ ] Twilio + ElevenLabs native integration for telephony
- [ ] Multi-tenant isolation (workspace-level agent separation)
- [ ] Rate limiting per agent/workspace
- [ ] File size limits and MIME validation hardening
- [ ] HTTPS / production CORS configuration
- [ ] Render.com deployment (backend)
- [ ] Netlify deployment (frontend)
- [ ] Environment variable validation on startup
- [ ] Health check endpoint with real component statuses
- [ ] Structured logging with log rotation
- [ ] Hallucination red-team test suite (automated)
- [ ] Voice interruption test suite
- [ ] RAG retrieval test suite (exact, paraphrase, multilingual, table)

---

## 📋 CURRENT STATUS

| Component | Status |
|---|---|
| Backend (FastAPI) | ✅ Built, needs start |
| Frontend (React + Vite) | ✅ Running on :5176 |
| RAG Pipeline | ✅ Complete |
| Voice WebSocket | ✅ Complete |
| Prompt Builder (skills spec) | ✅ Rebuilt with 37 skills |
| skills.md | ✅ Created |
| Groq LLM | ✅ Wired |
| Edge TTS | ✅ Wired |
| Twilio | 🔴 Not started |
| ElevenLabs | 🔴 Not started |
| Institution Profile | 🟡 Partial |
| FAQ Generation | 🔴 Not started |
| Lead Extraction UI | 🔴 Not started |

## 🚀 TODAY'S DEFINITION OF DONE

```
Upload PDF → Real extraction → Real chunks → Real embeddings
→ Real FAISS index → Real RAG retrieval → Real LLM (Groq)
→ Real voice (Edge TTS) → Real conversation with barge-in
→ Memory works → Objections handled → No hallucination
```

That is the vertical slice. Once that works end-to-end, telephony is next.
