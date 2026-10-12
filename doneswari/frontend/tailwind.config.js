/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ivory: "#FFFFF0",
        cognac: "#9B4520",
        warmwhite: "#FAF9F6",
        softblack: "#1A1A1A",
        beige: "#F5F0E8",
        muted: "#8B8680",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
}
