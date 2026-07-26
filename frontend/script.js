/**
 * Doneswari AI Telecaller — Frontend Script
 *
 * Fully automatic voice conversation pipeline:
 *   Listening → (VAD silence detection) → Thinking → Speaking → Listening
 *
 * Backend: proxied via Vite /api/* → http://localhost:8000
 * Frontend: http://localhost:5175
 */

// ── Configuration ─────────────────────────────────────────────────────────────
const CONFIG = {
  // Use relative path so Vite proxy handles /api/* → backend
  API_BASE:              "/api",
  STATIC_BASE:           "/static",
  SILENCE_TIMEOUT_MS:    1200,    // 1.2 s silence → auto-submit
  SPEECH_START_DELAY_MS: 300,     // VAD warm-up guard
  MAX_RECORDING_MS:      30_000,  // safety cap per recording
  HEALTH_CHECK_INTERVAL: 10_000,  // poll backend every 10 s
  MIN_AUDIO_BYTES:       500,     // ignore recordings smaller than this
  VAD_THRESHOLD:         10,      // RMS threshold for speech detection
  RECONNECT_DELAY_MS:    1000,    // delay before re-listening after error
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
let isRecording    = false;

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
  console.log("🔧 Doneswari AI Telecaller frontend initialized");
  console.log(`🔧 API_BASE: ${CONFIG.API_BASE}, Session: ${sessionId}`);
});

// ── Event Listeners ───────────────────────────────────────────────────────────
function _setupEventListeners() {
  micBtn.addEventListener("click", (e) => {
    _createRipple(e, micBtn);
    _handleMicToggle();
  });

  inlineMicBtn.addEventListener("click", (e) => {
    _createRipple(e, inlineMicBtn);
    _handleMicToggle();
  });

  voiceToggleBtn?.addEventListener("click", _handleMicToggle);

  sendBtn.addEventListener("click", () => _sendTextMessage());
  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      _sendTextMessage();
    }
  });

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

// ── Mic Toggle Logic ──────────────────────────────────────────────────────────
function _handleMicToggle() {
  if (!backendOnline) {
    _showToast("⚠️ Backend is offline. Please start the server first.", "error");
    return;
  }

  if (currentState === State.SPEAKING) {
    _interruptSpeaking();
    return;
  }

  if (voiceModeActive) {
    _stopVoiceMode();
  } else {
    _startVoiceMode();
  }
}

// ── Voice Mode (hands-free loop) ──────────────────────────────────────────────
async function _startVoiceMode() {
  if (voiceModeActive) return;
  console.log("🎤 Starting voice mode...");
  voiceModeActive = true;
  _updateVoiceToggleUI(true);
  _showToast("🎤 Voice mode ON — speak naturally!", "info");
  await _startListening();
}

function _stopVoiceMode() {
  console.log("⏹ Stopping voice mode");
  voiceModeActive = false;
  _updateVoiceToggleUI(false);
  _stopRecordingCleanup();
  _stopCurrentAudio();
  _setState(State.IDLE);
  _showToast("⏹ Voice mode OFF", "info");
}

function _updateVoiceToggleUI(active) {
  if (!voiceToggleBtn) return;
  voiceToggleBtn.textContent = active ? "⏹ Stop" : "🎤 Start Voice";
  voiceToggleBtn.classList.toggle("active", active);
}

