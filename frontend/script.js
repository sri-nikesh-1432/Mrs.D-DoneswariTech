/**
 * Doneswari AI Telecaller — Frontend Script
 *
 * Voice pipeline: Listening → (VAD silence) → Thinking → Speaking → Listening
 * Text pipeline:  Type → Send → Thinking → Speaking (optional)
 * Multilingual:   Auto-detects language, shows badge in message meta.
 *
 * Backend: http://localhost:8000  (FastAPI)
 * Frontend: http://localhost:5175 (Vite dev server)
 */

// ── Configuration ─────────────────────────────────────────────────────────────
const CONFIG = {
  API_BASE:              "http://127.0.0.1:8000",
  SILENCE_TIMEOUT_MS:    900,     // 0.9 s silence → auto-submit
  SPEECH_START_DELAY_MS: 300,     // VAD warm-up guard
  MAX_RECORDING_MS:      30_000,  // safety cap per recording
  HEALTH_CHECK_INTERVAL: 10_000,  // poll backend every 10 s
  MIN_AUDIO_BYTES:       500,     // ignore recordings smaller than this
  VAD_THRESHOLD:         10,      // RMS threshold for speech detection
};

// ── State Machine ─────────────────────────────────────────────────────────────
const State = {
  IDLE:      "idle",
  LISTENING: "listening",
  THINKING:  "thinking",
  SPEAKING:  "speaking",
};

let currentState    = State.IDLE;
let voiceModeActive = false;
let backendOnline   = false;

// ── Session ───────────────────────────────────────────────────────────────────
let sessionId = _generateSessionId();

// ── Recording ─────────────────────────────────────────────────────────────────
let mediaRecorder  = null;
let audioChunks    = [];
let recordingTimer = null;
let silenceTimer   = null;
let speechDetected = false;
let vadReady       = false;

// ── Audio Context / VAD ───────────────────────────────────────────────────────
let audioContext = null;
let analyser     = null;
let micStream    = null;
let vadActive    = false;

// ── Playback ──────────────────────────────────────────────────────────────────
let currentAudio = null;

// ── DOM References ────────────────────────────────────────────────────────────
const micBtn          = document.getElementById("micBtn");
const inlineMicBtn    = document.getElementById("inlineMicBtn");
const sendBtn         = document.getElementById("sendBtn");
const textInput       = document.getElementById("textInput");
const chatMessages    = document.getElementById("chatMessages");
const resetBtn        = document.getElementById("resetBtn");
const clearBtn        = document.getElementById("clearBtn");
const statusDot       = document.getElementById("statusDot");
const statusText      = document.getElementById("statusText");
const avatarContainer = document.getElementById("avatarContainer");
const interruptBanner = document.getElementById("interruptBanner");
const charCount       = document.getElementById("charCount");
const inputMode       = document.getElementById("inputMode");
const voiceToggleBtn  = document.getElementById("voiceToggleBtn");

// ── Initialisation ────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  _renderWelcomeMessage();
  _checkBackendHealth();
  setInterval(_checkBackendHealth, CONFIG.HEALTH_CHECK_INTERVAL);
  _setupEventListeners();
  _setState(State.IDLE);
});

