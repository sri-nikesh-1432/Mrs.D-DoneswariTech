import React from "react";

interface Props {
  bars?: number;
  color?: "ai" | "user" | undefined;
  active?: boolean;
  amplitude?: number;
  className?: string;
  levelsRef?: React.RefObject<Float32Array>;
}

export default function VoiceWaveform({ bars = 24, color, active = false, amplitude = 0, className = "", levelsRef }: Props) {
  const colorPick = color ?? ("ai" as const);
  const items = React.useMemo(() => {
    return Array.from({ length: bars }, (_, i) => {
      const seed = (i / bars) * Math.PI * 2;
      const base = 0.25 + 0.3 * Math.sin(seed + Date.now() / 500);
      let h = base;
      if (active) h = Math.min(1, base + (amplitude || 0) * 0.6);
      return Math.max(6, h * 48);
    });
  }, [bars, active, amplitude]);

  const cls = colorPick === "ai" ? "bg-neutral-400/60" : "bg-amber-500/70";

  return (
    <div className={`flex items-end gap-[3px] ${className}`}>
      {items.map((h, i) => (
        <div key={i} className={`wave-bar ${cls} rounded-full transition-all duration-150`} style={{ height: `${h}px` }} />
      ))}
    </div>
  );
}
