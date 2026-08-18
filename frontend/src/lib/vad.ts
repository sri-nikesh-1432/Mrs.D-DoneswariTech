/**
 * Real-time Voice Activity Detection (VAD) engine — Silero VAD (ML), not energy.
 *
 * Why this exists: an energy/RMS detector ("mic amplitude above threshold")
 * cannot tell speech from keyboard, fan, chair noise, coughing, or the AI's
 * own voice leaking through the speakers — and a Whisper call on any of those
 * can hallucinate a phantom "Thank you." Silero VAD is a neural network that
 * returns a genuine speech probability per frame, so only actual human speech
 * starts a turn (spec §6: "Audio amplitude alone is not speech").
 *
 * This wrapper exposes the SAME interface as the old energy detector so the
 * hook's architecture is unchanged, plus:
 *   - a growing 16 kHz mono PCM window of the current utterance (streaming
 *     STT partials + the final transcription come from here, not MediaRecorder)
 *   - setAISpeaking(): while Mrs. D's own audio is playing, the speech-probability
 *     threshold is raised so only the CALLER's clear voice (not her echo) can
 *     trigger a barge-in (spec §5, §38).
 *
 * The model + worklet + onnxruntime wasm binaries are served from /vad/
 * (frontend/public/vad/) — no runtime CDN dependency.
 */

import * as vadPkg from "@ricky0123/vad-web";

export interface VADOptions {
  /** Kept for API compatibility; the ML end-of-speech patience is `redemptionMs`. */
  silenceMs?: number;
  /** Number of waveform buckets (bars) exposed in levels[]. */
  buckets?: number;
  /** Silero speech probability that STARTS a segment (default 0.30). */
  positiveThreshold?: number;
  /** Silero probability below which audio counts as silence (default 0.25). */
  negativeThreshold?: number;
  /** ms of below-threshold audio before onSpeechEnd fires (default 1100). */
  redemptionMs?: number;
  /** Minimum speech-segment length in ms (default 350). */
  minSpeechMs?: number;
  /** Pre-roll kept by Silero (we start capturing at SpeechStart, so keep small). */
  preSpeechPadMs?: number;
}

export interface VADCallbacks {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  /** A too-short segment was discarded by the ML VAD — noise, not speech. */
  onVADMisfire?: () => void;
}

/** Default Silero thresholds while the caller owns the floor. */
const LISTENING_THRESHOLDS = { positive: 0.3, negative: 0.25 };
/** Raised thresholds while Mrs. D's own voice is playing — her echo must never
 *  score high enough to interrupt her (only a loud, clear caller voice can). */
const AI_SPEAKING_THRESHOLDS = { positive: 0.65, negative: 0.55 };

/** 16 kHz PCM window cap (120 s ≈ 1.92 M samples ≈ 3.8 MB) — a monologue can
 *  never grow memory without bound. */
const PCM_MAX_SAMPLES = 16000 * 120;

export class VoiceActivityDetector {
  analyser: AnalyserNode | null = null;

  /** Live waveform levels, 0..1, updated every animation frame. */
  levels: Float32Array;

  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onVADMisfire?: () => void;

  /** Kept for API compatibility (the energy-based threshold lift is replaced by
   *  `setAISpeaking`, which raises the ML speech-probability threshold). */
  dynamicThreshold: (() => number) | null = null;

  /** Kept for API compatibility (end-of-turn patience is `redemptionMs` + the
   *  hook's adaptive merge grace). */
  dynamicSilenceMs: (() => number) | null = null;

  private micVad: vadPkg.MicVAD | null = null;
  private ctx: AudioContext | null = null;
  private stream_: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private pcmNode: ScriptProcessorNode | null = null;
  private pcmMute: GainNode | null = null;
  private timeData: Float32Array | null = null;
  private rafId = 0;
  private running = false;
  private speechActive = false;
  private activeMs = 0;
  private lastFrame = 0;
  private baseThreshold: number;
  private buckets: number;
  private aiSpeaking = false;

