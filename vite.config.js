import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ai":     "http://localhost:3001",
      "/files":  "http://localhost:3001",
      "/sf":     "http://localhost:3001",
      "/status": "http://localhost:3001",
    },
  },
});
