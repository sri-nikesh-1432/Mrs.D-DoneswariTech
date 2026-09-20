/**
 * Real-time voice WebSocket client.
 *
 * Audio path (matches the server protocol):
 *   OUT: raw PCM16 mono @16 kHz frames (20ms) for server-side VAD + Whisper STT
 *   IN:  JSON messages carrying base64 MP3 sentence audio + control events
 *
 * Playback is an ordered queue: sentences are decoded ahead of time and
 * played back-to-back with a natural gap. Barge-in (`speech_start` from the
 * server) stops playback instantly so the caller can take the floor.
 */

const BASE_WS = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000";

const SAMPLE_RATE = 16000;
const FRAME_MS = 20; // match server FRAME_MS
const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000; // 320 samples

export type VoiceWSState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "greeting"
  | "listening"
  | "processing"
  | "speaking"
  | "error";

interface VoiceWSCallbacks {
  onStateChange?: (state: VoiceWSState) => void;
  onTranscriptPartial?: (text: string) => void;
  onTranscriptFinal?: (text: string) => void;
  onAgentPartial?: (text: string) => void;
  onAgentFinal?: (text: string) => void;
  onError?: (msg: string) => void;
  onAmplitude?: (amplitude: number) => void;
  onPlaybackAmplitude?: (amplitude: number) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  // Legacy hooks kept for old pages; no-ops in the current protocol
  onMemoryUpdate?: (memory: Record<string, unknown>) => void;
  onLeadScoreUpdate?: (score: { interest: number; conversion: number; intent: string }) => void;
  onCallEnded?: (report: unknown) => void;
}

class VoiceWebSocket {
  private ws: WebSocket | null = null;
  private agentId: string | null = null;
  private callbacks: VoiceWSCallbacks = {};
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  // Mic capture
  private audioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private amplitudeFrame: number | null = null;
  private analyser: AnalyserNode | null = null;
  private micActive = false;

  // Playback queue
  private playCtx: AudioContext | null = null;
  private playQueue: Array<{ text: string; buffer: AudioBuffer }> = [];
  private currentSource: AudioBufferSourceNode | null = null;
  private playing = false;
  private playbackDone = true;
  // REAL playback-level analyser (spec §34 §59): drives the agent-speaking
  // waveform from the actual audio being played — never a fake animation.
  private playAnalyser: AnalyserNode | null = null;
  private playbackAmpFrame: number | null = null;

  // Transcript assembly
  private agentTextBuffer = "";

  private state: VoiceWSState = "disconnected";

  // ─── Connect ──────────────────────────────────────────────────
  connect(agentId: string, callbacks: VoiceWSCallbacks): this {
    this.disconnect();
    this.intentionalClose = false;
    this.agentId = agentId;
    this.callbacks = callbacks;
    this._setState("connecting");

    this.ws = new WebSocket(`${BASE_WS}/ws/voice/${agentId}`);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this._setState("connected");
      this.ws?.send(JSON.stringify({
        type: "hello",
        mode: "live",                 // live = agent's own FAISS knowledge
        institute_id: Number(agentId) || 1,
        conversation_id: `web_${Date.now()}`,
      }));
    };

    this.ws.onmessage = (ev) => this._handleMessage(ev);
    this.ws.onerror = () => this._setState("error");
    this.ws.onclose = (ev) => {
      this._stopPlayback();
      if (ev.code !== 1000 && !this.intentionalClose && this.state !== "error") {
        this._scheduleReconnect();
      } else {
        this._setState("disconnected");
      }
    };

