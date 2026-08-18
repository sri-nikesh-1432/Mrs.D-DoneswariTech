/**
 * Subtle synthesized "breath" and vocalized fillers between sentences.
 *
 * Real telecallers breathe between utterances and use natural fillers like
 * "mm", "uhh", "hmm" while thinking — that tiny hesitation is a huge part
 * of why a voice reads as human instead of robotic. Edge TTS cannot produce
 * breath sounds or fillers, so we synthesize soft, low-passed vocalizations
 * with the Web Audio API and play them inside the natural gap between
 * sentences.
 *
 * Two layers:
 *   1. Filler sounds ("mm", "uhh", "hmm") — brief vocalized hesitations
 *      that signal "I'm still thinking" or "let me tell you..."
 *   2. Breath sounds — soft inhales between sentences for breathing rhythm
 *
 * Deliberately SUBTLE: if you can clearly hear them as sound effects, they
 * are too loud. They should sit just at the edge of perception, like sitting
 * next to a real person on the phone.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

// ── Filler Sound Types ─────────────────────────────────────────────────────
// Each filler has a fundamental frequency (pitch), formant frequencies, and
// a characteristic envelope. Formants approximate the human vocal tract for
// each specific sound.

interface FillerDef {
  /** Fundamental frequency in Hz (male ~100-150, female ~180-250) */
  f0: number;
  /** Formant frequencies [F1, F2, F3] in Hz */
  formants: [number, number, number];
  /** Formant bandwidths [B1, B2, B3] in Hz */
  bw: [number, number, number];
  /** Duration range [min, max] in seconds */
  dur: [number, number];
  /** Amplitude (0..1) */
  amp: number;
  /** Nasal flag (adds nasal resonance for mm, mmm) */
  nasal?: boolean;
}

const FILLERS: Record<string, FillerDef> = {
  // ── "Hmm" / "Mmm" — thinking, acknowledging ──
  // Closed-mouth nasal sound: F1 is low, strong nasal formant
  hmm: {
    f0: 195,
    formants: [300, 2500, 3200],
    bw: [80, 150, 200],
    dur: [0.25, 0.5],
    amp: 0.08,
    nasal: true,
  },
  mm: {
    f0: 185,
    formants: [280, 2400, 3100],
    bw: [70, 140, 190],
    dur: [0.2, 0.45],
    amp: 0.07,
    nasal: true,
  },

  // ── "Uhh" / "Umm" — hesitation, thinking ──
  // Open vowel with slight nasal: higher F1, mid F2
  uhh: {
    f0: 175,
    formants: [400, 1050, 2600],
    bw: [90, 110, 200],
    dur: [0.3, 0.6],
    amp: 0.07,
  },
  umm: {
    f0: 180,
    formants: [350, 1100, 2700],
    bw: [80, 120, 200],
    dur: [0.25, 0.55],
    amp: 0.07,
    nasal: true,
  },

  // ── "Aha" / "Aah" — acknowledgment, realization ──
  aha: {
    f0: 200,
    formants: [750, 1200, 2800],
    bw: [100, 120, 200],
    dur: [0.2, 0.4],
    amp: 0.06,
  },

  // ── "Ohh" — surprise, understanding ──
  ohh: {
    f0: 190,
    formants: [450, 800, 2600],
    bw: [90, 100, 200],
    dur: [0.2, 0.35],
    amp: 0.06,
  },
};

// Fillers categorized by context — which ones to pick for each situation
const THINKING_FILLERS = ["hmm", "uhh", "umm", "mm"];
const ACKNOWLEDGING_FILLERS = ["hmm", "aha", "ohh", "mm"];
const TRANSITION_FILLERS = ["hmm", "uhh", "aha"];

