import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ai":     { target: "http://localhost:3001", changeOrigin: true },
      "/files":  { target: "http://localhost:3001", changeOrigin: true },
      "/status": { target: "http://localhost:3001", changeOrigin: true },
      "/preview": { target: "http://localhost:3001", changeOrigin: true, timeout: 0, proxyTimeout: 0 },
      "/sf": {
        target: "http://localhost:3001",
        changeOrigin: true,
        // No timeout for SSE streaming (sf agent preview can take minutes)
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