// ── Event Listeners ───────────────────────────────────────────────────────────
function _setupEventListeners() {
  // Big mic button — toggle hands-free voice mode
  micBtn.addEventListener("click", (e) => {
    _createRipple(e, micBtn);
    if (currentState === State.SPEAKING) {
      _interruptSpeaking();
    } else if (voiceModeActive) {
      _stopVoiceMode();
    } else {
      _startVoiceMode();
    }
  });

  // Inline mic button (bottom bar)
  inlineMicBtn.addEventListener("click", (e) => {
    _createRipple(e, inlineMicBtn);
    if (currentState === State.SPEAKING) {
      _interruptSpeaking();
    } else if (voiceModeActive) {
      _stopVoiceMode();
    } else {
      _startVoiceMode();
    }
  });

  // Nav voice toggle button
  voiceToggleBtn?.addEventListener("click", () => {
    voiceModeActive ? _stopVoiceMode() : _startVoiceMode();
  });

  // Text send
  sendBtn.addEventListener("click", () => _sendTextMessage());
  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      _sendTextMessage();
    }
  });

  // Auto-resize textarea + char counter
  textInput.addEventListener("input", () => {
    textInput.style.height = "auto";
    textInput.style.height = Math.min(textInput.scrollHeight, 120) + "px";
    charCount.textContent  = `${textInput.value.length} / 2000`;
  });

  resetBtn.addEventListener("click", async () => {
    if (voiceModeActive) _stopVoiceMode();
    await _resetSession();
  });

  clearBtn.addEventListener("click", () => {
    chatMessages.innerHTML = "";
    _renderWelcomeMessage();
    _showToast("Chat cleared", "info");
  });
}

// ── Voice Mode (hands-free loop) ──────────────────────────────────────────────
async function _startVoiceMode() {
  if (voiceModeActive) return;

  if (!backendOnline) {
    _showToast("Backend is offline. Please start the server first.", "error");
    return;
  }

  voiceModeActive = true;
  _updateVoiceToggleUI(true);
  _showToast("Voice mode ON — speak naturally!", "info");
  await _startListening();
}

function _stopVoiceMode() {
  voiceModeActive = false;
  _updateVoiceToggleUI(false);
  _stopRecording(true);
  _stopCurrentAudio();
  _setState(State.IDLE);
  _showToast("Voice mode OFF", "info");
}

function _updateVoiceToggleUI(active) {
  if (!voiceToggleBtn) return;
  voiceToggleBtn.textContent = active ? "⏹ Stop Voice" : "🎤 Start Voice";
  voiceToggleBtn.classList.toggle("active", active);
}

// ── Listening ─────────────────────────────────────────────────────────────────
async function _startListening() {
  if (!voiceModeActive || currentState !== State.IDLE) return;

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    _showToast("Microphone access denied. Please allow microphone access.", "error");
    _stopVoiceMode();
    return;
  }

  audioChunks    = [];
  speechDetected = false;
  vadReady       = false;

  const mimeType  = _getSupportedMimeType();
  mediaRecorder   = new MediaRecorder(micStream, { mimeType });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    _cleanupMicStream();
    if (voiceModeActive && speechDetected && audioChunks.length > 0) {
      await _processVoiceInput();
    } else if (voiceModeActive) {
      // No speech detected — restart listening loop
      _setState(State.IDLE);
      setTimeout(_startListening, 200);
    }
  };

  mediaRecorder.start(100);
  _setState(State.LISTENING);

  // VAD warm-up: wait briefly before enabling silence detection
  setTimeout(() => { vadReady = true; }, CONFIG.SPEECH_START_DELAY_MS);

  _setupVAD();

  // Safety cap — stop recording after MAX_RECORDING_MS
  recordingTimer = setTimeout(() => {
    if (currentState === State.LISTENING) _stopRecording();
  }, CONFIG.MAX_RECORDING_MS);
}

function _stopRecording(discard = false) {
  clearTimeout(recordingTimer);
  clearTimeout(silenceTimer);
  silenceTimer = null;
  if (discard) speechDetected = false;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

function _cleanupMicStream() {
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
  audioContext?.close().catch(() => {});
  audioContext = null;
  analyser     = null;
  vadActive    = false;
  vadReady     = false;
}

// ── Voice Activity Detection ──────────────────────────────────────────────────
function _setupVAD() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser     = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    audioContext.createMediaStreamSource(micStream).connect(analyser);
    vadActive = true;
    _detectVoiceActivity();
  } catch (e) {
    console.warn("VAD setup failed:", e);
  }
}

