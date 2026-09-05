import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// 127.0.0.1, not "localhost": on macOS localhost resolves to ::1 first, and
// the server (Bun, listening on IPv4 only) refuses the connection. The result
// is a proxy returning ECONNREFUSED on every call while the backend, queried
// directly, answers in 35 ms — a grid that stays on "loading" for ever with no
// error to explain why.
const backendHost = process.env.BACKEND_HOST ?? "127.0.0.1";
const backend = `http://${backendHost}:${process.env.BACKEND_PORT ?? process.env.PORT ?? "3535"}`;

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(here, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": backend,
      "/raw": backend,
      "/gen": backend,
      "/orphan": backend,
      "/thumb": backend,
      "/graded": backend,
      "/orig": backend,
      "/previews": backend,
    },
  },
  build: {
    outDir: resolve(here, "..", "dist"),
    emptyOutDir: true,
  },
});