  // ── 16 kHz mono PCM window (streaming STT source) ─────────────────────────
  private pcm: Float32Array = new Float32Array(PCM_MAX_SAMPLES);
  private pcmWrite = 0;
  /** Fractional position of the next output sample inside the current input
   *  block (linear-interpolation resampler state, inputRate → 16 kHz). */
  private resamplePos = 0;

  constructor(opts: VADOptions = {}, callbacks: VADCallbacks = {}) {
    this.baseThreshold = opts.positiveThreshold ?? LISTENING_THRESHOLDS.positive;
    this.buckets = opts.buckets ?? 48;
    this.levels = new Float32Array(this.buckets);
    this.onSpeechStart = callbacks.onSpeechStart;
    this.onSpeechEnd = callbacks.onSpeechEnd;
    this.onVADMisfire = callbacks.onVADMisfire;
    this._thresholds = {
      positive: opts.positiveThreshold ?? LISTENING_THRESHOLDS.positive,
      negative: opts.negativeThreshold ?? LISTENING_THRESHOLDS.negative,
      redemptionMs: opts.redemptionMs ?? 1100,
      minSpeechMs: opts.minSpeechMs ?? 350,
      preSpeechPadMs: opts.preSpeechPadMs ?? 500,
    };
  }

  private _thresholds: {
    positive: number;
    negative: number;
    redemptionMs: number;
    minSpeechMs: number;
    preSpeechPadMs: number;
  };