// ── Listening ─────────────────────────────────────────────────────────────────
async function _startListening() {
  if (!voiceModeActive || currentState !== State.IDLE) return;
  console.log("🎧 Starting listening...");

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (err) {
    console.error("❌ Microphone error:", err);
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      _showToast("❌ Microphone access denied. Please allow microphone permission in browser settings.", "error");
    } else if (err.name === "NotFoundError") {
      _showToast("❌ No microphone found. Please connect a microphone.", "error");
    } else {
      _showToast(`❌ Microphone error: ${err.message}`, "error");
    }
    _stopVoiceMode();
    return;
  }

  audioChunks    = [];
  speechDetected = false;
  vadReady       = false;
  isRecording    = false;

  const mimeType  = _getSupportedMimeType();
  console.log(`🎧 Using MIME type: ${mimeType}`);

  try {
    mediaRecorder = new MediaRecorder(micStream, { mimeType });
  } catch (e) {
    console.warn(`⚠️ MIME type ${mimeType} not supported, trying fallback`);
    mediaRecorder = new MediaRecorder(micStream);
  }

  const actualMimeType = mediaRecorder.mimeType || mimeType;

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    console.log(`⏹ Recording stopped. Chunks: ${audioChunks.length}, Speech detected: ${speechDetected}`);
    const chunks = audioChunks.slice();
    audioChunks = [];
    _cleanupMicStream();

    if (voiceModeActive && speechDetected && chunks.length > 0) {
      await _processVoiceInput(chunks, actualMimeType);
    } else if (voiceModeActive) {
      console.log("🔁 No speech detected, restarting listening");
      _setState(State.IDLE);
      setTimeout(() => { if (voiceModeActive) _startListening(); }, 200);
    }
  };

  mediaRecorder.onerror = (event) => {
    console.error("❌ MediaRecorder error:", event.error);
    _showToast("❌ Recording error, please try again", "error");
    _cleanupMicStream();
    if (voiceModeActive) {
      _setState(State.IDLE);
      setTimeout(() => { if (voiceModeActive) _startListening(); }, CONFIG.RECONNECT_DELAY_MS);
    }
  };

  mediaRecorder.start(100);
  isRecording = true;
  _setState(State.LISTENING);

  setTimeout(() => { vadReady = true; }, CONFIG.SPEECH_START_DELAY_MS);
  _setupVAD();

  recordingTimer = setTimeout(() => {
    if (isRecording && currentState === State.LISTENING) {
      console.log("⏰ Recording timeout reached, stopping");
      _stopRecording();
    }
  }, CONFIG.MAX_RECORDING_MS);
}

function _stopRecording(discard = false) {
  clearTimeout(recordingTimer);
  clearTimeout(silenceTimer);
  silenceTimer = null;
  if (discard) speechDetected = false;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try { mediaRecorder.stop(); } catch (e) { console.warn("MediaRecorder stop error:", e); }
  }
  isRecording = false;
}

function _stopRecordingCleanup() {
  clearTimeout(recordingTimer);
  clearTimeout(silenceTimer);
  silenceTimer = null;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try { mediaRecorder.stop(); } catch (e) {}
  }
  isRecording = false;
  _cleanupMicStream();
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
    silenceTimer = setTimeout(() => {
      if (isRecording && currentState === State.LISTENING) {
        console.log("🔇 Silence detected, stopping recording");
        _stopRecording();
      }
    }, CONFIG.SILENCE_TIMEOUT_MS);
  }

  if (vadActive) requestAnimationFrame(_detectVoiceActivity);
}

// ── Process Voice Input ───────────────────────────────────────────────────────
async function _processVoiceInput(chunks, mimeType) {
  _setState(State.THINKING);
  console.log("🤔 Processing voice input...");

  const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
  const audioBlob = new Blob(chunks, { type: mimeType });

  if (audioBlob.size < CONFIG.MIN_AUDIO_BYTES) {
    console.log("🔇 Audio too small, skipping");
    _setState(State.IDLE);
    if (voiceModeActive) setTimeout(() => { if (voiceModeActive) _startListening(); }, 200);
    return;
  }

  console.log(`📤 Sending audio (${(audioBlob.size / 1024).toFixed(1)} KB, type: ${mimeType})`);

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
      let errMsg = `HTTP ${response.status}`;
      try {
        const err = await response.json();
        errMsg = err.detail || errMsg;
      } catch (e) {}
      throw new Error(errMsg);
    }

    const transcript = _safeDecodeHeader(response.headers.get("X-Transcript"));
    const answer     = _safeDecodeHeader(response.headers.get("X-Answer"));
    const lang       = response.headers.get("X-Language") || "en";

    _removeThinkingBubble(thinkingId);

    if (transcript) _addMessage("user",      transcript, "voice", lang);
    if (answer)     _addMessage("assistant", answer,     "voice", lang);

    console.log(`✅ Response received: "${answer?.slice(0, 60)}..."`);

    const audioBlob2 = await response.blob();
    await _playAudioResponse(audioBlob2);

  } catch (err) {
    _removeThinkingBubble(thinkingId);
    console.error("❌ Voice chat error:", err);
    let friendlyMsg = "Something went wrong. Please try again.";
    if (err.message.includes("Failed to fetch") || err.message.includes("TypeError")) {
      friendlyMsg = "Could not connect to the backend server. Please ensure it's running.";
    } else if (err.message) {
      friendlyMsg = err.message;
    }
    _showToast(`❌ ${friendlyMsg}`, "error");
    _setState(State.IDLE);
    if (voiceModeActive) setTimeout(() => { if (voiceModeActive) _startListening(); }, CONFIG.RECONNECT_DELAY_MS);
  }
}

