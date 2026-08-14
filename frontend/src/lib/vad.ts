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

  /**
   * Optional adaptive end-of-turn silence (spec §23). Returns how many ms of
   * QUIET should end the current utterance — humans pause mid-sentence, so a
   * long thought deserves more patience than a one-word "Avunu". When null,
   * the fixed `silenceMs` option is used.
   */
  dynamicSilenceMs: (() => number) | null = null;

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
  /**
   * Milliseconds of genuine speech energy since the last speech start — the
   * time the mic was actually ABOVE threshold while speaking (excludes the
   * trailing silence that triggers onSpeechEnd). The recorder uses this to
   * reject sub-speech blips (coughs, clicks) that would otherwise be sent to
   * Whisper, which can hallucinate "Thank you." on near-silence.
   */
  private activeMs = 0;

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
          // Mono gives Whisper a single clean channel and makes VAD energy
          // measurements consistent on any device (stereo mics otherwise
          // halve/double the RMS depending on the OS mixer).
          channelCount: 1,
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
      this.activeMs = 0;
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
    this.silentSince = 0;
    this.activeMs = 0;
  }

  /**
   * Milliseconds of genuine speech energy captured in the CURRENT speaking
   * segment (0 while silent). Read inside onSpeechEnd to gate the recording.
   */
  get activeSpeechMs(): number {
    return this.activeMs;
  }

  /** Force-reset the speech state (e.g. after a barge-in or turn end). */
  reset(): void {
    this._isSpeaking = false;
    this.framesAbove = 0;
    this.silentSince = 0;
    this.activeMs = 0;
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
    // Clamp dt: a single slow frame (tab switch, GC pause) must not count as
    // a full second of silence and end the turn mid-word.
    const dt = Math.min(now - this.lastFrame, 100);
    this.lastFrame = now;

    // Adaptive noise floor: slowly track the background level while silent,
    // so a noisy room doesn't block quiet speakers and a quiet room still
    // catches soft voices. Frozen while anyone is speaking (user OR AI — the
    // AI's voice bleeding into the mic must never inflate the floor).
    const dyn = this.dynamicThreshold ? this.dynamicThreshold() : 0;
    if (!this._isSpeaking && dyn === 0) {
      this.noiseFloor =
        this.noiseFloor * 0.97 + Math.min(rms, 0.1) * 0.03;
    }
    const threshold = Math.max(this.baseThreshold, this.noiseFloor * 2.2, dyn);

    if (rms > threshold) {
      this.framesAbove++;
      if (!this._isSpeaking && this.framesAbove >= this.startFrames) {
        this._isSpeaking = true;
        this.silentSince = 0;
        this.onSpeechStart?.();
      } else if (this._isSpeaking) {
        // Speech continues → genuine speech energy (drives the recorder's
        // min-duration gate). CRITICAL: reset the silence clock too — a brief
        // mid-thought pause must not accumulate with the NEXT pause; silence
        // only counts while CONSECUTIVELY below threshold.
        this.silentSince = 0;
        this.activeMs += dt;
      }
    } else {
      this.framesAbove = 0;
      if (this._isSpeaking) {
        this.silentSince += dt;
        // Adaptive end-of-turn patience (spec §23): longer utterances wait
        // longer before yielding the floor.
        const effSilence = this.dynamicSilenceMs
          ? Math.max(400, this.dynamicSilenceMs())
          : this.silenceMs;
        if (this.silentSince >= effSilence) {
          this._isSpeaking = false;
          this.silentSince = 0;
          // Fire the callback BEFORE resetting so the hook can read how much
          // real speech this segment contained.
          this.onSpeechEnd?.();
          this.activeMs = 0;
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
