import { describe, expect, it } from "vitest";
import { limparParametro, MODELOS_META, modeloConfirmacao, modeloListaEquipe, modeloPrevia, modeloRastreio, renderizarModeloMeta, textoConfirmacao } from "../src/index.js";

describe("modelos do WhatsApp oficial (Meta)", () => {
  it("seguem as regras da Meta: nome em minúsculas, corpo não começa nem termina com variável, exemplos para cada variável", () => {
    for (const m of MODELOS_META) {
      expect(m.nome).toMatch(/^[a-z0-9_]{1,512}$/);
      expect(m.corpo).not.toMatch(/^\{\{/);
      expect(m.corpo).not.toMatch(/\}\}$/);
      const vars = [...m.corpo.matchAll(/\{\{(\d+)\}\}/g)].map((x) => Number(x[1]));
      expect(vars).toEqual(vars.map((_, i) => i + 1)); // 1, 2, 3… em ordem
      expect(m.exemplo).toHaveLength(vars.length);
      expect(m.corpo.length).toBeLessThanOrEqual(1024);
    }
  });

  it("parâmetro sem quebra de linha, tabulação ou espaços demais, e nunca vazio", () => {
    expect(limparParametro("a\nb\tc      d")).toBe("a b c   d");
    expect(limparParametro("  ")).toBe("-");
  });

  it("a confirmação pelo modelo diz o mesmo que o texto livre", () => {
    const d = { primeiroNome: "Ana", passeio: "City Tour", data: "2026-11-14", ponto: { horario: "08:00", nome: "Villa Romana Shopping", endereco: "Ponto de táxi" }, linkEmbarque: null, transitoIntenso: true };
    const u = modeloConfirmacao(d);
    expect(u.nome).toBe("bybus_confirmacao");
    expect(u.parametros.every((p) => !p.includes("\n"))).toBe(true);
    const viaModelo = renderizarModeloMeta(u).replace(/\s+/g, " ");
    const livre = textoConfirmacao(d).replace(/\s+/g, " ");
    expect(viaModelo).toBe(livre);
  });

  it("prévia, rastreio e lista da equipe", () => {
    expect(renderizarModeloMeta(modeloPrevia({ primeiroNome: "", passeio: "City Tour", data: "2026-11-14", linkEmbarque: null, semPonto: false }))).toContain("Olá, tudo bem!");
    expect(modeloRastreio({ primeiroNome: "Ana", passeio: "City Tour", link: "https://x.test/r/1" }).parametros[2]).toBe("https://x.test/r/1");
    expect(renderizarModeloMeta(modeloListaEquipe({ primeiroNome: "Guia", passeio: "City Tour", data: "2026-11-14", versao: 2, link: "https://x.test/s/1" }))).toContain("lista atualizada, versão 2");
  });
});
