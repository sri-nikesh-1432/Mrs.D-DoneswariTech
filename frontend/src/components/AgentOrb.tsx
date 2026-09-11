import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { VoiceState } from "../types";

interface AgentOrbProps {
  state: VoiceState;
  amplitude?: number;  // 0..1 from mic analyser
  size?: number;       // px, default 200
}

const STATE_COLORS: Record<VoiceState, { from: string; to: string; glow: string }> = {
  idle:       { from: "#bae6fd", to: "#7dd3fc", glow: "rgba(125,211,252,0.3)" },
  connecting: { from: "#7dd3fc", to: "#38bdf8", glow: "rgba(56,189,248,0.35)" },
  listening:  { from: "#38bdf8", to: "#0ea5e9", glow: "rgba(14,165,233,0.5)" },
  thinking:   { from: "#0ea5e9", to: "#0284c7", glow: "rgba(2,132,199,0.45)" },
  speaking:   { from: "#0ea5e9", to: "#38bdf8", glow: "rgba(14,165,233,0.55)" },
  calling:    { from: "#34d399", to: "#10b981", glow: "rgba(16,185,129,0.4)" },
  connected:  { from: "#34d399", to: "#059669", glow: "rgba(5,150,105,0.4)" },
  ended:      { from: "#94a3b8", to: "#64748b", glow: "rgba(100,116,139,0.3)" },
  error:      { from: "#fca5a5", to: "#ef4444", glow: "rgba(239,68,68,0.35)" },
  greeting:   { from: "#a5b4fc", to: "#6366f1", glow: "rgba(99,102,241,0.4)" },
};

export default function AgentOrb({ state, amplitude = 0, size = 200 }: AgentOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef(0);

  const colors = STATE_COLORS[state] ?? STATE_COLORS.idle;

  // Draw organic blob waveform when speaking/listening
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rawCtx = canvas.getContext("2d");
    if (!rawCtx) return;
    const ctx: CanvasRenderingContext2D = rawCtx;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const baseR = size * 0.38;

    function draw() {
      ctx.clearRect(0, 0, size, size);

      const isActive = state === "listening" || state === "speaking";
      const pts = 64;
      const waveAmp = isActive ? baseR * 0.18 * (0.3 + amplitude * 0.7) : baseR * 0.04;
      const freq = state === "listening" ? 5 : state === "speaking" ? 7 : 3;

      phaseRef.current += state === "idle" ? 0.008 : state === "thinking" ? 0.04 : 0.03;
      const phase = phaseRef.current;

      // Build gradient
      const grad = ctx.createRadialGradient(cx - size * 0.08, cy - size * 0.08, 0, cx, cy, size * 0.5);
      grad.addColorStop(0, colors.from + "ff");
      grad.addColorStop(0.6, colors.to + "ee");
      grad.addColorStop(1,   colors.to + "44");

      ctx.beginPath();
      for (let i = 0; i <= pts; i++) {
        const angle = (i / pts) * Math.PI * 2;
        const noise1 = Math.sin(angle * freq + phase) * waveAmp;
        const noise2 = Math.sin(angle * (freq + 2) + phase * 1.3) * waveAmp * 0.5;
        const r = baseR + noise1 + noise2;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // Glow
      ctx.shadowColor = colors.glow;
      ctx.shadowBlur = state === "idle" ? 20 : 36;
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Inner highlight
      const hl = ctx.createRadialGradient(cx - size * 0.1, cy - size * 0.1, 0, cx, cy, baseR * 0.6);
      hl.addColorStop(0, "rgba(255,255,255,0.45)");
      hl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 0.95, 0, Math.PI * 2);
      ctx.fillStyle = hl;
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [state, amplitude, size, colors]);

  return (
    <motion.div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      animate={{
        scale: state === "listening" ? [1, 1.04, 1] : state === "speaking" ? [1, 1.02, 1] : 1,
      }}
      transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
    >
      {/* Outer pulse rings when calling/connecting */}
      {(state === "calling" || state === "connecting") && (
        <>
          {[0, 0.5, 1].map((delay) => (
            <motion.div
              key={delay}
              className="absolute rounded-full border"
              style={{
                width: size + 20,
                height: size + 20,
                borderColor: colors.to + "50",
              }}
              animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, delay, ease: "easeOut" }}
            />
          ))}
        </>
      )}

      {/* Thinking ring spinner */}
      {state === "thinking" && (
        <motion.div
          className="absolute rounded-full"
          style={{
            width: size + 12,
            height: size + 12,
            background: `conic-gradient(${colors.from}, ${colors.to}, transparent)`,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
        />
      )}

      {/* Canvas orb */}
      <canvas ref={canvasRef} className="rounded-full relative z-10" />

      {/* Mrs.D initial / status icon at center */}
      <div
        className="absolute z-20 select-none font-bold text-white/90 tracking-wider"
        style={{ fontSize: size * 0.22, textShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
      >
        {state === "thinking" ? (
          <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
            ···
          </motion.span>
        ) : (
          "M"
        )}
      </div>
    </motion.div>
  );
}
