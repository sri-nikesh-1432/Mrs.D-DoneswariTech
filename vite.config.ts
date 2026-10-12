export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": "ws://localhost:8000",
      "/api/ws": "ws://localhost:8000",
    },
  }
});
