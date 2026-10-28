import React, { useEffect, useState } from "react";

/**
 * Single Elegant Butterfly Component.
 * Perched gracefully on top of the letter 'r' in "Telecaller" at the top corner.
 * Gently basks its 3D wings every few seconds, exactly as requested:
 * "just one butterfly on telecaller thats it enough".
 */

export default function Butterflies() {
  const [anchorPos, setAnchorPos] = useState<{ x: number; y: number } | null>(null);
  const [flutter, setFlutter] = useState(false);

  useEffect(() => {
    const updateTarget = () => {
      const target =
        document.getElementById("telecaller-r-anchor") ||
        document.querySelector(".telecaller-r-target");

      if (target) {
        const rect = target.getBoundingClientRect();
        // Land gently right on top-right of the letter 'r'
        setAnchorPos({
          x: rect.right - 8,
          y: rect.top - 18,
        });
      } else {
        // Fallback position near top brand logo
        setAnchorPos({
          x: window.innerWidth > 768 ? 260 : window.innerWidth - 60,
          y: 26,
        });
      }
    };

    updateTarget();
    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget);

    const timer = setInterval(updateTarget, 2000);

    return () => {
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget);
      clearInterval(timer);
    };
  }, []);

  const handleClick = () => {
    setFlutter(true);
    setTimeout(() => setFlutter(false), 2000);
  };

  if (!anchorPos) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
      {/* ─── Single Butterfly: Perched on 'r' of Telecaller ─── */}
      <div
        onClick={handleClick}
        title="Telecaller butterfly"
        className="absolute cursor-pointer pointer-events-auto transition-transform duration-700 ease-out"
        style={{
          left: `${anchorPos.x}px`,
          top: `${anchorPos.y}px`,
          transform: flutter
            ? "scale(0.95) rotate(-5deg) translateY(-8px)"
            : "scale(0.85) rotate(-12deg)",
        }}
      >
        <div
          className="relative select-none"
          style={{
            width: 38,
            height: 32,
            perspective: 400,
            filter: "drop-shadow(0 3px 6px rgba(2, 132, 199, 0.45))",
          }}
        >
          {/* 3D Butterfly Container */}
          <div
            className="w-full h-full flex items-center justify-center relative"
            style={{ transformStyle: "preserve-3d" }}
          >
            {/* Left Wing */}
            <div
              className={`absolute left-0 top-0 w-1/2 h-full ${
                flutter ? "fast-flap-left" : "basking-wing-left"
              }`}
              style={{ transformOrigin: "right center" }}
            >
              <svg viewBox="0 0 50 60" className="w-full h-full overflow-visible">
                <defs>
                  <linearGradient id="single-bfly-l" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#0284C7" />
                    <stop offset="55%" stopColor="#38BDF8" />
                    <stop offset="100%" stopColor="#BAE6FD" />
                  </linearGradient>
                </defs>
                <path
                  d="M 48 30 C 35 15, 15 5, 2 12 C -4 16, 2 34, 18 38 C 30 40, 44 33, 48 30 Z"
                  fill="url(#single-bfly-l)"
                  stroke="#0f172a"
                  strokeWidth="1.2"
                />
                <path
                  d="M 48 32 C 38 35, 15 36, 10 46 C 6 54, 22 58, 32 52 C 40 46, 46 36, 48 32 Z"
                  fill="url(#single-bfly-l)"
                  stroke="#0f172a"
                  strokeWidth="1.2"
                />
                <path
                  d="M 45 30 Q 25 22 10 18 M 45 31 Q 28 32 16 34 M 45 33 Q 32 42 22 48"
                  stroke="#0f172a"
                  strokeWidth="0.75"
                  fill="none"
                  opacity="0.65"
                />
                <circle cx="8" cy="14" r="1.2" fill="#ffffff" />
                <circle cx="16" cy="10" r="1.2" fill="#ffffff" />
                <circle cx="28" cy="8" r="1.2" fill="#ffffff" />
                <circle cx="14" cy="50" r="1.2" fill="#ffffff" />
                <circle cx="22" cy="54" r="1.2" fill="#ffffff" />
              </svg>
            </div>

            {/* Center Body & Antennae */}
            <div className="absolute z-10 w-1.5 h-6 bg-slate-900 rounded-full flex flex-col items-center justify-between shadow-sm">
              <div className="relative -top-2 flex gap-1.5 text-slate-800">
                <span className="w-2.5 h-2.5 border-t border-l border-slate-800 rounded-tl-full block -rotate-12" />
                <span className="w-2.5 h-2.5 border-t border-r border-slate-800 rounded-tr-full block rotate-12" />
              </div>
            </div>

            {/* Right Wing */}
            <div
              className={`absolute right-0 top-0 w-1/2 h-full ${
                flutter ? "fast-flap-right" : "basking-wing-right"
              }`}
              style={{ transformOrigin: "left center" }}
            >
              <svg viewBox="0 0 50 60" className="w-full h-full overflow-visible">
                <defs>
                  <linearGradient id="single-bfly-r" x1="100%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#0284C7" />
                    <stop offset="55%" stopColor="#38BDF8" />
                    <stop offset="100%" stopColor="#BAE6FD" />
                  </linearGradient>
                </defs>
                <path
                  d="M 2 30 C 15 15, 35 5, 48 12 C 54 16, 48 34, 32 38 C 20 40, 6 33, 2 30 Z"
                  fill="url(#single-bfly-r)"
                  stroke="#0f172a"
                  strokeWidth="1.2"
                />
                <path
                  d="M 2 32 C 12 35, 35 36, 40 46 C 44 54, 28 58, 18 52 C 10 46, 4 36, 2 32 Z"
                  fill="url(#single-bfly-r)"
                  stroke="#0f172a"
                  strokeWidth="1.2"
                />
                <path
                  d="M 5 30 Q 25 22 40 18 M 5 31 Q 22 32 34 34 M 5 33 Q 18 42 28 48"
                  stroke="#0f172a"
                  strokeWidth="0.75"
                  fill="none"
                  opacity="0.65"
                />
                <circle cx="42" cy="14" r="1.2" fill="#ffffff" />
                <circle cx="34" cy="10" r="1.2" fill="#ffffff" />
                <circle cx="22" cy="8" r="1.2" fill="#ffffff" />
                <circle cx="36" cy="50" r="1.2" fill="#ffffff" />
                <circle cx="28" cy="54" r="1.2" fill="#ffffff" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        /* Slow, natural basking fold when resting on letter 'r' */
        @keyframes baskLeft {
          0%, 100% { transform: rotateY(20deg); }
          40% { transform: rotateY(65deg); }
          45% { transform: rotateY(15deg); }
          50% { transform: rotateY(60deg); }
          55% { transform: rotateY(20deg); }
        }
        @keyframes baskRight {
          0%, 100% { transform: rotateY(-20deg); }
          40% { transform: rotateY(-65deg); }
          45% { transform: rotateY(-15deg); }
          50% { transform: rotateY(-60deg); }
          55% { transform: rotateY(-20deg); }
        }
        .basking-wing-left {
          animation: baskLeft 3.5s ease-in-out infinite;
        }
        .basking-wing-right {
          animation: baskRight 3.5s ease-in-out infinite;
        }

        /* Fast energetic flap on click */
        @keyframes fastFlapLeft {
          0% { transform: rotateY(10deg); }
          100% { transform: rotateY(75deg); }
        }
        @keyframes fastFlapRight {
          0% { transform: rotateY(-10deg); }
          100% { transform: rotateY(-75deg); }
        }
        .fast-flap-left {
          animation: fastFlapLeft 0.18s ease-in-out infinite alternate;
        }
        .fast-flap-right {
          animation: fastFlapRight 0.18s ease-in-out infinite alternate;
        }
      `}</style>
    </div>
  );
}
