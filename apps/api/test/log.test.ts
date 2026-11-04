import { describe, expect, it } from "vitest";
import { mascararUrl } from "../src/app.js";

describe("log", () => {
  it("não registra o token do link de embarque", () => {
    expect(mascararUrl("/api/publico/embarque/AbC_def-123456789012345678/sugestao")).toBe("/api/publico/embarque/***/sugestao");
    expect(mascararUrl("/api/saidas?data=2026-11-05")).toBe("/api/saidas?data=2026-11-05");
  });

  it("não registra o token do link de rastreio, mas mantém as rotas internas legíveis", () => {
    expect(mascararUrl("/api/publico/rastreio/AbC_def-123456789012345678")).toBe("/api/publico/rastreio/***");
    expect(mascararUrl("/rastreio/AbC_def-123456789012345678")).toBe("/rastreio/***");
    expect(mascararUrl("/api/rastreio/saidas/3f2b8a9e-1c1d-4e5f-9a6b-7c8d9e0f1a2b")).toBe("/api/rastreio/saidas/3f2b8a9e-1c1d-4e5f-9a6b-7c8d9e0f1a2b");
    expect(mascararUrl("/api/rastreio/minhas-saidas")).toBe("/api/rastreio/minhas-saidas");
  });
});
