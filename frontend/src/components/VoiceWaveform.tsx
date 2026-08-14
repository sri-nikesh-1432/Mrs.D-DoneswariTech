import React, { useEffect, useRef } from "react";

/**
 * VoiceWaveform — a REAL-TIME waveform canvas.
 *
 * Unlike the old fake CSS bars, this component reads live audio levels from a
 * shared Float32Array (fed by the VAD analyser for the user's mic, or by the
 * AI audio element's analyser while Mrs. D speaks) and redraws every animation
 * frame — so the bars wave exactly with the sound being made.
 *
 * Props:
 *   levelsRef  - a ref to a Float32Array of bar levels (0..1), updated
 *                continuously by the audio pipeline.
 *   active     - when true, bars animate to the live levels; when false they
 *                settle into a calm idle state.
 *   color      - "user" (green) while the caller talks, "ai" (purple/blue)
 *                while Mrs. D talks, "idle" (slate) otherwise.
 */
export default function VoiceWaveform({
  levelsRef,
  active = false,
  color = "idle",
  className = "",
  barCount = 40,
}: {
  levelsRef: React.MutableRefObject<Float32Array>;
  active?: boolean;
  color?: "user" | "ai" | "idle";
  className?: string;
  barCount?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const dpr = window.devicePixelRatio || 1;
    // Smooth the bars slightly so they feel fluid, not jittery.
    const smooth: number[] = new Array(barCount).fill(0);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const levels = levelsRef.current;
      const count = Math.min(barCount, levels.length);

      // ── Color palette per mode ──────────────────────────────────────
      let top = "rgba(148,163,184,0.85)"; // slate (idle)
      let bottom = "rgba(100,116,139,0.35)";
      let glow = "rgba(148,163,184,0.12)";
      if (color === "user") {
        top = "rgba(74,222,128,0.95)"; // green — caller speaking
        bottom = "rgba(16,185,129,0.45)";
        glow = "rgba(74,222,128,0.18)";
      } else if (color === "ai") {
        top = "rgba(167,139,250,0.95)"; // purple/blue — AI speaking
        bottom = "rgba(99,102,241,0.45)";
        glow = "rgba(167,139,250,0.18)";
      }

      const gap = 3;
      const barW = (w - gap * (count - 1)) / count;
      const midY = h / 2;
      const maxBar = h - 6;

      // Soft outer glow behind the bars.
      ctx.shadowColor = glow;
      ctx.shadowBlur = active ? 14 : 4;

      for (let i = 0; i < count; i++) {
        const raw = active ? levels[i] : 0.02 + Math.sin(i * 0.35 + Date.now() * 0.001) * 0.012;
        // Ease toward the target so the wave flows naturally.
        smooth[i] += (Math.min(1, Math.max(0, raw)) - smooth[i]) * 0.28;
        const barH = Math.max(2, smooth[i] * maxBar);
        const x = i * (barW + gap);
        const y = midY - barH / 2;

        const grad = ctx.createLinearGradient(0, y, 0, y + barH);
        grad.addColorStop(0, top);
        grad.addColorStop(1, bottom);
        ctx.fillStyle = grad;

        const r = Math.min(barW / 2, 4);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + barW - r, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
        ctx.lineTo(x + barW, y + barH - r);
        ctx.quadraticCurveTo(x + barW, y + barH, x + barW - r, y + barH);
        ctx.lineTo(x + r, y + barH);
        ctx.quadraticCurveTo(x, y + barH, x, y + barH - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [levelsRef, active, color, barCount]);

  return <canvas ref={canvasRef} className={className} />;
}
