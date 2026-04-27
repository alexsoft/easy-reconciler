import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://api:3001", changeOrigin: true } },
  },
  test: { environment: "jsdom", globals: false, setupFiles: ["src/test-setup.ts"] },
});