// ── Text Chat ─────────────────────────────────────────────────────────────────
async function _sendTextMessage() {
  const message = textInput.value.trim();
  if (!message || currentState === State.THINKING) return;

  if (!backendOnline) {
    _showToast("⚠️ Backend is offline. Please start the server first.", "error");
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
      let errMsg = `HTTP ${response.status}`;
      try {
        const err = await response.json();
        errMsg = err.detail || errMsg;
      } catch (e) {}
      throw new Error(errMsg);
    }

    const data = await response.json();
    _removeThinkingBubble(thinkingId);

    const fullResponse = data.response;
    _addMessage("assistant", fullResponse, "text", data.language || "en");

    if (data.audio_url) {
      await _playAudioFromUrl(`${CONFIG.API_BASE}${data.audio_url}`);
    } else {
      _setState(State.IDLE);
    }

  } catch (err) {
    _removeThinkingBubble(thinkingId);
    console.error("❌ Text chat error:", err);
    let friendlyMsg = "Something went wrong. Please try again.";
    if (err.message.includes("Failed to fetch") || err.message.includes("TypeError")) {
      friendlyMsg = "Could not connect to the backend server.";
    } else if (err.message) {
      friendlyMsg = err.message;
    }
    _showToast(`❌ ${friendlyMsg}`, "error");
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
  console.log("🔊 Playing audio response...");

  currentAudio         = new Audio(url);
  currentAudio.preload = "auto";

  currentAudio.onended = () => {
    console.log("✅ Audio playback finished");
    if (isObjectUrl) URL.revokeObjectURL(url);
    currentAudio = null;
    _setState(State.IDLE);
    // Auto-return to listening mode
    if (voiceModeActive) {
      setTimeout(() => {
        if (voiceModeActive) _startListening();
      }, 400);
    }
  };

  currentAudio.onerror = (e) => {
    console.error("❌ Audio playback error:", e);
    if (isObjectUrl) URL.revokeObjectURL(url);
    currentAudio = null;
    _setState(State.IDLE);
    if (voiceModeActive) {
      setTimeout(() => {
        if (voiceModeActive) _startListening();
      }, 400);
    }
  };

  try {
    await currentAudio.play();
  } catch (e) {
    console.warn("⚠️ Autoplay blocked:", e);
    _showToast("Tap anywhere to enable audio, then speak again.", "info");
    _setState(State.IDLE);
    const resumeHandler = async () => {
      if (currentAudio) {
        try { await currentAudio.play(); } catch (err) {}
      }
      document.removeEventListener("click", resumeHandler);
    };
    document.addEventListener("click", resumeHandler, { once: true });
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
  if (voiceModeActive) {
    setTimeout(() => {
      if (voiceModeActive) _startListening();
    }, 300);
  }
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
      micBtn.disabled       = false;
      break;

    case State.LISTENING:
      document.getElementById("stateListening").classList.add("active");
      avatarContainer.classList.add("listening");
      micBtn.classList.add("recording");
      inlineMicBtn.classList.add("recording");
      micBtn.title = "Listening...";
      micBtn.disabled = false;
      if (hint) hint.textContent = "Listening... speak now";
      inputMode.textContent = "Voice Mode";
      sendBtn.disabled      = true;
      break;

    case State.THINKING:
      document.getElementById("stateThinking").classList.add("active");
      avatarContainer.classList.add("thinking");
      micBtn.classList.add("disabled");
      micBtn.disabled = true;
      sendBtn.disabled = true;
      if (hint) hint.textContent = "Thinking...";
      break;

    case State.SPEAKING:
      document.getElementById("stateSpeaking").classList.add("active");
      avatarContainer.classList.add("speaking");
      interruptBanner.classList.add("visible");
      micBtn.classList.add("disabled");
      micBtn.disabled = true;
      if (hint) hint.textContent = "Speaking... click to interrupt";
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
    <h3>Hello! I'm Shruthi</h3>
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
    const response = await fetch(`${CONFIG.API_BASE}/reset-session/${sessionId}`, { method: "POST" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    chatMessages.innerHTML = "";
    sessionId = _generateSessionId();
    _renderWelcomeMessage();
    _showToast("Session reset — fresh start!", "success");
  } catch (err) {
    console.error("Reset session error:", err);
    // Still reset locally even if backend fails
    sessionId = _generateSessionId();
    chatMessages.innerHTML = "";
    _renderWelcomeMessage();
    _showToast("Session reset locally", "info");
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

      document.getElementById("offlineBanner")?.remove();
    } else {
      _handleBackendOffline();
    }
  } catch (err) {
    console.warn("Health check failed:", err.message);
    _handleBackendOffline();
  }
}

function _handleBackendOffline() {
  backendOnline = false;
  _setConnectionStatus(false, "Offline");

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
  if (!container) return;
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
