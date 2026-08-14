/**
 * Real-time Voice Activity Detection (VAD) engine built on the Web Audio API.
 *
 * Why this exists: the browser's webkitSpeechRecognition only understands a
 * handful of languages, silently drops sessions, and frequently hears nothing.
 * This VAD listens to RAW AUDIO from the microphone and fires on ANY voice —
 * any language, any accent, any volume — by detecting when mic energy rises
 * above an adaptive noise floor. When speech is detected the caller records
 * the utterance (MediaRecorder) and sends it to Groq Whisper, which
 * transcribes it with automatic language detection.
 *
 * The same analyser also exposes a live waveform (`levels[]`, updated every
 * animation frame) so the UI can draw real-time voice waves that react to the
 * user's actual sound — not a fake CSS animation.
 */

export interface VADOptions {
  /** Frames of sustained energy required to declare speech start. */
  startFrames?: number;
  /** Milliseconds of quiet below threshold to declare speech end. */
  silenceMs?: number;
  /** Base RMS threshold (0..1); the real threshold adapts to the noise floor. */
  baseThreshold?: number;
  /** Number of waveform buckets (bars) exposed in levels[]. */
  buckets?: number;
}

export interface VADCallbacks {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
}

export class VoiceActivityDetector {
  analyser: AnalyserNode | null = null;

  /** Live waveform levels, 0..1, updated every animation frame. */
  levels: Float32Array;

  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;

  /**
   * Optional dynamic threshold override (returns a level the effective
   * threshold must be at least as high as). Used to raise the bar while the
   * AI's own voice is playing through the speakers, so only the CALLER's
   * voice (louder than the AI) triggers a barge-in.
   */
  dynamicThreshold: (() => number) | null = null;

  private ctx: AudioContext | null = null;
  private stream_: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timeData: Float32Array | null = null;
  private rafId = 0;
  private running = false;
  private noiseFloor = 0.005;
  private framesAbove = 0;
  private silentSince = 0;
  private lastFrame = 0;
  private _isSpeaking = false;
  private startFrames: number;
  private silenceMs: number;
  private baseThreshold: number;

  constructor(opts: VADOptions = {}, callbacks: VADCallbacks = {}) {
    this.startFrames = opts.startFrames ?? 3;
    this.silenceMs = opts.silenceMs ?? 1000;
    this.baseThreshold = opts.baseThreshold ?? 0.012;
    this.levels = new Float32Array(opts.buckets ?? 48);
    this.onSpeechStart = callbacks.onSpeechStart;
    this.onSpeechEnd = callbacks.onSpeechEnd;
  }

  get isSpeaking(): boolean {
    return this._isSpeaking;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** The live microphone stream (used by MediaRecorder to record speech). */
  get stream(): MediaStream | null {
    return this.stream_;
  }

  /** Acquire the microphone and start analysing. Resolves false on denial. */
  async start(): Promise<boolean> {
    if (this.running) return true;
    try {
      const Ctor =
        window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctor();
      await this.ctx.resume();
      this.stream_ = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.source = this.ctx.createMediaStreamSource(this.stream_);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.2;
      this.source.connect(this.analyser);
      this.timeData = new Float32Array(this.analyser.fftSize);
      this.noiseFloor = 0.005;
      this.framesAbove = 0;
      this._isSpeaking = false;
      this.silentSince = 0;
      this.running = true;
      this.lastFrame = performance.now();
      this.rafId = requestAnimationFrame(this.loop);
      return true;
    } catch (e) {
      console.error("VAD start failed:", e);
      this.stop();
      return false;
    }
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    try {
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.stream_?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    try {
      this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.stream_ = null;
    this.source = null;
    this.analyser = null;
    this.timeData = null;
    this._isSpeaking = false;
    this.framesAbove = 0;
  }

  /** Force-reset the speech state (e.g. after a barge-in or turn end). */
  reset(): void {
    this._isSpeaking = false;
    this.framesAbove = 0;
    this.silentSince = 0;
  }

  private loop = () => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);
    const analyser = this.analyser;
    const data = this.timeData;
    if (!analyser || !data) return;

    analyser.getFloatTimeDomainData(data as Float32Array<ArrayBuffer>);

    // RMS energy of this frame.
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);

    // Waveform buckets: peak |sample| per bucket, amplified for visibility.
    const buckets = this.levels.length;
    const per = Math.max(1, Math.floor(data.length / buckets));
    for (let b = 0; b < buckets; b++) {
      let peak = 0;
      const start = b * per;
      const end = Math.min(data.length, start + per);
      for (let i = start; i < end; i++) {
        const a = Math.abs(data[i]);
        if (a > peak) peak = a;
      }
      this.levels[b] = Math.min(1, peak * 3);
    }

    const now = performance.now();
    const dt = now - this.lastFrame;
    this.lastFrame = now;

    // Adaptive noise floor: slowly track the background level while silent,
    // so a noisy room doesn't block quiet speakers and a quiet room still
    // catches soft voices.
    if (!this._isSpeaking) {
      this.noiseFloor =
        this.noiseFloor * 0.97 + Math.min(rms, 0.1) * 0.03;
    }
    const dyn = this.dynamicThreshold ? this.dynamicThreshold() : 0;
    const threshold = Math.max(this.baseThreshold, this.noiseFloor * 2.2, dyn);

    if (rms > threshold) {
      this.framesAbove++;
      if (!this._isSpeaking && this.framesAbove >= this.startFrames) {
        this._isSpeaking = true;
        this.silentSince = 0;
        this.onSpeechStart?.();
      }
    } else {
      this.framesAbove = 0;
      if (this._isSpeaking) {
        this.silentSince += dt;
        if (this.silentSince >= this.silenceMs) {
          this._isSpeaking = false;
          this.silentSince = 0;
          this.onSpeechEnd?.();
        }
      }
    }
  };
}

/** True when this browser can run the Web Audio VAD pipeline. */
export function isVADSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined" &&
    typeof (window as any).AudioContext !== "undefined"
  );
}
