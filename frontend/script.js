/**
 * Doneswari AI Telecaller — Frontend Script
 *
 * REAL-TIME INTERRUPTIBLE VOICE CONVERSATION (BARGE-IN)
 * =====================================================
 * Features:
 * - Persistent microphone for continuous VAD monitoring
 * - Barge-in: user can interrupt AI speaking by just speaking
 * - Single active state: Listening → Thinking → Speaking → Listening
 * - Request ID tracking to cancel stale responses
 * - Like ChatGPT Voice Mode / Gemini Live
 *
 * Architecture:
 *   When voice mode starts → acquire mic (persistent for VAD)
 *     Listening:   MediaRecorder records chunks, VAD detects silence → submit
 *     Thinking:    Audio sent to backend, waiting for response
 *     Speaking:    Audio plays, VAD monitors for user speech → barge-in
 *     Barge-in:    Stop audio, cancel request, restart listening
 *
 * Backend: proxied via Vite /api/* → http://localhost:8000
 * Frontend: http://localhost:5175
 */

// ── Configuration ─────────────────────────────────────────────────────────────
const CONFIG = {
  API_BASE:              "/api",
  STATIC_BASE:           "/static",
  SILENCE_TIMEOUT_MS:    1200,    // 1.2 s silence → auto-submit
  SPEECH_START_DELAY_MS: 300,     // VAD warm-up guard
  MAX_RECORDING_MS:      30_000,  // safety cap per recording
  HEALTH_CHECK_INTERVAL: 10_000,  // poll backend every 10 s
  MIN_AUDIO_BYTES:       500,     // ignore recordings smaller than this
  VAD_THRESHOLD:         10,      // RMS threshold for speech detection (listening)
  VAD_BARGE_THRESHOLD:   12,      // RMS threshold for barge-in during playback
  RECONNECT_DELAY_MS:    1000,    // delay before re-listening after error
};

// ── State Machine ─────────────────────────────────────────────────────────────
const State = { IDLE: "idle", LISTENING: "listening", THINKING: "thinking", SPEAKING: "speaking" };
let currentState    = State.IDLE;
let voiceModeActive = false;
let backendOnline   = false;
let sessionId       = _generateSessionId();

// ── Request Tracking (for barge-in stale-response cancellation) ─────────────
let requestCounter   = 0;
let currentRequestId = 0;
let abortController  = null;

// ─── PERSISTENT MIC STREAM (for continuous VAD across all states) ──────────
// Acquired once when voice mode starts, released when voice mode stops.
let persistentStream = null;
let persistentAudioCtx = null;
let persistentAnalyser = null;
let persistentVadActive = false;
let persistentVadRafId = null;

// ── Recording (uses persistent mic stream) ──────────────────────────────────
let mediaRecorder = null;
let audioChunks   = [];
let recordingTimer = null;
let silenceTimer   = null;
let speechDetected = false;
let vadReady       = false;
let isRecording    = false;
// Track if current VAD data is during "listening" mode vs "speaking" mode
let vadMode = "listening"; // "listening" | "speaking"

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
  console.log("🔧 Doneswari AI Telecaller — Interruptible Voice Mode");
  console.log(`🔧 API_BASE: ${CONFIG.API_BASE}, Session: ${sessionId}`);
});