    return this;
  }

  // ─── Disconnect ───────────────────────────────────────────────
  disconnect(): void {
    this.intentionalClose = true;
    this._clearReconnect();
    this._stopMic();
    this._stopPlayback();
    if (this.ws) {
      try { this.ws.send(JSON.stringify({ type: "end" })); } catch { /* closing */ }
      this.ws.onclose = null;
      try { this.ws.close(1000); } catch { /* already closed */ }
      this.ws = null;
    }
    this._setState("disconnected");
  }

  // ─── Mic Control (streams PCM16 frames to server) ─────────────
  async startMic(): Promise<void> {
    if (this.micActive) return;
    if (!this.ws) {
      this.callbacks.onError?.("Not connected");
      return;
    }
    // The socket may still be handshaking when the user clicks. Waiting here
    // (instead of bailing out) is what actually lets the first click start
    // the microphone — the old code errored out whenever the WS wasn't open,
    // so the mic never turned on for a fresh conversation.
    if (this.ws.readyState !== WebSocket.OPEN) {
      try {
        await this._waitForOpen(5000);
      } catch {
        this.callbacks.onError?.("Not connected");
        return;
      }
    }
    try {
      const devices = navigator.mediaDevices;
      if (!devices?.getUserMedia) {
        this.callbacks.onError?.("Microphone not supported in this browser.");
        this._setState("error");
        return;
      }
      this.micStream = await devices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,   // prevents the agent hearing itself
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Shared AudioContext for capture. Some browsers ignore the requested
      // sampleRate (reporting the device rate instead), so we capture at the
      // context's REAL rate and resample every frame to 16 kHz before sending.
      this.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      const captureRate = this.audioCtx.sampleRate || SAMPLE_RATE;
      this.sourceNode = this.audioCtx.createMediaStreamSource(this.micStream);

      // Amplitude meter for the visualizer
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.sourceNode.connect(this.analyser);
      this._trackAmplitude();

      // PCM16 frame capture via ScriptProcessor (widely supported, low latency)
      this.processor = this.audioCtx.createScriptProcessor(FRAME_SAMPLES, 1, 1);
      this.processor.onaudioprocess = (e) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        let f32: Float32Array = e.inputBuffer.getChannelData(0);
        // Resample to the wire format (16 kHz) when the context differs —
        // otherwise the server reads 48 kHz audio as 16 kHz and hears
        // garbled, sped-up speech (STT "wrong responses").
        if (captureRate !== SAMPLE_RATE) {
          f32 = this._resampleLinear(f32, captureRate, SAMPLE_RATE);
        }
        // Convert float32 [-1,1] → int16
        const pcm = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          const s = Math.max(-1, Math.min(1, f32[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.ws.send(pcm.buffer);
      };
      // Required on some browsers to keep the processor alive
      const silentGain = this.audioCtx.createGain();
      silentGain.gain.value = 0;
      this.sourceNode.connect(this.processor);
      this.processor.connect(silentGain);
      silentGain.connect(this.audioCtx.destination);

      this.micActive = true;
      if (this.state === "connected") this._setState("listening");
    } catch {
      this.callbacks.onError?.("Microphone access denied.");
      this._setState("error");
    }
  }

  stopMic(): void {
    // Keep the socket; just stop capturing
    this._stopMic();
    if (this.state === "listening") this._setState("connected");
  }

  // ─── Real playback amplitude (spec §34 §59) ─────────────────
  private _trackPlaybackAmplitude(): void {
    if (!this.playAnalyser) return;
    const buf = new Uint8Array(this.playAnalyser.frequencyBinCount);
    const tick = () => {
      if (!this.playAnalyser) return;
      this.playAnalyser.getByteTimeDomainData(buf);
      // RMS of the time-domain signal — real audio energy.
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      this.callbacks.onPlaybackAmplitude?.(Math.min(1, rms * 4));
      this.playbackAmpFrame = requestAnimationFrame(tick);
    };
    if (this.playbackAmpFrame) cancelAnimationFrame(this.playbackAmpFrame);
    this.playbackAmpFrame = requestAnimationFrame(tick);
  }

  private _waitForOpen(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error("no socket"));
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      const start = Date.now();
      const timer = setInterval(() => {
        if (!this.ws || this.intentionalClose) {
          clearInterval(timer);
          reject(new Error("no socket"));
        } else if (this.ws.readyState === WebSocket.OPEN) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error("timeout"));
        }
      }, 50);
    });
  }

  // Linear-interpolation resampler used to downconvert captured audio to the
  // 16 kHz wire format. Cheap (a few k samples per 20 ms frame) and keeps
  // STT accurate when the browser ignores the requested AudioContext rate.
  private _resampleLinear(src: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate) return src;
    const ratio = fromRate / toRate;
    const out = new Float32Array(Math.max(1, Math.round(src.length / ratio)));
    for (let i = 0; i < out.length; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = src[Math.min(idx, src.length - 1)];
      const b = src[Math.min(idx + 1, src.length - 1)];
      out[i] = a + (b - a) * frac;
    }
    return out;
  }

  private _stopMic(): void {
    this.micActive = false;
    if (this.amplitudeFrame) {
      cancelAnimationFrame(this.amplitudeFrame);
      this.amplitudeFrame = null;
    }
    try { this.processor?.disconnect(); } catch { /* noop */ }
    try { this.sourceNode?.disconnect(); } catch { /* noop */ }
    this.processor = null;
    this.sourceNode = null;
    this.analyser = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    if (this.audioCtx && this.audioCtx.state !== "closed") {
      this.audioCtx.close().catch(() => { /* noop */ });
    }
    this.audioCtx = null;
  }

  private _trackAmplitude(): void {
    if (!this.analyser) return;
    const buf = new Uint8Array(this.analyser.frequencyBinCount);
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(buf);
      const avg = buf.reduce((s, v) => s + v, 0) / buf.length;
      this.callbacks.onAmplitude?.(avg / 128);
      this.amplitudeFrame = requestAnimationFrame(tick);
    };
    this.amplitudeFrame = requestAnimationFrame(tick);
  }

  // ─── Send typed text (skips STT) ──────────────────────────────
  sendText(text: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "text", text }));
      this._setState("processing");
    }
  }

  // ─── Interrupt playback (local barge-in) ──────────────────────
  interrupt(): void {
    this._stopPlayback();
  }

  // ─── Message handler ──────────────────────────────────────────
  private _handleMessage(ev: MessageEvent): void {
    if (ev.data instanceof ArrayBuffer) return; // audio comes base64 in JSON

    let msg: { type?: string; [k: string]: unknown };
    try { msg = JSON.parse(ev.data as string); } catch { return; }

    switch (msg.type) {
      case "connected":
        // Greeting arrives right after as `sentence` messages
        this._setState("greeting");
        break;

      case "sentence": {
        const text = String(msg.text ?? "");
        const audioB64 = msg.audio_data as string | null;
        // Every sentence that arrives is REAL agent speech streamed from the
        // server — there are no prewritten fillers (spec §1 §3 §6 §14).
        this.agentTextBuffer += (this.agentTextBuffer ? " " : "") + text;
        this.callbacks.onAgentPartial?.(text);
        if (audioB64) {
          this._enqueueAudio(text, audioB64);
        } else {
          // No audio for this sentence — show text immediately
          this.callbacks.onAgentFinal?.(text);
        }
        break;
      }

      case "turn_done": {
        const full = String(msg.ai_response ?? "");
        if (full) {
          this.callbacks.onAgentFinal?.(full);
        }
        this.agentTextBuffer = "";
        const debug = (msg.debug_info ?? {}) as Record<string, unknown>;
        console.info(
          "[VoiceWS] turn latency",
          `ttfa=${debug.ttfa_ms ?? "?"}ms total=${debug.total_turn_ms ?? debug.total_time_ms ?? "?"}ms`,
        );
        if (this.state !== "disconnected") this._setState("listening");
        break;
      }

      case "transcript": {
        const text = String(msg.text ?? "");
        if (text) {
          this.callbacks.onTranscriptPartial?.(text);
          this.callbacks.onTranscriptFinal?.(text);
        }
        this._setState("processing");
        break;
      }

      case "processing":
        this._setState("processing");
        break;

      case "speech_start":
        // Barge-in: caller started talking over the agent → cut audio now
        this._stopPlayback();
        break;

      case "error":
        this.callbacks.onError?.(String((msg as { message?: string }).message ?? "Voice error"));
        break;

      case "pong":
      default:
        break;
    }
  }

  // ─── Audio playback queue ─────────────────────────────────────
  private async _enqueueAudio(text: string, audioB64: string): Promise<void> {
    try {
      if (!this.playCtx) {
        this.playCtx = new AudioContext();
        // Analyser taps the real output so the UI shows actual agent audio.
        this.playAnalyser = this.playCtx.createAnalyser();
        this.playAnalyser.fftSize = 256;
        this.playAnalyser.connect(this.playCtx.destination);
        this._trackPlaybackAmplitude();
      }
      if (this.playCtx.state === "suspended") await this.playCtx.resume();

      const raw = atob(audioB64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

      const buffer = await this.playCtx.decodeAudioData(bytes.buffer);
      const wasIdle = !this.playing && this.playQueue.length === 0;
      this.playQueue.push({ text, buffer });
      this._setState("speaking");
      this.callbacks.onSpeakingChange?.(true);
      if (wasIdle) {
        // First audible audio of this turn — report to the server BEFORE the
        // buffer starts so the KPI includes real playback time.
        this._reportPlaybackState(true);
      }
      if (!this.playing) this._playNext();
    } catch (e) {
      console.warn("[VoiceWS] audio decode failed", e);
      this.callbacks.onAgentFinal?.(text);
    }
  }

  private _playNext(): void {
    const item = this.playQueue.shift();
    if (!item) {
      this.playing = false;
      this.playbackDone = true;
      this.callbacks.onSpeakingChange?.(false);
      this._reportPlaybackState(false);
      if (this.state === "speaking") this._setState(this.micActive ? "listening" : "connected");
      return;
    }

    this.playing = true;
    this.playbackDone = false;

    if (!this.playCtx) {
      this.playing = false;
      return;
    }
    const source = this.playCtx.createBufferSource();
    source.buffer = item.buffer;

    // Smooth the joins. A short fade-in and a slightly longer fade-out remove
    // the click at each clip boundary and make the streamed sentences sound
    // like ONE continuous voice instead of stitched MP3s.
    const gain = this.playCtx.createGain();
    const dur = item.buffer.duration;
    const fadeIn = Math.min(0.012, dur / 4);
    const fadeOut = Math.min(0.035, dur / 4);
    const t0 = this.playCtx.currentTime;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(1, t0 + fadeIn);
    gain.gain.setValueAtTime(1, Math.max(t0 + fadeIn, t0 + dur - fadeOut));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    source.connect(gain);
    gain.connect(this.playAnalyser ?? this.playCtx.destination);

    source.onended = () => {
      this.currentSource = null;
      if (this.intentionalClose) return;
      // Natural inter-sentence breath (spec §37): humans barely pause between
      // related thoughts, take a moment after a question, and run a short
      // acknowledgement straight into the answer. Each clip already carries
      // its own trailing silence, so these gaps stay short on purpose.
      // Skipped instantly when barged in.
      const t = item.text?.trim() ?? "";
      const breath = t.endsWith("...") || t.endsWith("…") ? 280
        : t.endsWith("?") ? 220
        : t.endsWith("!") ? 140
        : t.length <= 24 ? 70
        : 130;
      setTimeout(() => { if (!this.intentionalClose) this._playNext(); }, breath);
    };
    this.currentSource = source;
    source.start();
  }

  /** Tell the server when agent audio ACTUALLY plays — drives the server's
   *  echo-suppression window and the first-audible-audio KPI (spec §13). */
  private _reportPlaybackState(active: boolean): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify({ type: "playback_state", active })); } catch { /* best effort */ }
    }
  }

  private _stopPlayback(): void {
    this.playQueue = [];
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch { /* already stopped */ }
      this.currentSource = null;
    }
    this.callbacks.onPlaybackAmplitude?.(0);
    this._reportPlaybackState(false);
    if (this.playing || !this.playbackDone) {
      this.playing = false;
      this.playbackDone = true;
      this.callbacks.onSpeakingChange?.(false);
      if (this.state === "speaking" || this.state === "greeting") {
        this._setState(this.micActive ? "listening" : "connected");
      }
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────
  private _setState(s: VoiceWSState): void {
    if (this.state === s) return;
    this.state = s;
    this.callbacks.onStateChange?.(s);
  }

  private _scheduleReconnect(): void {
    this._clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      if (this.agentId && !this.intentionalClose) {
        this.connect(this.agentId, this.callbacks);
      }
    }, 3000);
  }

  private _clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  get currentState(): VoiceWSState { return this.state; }
}

export const voiceWS = new VoiceWebSocket();
export { VoiceWebSocket };
