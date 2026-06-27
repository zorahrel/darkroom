import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const backend = `http://localhost:${process.env.BACKEND_PORT ?? process.env.PORT ?? "3535"}`;

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
    },
  },
  build: {
    outDir: resolve(here, "..", "dist"),
    emptyOutDir: true,
  },
});
