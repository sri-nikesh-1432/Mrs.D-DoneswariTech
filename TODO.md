# Implementation TODO - Multilingual Telugu Voice Agent

## Core Module
- [x] Create `backend/app/roman_telugu.py` with:
  - Roman Telugu detection (`detect_language` aware)
  - Roman Telugu -> Telugu transliteration (internal)
  - Telugu number-to-words converter (fees, years)
  - `normalize_for_speech()` (fees, years, phone numbers, abbreviations)

## Active Mrs. D Pipeline
- [x] `backend/app/api/conversation_routes.py` - robust language detection + internal transliteration + feed normalized text to prompt
- [x] `backend/app/rag/prompt_builder.py` - enrich SYSTEM_PROMPT (counsellor tone, code-mixing, fillers, pronunciation)
- [x] `backend/app/tts/edge_tts_service.py` - apply normalize_for_speech before synthesis, warm Telugu voice + ~1.1x rate
- [x] `backend/app/config/settings.py` - default TTS_RATE +10%, TTS_VOICE te-IN-ShrutiNeural
- [x] `backend/app/voice/voice_service.py` - rate +10%, Telugu voice default

## Legacy Services (consistency)
- [x] `backend/services/language_service.py` - Roman Telugu detection
- [x] `backend/services/tts_service.py` - apply normalization pre-TTS
- [x] `backend/services/llm_service.py` - code-mixing/filler guidance in instruction

## Frontend
- [x] `frontend/src/hooks/useVoiceAgent.ts` - Roman Telugu detection in detectLanguage()
- [x] Adaptive turn-taking: silence timeout scales with utterance length + jitter (no fixed timeout that cuts callers off)
- [x] TTFA (time-to-first-audio) surfaced in the debug panels — the metric that decides "feels human" vs "feels robotic"

## Tests
- [x] Add tests for Roman Telugu detection + number normalization
- [x] Run pytest and verify (43 passed)

## Realtime pipeline rebuild (true streaming, ML VAD)
- [x] `frontend/public/vad/` - Silero VAD v5 model + worklet + onnxruntime wasm (local, no CDN)
- [x] `frontend/src/lib/vad.ts` - replace energy/RMS VAD with Silero ML VAD (neural speech probability; fan/keyboard/cough/echo can never start a turn). Same public interface + 16 kHz PCM window + `setAISpeaking()` threshold lift while Mrs. D talks
- [x] `frontend/src/lib/wav.ts` - PCM16 WAV encoder (no MediaRecorder round-trip)
- [x] `frontend/src/hooks/useVoiceAgent.ts` - merged-utterance turn detection (mid-thought pauses stay ONE turn), streaming STT partials (live "naku... naku mee..." text, never sent to LLM), partial-based semantic barge-in (genuine question stops Mrs. D immediately; backchannel resumes her), PCM-window finalize with STT-lock parking (never drops an utterance), echo suppression on partials, spec §34 analytics counters (partials/barge-ins/false detections/corrections/turns) + `fsmState`/`partialTranscript` exposure
- [x] `frontend/src/components/VoiceTestingConsole.tsx` - live partial transcript + Voice engine analytics panel
- [x] Verify: tsc + vite build green; backend pytest 43 passed; /vad assets served; headless Chrome (fake mic) reaches LISTENING with zero console errors and zero phantom STT calls