// ── Event Listeners ───────────────────────────────────────────────────────────
function _setupEventListeners() {
  micBtn.addEventListener("click", (e) => { _createRipple(e, micBtn); _handleMicToggle(); });
  inlineMicBtn.addEventListener("click", (e) => { _createRipple(e, inlineMicBtn); _handleMicToggle(); });
  voiceToggleBtn?.addEventListener("click", _handleMicToggle);
  sendBtn.addEventListener("click", () => _sendTextMessage());
  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); _sendTextMessage(); }
  });
  textInput.addEventListener("input", () => {
    textInput.style.height = "auto";
    textInput.style.height = Math.min(textInput.scrollHeight, 120) + "px";
    charCount.textContent = `${textInput.value.length} / 2000`;
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
  if (currentState === State.SPEAKING) { _bargeIn(); return; }
  if (voiceModeActive) { _stopVoiceMode(); }
  else { _startVoiceMode(); }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PERSISTENT MICROPHONE (acquired once, stays alive for continuous VAD)
// ═══════════════════════════════════════════════════════════════════════════

async function _acquirePersistentMic() {
  if (persistentStream) return true; // Already acquired
  try {
    persistentStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    // Set up persistent audio context & analyser for continuous VAD
    persistentAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    persistentAnalyser = persistentAudioCtx.createAnalyser();
    persistentAnalyser.fftSize = 512;
    persistentAnalyser.smoothingTimeConstant = 0.7;
    persistentAudioCtx.createMediaStreamSource(persistentStream).connect(persistentAnalyser);
    persistentVadActive = true;
    _startPersistentVAD();
    console.log("🎤 Persistent mic acquired for continuous VAD");
    return true;
  } catch (err) {
    console.error("❌ Microphone error:", err);
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      _showToast("❌ Microphone access denied. Please allow microphone permission in browser settings.", "error");
    } else if (err.name === "NotFoundError") {
      _showToast("❌ No microphone found. Please connect a microphone.", "error");
    } else {
      _showToast(`❌ Microphone error: ${err.message}`, "error");
    }
    return false;
  }
}

function _releasePersistentMic() {
  persistentVadActive = false;
  if (persistentVadRafId) { cancelAnimationFrame(persistentVadRafId); persistentVadRafId = null; }
  persistentStream?.getTracks().forEach(t => t.stop());
  persistentStream = null;
  persistentAudioCtx?.close().catch(() => {});
  persistentAudioCtx = null;
  persistentAnalyser = null;
  console.log("🎤 Persistent mic released");
}

function _startPersistentVAD() {
  if (!persistentVadActive || !persistentAnalyser) return;

  const data = new Uint8Array(persistentAnalyser.frequencyBinCount);
  persistentAnalyser.getByteFrequencyData(data);
  const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);

  const nowState = currentState;

  if (nowState === State.SPEAKING) {
    // ── BARGE-IN MODE: if user speaks during AI playback, interrupt ──
    if (rms > CONFIG.VAD_BARGE_THRESHOLD) {
      console.log(`🗣️ BARGE-IN: User speech detected during playback (RMS: ${rms.toFixed(1)})`);
      _bargeIn();
      // VAD will continue after barge-in restarts listening
    }
  } else if (nowState === State.LISTENING && isRecording) {
    // ── SILENCE DETECTION MODE: auto-submit after silence ──
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
  }

  if (persistentVadActive) {
    persistentVadRafId = requestAnimationFrame(_startPersistentVAD);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  VOICE MODE
// ═══════════════════════════════════════════════════════════════════════════

async function _startVoiceMode() {
  if (voiceModeActive) return;
  console.log("🎤 Starting voice mode...");
  voiceModeActive = true;
  _updateVoiceToggleUI(true);

  // Acquire persistent mic (for VAD across all states)
  const micOk = await _acquirePersistentMic();
  if (!micOk) {
    _stopVoiceMode();
    return;
  }

  _showToast("🎤 Voice mode ON — speak naturally!", "info");
  await _startListening();
}

function _stopVoiceMode() {
  console.log("⏹ Stopping voice mode");
  voiceModeActive = false;
  _updateVoiceToggleUI(false);
  _stopRecordingCleanup();
  _stopCurrentAudio();
  _cancelPendingRequest();
  _releasePersistentMic();
  _setState(State.IDLE);
  document.querySelectorAll('[id^="thinking-"]').forEach(el => el.remove());
  _showToast("⏹ Voice mode OFF", "info");
}

function _updateVoiceToggleUI(active) {
  if (!voiceToggleBtn) return;
  voiceToggleBtn.textContent = active ? "⏹ Stop" : "🎤 Start Voice";
  voiceToggleBtn.classList.toggle("active", active);
}

// ═══════════════════════════════════════════════════════════════════════════
//  LISTENING (MediaRecorder using persistent mic)
// ═══════════════════════════════════════════════════════════════════════════

async function _startListening() {
  if (!voiceModeActive || currentState !== State.IDLE) return;
  if (!persistentStream) {
    console.warn("No persistent mic stream — reacquiring");
    const ok = await _acquirePersistentMic();
    if (!ok) return;
  }
  console.log("🎧 Starting listening...");

  audioChunks    = [];
  speechDetected = false;
  vadReady       = false;
  isRecording    = false;
  vadMode        = "listening";

  const mimeType = _getSupportedMimeType();
  try {
    mediaRecorder = new MediaRecorder(persistentStream, { mimeType });
  } catch (e) {
    console.warn(`⚠️ MIME type ${mimeType} not supported, trying fallback`);
    mediaRecorder = new MediaRecorder(persistentStream);
  }
  const actualMimeType = mediaRecorder.mimeType || mimeType;

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    console.log(`⏹ Recording stopped. Chunks: ${audioChunks.length}, Speech: ${speechDetected}`);
    const chunks = audioChunks.slice();
    audioChunks = [];
    // Do NOT release persistent mic — keep it alive for VAD
    // Do NOT call _cleanupMicStream() — that's for non-persistent mode

    if (!voiceModeActive) return; // Voice mode turned off

    if (speechDetected && chunks.length > 0) {
      await _processVoiceInput(chunks, actualMimeType);
    } else {
      console.log("🔁 No speech detected, restarting listening");
      _setState(State.IDLE);
      if (voiceModeActive) {
        setTimeout(() => { if (voiceModeActive && currentState === State.IDLE) _startListening(); }, 200);
      }
    }
  };

  mediaRecorder.onerror = (event) => {
    console.error("❌ MediaRecorder error:", event.error);
    _showToast("❌ Recording error, please try again", "error");
    if (voiceModeActive) {
      _setState(State.IDLE);
      setTimeout(() => { if (voiceModeActive) _startListening(); }, CONFIG.RECONNECT_DELAY_MS);
    }
  };

  mediaRecorder.start(100);
  isRecording = true;
  _setState(State.LISTENING);

  setTimeout(() => { vadReady = true; }, CONFIG.SPEECH_START_DELAY_MS);

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
    const r = mediaRecorder;
    mediaRecorder = null;
    try { r.stop(); } catch (e) { console.warn("MediaRecorder stop error:", e); }
  }
  isRecording = false;
}