function _detectVoiceActivity() {
  if (!vadActive || !analyser) return;

  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const rms        = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
  const isSpeaking = rms > CONFIG.VAD_THRESHOLD;

  if (isSpeaking) {
    speechDetected = true;
    clearTimeout(silenceTimer);
    silenceTimer = null;
  } else if (vadReady && speechDetected && !silenceTimer) {
    // Silence after speech → auto-submit
    silenceTimer = setTimeout(() => {
      if (currentState === State.LISTENING) _stopRecording();
    }, CONFIG.SILENCE_TIMEOUT_MS);
  }

  if (vadActive) requestAnimationFrame(_detectVoiceActivity);
}

// ── Process Voice Input ───────────────────────────────────────────────────────
async function _processVoiceInput() {
  _setState(State.THINKING);

  const mimeType  = _getSupportedMimeType();
  const ext       = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
  const audioBlob = new Blob(audioChunks, { type: mimeType });

  if (audioBlob.size < CONFIG.MIN_AUDIO_BYTES) {
    _setState(State.IDLE);
    if (voiceModeActive) setTimeout(_startListening, 200);
    return;
  }

  const formData = new FormData();
  formData.append("audio",      audioBlob, `recording.${ext}`);
  formData.append("session_id", sessionId);

  const thinkingId = _addThinkingBubble();

  try {
    const response = await fetch(`${CONFIG.API_BASE}/chat`, {
      method: "POST",
      body:   formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error(err.detail || `HTTP ${response.status}`);
    }

    const transcript = _safeDecodeHeader(response.headers.get("X-Transcript"));
    const answer     = _safeDecodeHeader(response.headers.get("X-Answer"));
    const lang       = response.headers.get("X-Language") || "en";

    _removeThinkingBubble(thinkingId);
    if (transcript) _addMessage("user",      transcript, "voice", lang);
    if (answer)     _addMessage("assistant", answer,     "voice", lang);

    const audioBlob2 = await response.blob();
    await _playAudioResponse(audioBlob2);

  } catch (err) {
    _removeThinkingBubble(thinkingId);
    console.error("Voice chat error:", err);
    _showToast(`Error: ${err.message}`, "error");
    _setState(State.IDLE);
    if (voiceModeActive) setTimeout(_startListening, 1000);
  }
}

// ── Text Chat ─────────────────────────────────────────────────────────────────
async function _sendTextMessage() {
  const message = textInput.value.trim();
  if (!message || currentState === State.THINKING) return;

  if (!backendOnline) {
    _showToast("Backend is offline. Please start the server first.", "error");
    return;
  }

  if (voiceModeActive) _stopVoiceMode();

  textInput.value        = "";
  textInput.style.height = "auto";
  charCount.textContent  = "0 / 2000";

  _addMessage("user", message, "text");
  _setState(State.THINKING);

  const thinkingId = _addThinkingBubble();

  try {
    const response = await fetch(`${CONFIG.API_BASE}/text-chat`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        session_id:   sessionId,
        message,
        return_audio: true,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error(err.detail || `HTTP ${response.status}`);
    }

    const data = await response.json();
    _removeThinkingBubble(thinkingId);
    _addMessage("assistant", data.response, "text", data.language || "en");

    if (data.audio_url) {
      await _playAudioFromUrl(`${CONFIG.API_BASE}${data.audio_url}`);
    } else {
      _setState(State.IDLE);
    }

  } catch (err) {
    _removeThinkingBubble(thinkingId);
    console.error("Text chat error:", err);
    _showToast(`Error: ${err.message}`, "error");
    _setState(State.IDLE);
  }
}

// ── Audio Playback ────────────────────────────────────────────────────────────
async function _playAudioResponse(blob) {
  const url = URL.createObjectURL(blob);
  await _playAudioFromUrl(url, true);
}

async function _playAudioFromUrl(url, isObjectUrl = false) {
  _setState(State.SPEAKING);

  currentAudio         = new Audio(url);
  currentAudio.preload = "auto";

  currentAudio.onended = () => {
    if (isObjectUrl) URL.revokeObjectURL(url);
    currentAudio = null;
    _setState(State.IDLE);
    if (voiceModeActive) setTimeout(_startListening, 400);
  };

  currentAudio.onerror = () => {
    if (isObjectUrl) URL.revokeObjectURL(url);
    currentAudio = null;
    _setState(State.IDLE);
    if (voiceModeActive) setTimeout(_startListening, 400);
  };

  try {
    await currentAudio.play();
  } catch (e) {
    console.warn("Autoplay blocked:", e);
    _showToast("Tap anywhere to enable audio, then speak again.", "info");
    _setState(State.IDLE);
    document.addEventListener(
      "click",
      async () => { if (currentAudio) { try { await currentAudio.play(); } catch {} } },
      { once: true },
    );
  }
}

function _stopCurrentAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio     = null;
  }
}

