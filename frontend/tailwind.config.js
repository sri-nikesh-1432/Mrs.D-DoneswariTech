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
        // Cognac — warm brand brown
        primary: {
          50: "#fbf3ee", 100: "#f5e2d6", 200: "#e9c4ac",
          300: "#d9a180", 400: "#c07b52", 500: "#a85a32",
          600: "#8f4426", 700: "#75341d", 800: "#5c2918",
          900: "#452012",
        },
        // Sky blue — fresh accent
        secondary: {
          50: "#f0f9fe", 100: "#dcf1fb", 200: "#b8e2f7",
          300: "#8cd0f0", 400: "#5ab8e4", 500: "#3a9fd6",
          600: "#2b82b5", 700: "#256992", 800: "#225474",
          900: "#1f465f",
        },
        // Cream / beige — warm light surfaces
        cream: {
          50: "#fffdf8", 100: "#fbf6ec", 200: "#f5edde",
          300: "#f0e6d1", 400: "#e8dcc4", 500: "#ded0b2",
          600: "#c9b896",
        },
        // Warm ink — dark text
        ink: {
          DEFAULT: "#43301f",
          soft: "#5c4632",
          muted: "#8a7157",
          faint: "#9c8369",
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