function _stopRecordingCleanup() {
  clearTimeout(recordingTimer);
  clearTimeout(silenceTimer);
  silenceTimer = null;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    const r = mediaRecorder;
    mediaRecorder = null;
    try { r.stop(); } catch (e) {}
  }
  isRecording = false;
}

// ═══════════════════════════════════════════════════════════════════════════
//  BARGE-IN: Interrupt AI Speaking
// ═══════════════════════════════════════════════════════════════════════════

function _bargeIn() {
  console.log("⏱️ BARGE-IN: Interrupting AI speech");

  // 1. Stop audio playback immediately
  _stopCurrentAudio();

  // 2. Cancel any in-flight fetch request
  _cancelPendingRequest();

  // 3. Clear thinking bubbles / stale UI
  document.querySelectorAll('[id^="thinking-"]').forEach(el => el.remove());

  // 4. Set state to IDLE then start listening
  _setState(State.IDLE);

  // 5. Start listening using the persistent mic (still active)
  if (voiceModeActive) {
    _showToast("🎤 Listening after interruption...", "info");
    // Give a tiny moment for state to settle
    setTimeout(() => {
      if (voiceModeActive && currentState === State.IDLE) _startListening();
    }, 150);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  REQUEST CANCELLATION
// ═══════════════════════════════════════════════════════════════════════════

function _cancelPendingRequest() {
  requestCounter++;
  if (abortController) {
    try { abortController.abort(); } catch (e) { /* ignore */ }
    abortController = null;
  }
  console.log(`🛑 Request cancelled. New active request ID: ${requestCounter}`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  PROCESS VOICE INPUT
// ═══════════════════════════════════════════════════════════════════════════

async function _processVoiceInput(chunks, mimeType) {
  // Create fresh request ID, cancel any pending
  requestCounter++;
  const myRequestId = requestCounter;
  currentRequestId = myRequestId;
  _cancelPendingRequest();
  currentRequestId = myRequestId;

  _setState(State.THINKING);
  console.log(`🤔 [Req #${myRequestId}] Processing voice input...`);

  const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
  const audioBlob = new Blob(chunks, { type: mimeType });

  if (audioBlob.size < CONFIG.MIN_AUDIO_BYTES) {
    console.log(`🔇 [Req #${myRequestId}] Audio too small (${audioBlob.size} bytes), skipping`);
    _setState(State.IDLE);
    if (voiceModeActive) setTimeout(() => { if (voiceModeActive && currentState === State.IDLE) _startListening(); }, 200);
    return;
  }

  console.log(`📤 [Req #${myRequestId}] Sending audio (${(audioBlob.size / 1024).toFixed(1)} KB)`);

  const formData = new FormData();
  formData.append("audio",      audioBlob, `recording.${ext}`);
  formData.append("session_id", sessionId);

  const thinkingId = _addThinkingBubble();

  abortController = new AbortController();
  const signal = abortController.signal;

  try {
    const response = await fetch(`${CONFIG.API_BASE}/chat`, {
      method: "POST", body: formData, signal,
    });

    // Stale check: was this request superseded by a barge-in?
    if (myRequestId !== currentRequestId || !voiceModeActive) {
      console.log(`⏭️ [Req #${myRequestId}] Stale after fetch (current: #${currentRequestId}), ignoring`);
      _removeThinkingBubble(thinkingId);
      return;
    }

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try { const err = await response.json(); errMsg = err.detail || errMsg; } catch (e) {}
      throw new Error(errMsg);
    }

    // Extra stale check after response parsed
    if (myRequestId !== currentRequestId || !voiceModeActive) {
      console.log(`⏭️ [Req #${myRequestId}] Became stale after response headers, ignoring`);
      _removeThinkingBubble(thinkingId);
      return;
    }

    const transcript = _safeDecodeHeader(response.headers.get("X-Transcript"));
    const answer     = _safeDecodeHeader(response.headers.get("X-Answer"));
    const lang       = response.headers.get("X-Language") || "en";

    _removeThinkingBubble(thinkingId);

    if (myRequestId === currentRequestId && voiceModeActive) {
      if (transcript) _addMessage("user",      transcript, "voice", lang);
      if (answer)     _addMessage("assistant", answer,     "voice", lang);
    }

    console.log(`✅ [Req #${myRequestId}] Response: "${answer?.slice(0, 60)}..."`);

    const audioBlob2 = await response.blob();

    // Final stale check before playing
    if (myRequestId !== currentRequestId || !voiceModeActive) {
      console.log(`⏭️ [Req #${myRequestId}] Stale before playback, ignoring`);
      return;
    }

    await _playAudioResponse(audioBlob2, myRequestId);

  } catch (err) {
    _removeThinkingBubble(thinkingId);
    if (err.name === "AbortError") {
      console.log(`⏭️ [Req #${myRequestId}] Request aborted (barge-in)`);
      return;
    }
    console.error(`❌ [Req #${myRequestId}] Error:`, err);
    let msg = "Something went wrong.";
    if (err.message.includes("Failed to fetch") || err.message.includes("TypeError")) {
      msg = "Could not connect to the backend server.";
    } else if (err.message) { msg = err.message; }
    _showToast(`❌ ${msg}`, "error");
    _setState(State.IDLE);
    if (voiceModeActive) setTimeout(() => { if (voiceModeActive && currentState === State.IDLE) _startListening(); }, CONFIG.RECONNECT_DELAY_MS);
  } finally {
    if (abortController && myRequestId === currentRequestId) abortController = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  TEXT CHAT
// ═══════════════════════════════════════════════════════════════════════════

async function _sendTextMessage() {
  const message = textInput.value.trim();
  if (!message || currentState === State.THINKING) return;
  if (!backendOnline) { _showToast("⚠️ Backend offline.", "error"); return; }
  if (voiceModeActive) _stopVoiceMode();

  textInput.value = ""; textInput.style.height = "auto"; charCount.textContent = "0 / 2000";
  _addMessage("user", message, "text");
  _setState(State.THINKING);
  const thinkingId = _addThinkingBubble();

  try {
    const response = await fetch(`${CONFIG.API_BASE}/text-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message, return_audio: true }),
    });
    if (!response.ok) {
      let m = `HTTP ${response.status}`;
      try { const e = await response.json(); m = e.detail || m; } catch (ex) {}
      throw new Error(m);
    }
    const data = await response.json();
    _removeThinkingBubble(thinkingId);
    _addMessage("assistant", data.response, "text", data.language || "en");
    if (data.audio_url) {
      await _playAudioFromUrl(`${CONFIG.API_BASE}${data.audio_url}`, false, 0);
    } else { _setState(State.IDLE); }
  } catch (err) {
    _removeThinkingBubble(thinkingId);
    console.error("❌ Text chat error:", err);
    _showToast(`❌ ${err.message || "Something went wrong."}`, "error");
    _setState(State.IDLE);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUDIO PLAYBACK
// ═══════════════════════════════════════════════════════════════════════════

async function _playAudioResponse(blob, requestId) {
  const url = URL.createObjectURL(blob);
  await _playAudioFromUrl(url, true, requestId);
}

async function _playAudioFromUrl(url, isObjectUrl = false, requestId = 0) {
  if (requestId > 0 && requestId !== currentRequestId) {
    console.log(`⏭️ Audio stale (req #${requestId}), skipping`);
    if (isObjectUrl) URL.revokeObjectURL(url);
    return;
  }

  _setState(State.SPEAKING);
  console.log(`🔊 [Req #${requestId || 'text'}] Playing...`);

  currentAudio = new Audio(url);
  currentAudio.preload = "auto";

  currentAudio.onended = () => {
    if (isObjectUrl) URL.revokeObjectURL(url);
    currentAudio = null;
    console.log("✅ Audio finished");
    _setState(State.IDLE);
    if (voiceModeActive) {
      setTimeout(() => { if (voiceModeActive && currentState === State.IDLE) _startListening(); }, 400);
    }
  };

  currentAudio.onerror = (e) => {
    console.error("❌ Audio error:", e);
    if (isObjectUrl) URL.revokeObjectURL(url);
    currentAudio = null;
    _setState(State.IDLE);
    if (voiceModeActive) {
      setTimeout(() => { if (voiceModeActive && currentState === State.IDLE) _startListening(); }, 400);
    }
  };

  try { await currentAudio.play(); }
  catch (e) {
    console.warn("⚠️ Autoplay blocked:", e);
    _showToast("Tap anywhere to enable audio.", "info");
    _setState(State.IDLE);
    if (isObjectUrl) URL.revokeObjectURL(url);
    currentAudio = null;
  }
}

function _stopCurrentAudio() {
  if (currentAudio) {
    const a = currentAudio; currentAudio = null;
    a.pause(); a.src = "";
    console.log("🛑 Audio stopped (interrupted)");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

function _setState(newState) {
  currentState = newState;

  document.querySelectorAll(".state-idle,.state-listening,.state-thinking,.state-speaking")
    .forEach(el => el.classList.remove("active"));

  avatarContainer.classList.remove("listening", "speaking", "thinking");
  micBtn.classList.remove("recording", "disabled", "speaking-active");
  inlineMicBtn.classList.remove("recording", "speaking-active");
  interruptBanner.classList.remove("visible");

  const hint = document.getElementById("micHint");
  if (hint) hint.classList.remove("interrupt-hint");

  switch (newState) {
    case State.IDLE:
      document.getElementById("stateIdle").classList.add("active");
      micBtn.title = voiceModeActive ? "Voice ON — speak!" : "Click to start";
      micBtn.disabled = false;
      if (hint) hint.textContent = voiceModeActive ? "Waiting to listen..." : "Click to start voice mode";
      inputMode.textContent = voiceModeActive ? "Voice Mode" : "Text Mode";
      sendBtn.disabled = false;
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
      sendBtn.disabled = true;
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
      // Mic ENABLED during speaking — user can click OR speak to interrupt (VAD monitors)
      micBtn.classList.remove("disabled");
      micBtn.classList.add("speaking-active");
      micBtn.disabled = false;
      inlineMicBtn.classList.add("speaking-active");
      if (hint) { hint.textContent = "🔴 Click or speak to interrupt"; hint.classList.add("interrupt-hint"); }
      sendBtn.disabled = true;
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CHAT UI
// ═══════════════════════════════════════════════════════════════════════════

const LANG_FLAGS = { en: "🇬🇧", te: "🇮🇳 తె", hi: "🇮🇳 हि", ta: "🇮🇳 த" };

function _addMessage(role, content, inputType = "text", lang = "en") {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = role === "user" ? "You" : "D";
  const msgContent = document.createElement("div");
  msgContent.className = "msg-content";
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = content;
  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const now = new Date();
  const lb = lang !== "en" ? ` · ${LANG_FLAGS[lang] || lang}` : "";
  const mb = inputType === "voice" ? " · 🎤" : "";
  meta.textContent = `${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${mb}${lb}`;
  msgContent.appendChild(bubble);
  msgContent.appendChild(meta);
  msg.appendChild(avatar);
  msg.appendChild(msgContent);
  chatMessages.appendChild(msg);
  _scrollToBottom();
  return msg;
}

function _addThinkingBubble() {
  const id = "thinking-" + Date.now();
  const msg = document.createElement("div");
  msg.className = "message assistant typing-indicator";
  msg.id = id;
  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = "D";
  const msgContent = document.createElement("div");
  msgContent.className = "msg-content";
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  msgContent.appendChild(bubble);
  msg.appendChild(avatar);
  msg.appendChild(msgContent);
  chatMessages.appendChild(msg);
  _scrollToBottom();
  return id;
}

function _removeThinkingBubble(id) { document.getElementById(id)?.remove(); }

function _renderWelcomeMessage() {
  const w = document.createElement("div");
  w.className = "welcome-msg";
  w.innerHTML = `
    <div class="welcome-icon">🎓</div>
    <h3>Hello! I'm Shruthi</h3>
    <p>Your AI Educational Counselor — available in English, Telugu (తెలుగు), Hindi (हिंदी) &amp; Tamil (தமிழ்).</p>
    <p style="margin-top:0.5rem">Click <strong>🎤 Start Voice</strong> for hands-free conversation, or type below.</p>
    <p style="margin-top:0.4rem; font-size:0.78rem; color:var(--text-muted)">You can interrupt me anytime while I'm speaking — just start talking!</p>`;
  chatMessages.appendChild(w);
}

function _scrollToBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }

// ── Session ───────────────────────────────────────────────────────────────────
async function _resetSession() {
  _cancelPendingRequest();
  try {
    const r = await fetch(`${CONFIG.API_BASE}/reset-session/${sessionId}`, { method: "POST" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (err) { console.error("Reset error:", err); }
  chatMessages.innerHTML = "";
  sessionId = _generateSessionId();
  _renderWelcomeMessage();
  _showToast("Session reset — fresh start!", "success");
}

// ── Health ────────────────────────────────────────────────────────────────────
async function _checkBackendHealth() {
  try {
    const res = await fetch(`${CONFIG.API_BASE}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      backendOnline = true;
      _setConnectionStatus(true, data.groq_configured ? "Online" : "API Key Missing");
      document.getElementById("offlineBanner")?.remove();
    } else { _handleBackendOffline(); }
  } catch (err) { console.warn("Health check:", err.message); _handleBackendOffline(); }
}

function _handleBackendOffline() {
  backendOnline = false;
  _setConnectionStatus(false, "Offline");
  if (!document.getElementById("offlineBanner")) {
    const b = document.createElement("div");
    b.id = "offlineBanner";
    b.className = "offline-banner";
    b.innerHTML = `<span>⚠️ Backend is offline.</span><span>Start: <code>cd backend &amp;&amp; python -m uvicorn app:app --reload --port 8000</code></span>`;
    document.querySelector(".chat-panel")?.prepend(b);
  }
}

function _setConnectionStatus(online, label) {
  statusDot.className = "status-dot " + (online ? "online" : "offline");
  statusText.textContent = label;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function _generateSessionId() { return "sess_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now(); }

function _getSupportedMimeType() {
  const t = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return t.find(tt => MediaRecorder.isTypeSupported(tt)) || "audio/webm";
}

function _safeDecodeHeader(val) { if (!val) return ""; try { return decodeURIComponent(val); } catch { return val; } }

function _showToast(message, type = "info") {
  const c = document.getElementById("toastContainer");
  if (!c) return;
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = message;
  c.appendChild(t);
  setTimeout(() => { t.style.animation = "toast-out 0.3s ease forwards"; setTimeout(() => t.remove(), 300); }, 3000);
}

function _createRipple(event, button) {
  const r = document.createElement("span");
  r.className = "ripple";
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  r.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - rect.left - size / 2}px;top:${event.clientY - rect.top - size / 2}px;`;
  button.style.position = "relative";
  button.style.overflow = "hidden";
  button.appendChild(r);
  setTimeout(() => r.remove(), 600);
}

