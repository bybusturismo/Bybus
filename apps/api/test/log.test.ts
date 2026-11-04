import { describe, expect, it } from "vitest";
import { mascararUrl } from "../src/app.js";

describe("log", () => {
  it("não registra o token do link de embarque", () => {
    expect(mascararUrl("/api/publico/embarque/AbC_def-123456789012345678/sugestao")).toBe("/api/publico/embarque/***/sugestao");
    expect(mascararUrl("/api/saidas?data=2026-11-05")).toBe("/api/saidas?data=2026-11-05");
  });

  it("não registra o token do aviso do WhatsApp (rota interna)", () => {
    expect(mascararUrl("/api/interno/whatsapp/0123456789abcdef0123456789abcdef0123")).toBe("/api/interno/whatsapp/***");
  });
});
