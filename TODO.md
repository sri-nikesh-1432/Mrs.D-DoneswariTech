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