// Which fillers are natural in which language contexts
const LANGUAGE_FILLERS: Record<string, string[]> = {
  Telugu: ["hmm", "mm", "aha", "ohh"], // "హ్మ్", "మ్మ్", "అహా"
  Hindi: ["hmm", "aha", "ohh", "uhh"],
  English: ["hmm", "uhh", "umm", "ohh"],
  Tamil: ["hmm", "aha", "mm", "ohh"],
  Kannada: ["hmm", "aha", "mm", "ohh"],
  Malayalam: ["hmm", "aha", "mm", "ohh"],
};

export type FillerContext =
  | "thinking" // Before giving a substantial answer
  | "acknowledging" // Acknowledging what the caller said
  | "transition"; // Transitioning between topics

/**
 * Pick a random filler from a list.
 */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Synthesize a vocalized filler sound using formant synthesis.
 *
 * The sound approximates a human vocal tract by combining:
 *   - A glottal source (pulsed sawtooth for voiced, noise for unvoiced)
 *   - Formant filters (resonant peaks at F1, F2, F3)
 *   - Nasal coupling (for mm, hmm — adds a low-frequency resonance)
 *   - Natural jitter (slight pitch/amplitude variation for organic feel)
 */
function synthesizeFiller(
  ctx: AudioContext,
  def: FillerDef,
  duration: number,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const frames = Math.ceil(sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, sampleRate);
  const data = buffer.getChannelData(0);

  const f0 = def.f0;
  const [F1, F2, F3] = def.formants;
  const [B1, B2, B3] = def.bw;

  // Glottal source: bandlimited impulse train (voiced speech)
  const period = sampleRate / f0;
  let phase = 0;

  // Formant state variables (second-order resonator)
  let y1 = 0, y2 = 0; // F1
  let y3 = 0, y4 = 0; // F2
  let y5 = 0, y6 = 0; // F3

  for (let i = 0; i < frames; i++) {
    const t = i / frames;

    // ── Natural envelope ──
    // Slow attack, sustained middle, gentle decay — like a real hesitation
    let env: number;
    const attackEnd = 0.15;
    const decayStart = 0.7;
    if (t < attackEnd) {
      env = Math.pow(t / attackEnd, 0.6); // smooth rise
    } else if (t > decayStart) {
      const rest = 1 - (t - decayStart) / (1 - decayStart);
      env = Math.pow(rest, 1.3); // gentle falloff
    } else {
      env = 0.85 + 0.15 * Math.sin(t * Math.PI * 3); // subtle wobble
    }

    // ── Natural pitch jitter (±2% — real voices are never perfectly steady) ──
    const jitter = 1 + 0.02 * Math.sin(t * 13.7) + 0.01 * Math.sin(t * 29.3);
    const currentF0 = f0 * jitter;
    const currentPeriod = sampleRate / currentF0;

    // ── Glottal source ──
    phase += 1;
    if (phase >= currentPeriod) phase -= currentPeriod;
    // Rosenberg glottal pulse approximation
    const pp = phase / currentPeriod;
    let source: number;
    if (pp < 0.4) {
      // Open phase: smooth rise
      source = 0.5 * (1 - Math.cos(Math.PI * pp / 0.4));
    } else if (pp < 0.6) {
      // Closing phase: sharp fall
      source = Math.cos(Math.PI * (pp - 0.4) / 0.4);
    } else {
      // Closed phase: silence
      source = 0;
    }

    // Add slight breathiness (noise component, ~15% of source)
    source += 0.15 * (Math.random() * 2 - 1);

    // ── Nasal coupling (for mm, hmm) ──
    // Nasal sounds have a low-frequency anti-resonance that creates the
    // characteristic "humming" quality.
    if (def.nasal) {
      // Simple nasal coupling: mix in a low-frequency resonance
      const nasalF = 250; // nasal formant
      const nasalBw = 60;
      const r_n = Math.exp(-Math.PI * nasalBw / sampleRate);
      const theta_n = 2 * Math.PI * nasalF / sampleRate;
      // This adds a slight low-frequency emphasis
      source *= 1.1 + 0.3 * Math.sin(i * theta_n);
    }

    // ── Formant filters (cascaded second-order resonators) ──
    const g1 = Math.exp(-Math.PI * B1 / sampleRate);
    const t1 = 2 * Math.PI * F1 / sampleRate;
    y1 = g1 * y1 + source - g1 * Math.cos(t1) * y1 + (1 - g1) * source * 0.5;
    y2 = g1 * y2 + y1 - g1 * Math.cos(t1) * y2;

    const g2 = Math.exp(-Math.PI * B2 / sampleRate);
    const t2 = 2 * Math.PI * F2 / sampleRate;
    y3 = g2 * y3 + y1 - g2 * Math.cos(t2) * y3 + (1 - g2) * y1 * 0.3;
    y4 = g2 * y4 + y3 - g2 * Math.cos(t2) * y4;

    const g3 = Math.exp(-Math.PI * B3 / sampleRate);
    const t3 = 2 * Math.PI * F3 / sampleRate;
    y5 = g3 * y5 + y3 - g3 * Math.cos(t3) * y5 + (1 - g3) * y3 * 0.15;
    y6 = g3 * y6 + y5 - g3 * Math.cos(t3) * y6;

    // Mix formants: F1 dominates for vowels, F2 for transitions, F3 for brightness
    const voiced = y2 * 0.6 + y4 * 0.3 + y6 * 0.1;

    data[i] = voiced * env * def.amp;
  }

  return buffer;
}

