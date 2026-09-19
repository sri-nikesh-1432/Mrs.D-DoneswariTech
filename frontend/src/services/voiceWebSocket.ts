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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.callbacks.onError?.("Not connected");
      return;
    }
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,   // prevents the agent hearing itself
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Shared AudioContext for capture (16 kHz target)
      this.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
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
        const f32 = e.inputBuffer.getChannelData(0);
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
      this.playQueue.push({ text, buffer });
      this._setState("speaking");
      this.callbacks.onSpeakingChange?.(true);
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
    source.connect(this.playAnalyser ?? this.playCtx.destination);
    source.onended = () => {
      this.currentSource = null;
      if (this.intentionalClose) return;
      // Natural inter-sentence breath — varied like real speech rhythm
      // (spec §37): shorter between related thoughts, a thinking beat after
      // questions. Skipped instantly when barged in.
      const t = item.text?.trim() ?? "";
      const breath = t.endsWith("?") ? 340 : t.endsWith("!") ? 260 : 220;
      setTimeout(() => { if (!this.intentionalClose) this._playNext(); }, breath);
    };
    this.currentSource = source;
    source.start();
  }

  private _stopPlayback(): void {
    this.playQueue = [];
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch { /* already stopped */ }
      this.currentSource = null;
    }
    this.callbacks.onPlaybackAmplitude?.(0);
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
