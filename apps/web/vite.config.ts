/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = process.env.BYBUS_API_URL ?? "http://127.0.0.1:3333";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: API, changeOrigin: false } },
  },
  preview: {
    port: 4173,
    proxy: { "/api": { target: API, changeOrigin: false } },
  },
  build: process.env.VITE_DEMO === "1"
    ? { sourcemap: false, target: "es2022", outDir: "dist-demo", modulePreload: false, assetsInlineLimit: 100_000, rollupOptions: { output: { inlineDynamicImports: true } } }
    : { sourcemap: true, target: "es2022" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/teste/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
