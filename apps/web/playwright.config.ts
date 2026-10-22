import { defineConfig, devices } from "@playwright/test";

/**
 * Testes ponta a ponta contra a API local (dados fictícios).
 * Pré-requisito: API rodando em 127.0.0.1:3333 com SEMEAR_FICTICIOS=true (ver README do app).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BYBUS_WEB_URL ?? "http://localhost:5173",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
