import { describe, expect, it } from "vitest";
import { calcularAcesso, destinoDoArraste, htmlParaTexto, htmlVazio, limparEstilo, markdownParaHtml, renumerarIrmas, textoDaPagina, zonaDeSoltura, MARCA_HTML } from "../src/index.js";

describe("estilo seguro", () => {
  it("mantém só propriedades inofensivas e nunca url()", () => {
    expect(limparEstilo("color: rgb(224, 78, 31); text-align: center")).toBe("color: rgb(224, 78, 31); text-align: center");
    expect(limparEstilo("background: url(http://x.test/a.png)")).toBe("");
    expect(limparEstilo("color: red; background-color: url(x)")).toBe("color: red");
    expect(limparEstilo("position: fixed; top: 0; width: 9999px")).toBe("");
    expect(limparEstilo("font-size: x-large; color: expression(alert(1))")).toBe("font-size: x-large");
    expect(limparEstilo("color: red !important")).toBe("");
  });
});

describe("markdown para html e texto", () => {
  it("escapa tudo", () => {
    expect(markdownParaHtml("<script>x</script> **a**")).toBe("<p>&lt;script&gt;x&lt;/script&gt; <strong>a</strong></p>");
  });
  it("texto puro para busca", () => {
    expect(htmlParaTexto("<p>Olá &amp; <strong>mundo</strong></p><ul><li>um</li><li>dois</li></ul>")).toBe("Olá & mundo um dois");
    expect(textoDaPagina(`${MARCA_HTML}<h1>Título</h1><p>Corpo</p>`)).toBe("Título Corpo");
    expect(htmlVazio("<p><br></p>")).toBe(true);
    expect(htmlVazio('<p><br></p><img src="/api/biblioteca/anexos/x">')).toBe(false);
  });
});

const pag = (id: string, paiId: string | null, acesso: "EQUIPE" | "RESTRITO" = "EQUIPE", ordem = 0) => ({ id, paiId, acesso, ordem, titulo: id });

describe("acesso por pessoa herdado", () => {
  const paginas = [pag("a", null), pag("b", "a", "RESTRITO"), pag("c", "b"), pag("d", null)];
  const eu = { id: "u1", editorGeral: false };
  it("editor geral vê e edita tudo", () => {
    expect(calcularAcesso(paginas, [], { id: "x", editorGeral: true }, "c")).toEqual({ ver: true, editar: true });
  });
  it("leitor comum: lê o que não é restrito, nunca edita", () => {
    expect(calcularAcesso(paginas, [], eu, "d")).toEqual({ ver: true, editar: false });
    expect(calcularAcesso(paginas, [], eu, "c")).toEqual({ ver: false, editar: false });
  });
  it("pessoa na lista da página restrita vale para as subpáginas", () => {
    const acessos = [{ paginaId: "b", usuarioId: "u1", nivel: "VER" as const }];
    expect(calcularAcesso(paginas, acessos, eu, "b")).toEqual({ ver: true, editar: false });
    expect(calcularAcesso(paginas, acessos, eu, "c")).toEqual({ ver: true, editar: false });
    expect(calcularAcesso(paginas, [{ ...acessos[0]!, nivel: "EDITAR" }], eu, "c")).toEqual({ ver: true, editar: true });
    expect(calcularAcesso(paginas, acessos, { id: "u2", editorGeral: false }, "c")).toEqual({ ver: false, editar: false });
  });
  it("a lista mais próxima vence a mais distante", () => {
    const acessos = [{ paginaId: "a", usuarioId: "u1", nivel: "EDITAR" as const }, { paginaId: "c", usuarioId: "u2", nivel: "VER" as const }];
    expect(calcularAcesso(paginas, acessos, eu, "c")).toEqual({ ver: false, editar: false }); // c tem lista própria sem o u1
    expect(calcularAcesso(paginas, acessos, eu, "b")).toEqual({ ver: true, editar: true });
  });
  it("página inexistente não dá acesso", () => {
    expect(calcularAcesso(paginas, [], eu, "zzz")).toEqual({ ver: false, editar: false });
  });
});

describe("arrastar na árvore", () => {
  const nos = [pag("a", null, "EQUIPE", 1), pag("b", null, "EQUIPE", 2), pag("c", null, "EQUIPE", 3), pag("a1", "a", "EQUIPE", 1)];
  it("zonas: terço de cima e de baixo = ordem, meio = dentro", () => {
    expect(zonaDeSoltura(2, 0, 40)).toBe("antes");
    expect(zonaDeSoltura(20, 0, 40)).toBe("dentro");
    expect(zonaDeSoltura(38, 0, 40)).toBe("depois");
  });
  it("destino: meio vira subpágina; cima/baixo ordenam entre irmãs", () => {
    expect(destinoDoArraste(nos, "c", "a", "dentro")).toEqual({ paiId: "a", antesDe: null });
    expect(destinoDoArraste(nos, "c", "a", "antes")).toEqual({ paiId: null, antesDe: "a" });
    expect(destinoDoArraste(nos, "c", "a", "depois")).toEqual({ paiId: null, antesDe: "b" });
    expect(destinoDoArraste(nos, "a", "c", "depois")).toEqual({ paiId: null, antesDe: null });
  });
  it("recusa soltar em si mesma ou numa subpágina dela", () => {
    expect(destinoDoArraste(nos, "a", "a", "dentro")).toBeNull();
    expect(destinoDoArraste(nos, "a", "a1", "dentro")).toBeNull();
  });
  it("renumera as irmãs 1, 2, 3 (inclusive as invisíveis) e devolve só o que mudou", () => {
    const m = renumerarIrmas(nos, "c", null, "a");
    expect(m).toEqual([{ id: "c", ordem: 1 }, { id: "a", ordem: 2 }, { id: "b", ordem: 3 }]);
    const fim = renumerarIrmas(nos, "a", null, null);
    expect(fim).toEqual([{ id: "b", ordem: 1 }, { id: "c", ordem: 2 }, { id: "a", ordem: 3 }]);
    // mudar para outro pai renumera o pai novo
    expect(renumerarIrmas(nos, "b", "a", null)).toEqual([{ id: "a1", ordem: 1 }, { id: "b", ordem: 2 }].filter((x) => x.id !== "a1"));
  });
});