export interface BreathOptions {
  /** Rough duration of the breath in ms (clamped to a realistic range). */
  durationMs?: number;
  /** 0..1 intensity — scales loudness and filter brightness. */
  intensity?: number;
}

export interface FillerOptions {
  /** Context determines which filler to pick. */
  context?: FillerContext;
  /** Language hint for natural filler selection. */
  language?: string;
  /** Override: force a specific filler sound ("hmm", "uhh", etc.) */
  force?: string;
}

// ── Play a breath sound (soft inhale) ──────────────────────────────────────

/**
 * Play one soft breath. No-op when Web Audio is unavailable, the tab is
 * hidden, or the user has never interacted (autoplay policy).
 */
export function playBreath(options: BreathOptions = {}): void {
  if (document.hidden) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const duration = Math.min(Math.max(options.durationMs ?? 420, 200), 650) / 1000;
  const intensity = Math.min(Math.max(options.intensity ?? 0.35, 0), 1);

  // Very quiet — an inhale, not a sound effect (~-22 to -30 dBFS peak).
  const peakGain = 0.04 + intensity * 0.05;

  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  // White noise shaped like a breath: quick attack, gentle rise to ~35% in,
  // then a longer natural falloff — an intake of air, never a click/burst.
  const peakAt = 0.35;
  for (let i = 0; i < frames; i++) {
    const t = i / frames;
    let env: number;
    if (t < peakAt) {
      env = Math.pow(t / peakAt, 0.8);
    } else {
      const rest = 1 - (t - peakAt) / (1 - peakAt);
      env = Math.pow(rest, 1.7);
    }
    data[i] = (Math.random() * 2 - 1) * env;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Low-pass: breath is "air", not hiss. Slightly brighter for stronger breaths.
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 700 + intensity * 900;
  filter.Q.value = 0.7;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peakGain, now + duration * peakAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
  source.stop(now + duration + 0.05);
}

// ── Play a filler sound (vocalized hesitation) ─────────────────────────────

/**
 * Play a natural filler sound ("hmm", "uhh", "mm", etc.).
 * Used between sentences to simulate natural thinking pauses.
 *
 * ~60% of sentence gaps get a filler (the rest are silent breaths),
 * keeping the overall rhythm organic without overdoing it.
 */
export function playFiller(options: FillerOptions = {}): void {
  if (document.hidden) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  // Pick which filler to play
  let fillerKey: string;
  if (options.force && FILLERS[options.force]) {
    fillerKey = options.force;
  } else {
    const context = options.context || "thinking";
    const pool =
      context === "acknowledging"
        ? ACKNOWLEDGING_FILLERS
        : context === "transition"
          ? TRANSITION_FILLERS
          : THINKING_FILLERS;
    fillerKey = pickRandom(pool);
  }

  const def = FILLERS[fillerKey];
  const duration = def.dur[0] + Math.random() * (def.dur[1] - def.dur[0]);
  const buffer = synthesizeFiller(ctx, def, duration);

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Gentle low-pass to soften any harsh harmonics
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 3500;
  filter.Q.value = 0.5;

  const gain = ctx.createGain();
  gain.gain.value = 0.9; // Subtle overall volume

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;
  source.start(now);
  source.stop(now + duration + 0.05);
}

/**
 * Play a filler + breath combo: a brief "hmm..." followed by a soft inhale.
 * This is the most natural "thinking pause" pattern in real conversation.
 *
 * The filler comes first (signals "I'm still thinking"), then the breath
 * (natural pause before speaking). Total duration ~400-800ms.
 */
export function playThinkingPause(options: { language?: string } = {}): void {
  if (document.hidden) return;

  // 60% chance of a filler, 40% chance of just a breath
  if (Math.random() < 0.6) {
    playFiller({ context: "thinking", language: options.language });
    // Breath follows the filler with a slight offset
    const fillerDuration = 300 + Math.random() * 250;
    setTimeout(() => {
      playBreath({ durationMs: 250 + Math.random() * 200, intensity: 0.25 });
    }, fillerDuration);
  } else {
    playBreath({ durationMs: 300 + Math.random() * 250, intensity: 0.3 });
  }
}

/**
 * Determine if a filler should be inserted before this sentence.
 * Rules:
 *   - First sentence of a reply: often has a filler ("Hmm, let me tell you...")
 *   - After a question mark: brief thinking pause
 *   - Long sentence: occasional filler for breathing rhythm
 *   - Sometimes skip for variety (short replies flow without filler)
 */
export function shouldInsertFiller(
  sentence: string,
  isFirstSentence: boolean,
  sentenceIndex: number,
): boolean {
  const s = sentence.trim();

  // First sentence: 55% chance of filler (natural "thinking" opener)
  if (isFirstSentence && Math.random() < 0.55) return true;

  // After a question (caller asked something): 40% chance
  if (s.startsWith("?") || s.includes("?")) {
    return Math.random() < 0.4;
  }

  // Long sentence (>100 chars): occasional filler for rhythm
  if (s.length > 100 && Math.random() < 0.25) return true;

  // Second+ sentence: 20% chance for variety
  if (sentenceIndex > 0 && Math.random() < 0.2) return true;

  return false;
}

// ── Background Ambient Sound ──────────────────────────────────────────────
// Subtle room tone that plays throughout the call — mimics the low-level
// background noise of a real office environment. This is a key Retell AI
// technique for making conversations feel grounded in reality.
//
// The sound is extremely quiet (-35 to -40 dBFS) and uses band-limited
// noise shaped like a quiet office: low-frequency hum (HVAC) + mid-frequency
// presence (distant activity). It should be barely perceptible.

let ambientNode: AudioBufferSourceNode | null = null;
let ambientGain: GainNode | null = null;
let ambientRunning = false;

/**
 * Start subtle background ambient sound. No-op if already running or if
 * Web Audio is unavailable.
 */
export function startAmbient(): void {
  if (ambientRunning) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    // Generate a long buffer of shaped noise (10 seconds, looped)
    const duration = 10;
    const frames = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Shaped noise: low-frequency rumble + mid-frequency presence
    let prevSample = 0;
    for (let i = 0; i < frames; i++) {
      const white = Math.random() * 2 - 1;
      // Brown noise integration (low-frequency emphasis)
      prevSample = (prevSample + 0.02 * white) / 1.02;
      // Mix white (10%) + brown (90%) for natural room tone
      data[i] = prevSample * 0.9 + white * 0.1;
    }

    ambientNode = ctx.createBufferSource();
    ambientNode.buffer = buffer;
    ambientNode.loop = true;

    // Low-pass: room tone is muffled, not hissy
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;
    filter.Q.value = 0.5;

    ambientGain = ctx.createGain();
    ambientGain.gain.value = 0.015; // Very quiet: -36 dBFS approx

    ambientNode.connect(filter);
    filter.connect(ambientGain);
    ambientGain.connect(ctx.destination);

    ambientNode.start();
    ambientRunning = true;
  } catch {
    // Ambient is cosmetic — never break the call
  }
}