  get isSpeaking(): boolean {
    return this.speechActive;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** The live microphone stream (API compat; capture now uses the PCM window). */
  get stream(): MediaStream | null {
    return this.stream_;
  }

  /** Milliseconds of genuine ML-detected speech in the current segment. */
  get activeSpeechMs(): number {
    return this.activeMs;
  }

  /**
   * The current utterance's audio as a 16 kHz mono Float32Array (samples in
   * -1..1). The buffer keeps growing from the first speech start until the
   * hook finalizes the turn. Used for live partial transcripts AND the final
   * transcription — one continuous source, no MediaRecorder round-trips.
   */
  getPcmWindow(): Float32Array {
    return this.pcm.slice(0, this.pcmWrite);
  }

  /**
   * Raise/lower the speech-probability thresholds while the AI's own audio is
   * playing. Her voice leaking into the mic must never score above ~0.65, so a
   * caller who is NOT clearly louder cannot accidentally interrupt her.
   */
  setAISpeaking(speaking: boolean): void {
    if (speaking === this.aiSpeaking) return;
    this.aiSpeaking = speaking;
    const t = speaking ? AI_SPEAKING_THRESHOLDS : LISTENING_THRESHOLDS;
    this._thresholds.positive = t.positive;
    this._thresholds.negative = t.negative;
    // setOptions recomputes the frame counters from redemptionMs etc. — cheap
    // and only called on AI-speech transitions, not per frame.
    this.micVad?.setOptions({
      positiveSpeechThreshold: t.positive,
      negativeSpeechThreshold: t.negative,
    });
  }

  /** Acquire the microphone and start Silero VAD. Resolves false on denial. */
  async start(): Promise<boolean> {
    if (this.running) return true;
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctor();
      await this.ctx.resume();
      this.stream_ = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Mono: consistent energy + a single clean channel for VAD/STT.
          channelCount: 1,
        },
      });

      // ── Waveform analyser (visual) — raw mic energy drives the bars. ──────
      this.source = this.ctx.createMediaStreamSource(this.stream_);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.2;
      this.source.connect(this.analyser);
      this.timeData = new Float32Array(this.analyser.fftSize);

      // ── 16 kHz PCM tap (streaming STT source) — ScriptProcessor resamples
      //    the mic to 16 kHz mono and appends into the growing window. Muted
      //    output node satisfies Chrome's ScriptProcessor connection quirk. ──
      this.pcmNode = this.ctx.createScriptProcessor(4096, 1, 1);
      this.pcmMute = this.ctx.createGain();
      this.pcmMute.gain.value = 0;
      this.pcmNode.connect(this.pcmMute);
      this.pcmMute.connect(this.ctx.destination);
      this.pcmNode.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        this.appendPcm(input);
      };

      // ── Silero ML VAD — the speech DECISION layer. ────────────────────────
      this.micVad = await vadPkg.MicVAD.new({
        model: "v5",
        audioContext: this.ctx,
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/vad/",
        startOnLoad: false,
        getStream: async () => this.stream_!,
        // Mic continuity is owned by THIS wrapper (analyser + PCM tap must keep
        // flowing); pause/resume must therefore never stop the shared stream.
        pauseStream: async () => {},
        resumeStream: async (s) => s,
        positiveSpeechThreshold: this._thresholds.positive,
        negativeSpeechThreshold: this._thresholds.negative,
        redemptionMs: this._thresholds.redemptionMs,
        minSpeechMs: this._thresholds.minSpeechMs,
        preSpeechPadMs: this._thresholds.preSpeechPadMs,
        onSpeechStart: () => {
          this.speechActive = true;
          this.onSpeechStart?.();
        },
        onSpeechEnd: () => {
          this.speechActive = false;
          // Hook reads activeSpeechMs synchronously in onSpeechEnd, so reset
          // the counter AFTER the callback.
          this.onSpeechEnd?.();
          this.activeMs = 0;
        },
        onVADMisfire: () => {
          this.onVADMisfire?.();
        },
      });
      await this.micVad.start();

      this.running = true;
      this.lastFrame = performance.now();
      this.rafId = requestAnimationFrame(this.loop);
      return true;
    } catch (e) {
      console.error("Silero VAD start failed:", e);
      this.stop();
      return false;
    }
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    try {
      this.micVad?.destroy();
    } catch {
      /* ignore */
    }
    this.micVad = null;
    try {
      this.pcmNode?.disconnect();
    } catch {
      /* ignore */
    }
    this.pcmNode = null;
    try {
      this.pcmMute?.disconnect();
    } catch {
      /* ignore */
    }
    this.pcmMute = null;
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
    this.speechActive = false;
    this.activeMs = 0;
    this.pcmWrite = 0;
    this.resamplePos = 0;
  }

  /**
   * Clear the current utterance capture + speech flags WITHOUT touching the
   * Silero model (its continuous state is what makes turn detection seamless).
   * Called at turn end / after the AI finishes so her trailing audio can never
   * become the next user query.
   */
  reset(): void {
    this.speechActive = false;
    this.activeMs = 0;
    this.pcmWrite = 0;
    this.resamplePos = 0;
  }

  // ── Waveform + active-speech-ms loop (gated by Silero's decision) ────────
  private loop = () => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);
    const analyser = this.analyser;
    const data = this.timeData;
    if (!analyser || !data) return;

    analyser.getFloatTimeDomainData(data as Float32Array<ArrayBuffer>);

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
    const dt = Math.min(now - this.lastFrame, 100);
    this.lastFrame = now;
    // Only genuine ML-detected speech counts toward the recorder's min-duration
    // gate (a fan, keyboard, or cough never does — Silero won't say "speech").
    if (this.speechActive) this.activeMs += dt;
  };

  // ── 16 kHz mono resampling into the growing PCM window ────────────────────
  private appendPcm(input: Float32Array): void {
    if (this.pcmWrite >= PCM_MAX_SAMPLES) return;
    const rate = this.ctx?.sampleRate || 48000;
    const ratio = rate / 16000; // >= 1 for all supported mic rates
    let pos = this.resamplePos;
    const out = new Float32Array(Math.ceil((input.length - pos) / ratio));
    let written = 0;
    while (pos + 1 < input.length) {
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      out[written++] = input[i0] * (1 - frac) + input[i0 + 1] * frac;
      pos += ratio;
    }
    this.resamplePos = pos - input.length;
    const room = PCM_MAX_SAMPLES - this.pcmWrite;
    const n = Math.min(written, room);
    this.pcm.set(out.subarray(0, n), this.pcmWrite);
    this.pcmWrite += n;
  }
}

/** True when this browser can run the Silero ML VAD pipeline. */
export function isVADSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof (window as any).AudioContext !== "undefined" &&
    typeof WebAssembly !== "undefined" &&
    typeof fetch !== "undefined"
  );
}
