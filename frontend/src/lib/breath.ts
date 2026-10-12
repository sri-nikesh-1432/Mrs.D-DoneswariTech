/**
 * Subtle synthesized "breath" between sentences.
 *
 * Real telecallers breathe between utterances — that tiny intake of air is a
 * huge part of why a voice reads as human instead of robotic. Edge TTS cannot
 * produce breath sounds, so we synthesize a soft, low-passed puff of air with
 * the Web Audio API and play it inside the natural gap between sentences.
 *
 * Deliberately SUBTLE: if you can clearly hear it as a sound effect, it is too
 * loud. It should sit just at the edge of perception, like sitting next to a
 * real person on the phone. It is also silent when the tab is hidden or the
 * AudioContext has not been unlocked by a user gesture yet.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as any).webkitAudioContext;
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

export interface BreathOptions {
  /** Rough duration of the breath in ms (clamped to a realistic range). */
  durationMs?: number;
  /** 0..1 intensity — scales loudness and filter brightness. */
  intensity?: number;
}

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