/**
 * Stop the background ambient sound.
 */
export function stopAmbient(): void {
  if (!ambientRunning) return;
  try {
    ambientNode?.stop();
    ambientNode?.disconnect();
  } catch {
    /* ignore */
  }
  ambientNode = null;
  ambientGain = null;
  ambientRunning = false;
}

// ── Backchanneling (Agent Acknowledgment While User Talks) ────────────────
// When the user is speaking, the agent occasionally makes soft acknowledgment
// sounds: "mm-hmm", "right", "I see". This is a key Retell AI feature —
// it signals "I'm listening" and makes the conversation feel alive.

const BACKCHANNEL_SOUNDS: Array<
  { text: string; f0: number; formants: [number, number, number]; dur: [number, number] }
> = [
  // "mm-hmm" — nasal acknowledgment (closed mouth)
  { text: "mm-hmm", f0: 200, formants: [300, 2500, 3200], dur: [0.3, 0.5] },
  // "hmm" — soft thinking acknowledgment
  { text: "hmm", f0: 190, formants: [280, 2400, 3100], dur: [0.2, 0.4] },
  // "right" — verbal acknowledgment
  { text: "right", f0: 195, formants: [500, 1400, 2600], dur: [0.2, 0.35] },
  // "ah" — realization sound
  { text: "ah", f0: 210, formants: [700, 1200, 2800], dur: [0.15, 0.3] },
];

