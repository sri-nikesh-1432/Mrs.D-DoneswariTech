# Complete Redesign Plan: Mrs. D - Premium Voice-First AI Counselor

## Overview
Transform the app into a premium, voice-first AI Educational Counselor named "Mrs. D" with ChatGPT Voice Mode-style experience, premium modal popups, and a world-class UI.

## Files to Modify

### 1. `backend/prompts/system_prompt.txt` — Update name to Mrs. D
- Change "Shruthi" → "Mrs. D" everywhere
- Update persona to be more mature/professional counselor
- Update opening messages

### 2. `frontend/index.html` — Complete redesign
- Add modal overlay structure (Listening/Thinking/Speaking popups)
- Add particle canvas for background effects
- Add voice visualization canvas
- Restructure for voice-first layout (minimal chat, prominent mic)
- Remove text-centric layout, make voice the hero

### 3. `frontend/style.css` — Complete premium redesign
- Premium CSS variables (deeper gradients, richer shadows)
- **Modal Popups**:
  - `.modal-overlay` - Full screen backdrop blur
  - `.modal-popup.listening` - Blue glow, animated mic, waveform
  - `.modal-popup.thinking` - Purple glow, brain animation, dots
  - `.modal-popup.speaking` - Animated avatar, waveform, audio viz
- **Particle System** - Floating animated background particles
- **Voice-first layout** - Large center-aligned mic, minimal chrome
- **Animations**:
  - Smooth modal transitions (fade + scale)
  - Mic pulse animations (listening=blue, thinking=purple, speaking=green)
  - Waveform bars for each state
  - Floating glow orbs
- **Premium glassmorphism** throughout
- Responsive for all devices

### 4. `frontend/script.js` — Complete rewrite for voice-first
- **Auto VAD mode**: 
  - When voice starts → immediately listening
  - Continuous mic monitoring (persistent)
  - Auto-start recording when speech detected (RMS > threshold)
  - ~2s silence auto-submits
  - No manual record button needed
- **Modal Popup Manager**:
  - Show/hide modals with animations
  - Track current state for transitions
- **Particle system** (canvas-based)
- **Audio visualizer** for speaking state
- **State machine**: IDLE → LISTENING → THINKING → SPEAKING → LISTENING
- **Barge-in** preserved (interrupt during speaking)
- **Text** optional, accessible via minimize button

### 5. `backend/app.py` — Add reset-session endpoint if missing
- Ensure CORS allows all origins for development

## Key Requirements Checklist
- [ ] Voice is PRIMARY, text is optional accessibility feature
- [ ] Continuous mic monitoring with true VAD
- [ ] Auto-start recording on speech
- [ ] ~2s silence auto-submit
- [ ] No manual Send button for voice
- [ ] Premium modal popups for each state
- [ ] Smooth animated transitions between modals
- [ ] Background blur effect during modals
- [ ] Name changed to "Mrs. D"
- [ ] Premium glassmorphism design
- [ ] Particle background
- [ ] Audio visualization during speaking
- [ ] Barge-in preserved
- [ ] Responsive design
- [ ] Push to GitHub

## Execution Order
1. Update system prompt (Mrs. D rename)
2. Update index.html (new structure with modals)
3. Rewrite style.css (premium design + modals)
4. Rewrite script.js (voice-first + modals + particles)
5. Test and debug
6. Update Vite config if needed
7. Push to GitHub

