import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by the gateway at /_sp/room/ on the provider's own domain (first-party cookies).
// In dev the gateway proxies to this server; HMR connects here directly.
export default defineConfig({
  base: "/_sp/room/",
  plugins: [react()],
  server: { port: 5173, strictPort: true, hmr: { clientPort: 5173, host: "localhost" } },
  build: { outDir: "dist", emptyOutDir: true },
});
