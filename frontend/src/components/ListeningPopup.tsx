import React from "react";

interface Props {
  amplitude?: number; // 0..1
  lang?: string;
}

export default function ListeningPopup({ amplitude = 0, lang = "English" }: Props) {
  const count = 12;
  // Oscillate bars even without mic amplitude so the popup feels alive
  const bars = React.useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const phase = (i / count) * Math.PI * 2;
      const base = 0.35 + 0.25 * Math.sin(phase + Date.now() / 400);
      const amp = Math.min(1, Math.max(0.15, base + (amplitude || 0) * 0.4));
      return amp;
    });
  }, [amplitude]);

  const label = lang === "Telugu" ? "వింటోంది..." :
                lang === "Hindi" ? "सुन रहा है..." :
                lang === "Tamil" ? "கேட்கிறது..." :
                lang === "Kannada" ? "ಕೇಳುತ್ತಿದೆ..." :
                lang === "Malayalam" ? "കേൾക്കുന്നു..." :
                "Listening...";

  return (
    <div className="fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none">
      <div className="glass-card-static px-6 py-4 flex items-center gap-4 shadow-xl">
        <div className="flex items-end gap-[3px] h-10 w-12">
          {bars.map((h, i) => (
            <div
              key={i}
              className="wave-bar ai"
              style={{ height: `${Math.max(6, h * 36)}px` }}
            />
          ))}
        </div>
        <span className="text-sm font-medium text-neutral-700 bg-neutral-100 px-3 py-1 rounded-full">
          {label}
        </span>
      </div>
    </div>
  );
}