function _interruptSpeaking() {
  _stopCurrentAudio();
  _setState(State.IDLE);
  _showToast("Interrupted — go ahead!", "info");
  if (voiceModeActive) setTimeout(_startListening, 300);
}

// ── State Management ──────────────────────────────────────────────────────────
function _setState(newState) {
  currentState = newState;

  document
    .querySelectorAll(".state-idle,.state-listening,.state-thinking,.state-speaking")
    .forEach((el) => el.classList.remove("active"));

  avatarContainer.classList.remove("listening", "speaking", "thinking");
  micBtn.classList.remove("recording", "disabled");
  inlineMicBtn.classList.remove("recording");
  interruptBanner.classList.remove("visible");

  const hint = document.getElementById("micHint");

  switch (newState) {
    case State.IDLE:
      document.getElementById("stateIdle").classList.add("active");
      micBtn.title = voiceModeActive ? "Voice mode ON — speak!" : "Click to start voice mode";
      if (hint) hint.textContent = voiceModeActive ? "Waiting to listen..." : "Click to start voice mode";
      inputMode.textContent = voiceModeActive ? "Voice Mode" : "Text Mode";
      sendBtn.disabled      = false;
      break;

    case State.LISTENING:
      document.getElementById("stateListening").classList.add("active");
      avatarContainer.classList.add("listening");
      micBtn.classList.add("recording");
      inlineMicBtn.classList.add("recording");
      micBtn.title = "Listening... click to stop";
      if (hint) hint.textContent = "Listening... speak now";
      inputMode.textContent = "Voice Mode";
      sendBtn.disabled      = true;
      break;

    case State.THINKING:
      document.getElementById("stateThinking").classList.add("active");
      avatarContainer.classList.add("thinking");
      micBtn.classList.add("disabled");
      sendBtn.disabled = true;
      break;

    case State.SPEAKING:
      document.getElementById("stateSpeaking").classList.add("active");
      avatarContainer.classList.add("speaking");
      interruptBanner.classList.add("visible");
      micBtn.title = "Click to interrupt";
      if (hint) hint.textContent = "Click to interrupt";
      sendBtn.disabled = true;
      break;
  }
}

// ── Chat UI ───────────────────────────────────────────────────────────────────
const LANG_FLAGS = {
  en: "🇬🇧",
  te: "🇮🇳 తె",
  hi: "🇮🇳 हि",
  ta: "🇮🇳 த",
};

function _addMessage(role, content, inputType = "text", lang = "en") {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;

  const avatar       = document.createElement("div");
  avatar.className   = "msg-avatar";
  avatar.textContent = role === "user" ? "You" : "D";

  const msgContent = document.createElement("div");
  msgContent.className = "msg-content";

  const bubble       = document.createElement("div");
  bubble.className   = "msg-bubble";
  bubble.textContent = content;

  const meta     = document.createElement("div");
  meta.className = "msg-meta";
  const now      = new Date();
  const langBadge = lang !== "en" ? ` · ${LANG_FLAGS[lang] || lang}` : "";
  const modeBadge = inputType === "voice" ? " · 🎤" : "";
  meta.textContent = `${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${modeBadge}${langBadge}`;

  msgContent.appendChild(bubble);
  msgContent.appendChild(meta);
  msg.appendChild(avatar);
  msg.appendChild(msgContent);
  chatMessages.appendChild(msg);
  _scrollToBottom();
  return msg;
}

