import React, { useEffect, useRef } from "react";
import type { VoiceState } from "../types";

interface RealWaveformProps {
  /** "mic" = user's live microphone; "playback" = the agent's actual audio output. */
  source: "mic" | "playback";
  /** Live amplitude 0..1 from the analyser driving this waveform. */
  amplitude: number;
  active: boolean;
  color?: string;
  height?: number;
  barCount?: number;
}

/**
 * REAL live waveform (spec §33 §34 §59).
 *
 * Renders the ACTUAL audio energy reported by the Web Audio analyser:
 *   - source="mic"       → the user's microphone input
 *   - source="playback"  → the agent's audio output while speaking
 *
 * There are NO sine waves, NO random values, NO decorative animation:
 *   - silence produces a flat baseline (real silence looks silent)
 *   - every bar height is derived from the latest measured amplitude
 *   - a short ring buffer of recent amplitudes gives the waveform its
 *     scrolling shape — it is a history of real measurements, not math.
 */
export default function RealWaveform({
  source,
  amplitude,
  active,
  color = "#0ea5e9",
  height = 56,
  barCount = 40,
}: RealWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  // Ring buffer of REAL measured amplitudes (scrolled over time).
  const historyRef = useRef<number[]>(new Array(barCount).fill(0));
  const ampRef = useRef(0);

  // Keep the latest amplitude in a ref so the RAF loop reads fresh values
  // without re-creating the animation on every frame.
  ampRef.current = active ? Math.max(0, Math.min(1, amplitude)) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rawCtx = canvas.getContext("2d");
    if (!rawCtx) return;
    const ctx: CanvasRenderingContext2D = rawCtx;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const h = height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    let lastPush = 0;
    const PUSH_EVERY_MS = 45; // waveform scroll resolution (~22 fps of history)

    function draw(ts: number) {
      // Push the latest REAL measurement into the history buffer.
      if (ts - lastPush >= PUSH_EVERY_MS) {
        lastPush = ts;
        const hist = historyRef.current;
        hist.push(ampRef.current);
        if (hist.length > barCount) hist.shift();
      }

      ctx.clearRect(0, 0, w, h);
      const hist = historyRef.current;
      const barW = Math.max(2, (w - barCount) / barCount);
      const maxH = h * 0.92;
      const minH = 2;

      for (let i = 0; i < barCount; i++) {
        // Real measured amplitude for this column (0 when silent).
        const v = hist[hist.length - barCount + i] ?? 0;
        const bh = Math.max(minH, v * maxH);
        const x = i * (barW + 1);
        const y = (h - bh) / 2;

        const alpha = v > 0.01 ? 0.55 + v * 0.45 : 0.18;
        ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, "0");
        ctx.beginPath();
        ctx.roundRect(x, y, barW, bh, barW / 2);
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [barCount, color, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: `${height}px` }}
      className="w-full"
      aria-label={`${source === "mic" ? "Your voice" : "Agent audio"} waveform (live)`}
    />
  );
}
