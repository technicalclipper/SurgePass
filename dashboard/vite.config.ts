import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// In local dev the console signs in with ADMIN_TOKEN from the root .env. Production builds never embed it.
export default defineConfig(({ command }) => {
  const env = loadEnv("development", "..", "");
  return {
    plugins: [react()],
    server: { port: 5174, strictPort: true },
    define: {
      "import.meta.env.VITE_DEV_ADMIN_TOKEN": JSON.stringify(command === "serve" ? (env.ADMIN_TOKEN ?? "") : ""),
      "import.meta.env.VITE_GATEWAY_ORIGIN": JSON.stringify(env.GATEWAY_ORIGIN ?? "http://localhost:8080"),
      // VITE_HOSTED=1: the public static build (landing page + integration guide), with no gateway behind it.
      "import.meta.env.VITE_HOSTED": JSON.stringify(process.env.VITE_HOSTED ?? env.VITE_HOSTED ?? ""),
    },
  };
});