function _addThinkingBubble() {
  const id  = "thinking-" + Date.now();
  const msg = document.createElement("div");
  msg.className = "message assistant typing-indicator";
  msg.id        = id;

  const avatar       = document.createElement("div");
  avatar.className   = "msg-avatar";
  avatar.textContent = "D";

  const msgContent = document.createElement("div");
  msgContent.className = "msg-content";

  const bubble     = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';

  msgContent.appendChild(bubble);
  msg.appendChild(avatar);
  msg.appendChild(msgContent);
  chatMessages.appendChild(msg);
  _scrollToBottom();
  return id;
}

function _removeThinkingBubble(id) {
  document.getElementById(id)?.remove();
}

function _renderWelcomeMessage() {
  const welcome     = document.createElement("div");
  welcome.className = "welcome-msg";
  welcome.innerHTML = `
    <div class="welcome-icon">🎓</div>
    <h3>Hello! I'm Doneswari</h3>
    <p>Your AI Educational Counselor — available in English, Telugu (తెలుగు), Hindi (हिंदी) &amp; Tamil (தமிழ்).</p>
    <p style="margin-top:0.5rem">Click <strong>🎤 Start Voice</strong> for hands-free conversation, or type below.</p>
    <p style="margin-top:0.4rem; font-size:0.78rem; color:var(--text-muted)">I'll automatically detect your language and reply in the same language.</p>
  `;
  chatMessages.appendChild(welcome);
}

function _scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ── Session Management ────────────────────────────────────────────────────────
async function _resetSession() {
  try {
    await fetch(`${CONFIG.API_BASE}/reset-session/${sessionId}`, { method: "POST" });
    chatMessages.innerHTML = "";
    _renderWelcomeMessage();
    _showToast("Session reset — fresh start!", "success");
  } catch {
    _showToast("Could not reset session", "error");
  }
}

// ── Backend Health Check ──────────────────────────────────────────────────────
async function _checkBackendHealth() {
  try {
    const res = await fetch(`${CONFIG.API_BASE}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const data  = await res.json();
      backendOnline = true;

      if (!data.groq_configured) {
        _setConnectionStatus(false, "API Key Missing");
      } else {
        _setConnectionStatus(true, "Online");
      }

      // Remove offline banner if it exists
      document.getElementById("offlineBanner")?.remove();
    } else {
      _handleBackendOffline();
    }
  } catch {
    _handleBackendOffline();
  }
}

function _handleBackendOffline() {
  backendOnline = false;
  _setConnectionStatus(false, "Offline");

  // Show a persistent banner if not already shown
  if (!document.getElementById("offlineBanner")) {
    const banner     = document.createElement("div");
    banner.id        = "offlineBanner";
    banner.className = "offline-banner";
    banner.innerHTML = `
      <span>⚠️ Backend is offline.</span>
      <span>Start the server: <code>cd backend &amp;&amp; python -m uvicorn app:app --reload --port 8000</code></span>
    `;
    document.querySelector(".chat-panel")?.prepend(banner);
  }
}

function _setConnectionStatus(online, label) {
  statusDot.className  = "status-dot " + (online ? "online" : "offline");
  statusText.textContent = label;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function _generateSessionId() {
  return "sess_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();
}

function _getSupportedMimeType() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "audio/webm";
}

function _safeDecodeHeader(val) {
  if (!val) return "";
  try { return decodeURIComponent(val); } catch { return val; }
}

function _showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast     = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = "toast-out 0.3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function _createRipple(event, button) {
  const ripple  = document.createElement("span");
  ripple.className = "ripple";
  const rect    = button.getBoundingClientRect();
  const size    = Math.max(rect.width, rect.height);
  ripple.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - rect.left - size / 2}px;top:${event.clientY - rect.top - size / 2}px;`;
  button.style.position = "relative";
  button.style.overflow = "hidden";
  button.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
}
