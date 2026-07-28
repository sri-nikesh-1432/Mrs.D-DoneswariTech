/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Playfair Display", "serif"],
        body: ["Inter", "sans-serif"],
      },
      colors: {
        primary: {
          50: "#eef2ff", 100: "#e0e7ff", 200: "#c7d2fe",
          300: "#a5b4fc", 400: "#818cf8", 500: "#6366f1",
          600: "#4f46e5", 700: "#4338ca", 800: "#3730a3",
          900: "#312e81",
        },
        secondary: {
          50: "#ecfeff", 100: "#cffafe", 200: "#a5f3fc",
          300: "#67e8f9", 400: "#22d3ee", 500: "#06b6d4",
          600: "#0891b2", 700: "#0e7490", 800: "#155e75",
          900: "#164e63",
        },
        dark: {
          50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0",
          300: "#cbd5e1", 400: "#94a3b8", 500: "#64748b",
          600: "#475569", 700: "#334155", 800: "#1e293b",
          900: "#0f172a", 950: "#020617",
        },
      },
      animation: {
        "float": "float 6s ease-in-out infinite",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "spin-slow": "spin 8s linear infinite",
        "glow": "glow 2s ease-in-out infinite alternate",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        glow: {
          "0%": { opacity: "0.5", filter: "blur(4px)" },
          "100%": { opacity: "1", filter: "blur(8px)" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
