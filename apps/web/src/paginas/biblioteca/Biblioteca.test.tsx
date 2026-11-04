import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { Biblioteca } from "./Biblioteca";
import { Markdown } from "./Markdown";

describe("Markdown seguro na tela", () => {
  it("mostra HTML e scripts como texto, sem criar elementos", () => {
    const { container } = renderizar(<Markdown texto={'<script>window.hackeado = true</script>\n\n<img src=x onerror="window.hackeado = true">\n\n**negrito** e [site](https://exemplo.test)'} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>window.hackeado = true</script>");
    expect(container.querySelector("strong")?.textContent).toBe("negrito");
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://exemplo.test/");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect((window as unknown as { hackeado?: boolean }).hackeado).toBeUndefined();
  });

  it("descarta links javascript: e data:", () => {
    const { container } = renderizar(<Markdown texto={"[a](javascript:alert) [b](data:text/html,x) [c](vbscript:x)"} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("a");
  });

  it("renderiza título, lista e tabela", () => {
    renderizar(<Markdown texto={"# Regras\n\n- um\n- dois\n\n| A | B |\n|---|---|\n| 1 | 2 |"} />);
    expect(screen.getByRole("heading", { name: "Regras" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});

const paginas = [
  { id: "p1", paiId: null, titulo: "Manuais operacionais", acesso: "EQUIPE", acessoEfetivo: "EQUIPE", ordem: 10, atualizadoEm: "2026-11-04T12:00:00Z" },
  { id: "p2", paiId: "p1", titulo: "Fluxo da lista das 21h", acesso: "EQUIPE", acessoEfetivo: "EQUIPE", ordem: 10, atualizadoEm: "2026-11-04T12:00:00Z" },
  { id: "p3", paiId: null, titulo: "Interna", acesso: "RESTRITO", acessoEfetivo: "RESTRITO", ordem: 20, atualizadoEm: "2026-11-04T12:00:00Z" },
];
const detalhe = (id: string, titulo: string, conteudo: string, extra = {}) => ({ id, paiId: null, titulo, conteudo, acesso: "EQUIPE", ordem: 0, acessoEfetivo: "EQUIPE", atualizadoEm: "2026-11-04T12:00:00Z", podeEditar: false, caminho: [{ id, titulo }], subpaginas: [], ...extra });

function montar(podeEditar: boolean, rota = "/biblioteca/p1") {
  const permissoes = podeEditar ? (["biblioteca:ver", "biblioteca:editar"] as const) : (["biblioteca:ver"] as const);
  return renderizar(
    <Routes>
      <Route path="/biblioteca" element={<Biblioteca />} />
      <Route path="/biblioteca/:id" element={<Biblioteca />} />
    </Routes>,
    { rota, sessao: sessaoFicticia("EQUIPE", [...permissoes]) },
  );
}

describe("Biblioteca", () => {
  it("mostra a árvore e a página; quem só lê não vê botões de edição", async () => {
    simularApi({
      "GET /api/biblioteca/paginas": { podeEditar: false, paginas: paginas.slice(0, 2) },
      "GET /api/biblioteca/paginas/p1": detalhe("p1", "Manuais operacionais", "Texto do manual", { subpaginas: [{ id: "p2", titulo: "Fluxo da lista das 21h" }] }),
    });
    montar(false);
    expect(await screen.findByRole("heading", { name: "Manuais operacionais", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Texto do manual")).toBeInTheDocument();
    const arvore = screen.getByRole("navigation", { name: "Árvore de páginas" });
    expect(within(arvore).getByRole("link", { name: "Fluxo da lista das 21h" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Nova página/ })).toBeNull();
  });

  it("editor cria página dentro de outra e envia o Markdown", async () => {
    const api = simularApi({
      "GET /api/biblioteca/paginas": { podeEditar: true, paginas },
      "GET /api/biblioteca/paginas/p1": detalhe("p1", "Manuais operacionais", "Texto", { podeEditar: true }),
      "POST /api/biblioteca/paginas": { id: "novo" },
      "GET /api/biblioteca/paginas/novo": detalhe("novo", "Nova", "Corpo", { podeEditar: true }),
    });
    montar(true);
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Nova subpágina" }));
    await u.type(screen.getByLabelText("Título"), "Regras do quiosque");
    await u.type(screen.getByLabelText(/Conteúdo \(Markdown\)/), "- item **forte**");
    expect(screen.getByText("forte").tagName).toBe("STRONG"); // pré-visualização
    await u.click(screen.getByRole("button", { name: "Salvar página" }));
    expect(corpoEnviado(api, "POST", "/api/biblioteca/paginas")).toMatchObject({ titulo: "Regras do quiosque", paiId: "p1", acesso: "EQUIPE", conteudo: "- item **forte**" });
  });

  it("não deixa escolher a própria página nem uma subpágina como pai", async () => {
    simularApi({
      "GET /api/biblioteca/paginas": { podeEditar: true, paginas },
      "GET /api/biblioteca/paginas/p1": detalhe("p1", "Manuais operacionais", "Texto", { podeEditar: true }),
    });
    montar(true);
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Editar" }));
    const opcoes = within(screen.getByLabelText("Dentro de")).getAllByRole("option").map((o) => o.textContent);
    expect(opcoes).toEqual(["(raiz da Biblioteca)", "Interna"]);
  });

  it("busca mostra os resultados com o trecho", async () => {
    simularApi({
      "GET /api/biblioteca/paginas": { podeEditar: false, paginas: paginas.slice(0, 2) },
      "GET /api/biblioteca/paginas/p1": detalhe("p1", "Manuais operacionais", "Texto"),
      "GET /api/biblioteca/busca": [{ id: "p2", titulo: "Fluxo da lista das 21h", noTitulo: true, trecho: "…fechamento às 21h…", caminho: ["Manuais operacionais"] }],
    });
    montar(false);
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText("Buscar na Biblioteca"), "21h{enter}");
    expect(await screen.findByText("…fechamento às 21h…")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Resultados para/ })).toBeInTheDocument();
  });
});