let backchannelTimer: ReturnType<typeof setTimeout> | null = null;
let lastBackchannelAt = 0;

/**
 * Play a subtle backchannel sound while the user is talking.
 * Rate-limited: no more than once every 4 seconds.
 */
export function playBackchannel(): void {
  if (document.hidden) return;
  const now = Date.now();
  if (now - lastBackchannelAt < 4000) return; // Rate limit
  lastBackchannelAt = now;

  const ctx = getAudioContext();
  if (!ctx) return;

  const def = BACKCHANNEL_SOUNDS[Math.floor(Math.random() * BACKCHANNEL_SOUNDS.length)];
  const duration = def.dur[0] + Math.random() * (def.dur[1] - def.dur[0]);
  const buffer = synthesizeFiller(ctx, {
    f0: def.f0,
    formants: def.formants,
    bw: [80, 150, 200],
    dur: [duration, duration],
    amp: 0.03, // Very quiet — background acknowledgment
    nasal: def.text.includes("m"),
  }, duration);

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const gain = ctx.createGain();
  gain.gain.value = 0.4; // Quiet — the user is talking, not the agent

  source.connect(gain);
  gain.connect(ctx.destination);

  source.start();
  source.stop(now + duration + 0.05);
}

/**
 * Start periodic backchanneling while the user speaks.
 * Plays a soft "mm-hmm" / "hmm" / "right" every 3-6 seconds.
 */
export function startBackchanneling(): void {
  stopBackchanneling();
  const tick = () => {
    playBackchannel();
    backchannelTimer = setTimeout(tick, 3000 + Math.random() * 3000);
  };
  backchannelTimer = setTimeout(tick, 2000 + Math.random() * 2000);
}

/**
 * Stop backchanneling.
 */
export function stopBackchanneling(): void {
  if (backchannelTimer) {
    clearTimeout(backchannelTimer);
    backchannelTimer = null;
  }
}
