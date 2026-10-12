/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Instrument Serif", "Georgia", "serif"],
        body: ["Inter", "-apple-system", "sans-serif"],
      },
      colors: {
        // Sky blue — cool accent (ElevenLabs × Apple)
        secondary: {
          50: "#eef7ff", 100: "#def0fe", 200: "#b9e2fd",
          300: "#83cdfa", 400: "#3fb1f5", 500: "#0e93e8",
          600: "#0773c2", 700: "#0a5c9c", 800: "#0d4470",
          900: "#0d304f",
        },
        // Cream / beige — warm light surfaces
        cream: {
          50: "#fffdf9", 100: "#fbf9f4", 200: "#f4f0e7",
          300: "#ece6d8", 400: "#e0d8c4", 500: "#cfc4a9",
          600: "#b4a57f",
        },
        // Warm ink — dark text (near black)
        ink: {
          DEFAULT: "#22211c",
          soft: "#3b3931",
          muted: "#5d594f",
          faint: "#807b6e",
        },
      },
      borderRadius: {
        "4xl": "2rem",
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