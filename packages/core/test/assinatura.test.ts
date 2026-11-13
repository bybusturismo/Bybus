import { describe, expect, it } from "vitest";
import { folhaDeAssinaturas, mascararCpf, mascararEmail, mesmoNome, resumirNavegador } from "../src/index.js";

describe("assinatura eletrônica (13/11/2026)", () => {
  it("máscaras e conferências", () => {
    expect(mascararEmail("representante@exemplo.test")).toBe("re***********@exemplo.test");
    expect(mascararCpf("529.982.247-25")).toBe("***.982.247-**");
    expect(mesmoNome("  José  da Silva Fictício", "JOSE DA SILVA FICTICIO")).toBe(true);
    expect(mesmoNome("José Fictício", "Maria Fictícia")).toBe(false);
    expect(resumirNavegador("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36")).toBe("Chrome em Android");
    expect(resumirNavegador(null)).toBe("não informado");
  });

  it("folha de assinaturas com código, hash e trilha de cada signatário", () => {
    const f = folhaDeAssinaturas({
      titulo: "Contrato — Escola Fictícia", hashOriginal: "ab".repeat(32), codigo: "BB-7Q2K-9XWM", urlVerificacao: "https://gestao.exemplo.test/verificar/BB-7Q2K-9XWM", enviadoEm: "2026-11-13T15:00:00Z",
      signatarios: [{ papel: "CONTRATANTE", nome: "Representante Fictícia", email: "rep@exemplo.test", cpf: "52998224725", assinadoEm: "2026-11-13T18:30:05Z", ip: "203.0.113.9", navegador: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36" }],
    });
    const t = f.map((b) => ("texto" in b ? b.texto : "")).join("\n");
    expect(t).toContain("BB-7Q2K-9XWM");
    expect(t).toContain("ab".repeat(32));
    expect(t).toContain("1. Representante Fictícia — Contratante");
    expect(t).toContain("13/11/2026, 15:30:05");
    expect(t).toContain("re*@exemplo.test");
    expect(t).toContain("CPF ***.982.247-**");
    expect(t).toContain("IP 203.0.113.9 · Chrome em Windows");
  });
});
