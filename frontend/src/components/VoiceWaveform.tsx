import React, { useEffect, useRef } from "react";
import type { VoiceState } from "../types";

interface VoiceWaveformProps {
  state: VoiceState;
  amplitude?: number;   // 0..1
  barCount?: number;
  color?: string;
  height?: number;
}

export default function VoiceWaveform({
  state,
  amplitude = 0,
  barCount = 40,
  color = "#0ea5e9",
  height = 56,
}: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef(0);

  const active = state === "listening" || state === "speaking" || state === "greeting";

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

    function draw() {
      ctx.clearRect(0, 0, w, h);
      phaseRef.current += active ? 0.06 : 0.015;
      const phase = phaseRef.current;

      const barW = (w - barCount) / barCount;
      const gap = 1;
      const maxH = h * 0.9;
      const minH = h * 0.06;

      for (let i = 0; i < barCount; i++) {
        const norm = i / barCount;
        const wave =
          Math.sin(norm * Math.PI * 4 + phase) * 0.5 +
          Math.sin(norm * Math.PI * 2.5 + phase * 0.7) * 0.3 +
          Math.sin(norm * Math.PI * 7 + phase * 1.3) * 0.2;

        const amp = active ? (0.4 + amplitude * 0.6) : 0.08;
        const bh = Math.max(minH, ((wave + 1) / 2) * maxH * amp + minH);

        const x = i * (barW + gap);
        const y = (h - bh) / 2;

        const alpha = active ? 0.7 + norm * 0.3 : 0.25;
        ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, "0");
        ctx.beginPath();
        ctx.roundRect(x, y, barW, bh, barW / 2);
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [state, amplitude, barCount, color, height, active]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: `${height}px` }}
      className="w-full"
    />
  );
}
