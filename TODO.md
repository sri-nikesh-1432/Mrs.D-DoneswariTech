# Implementation TODO - Multilingual Telugu Voice Agent

## Core Module
- [ ] Create `backend/app/roman_telugu.py` with:
  - Roman Telugu detection (`detect_language` aware)
  - Roman Telugu -> Telugu transliteration (internal)
  - Telugu number-to-words converter (fees, years)
  - `normalize_for_speech()` (fees, years, phone numbers, abbreviations)

## Active Mrs. D Pipeline
- [ ] `backend/app/api/conversation_routes.py` - robust language detection + internal transliteration + feed normalized text to prompt
- [ ] `backend/app/rag/prompt_builder.py` - enrich SYSTEM_PROMPT (counsellor tone, code-mixing, fillers, pronunciation)
- [ ] `backend/app/tts/edge_tts_service.py` - apply normalize_for_speech before synthesis, warm Telugu voice + ~1.1x rate
- [ ] `backend/app/config/settings.py` - default TTS_RATE +10%, TTS_VOICE te-IN-ShrutiNeural
- [ ] `backend/app/voice/voice_service.py` - rate +10%, Telugu voice default

## Legacy Services (consistency)
- [ ] `backend/services/language_service.py` - Roman Telugu detection
- [ ] `backend/services/tts_service.py` - apply normalization pre-TTS
- [ ] `backend/services/llm_service.py` - code-mixing/filler guidance in instruction

## Frontend
- [ ] `frontend/src/hooks/useVoiceAgent.ts` - Roman Telugu detection in detectLanguage()

## Tests
- [ ] Add tests for Roman Telugu detection + number normalization
- [ ] Run pytest and verify
