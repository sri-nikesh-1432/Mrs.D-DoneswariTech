import type { VoiceState, ConversationMessage, CallerMemory, WSMessage } from "../types";

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
  onAudioChunk?: (chunk: ArrayBuffer) => void;
  onMemoryUpdate?: (memory: Partial<CallerMemory>) => void;
  onCallStarted?: () => void;
  onCallEnded?: (report: unknown) => void;
  onLeadScoreUpdate?: (score: { interest: number; conversion: number; intent: string }) => void;
  onError?: (msg: string) => void;
  onAmplitude?: (amplitude: number) => void;
}

const BASE_WS = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000";

class VoiceWebSocket {
  private ws: WebSocket | null = null;
  private instituteId: string | null = null;
  private callbacks: VoiceWSCallbacks = {};
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private micStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private amplitudeFrame: number | null = null;
  private state: VoiceWSState = "disconnected";
  private currentBlobQueue: Blob[] = [];

  // ─── Connect ──────────────────────────────────────────────────
  connect(instituteId: string, callbacks: VoiceWSCallbacks): this {
    this.disconnect();
    this.instituteId = instituteId;
    this.callbacks = callbacks;
    this._setState("connecting");
    this.ws = new WebSocket(`${BASE_WS}/ws/voice/${instituteId}`);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this._setState("connected");
      this.ws?.send(JSON.stringify({ type: "hello", institute_id: instituteId }));
    };

    this.ws.onmessage = (ev) => this._handleMessage(ev);
    this.ws.onerror = () => this._setState("error");
    this.ws.onclose = (ev) => {
      if (ev.code !== 1000 && this.state !== "error") {
        this._scheduleReconnect();
      } else {
        this._setState("disconnected");
      }
    };

    return this;
  }

  // ─── Disconnect ───────────────────────────────────────────────
  disconnect(): void {
    this._clearReconnect();
    this._stopMic();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close(1000);
      this.ws = null;
    }
    this._setState("disconnected");
  }

  // ─── Mic Control ─────────────────────────────────────────────
  async startMic(): Promise<void> {
    if (this.micStream) return;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
      });

      // Amplitude tracking
      this.audioCtx = new AudioContext({ sampleRate: 16000 });
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      const src = this.audioCtx.createMediaStreamSource(this.micStream);
      src.connect(this.analyser);
      this._trackAmplitude();

      // MediaRecorder → WebSocket
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      this.mediaRecorder = new MediaRecorder(this.micStream, { mimeType, audioBitsPerSecond: 16000 });
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0 && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(e.data);
        }
      };
      this.mediaRecorder.start(100); // 100ms chunks for low latency
      this._setState("listening");
    } catch (err) {
      this.callbacks.onError?.("Microphone access denied.");
      this._setState("error");
    }
  }

  stopMic(): void {
    this._stopMic();
    if (this.state === "listening") this._setState("processing");
  }

  private _stopMic(): void {
    if (this.amplitudeFrame) {
      cancelAnimationFrame(this.amplitudeFrame);
      this.amplitudeFrame = null;
    }
    this.mediaRecorder?.stop();
    this.mediaRecorder = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.analyser = null;
    this.audioCtx?.close();
    this.audioCtx = null;
  }

  private _trackAmplitude(): void {
    if (!this.analyser) return;
    const buf = new Uint8Array(this.analyser.frequencyBinCount);
    const tick = () => {
      this.analyser?.getByteFrequencyData(buf);
      const avg = buf.reduce((s, v) => s + v, 0) / buf.length;
      this.callbacks.onAmplitude?.(avg / 128);
      this.amplitudeFrame = requestAnimationFrame(tick);
    };
    this.amplitudeFrame = requestAnimationFrame(tick);
  }

  // ─── Send text message ────────────────────────────────────────
  sendText(text: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "text_message", text }));
      this._setState("processing");
    }
  }

  // ─── Interrupt TTS playback ───────────────────────────────────
  interrupt(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "interrupt" }));
    }
  }

  // ─── Message handler ──────────────────────────────────────────
  private _handleMessage(ev: MessageEvent): void {
    if (ev.data instanceof ArrayBuffer) {
      this.callbacks.onAudioChunk?.(ev.data);
      return;
    }

    let msg: WSMessage;
    try { msg = JSON.parse(ev.data as string); }
    catch { return; }

    switch (msg.type) {
      case "agent_state": {
        const map: Record<string, VoiceWSState> = {
          idle: "connected",
          greeting: "greeting",
          listening: "listening",
          processing: "processing",
          speaking: "speaking",
        };
        const raw = (msg.data as { state: string }).state ?? "connected";
        this._setState(map[raw] ?? "connected");
        break;
      }
      case "transcript_partial":
        this.callbacks.onTranscriptPartial?.((msg.data as { text: string }).text);
        break;
      case "transcript_final":
        this.callbacks.onTranscriptFinal?.((msg.data as { text: string }).text);
        break;
      case "agent_response_partial":
        this.callbacks.onAgentPartial?.((msg.data as { text: string }).text);
        this._setState("speaking");
        break;
      case "agent_response_final":
        this.callbacks.onAgentFinal?.((msg.data as { text: string }).text);
        break;
      case "memory_update":
        this.callbacks.onMemoryUpdate?.(msg.data as Partial<CallerMemory>);
        break;
      case "call_started":
        this.callbacks.onCallStarted?.();
        break;
      case "call_ended":
        this.callbacks.onCallEnded?.(msg.data);
        this._setState("disconnected");
        break;
      case "lead_score_update":
        this.callbacks.onLeadScoreUpdate?.(
          msg.data as { interest: number; conversion: number; intent: string }
        );
        break;
      case "error":
        this.callbacks.onError?.((msg.data as { message: string }).message ?? "Unknown error");
        break;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────
  private _setState(s: VoiceWSState): void {
    this.state = s;
    this.callbacks.onStateChange?.(s);
  }

  private _scheduleReconnect(): void {
    this._clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      if (this.instituteId) {
        this.connect(this.instituteId, this.callbacks);
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
