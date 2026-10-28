import React, { useEffect, useState } from "react";

/**
 * High-fidelity 3D flapping butterfly component.
 * Features 3 unique butterflies:
 * 1. Perching Butterfly: swoops across the top and lands on the 'r' letter of "Telecaller",
 *    resting with gentle wing folds, then taking off periodically.
 * 2. Sky Morpho Glider: flutters along a graceful curved arc across the screen.
 * 3. Amber Monarch: wanders smoothly in ambient space with soft floating physics.
 */

interface ButterflyWingProps {
  colorScheme: "sky" | "cyan" | "gold";
  isResting?: boolean;
}

function ButterflySvg({ colorScheme, isResting }: ButterflyWingProps) {
  // Gradients for wings
  const gradients = {
    sky: {
      id: "grad-sky",
      base: "#0284C7",
      mid: "#38BDF8",
      light: "#BAE6FD",
      glow: "rgba(56, 189, 248, 0.4)",
    },
    cyan: {
      id: "grad-cyan",
      base: "#0891B2",
      mid: "#06B6D4",
      light: "#A5F3FC",
      glow: "rgba(6, 182, 212, 0.4)",
    },
    gold: {
      id: "grad-gold",
      base: "#D97706",
      mid: "#F59E0B",
      light: "#FDE68A",
      glow: "rgba(245, 158, 11, 0.4)",
    },
  }[colorScheme];

  return (
    <div
      className="relative select-none pointer-events-auto cursor-pointer"
      style={{
        width: 38,
        height: 32,
        perspective: 400,
        filter: `drop-shadow(0 4px 6px ${gradients.glow})`,
      }}
    >
      {/* 3D Container */}
      <div
        className="w-full h-full flex items-center justify-center relative"
        style={{ transformStyle: "preserve-3d" }}
      >
        {/* Left Wing */}
        <div
          className={`absolute left-0 top-0 w-1/2 h-full ${
            isResting ? "basking-wing-left" : "flapping-wing-left"
          }`}
          style={{ transformOrigin: "right center" }}
        >
          <svg viewBox="0 0 50 60" className="w-full h-full overflow-visible">
            <defs>
              <linearGradient id={`${gradients.id}-l`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={gradients.base} />
                <stop offset="50%" stopColor={gradients.mid} />
                <stop offset="100%" stopColor={gradients.light} />
              </linearGradient>
            </defs>
            {/* Forewing */}
            <path
              d="M 48 30 C 35 15, 15 5, 2 12 C -4 16, 2 34, 18 38 C 30 40, 44 33, 48 30 Z"
              fill={`url(#${gradients.id}-l)`}
              stroke="#0f172a"
              strokeWidth="1.2"
            />
            {/* Hindwing */}
            <path
              d="M 48 32 C 38 35, 15 36, 10 46 C 6 54, 22 58, 32 52 C 40 46, 46 36, 48 32 Z"
              fill={`url(#${gradients.id}-l)`}
              stroke="#0f172a"
              strokeWidth="1.2"
            />
            {/* Wing Veins */}
            <path
              d="M 45 30 Q 25 22 10 18 M 45 31 Q 28 32 16 34 M 45 33 Q 32 42 22 48"
              stroke="#0f172a"
              strokeWidth="0.75"
              fill="none"
              opacity="0.65"
            />
            {/* Margin dots */}
            <circle cx="8" cy="14" r="1.2" fill="#ffffff" />
            <circle cx="16" cy="10" r="1.2" fill="#ffffff" />
            <circle cx="28" cy="8" r="1.2" fill="#ffffff" />
            <circle cx="14" cy="50" r="1.2" fill="#ffffff" />
            <circle cx="22" cy="54" r="1.2" fill="#ffffff" />
          </svg>
        </div>

        {/* Center Body & Antennae */}
        <div className="absolute z-10 w-1.5 h-6 bg-slate-900 rounded-full flex flex-col items-center justify-between shadow-sm">
          {/* Antennae */}
          <div className="relative -top-2 flex gap-1.5 text-slate-800">
            <span className="w-2.5 h-2.5 border-t border-l border-slate-800 rounded-tl-full block -rotate-12" />
            <span className="w-2.5 h-2.5 border-t border-r border-slate-800 rounded-tr-full block rotate-12" />
          </div>
        </div>

        {/* Right Wing */}
        <div
          className={`absolute right-0 top-0 w-1/2 h-full ${
            isResting ? "basking-wing-right" : "flapping-wing-right"
          }`}
          style={{ transformOrigin: "left center" }}
        >
          <svg viewBox="0 0 50 60" className="w-full h-full overflow-visible">
            <defs>
              <linearGradient id={`${gradients.id}-r`} x1="100%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={gradients.base} />
                <stop offset="50%" stopColor={gradients.mid} />
                <stop offset="100%" stopColor={gradients.light} />
              </linearGradient>
            </defs>
            {/* Forewing */}
            <path
              d="M 2 30 C 15 15, 35 5, 48 12 C 54 16, 48 34, 32 38 C 20 40, 6 33, 2 30 Z"
              fill={`url(#${gradients.id}-r)`}
              stroke="#0f172a"
              strokeWidth="1.2"
            />
            {/* Hindwing */}
            <path
              d="M 2 32 C 12 35, 35 36, 40 46 C 44 54, 28 58, 18 52 C 10 46, 4 36, 2 32 Z"
              fill={`url(#${gradients.id}-r)`}
              stroke="#0f172a"
              strokeWidth="1.2"
            />
            {/* Wing Veins */}
            <path
              d="M 5 30 Q 25 22 40 18 M 5 31 Q 22 32 34 34 M 5 33 Q 18 42 28 48"
              stroke="#0f172a"
              strokeWidth="0.75"
              fill="none"
              opacity="0.65"
            />
            {/* Margin dots */}
            <circle cx="42" cy="14" r="1.2" fill="#ffffff" />
            <circle cx="34" cy="10" r="1.2" fill="#ffffff" />
            <circle cx="22" cy="8" r="1.2" fill="#ffffff" />
            <circle cx="36" cy="50" r="1.2" fill="#ffffff" />
            <circle cx="28" cy="54" r="1.2" fill="#ffffff" />
          </svg>
        </div>
      </div>
    </div>
  );
}

export default function Butterflies() {
  const [perchedOnR, setPerchedOnR] = useState(true);
  const [anchorPos, setAnchorPos] = useState<{ x: number; y: number } | null>(null);
  const [playfulFlutter, setPlayfulFlutter] = useState(false);

  // Locate the 'r' letter in "Telecaller" dynamically
  useEffect(() => {
    const updateTarget = () => {
      // Look for the target letter anchor in DOM
      const target =
        document.getElementById("telecaller-r-anchor") ||
        document.querySelector(".telecaller-r-target");

      if (target) {
        const rect = target.getBoundingClientRect();
        // Land slightly above and to the right of the letter 'r'
        setAnchorPos({
          x: rect.right - 10,
          y: rect.top - 18,
        });
      } else {
        // Fallback to top-right logo position
        setAnchorPos({
          x: window.innerWidth > 768 ? 260 : window.innerWidth - 60,
          y: 28,
        });
      }
    };

    updateTarget();
    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget);

    // Periodically switch between perching on 'r' and flying a playful circle
    const flightCycle = setInterval(() => {
      setPerchedOnR(false);
      setTimeout(() => {
        updateTarget();
        setPerchedOnR(true);
      }, 7000); // Fly for 7 seconds, then land and rest for 12 seconds
    }, 19000);

    return () => {
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget);
      clearInterval(flightCycle);
    };
  }, []);

  const handlePercherClick = () => {
    setPlayfulFlutter(true);
    setPerchedOnR(false);
    setTimeout(() => {
      setPerchedOnR(true);
      setPlayfulFlutter(false);
    }, 4500);
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
      {/* ─── Butterfly 1: The Percher (Lands on 'r' of Telecaller) ─── */}
      <div
        onClick={handlePercherClick}
        title="Friendly Telecaller butterfly — click me to make me fly!"
        className={`absolute transition-all duration-1000 ease-in-out cursor-pointer pointer-events-auto ${
          perchedOnR ? "butterfly-perched" : "butterfly-flight-path-1"
        }`}
        style={
          perchedOnR && anchorPos
            ? {
                left: `${anchorPos.x}px`,
                top: `${anchorPos.y}px`,
                transform: "scale(0.85) rotate(-12deg)",
                transition: "all 2.2s cubic-bezier(0.25, 1, 0.5, 1)",
              }
            : undefined
        }
      >
        <ButterflySvg colorScheme="sky" isResting={perchedOnR && !playfulFlutter} />
      </div>

      {/* ─── Butterfly 2: The Sky Cruiser (Soars across screen) ─── */}
      <div className="absolute butterfly-flight-path-2 pointer-events-auto">
        <ButterflySvg colorScheme="cyan" />
      </div>

      {/* ─── Butterfly 3: The Golden Monarch (Gentle ambient drift) ─── */}
      <div className="absolute butterfly-flight-path-3 pointer-events-auto">
        <ButterflySvg colorScheme="gold" />
      </div>

      {/* Styles for lifelike 3D flapping, perching, and flight paths */}
      <style>{`
        /* Wing Flap Animations */
        @keyframes flapLeft {
          0% { transform: rotateY(0deg) rotateZ(0deg); }
          50% { transform: rotateY(55deg) rotateZ(6deg); }
          100% { transform: rotateY(74deg) rotateZ(10deg); }
        }
        @keyframes flapRight {
          0% { transform: rotateY(0deg) rotateZ(0deg); }
          50% { transform: rotateY(-55deg) rotateZ(-6deg); }
          100% { transform: rotateY(-74deg) rotateZ(-10deg); }
        }
        .flapping-wing-left {
          animation: flapLeft 0.22s ease-in-out infinite alternate;
        }
        .flapping-wing-right {
          animation: flapRight 0.22s ease-in-out infinite alternate;
        }

        /* Basking / Resting Wing Fold on Letter 'r' */
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
          animation: baskLeft 4s ease-in-out infinite;
        }
        .basking-wing-right {
          animation: baskRight 4s ease-in-out infinite;
        }

        /* Flight Path 1 (When airborne, swooping before landing) */
        @keyframes flightCycle1 {
          0% {
            left: 20%;
            top: 15%;
            transform: scale(0.9) rotate(20deg);
          }
          25% {
            left: 45%;
            top: 8%;
            transform: scale(1) rotate(-15deg);
          }
          50% {
            left: 65%;
            top: 22%;
            transform: scale(0.95) rotate(35deg);
          }
          75% {
            left: 40%;
            top: 25%;
            transform: scale(0.88) rotate(-25deg);
          }
          100% {
            left: 20%;
            top: 15%;
            transform: scale(0.9) rotate(20deg);
          }
        }
        .butterfly-flight-path-1 {
          animation: flightCycle1 7s ease-in-out infinite;
        }

        /* Flight Path 2 (Sky Cruiser across viewport) */
        @keyframes flightCycle2 {
          0% {
            left: -5%;
            top: 75%;
            transform: scale(0.9) rotate(35deg);
          }
          20% {
            left: 22%;
            top: 55%;
            transform: scale(0.95) rotate(15deg);
          }
          40% {
            left: 48%;
            top: 62%;
            transform: scale(1.05) rotate(40deg);
          }
          65% {
            left: 75%;
            top: 38%;
            transform: scale(0.95) rotate(-10deg);
          }
          85% {
            left: 95%;
            top: 20%;
            transform: scale(0.85) rotate(25deg);
          }
          100% {
            left: 105%;
            top: 10%;
            transform: scale(0.8) rotate(20deg);
          }
        }
        .butterfly-flight-path-2 {
          animation: flightCycle2 24s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        /* Flight Path 3 (Golden Monarch ambient drift) */
        @keyframes flightCycle3 {
          0% {
            right: 8%;
            top: 35%;
            transform: scale(0.85) rotate(-15deg);
          }
          25% {
            right: 18%;
            top: 48%;
            transform: scale(0.92) rotate(20deg);
          }
          50% {
            right: 12%;
            top: 65%;
            transform: scale(0.88) rotate(-30deg);
          }
          75% {
            right: 5%;
            top: 50%;
            transform: scale(0.95) rotate(15deg);
          }
          100% {
            right: 8%;
            top: 35%;
            transform: scale(0.85) rotate(-15deg);
          }
        }
        .butterfly-flight-path-3 {
          animation: flightCycle3 18s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
