import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { NEXO_API_PORT, VITE_DEV_PORT } from "./src/shared/ports";

export default defineConfig({
  base: "./",
  plugins: [react()],
  cacheDir: ".vite-cache",
  server: {
    host: "0.0.0.0",
    port: VITE_DEV_PORT,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://localhost:${NEXO_API_PORT}`,
        changeOrigin: true,
      },
      "/uploads": {
        target: `http://localhost:${NEXO_API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
