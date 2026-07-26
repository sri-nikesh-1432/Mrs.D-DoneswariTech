import { defineConfig } from "vite";

/**
 * Vite configuration for Doneswari AI Telecaller frontend.
 * Dev server: http://localhost:5175
 * Backend proxy: /api → http://localhost:8000
 */
export default defineConfig({
  root: ".",

  server: {
    port: 5175,
    strictPort: true,       // fail if 5175 is taken instead of picking another port
    host: "localhost",
    open: true,             // auto-open browser on `npm run dev`

    proxy: {
      // Proxy all /api/* requests to the FastAPI backend
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      // Proxy /static/* for audio file serving
      "/static": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },

  preview: {
    port: 5175,
    strictPort: true,
    host: "localhost",
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
