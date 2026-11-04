import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: process.env.SAFI_API_PROXY ?? "http://localhost:8080",
        changeOrigin: true
      },
      "/wm": {
        target: process.env.SAFI_WINDMILL_PROXY ?? "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/wm/, ""),
        ws: true
      }
    }
  },
  build: {
    sourcemap: false,
    target: "es2022"
  }
});
