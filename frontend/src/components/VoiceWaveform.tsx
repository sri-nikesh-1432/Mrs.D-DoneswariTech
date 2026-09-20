import React, { useEffect, useRef } from "react";
import type { VoiceState } from "../types";

interface VoiceWaveformProps {
  state: VoiceState;
  amplitude?: number;   // 0..1 REAL level from the Web Audio analyser
  barCount?: number;
  color?: string;
  height?: number;
}

/**
 * REAL waveform (spec §10): renders the ACTUAL measured audio amplitude.
 *
 * There are NO sine waves, NO phase oscillators, NO random values:
 *   - every bar height comes from the latest real amplitude measurement
 *   - a scrolling ring buffer of real measurements gives the shape
 *   - silence renders flat/minimal exactly as silence sounds
 */
export default function VoiceWaveform({
  state,
  amplitude = 0,
  barCount = 40,
  color = "#0ea5e9",
  height = 56,
}: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  const active = state === "listening" || state === "speaking" || state === "greeting";

  // Ring buffer of REAL measured amplitudes (scrolled over time).
  const historyRef = useRef<number[]>(new Array(barCount).fill(0));
  const ampRef = useRef(0);

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
    const PUSH_EVERY_MS = 45;

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
      const maxH = h * 0.9;
      const minH = h * 0.05;

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
  }, [barCount, color, height, active]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: `${height}px` }}
      className="w-full"
    />
  );
}
