import { defineConfig } from "vite";
import { pwaBuild } from "./scripts/pwa-build.mjs";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    allowedHosts: ["terminal.local"],
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/.well-known": "http://127.0.0.1:8787",
    },
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  plugins: [react(), pwaBuild()],
});
