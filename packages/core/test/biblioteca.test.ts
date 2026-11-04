import { describe, expect, it } from "vitest";
import { acessoEfetivo, analisarInline, analisarMarkdown, caminhoDaPagina, criaCiclo, escaparLike, hrefSeguro, montarArvore, trechoDaBusca, type PaginaBase } from "../src/index.js";

const p = (id: string, paiId: string | null, acesso: "EQUIPE" | "RESTRITO" = "EQUIPE", ordem = 0): PaginaBase => ({ id, paiId, titulo: id, acesso, ordem });

describe("markdown seguro", () => {
  it("só aceita links http, https, mailto, tel e internos", () => {
    expect(hrefSeguro("https://bybusturismo.com.br")).toContain("https://");
    expect(hrefSeguro("javascript:alert(1)")).toBeNull();
    expect(hrefSeguro("JaVaScRiPt:alert(1)")).toBeNull();
    expect(hrefSeguro("data:text/html;base64,AAAA")).toBeNull();
    expect(hrefSeguro("//evil.test")).toBeNull();
    expect(hrefSeguro("/\\evil.test")).toBeNull();
    expect(hrefSeguro("/biblioteca/abc")).toBe("/biblioteca/abc");
  });

  it("link perigoso vira só o texto", () => {
    expect(analisarInline("[clique](javascript:alert)")).toEqual([{ t: "texto", v: "clique" }]);
  });

  it("HTML escrito fica como texto (nunca vira tag)", () => {
    const b = analisarMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(b).toEqual([
      { t: "paragrafo", c: [{ t: "texto", v: "<script>alert(1)</script>" }] },
      { t: "paragrafo", c: [{ t: "texto", v: "<img src=x onerror=alert(1)>" }] },
    ]);
  });

  it("títulos, listas, tabela, citação, código e régua", () => {
    const md = ["# Título", "", "Texto com **negrito**, *itálico* e `código`.", "", "- um", "- dois", "", "1. a", "2. b", "", "> aviso", "", "| A | B |", "|---|---|", "| 1 | 2 |", "", "```", "<b>x</b>", "```", "", "---"].join("\n");
    const b = analisarMarkdown(md);
    expect(b.map((x) => x.t)).toEqual(["titulo", "paragrafo", "lista", "lista", "citacao", "tabela", "codigo", "regua"]);
    expect(b[2]).toMatchObject({ t: "lista", ordenada: false });
    expect(b[3]).toMatchObject({ t: "lista", ordenada: true });
    expect(b[5]).toMatchObject({ t: "tabela" });
    expect(b[6]).toEqual({ t: "codigo", v: "<b>x</b>" });
  });

  it("entrada gigante ou malformada não trava", () => {
    const lixo = "*".repeat(5000) + "[" .repeat(2000) + "_".repeat(3000);
    const inicio = Date.now();
    analisarMarkdown(lixo);
    expect(Date.now() - inicio).toBeLessThan(2000);
  });
});

describe("árvore de páginas", () => {
  const lista = [p("a", null, "EQUIPE", 1), p("b", "a", "RESTRITO", 1), p("c", "b"), p("d", null, "EQUIPE", 0)];

  it("monta a árvore ordenada", () => {
    const arv = montarArvore(lista);
    expect(arv.map((n) => n.pagina.id)).toEqual(["d", "a"]);
    expect(arv[1]!.filhos[0]!.filhos[0]!.pagina.id).toBe("c");
  });

  it("caminho e acesso efetivo herdam restrição", () => {
    expect(caminhoDaPagina(lista, "c").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(acessoEfetivo(lista, "c")).toBe("RESTRITO");
    expect(acessoEfetivo(lista, "a")).toBe("EQUIPE");
  });

  it("detecta ciclo ao mover", () => {
    expect(criaCiclo(lista, "a", "c")).toBe(true);
    expect(criaCiclo(lista, "a", "a")).toBe(true);
    expect(criaCiclo(lista, "c", "d")).toBe(false);
    expect(criaCiclo(lista, "a", null)).toBe(false);
  });

  it("trecho e escape do LIKE", () => {
    expect(trechoDaBusca("# Regras\nÉ **proibido** comer a bordo do ônibus.", "proibido")).toContain("proibido");
    expect(escaparLike("100%_ok\\")).toBe("100\\%\\_ok\\\\");
  });
});
