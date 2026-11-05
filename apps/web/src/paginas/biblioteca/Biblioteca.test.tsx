import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { Biblioteca, opcoesDePai } from "./Biblioteca";
import { doEditor } from "./htmlSeguro";
import { Markdown } from "./Markdown";

afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* ok */ } });

describe("Markdown seguro na tela (páginas antigas)", () => {
  it("mostra HTML e scripts como texto, sem criar elementos", () => {
    const { container } = renderizar(<Markdown texto={'<script>window.hackeado = true</script>\n\n<img src=x onerror="window.hackeado = true">\n\n**negrito** e [site](https://exemplo.test)'} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>window.hackeado = true</script>");
    expect(container.querySelector("strong")?.textContent).toBe("negrito");
    expect(container.querySelector("a")!.getAttribute("rel")).toBe("noopener noreferrer");
    expect((window as unknown as { hackeado?: boolean }).hackeado).toBeUndefined();
  });

  it("descarta links javascript: e data:", () => {
    const { container } = renderizar(<Markdown texto={"[a](javascript:alert) [b](data:text/html,x)"} />);
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("limpeza do HTML no navegador", () => {
  it("tira script, onerror, javascript:, style com url() e imagem de fora; mantém o inofensivo", () => {
    const r = doEditor('<p style="color: red; background: url(http://x.test/a.png)" onclick="x()">Olá<script>alert(1)</script></p><img src="https://x.test/p.png" onerror="y()"><a href="javascript:alert(1)">ruim</a><a href="https://exemplo.test">bom</a><img src="/api/biblioteca/anexos/00000000-0000-4000-8000-000000000000">');
    expect(r.startsWith("<!--html-->")).toBe(true);
    for (const p of ["<script", "alert(", "onclick", "onerror", "url(", "javascript:", "x.test/p.png"]) expect(r).not.toContain(p);
    expect(r).toContain("color: red");
    expect(r).toContain('href="https://exemplo.test"');
    expect(r).toContain("/api/biblioteca/anexos/00000000-0000-4000-8000-000000000000");
  });
  it("texto vazio vira string vazia", () => {
    expect(doEditor("<p><br></p>")).toBe("");
  });
});

const meta = (id: string, titulo: string, extra: Record<string, unknown> = {}) => ({ id, paiId: null, titulo, icone: null, acesso: "EQUIPE", acessoEfetivo: "EQUIPE", ordem: 1, atualizadoEm: "2026-11-04T12:00:00Z", podeEditar: true, ...extra });
const paginas = [
  meta("p1", "Manuais operacionais", { icone: "📘", ordem: 1 }),
  meta("p2", "Fluxo da lista das 21h", { paiId: "p1", ordem: 1 }),
  meta("p3", "Interna", { acesso: "RESTRITO", acessoEfetivo: "RESTRITO", ordem: 2 }),
];
const detalhe = (id: string, titulo: string, conteudo: string, extra: Record<string, unknown> = {}) => ({
  id, paiId: null, titulo, icone: "📘", conteudo, formato: conteudo.startsWith("<!--html-->") ? "html" : "markdown", acesso: "EQUIPE", acessoEfetivo: "EQUIPE", atualizadoEm: "2026-11-04T12:00:00Z", criadoEm: "2026-11-03T12:00:00Z",
  autor: "Admin Demo", atualizadoPor: "Supervisora Demo", colaboradores: ["Admin Demo"], podeEditar: true, podeGerenciarAcesso: true, caminho: [{ id, titulo, icone: null }], subpaginas: [], anexos: [], ...extra,
});

function montar(editor: boolean, rota = "/biblioteca/p1") {
  const permissoes = editor ? (["biblioteca:ver", "biblioteca:editar"] as const) : (["biblioteca:ver"] as const);
  return renderizar(
    <Routes>
      <Route path="/biblioteca" element={<Biblioteca />} />
      <Route path="/biblioteca/:id" element={<Biblioteca />} />
    </Routes>,
    { rota, sessao: sessaoFicticia("EQUIPE", [...permissoes]) },
  );
}
const rotasBase = (editor: boolean, extra: Record<string, unknown> = {}) => ({
  "GET /api/biblioteca/paginas": { podeEditar: editor, paginas: editor ? paginas : paginas.slice(0, 2).map((p) => ({ ...p, podeEditar: false })) },
  "GET /api/biblioteca/paginas/p1": detalhe("p1", "Manuais operacionais", "<!--html-->\n<p>Texto do manual</p>", { podeEditar: editor, subpaginas: [{ id: "p2", titulo: "Fluxo da lista das 21h", icone: null, proprietario: "Admin Demo", colaboradores: ["Admin Demo", "Guia Demo"] }] }),
  ...extra,
});

describe("Biblioteca: leitura", () => {
  it("mostra a árvore, o cabeçalho (autor e última atualização) e a tabela de subpáginas", async () => {
    simularApi(rotasBase(false));
    montar(false);
    expect(await screen.findByRole("heading", { name: "Manuais operacionais", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Texto do manual")).toBeInTheDocument();
    expect(screen.getByText(/Criada por/)).toBeInTheDocument();
    expect(screen.getByText(/Atualizado por último/)).toBeInTheDocument();
    const tabela = screen.getByRole("table");
    expect(within(tabela).getByText("Admin Demo")).toBeInTheDocument();
    expect(within(tabela).getByText("Admin Demo, Guia Demo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Nova página/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Trocar o ícone da página" })).toBeNull();
  });

  it("HTML perigoso gravado na página não executa nem aparece", async () => {
    simularApi(rotasBase(false, { "GET /api/biblioteca/paginas/p1": detalhe("p1", "Manuais", '<!--html-->\n<p>ok</p><img src="x" onerror="window.hackeado=1"><script>window.hackeado=1</script>', { podeEditar: false }) }));
    const { container } = montar(false);
    await screen.findByText("ok");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img[onerror]")).toBeNull();
    expect((window as unknown as { hackeado?: number }).hackeado).toBeUndefined();
  });

  it("página antiga em markdown abre normalmente", async () => {
    simularApi(rotasBase(false, { "GET /api/biblioteca/paginas/p1": detalhe("p1", "Antiga", "# Velha\n\n- item um", { podeEditar: false }) }));
    montar(false);
    expect(await screen.findByRole("heading", { name: "Velha" })).toBeInTheDocument();
    expect(screen.getByText("item um")).toBeInTheDocument();
  });

  it("busca mostra os resultados com o trecho", async () => {
    simularApi({ ...rotasBase(false), "GET /api/biblioteca/busca": [{ id: "p2", titulo: "Fluxo da lista das 21h", noTitulo: true, trecho: "…fechamento às 21h…", caminho: ["Manuais operacionais"] }] });
    montar(false);
    await userEvent.setup().type(await screen.findByLabelText("Buscar na Biblioteca"), "21h{enter}");
    expect(await screen.findByText("…fechamento às 21h…")).toBeInTheDocument();
  });
});

describe("Menu ⋯ da árvore", () => {
  it("quem só lê vê apenas copiar link e PDF", async () => {
    simularApi(rotasBase(false));
    montar(false);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Ações de Manuais operacionais" }));
    const menu = screen.getByRole("menu", { name: "Ações de Manuais operacionais" });
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Copiar link", "Baixar PDF"]);
  });

  it("editor geral vê todas as ações", async () => {
    simularApi(rotasBase(true));
    montar(true);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Ações de Manuais operacionais" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Nova subpágina", "Duplicar", "Mover para…", "Copiar link", "Renomear", "Ícone", "Restringir", "Acesso por pessoa…", "Baixar PDF", "Excluir"]);
  });

  it("renomear, restringir e mover mandam o PATCH certo (mover não oferece a própria página nem as de dentro)", async () => {
    const api = simularApi({ ...rotasBase(true), "PATCH /api/biblioteca/paginas/p1": { ok: true } });
    montar(true);
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Ações de Manuais operacionais" }));
    await u.click(screen.getByRole("menuitem", { name: "Renomear" }));
    const campo = screen.getByLabelText("Nome da página");
    await u.clear(campo);
    await u.type(campo, "Manuais da operação");
    await u.click(screen.getByRole("button", { name: "Renomear" }));
    await waitFor(() => expect(corpoEnviado(api, "PATCH", "/api/biblioteca/paginas/p1")).toEqual({ titulo: "Manuais da operação" }));

    await u.click(screen.getByRole("button", { name: "Ações de Manuais operacionais" }));
    await u.click(screen.getByRole("menuitem", { name: "Restringir" }));
    await waitFor(() => expect(corpoEnviado(api, "PATCH", "/api/biblioteca/paginas/p1", 1)).toEqual({ acesso: "RESTRITO" }));

    await u.click(screen.getByRole("button", { name: "Ações de Manuais operacionais" }));
    await u.click(screen.getByRole("menuitem", { name: "Mover para…" }));
    const opcoes = within(screen.getByLabelText(/Mover “/)).getAllByRole("option").map((o) => o.textContent);
    expect(opcoes).toEqual(["(raiz da Biblioteca)", "Interna"]);
    await u.selectOptions(screen.getByLabelText(/Mover “/), "p3");
    await u.click(screen.getByRole("button", { name: "Mover" }));
    await waitFor(() => expect(corpoEnviado(api, "PATCH", "/api/biblioteca/paginas/p1", 2)).toEqual({ paiId: "p3" }));
  });

  it("nova subpágina cria e abre em edição; excluir leva à lixeira com Desfazer", async () => {
    const api = simularApi({
      ...rotasBase(true),
      "POST /api/biblioteca/paginas": { id: "novo" },
      "GET /api/biblioteca/paginas/novo": detalhe("novo", "Nova página", "", { paiId: "p1" }),
      "DELETE /api/biblioteca/paginas/p1": { ok: true, paginas: 2 },
      "POST /api/biblioteca/lixeira/p1/restaurar": { id: "p1", paginas: 2 },
    });
    montar(true);
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Ações de Manuais operacionais" }));
    await u.click(screen.getByRole("menuitem", { name: "Nova subpágina" }));
    await waitFor(() => expect(corpoEnviado(api, "POST", "/api/biblioteca/paginas")).toEqual({ titulo: "Nova página", paiId: "p1" }));
    expect(await screen.findByRole("textbox", { name: "Texto da página" })).toBeInTheDocument();
  });

  it("excluir pede confirmação e oferece desfazer", async () => {
    const api = simularApi({
      ...rotasBase(true),
      "DELETE /api/biblioteca/paginas/p1": { ok: true, paginas: 2 },
      "POST /api/biblioteca/lixeira/p1/restaurar": { id: "p1", paginas: 2 },
    });
    montar(true);
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Ações de Manuais operacionais" }));
    await u.click(screen.getByRole("menuitem", { name: "Excluir" }));
    await u.click(await screen.findByRole("button", { name: "Excluir página" }));
    expect(await screen.findByText(/foi para a lixeira/)).toBeInTheDocument();
    expect(api.mock.calls.some(([url, i]) => String(url).endsWith("/paginas/p1") && i?.method === "DELETE")).toBe(true);
    await u.click(screen.getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(api.mock.calls.some(([url]) => String(url).endsWith("/lixeira/p1/restaurar"))).toBe(true));
  });
});

describe("Arrastar na árvore", () => {
  /** jsdom não calcula layout: cada linha da árvore ganha um retângulo (40 px de altura, uma abaixo da outra). */
  function medir() {
    const ordem = ["p1", "p2", "p3"];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const i = ordem.indexOf(this.getAttribute("data-pagina") ?? "");
      const top = i < 0 ? 0 : i * 40;
      return { x: 0, y: top, top, left: 0, right: 200, bottom: top + (i < 0 ? 0 : 40), width: 200, height: i < 0 ? 0 : 40, toJSON: () => ({}) } as DOMRect;
    });
  }
  async function arrastar(deId: string, paraY: number) {
    const linha = document.querySelector(`[data-pagina="${deId}"]`)!;
    fireEvent.mouseDown(linha, { clientX: 10, clientY: 90, button: 0 });
    fireEvent.mouseMove(document, { clientX: 10, clientY: 90 + 12 });
    fireEvent.mouseMove(document, { clientX: 10, clientY: paraY });
    fireEvent.mouseUp(document, { clientX: 10, clientY: paraY });
  }

  it("soltar no terço de cima de outra página muda a ordem (antes dela)", async () => {
    medir();
    const api = simularApi({ ...rotasBase(true), "PATCH /api/biblioteca/paginas/p3": { ok: true } });
    montar(true);
    await screen.findByText("Texto do manual");
    await arrastar("p3", 4); // topo da linha p1
    await waitFor(() => expect(corpoEnviado(api, "PATCH", "/api/biblioteca/paginas/p3")).toEqual({ paiId: null, antesDe: "p1" }));
  });

  it("soltar no meio coloca dentro dela (vira subpágina)", async () => {
    medir();
    const api = simularApi({ ...rotasBase(true), "PATCH /api/biblioteca/paginas/p3": { ok: true } });
    montar(true);
    await screen.findByText("Texto do manual");
    await arrastar("p3", 20); // meio da linha p1
    await waitFor(() => expect(corpoEnviado(api, "PATCH", "/api/biblioteca/paginas/p3")).toEqual({ paiId: "p1", antesDe: null }));
  });

  it("não deixa soltar uma página dentro de uma subpágina dela", async () => {
    medir();
    const api = simularApi({ ...rotasBase(true), "PATCH /api/biblioteca/paginas/p1": { ok: true } });
    montar(true);
    await screen.findByText("Texto do manual");
    const linha = document.querySelector('[data-pagina="p1"]')!;
    fireEvent.mouseDown(linha, { clientX: 10, clientY: 20, button: 0 });
    fireEvent.mouseMove(document, { clientX: 10, clientY: 32 });
    fireEvent.mouseMove(document, { clientX: 10, clientY: 60 }); // meio de p2, filha de p1
    fireEvent.mouseUp(document, { clientX: 10, clientY: 60 });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.mock.calls.some(([, i]) => i?.method === "PATCH")).toBe(false);
  });

  it("quem só lê não arrasta", async () => {
    medir();
    const api = simularApi(rotasBase(false));
    montar(false);
    await screen.findByText("Texto do manual");
    await arrastar("p2", 4);
    await new Promise((r) => setTimeout(r, 50));
    expect(api.mock.calls.some(([, i]) => i?.method === "PATCH")).toBe(false);
  });
});

describe("Título editável no lugar", () => {
  it("Enter salva; Esc desiste", async () => {
    const api = simularApi({ ...rotasBase(true), "PATCH /api/biblioteca/paginas/p1": { ok: true } });
    montar(true);
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Manuais operacionais", description: /renomear/i }));
    let campo = screen.getByLabelText("Nome da página");
    await u.clear(campo);
    await u.type(campo, "Descartado{Escape}");
    expect(api.mock.calls.some(([, i]) => i?.method === "PATCH")).toBe(false);
    await u.click(screen.getByRole("button", { name: "Manuais operacionais", description: /renomear/i }));
    campo = screen.getByLabelText("Nome da página");
    await u.clear(campo);
    await u.type(campo, "Novo nome{Enter}");
    await waitFor(() => expect(corpoEnviado(api, "PATCH", "/api/biblioteca/paginas/p1")).toEqual({ titulo: "Novo nome" }));
  });
});

describe("Editor visual", () => {
  it("botões chamam o comando do navegador e salvar manda HTML limpo (Ctrl+S também)", async () => {
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    const api = simularApi({ ...rotasBase(true), "PATCH /api/biblioteca/paginas/p1": { ok: true } });
    montar(true);
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Editar" }));
    const area = screen.getByRole("textbox", { name: "Texto da página" });
    expect(area.innerHTML).toContain("Texto do manual");
    await u.click(screen.getByRole("button", { name: "Negrito (Ctrl+B)" }));
    expect(exec).toHaveBeenCalledWith("bold", false, undefined);
    await u.click(screen.getByRole("button", { name: "Desfazer (Ctrl+Z)" }));
    expect(exec).toHaveBeenCalledWith("undo", false, undefined);
    await u.click(screen.getByRole("button", { name: "Lista com marcadores" }));
    expect(exec).toHaveBeenCalledWith("insertUnorderedList", false, undefined);
    await u.click(screen.getByRole("button", { name: /Quebra de página/ }));
    expect(exec).toHaveBeenCalledWith("insertHTML", false, expect.stringContaining("quebra-pagina"));
    // atalho de teclado
    fireEvent.keyDown(area, { key: "b", ctrlKey: true });
    expect(exec).toHaveBeenLastCalledWith("bold", false, undefined);
    // conteúdo perigoso colado/digitado é limpo ao salvar
    area.innerHTML = '<p>Novo <b onclick="x()">texto</b></p><img src="https://x.test/a.png" onerror="y()"><script>z()</script>';
    fireEvent.keyDown(area, { key: "s", ctrlKey: true });
    await waitFor(() => expect(corpoEnviado(api, "PATCH", "/api/biblioteca/paginas/p1")).toBeTruthy());
    const corpo = corpoEnviado(api, "PATCH", "/api/biblioteca/paginas/p1") as { conteudo: string; formato: string };
    expect(corpo.formato).toBe("html");
    expect(corpo.conteudo).toContain("<!--html-->");
    expect(corpo.conteudo).toContain("Novo <b>texto</b>");
    for (const p of ["onclick", "onerror", "<script", "x.test"]) expect(corpo.conteudo).not.toContain(p);
  });

  it("barra de tabela aparece com o cursor numa tabela e mexe nas linhas", async () => {
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => true);
    simularApi({ ...rotasBase(true, { "GET /api/biblioteca/paginas/p1": detalhe("p1", "Manuais", "<!--html-->\n<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>") }) });
    montar(true);
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Editar" }));
    const area = screen.getByRole("textbox", { name: "Texto da página" });
    const td = area.querySelector("td")!;
    const sel = window.getSelection()!;
    const r = document.createRange();
    r.selectNodeContents(td);
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event("selectionchange"));
    await u.click(await screen.findByRole("button", { name: "+ linha" }));
    expect(area.querySelectorAll("tbody tr")).toHaveLength(2);
    await u.click(screen.getByRole("button", { name: "+ coluna" }));
    expect(area.querySelectorAll("thead th")).toHaveLength(2);
  });

  it("gravar a tela avisa quando o navegador não suporta", async () => {
    simularApi(rotasBase(true));
    montar(true);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Gravar a tela" }));
    expect(await screen.findByText(/não grava a tela/)).toBeInTheDocument();
  });
});

describe("Largura da coluna e opções de destino", () => {
  it("a largura muda pelo teclado e fica guardada no navegador", async () => {
    simularApi(rotasBase(false));
    montar(false);
    const divisor = await screen.findByRole("separator", { name: "Largura da lista de páginas" });
    expect(divisor).toHaveAttribute("aria-valuenow", "288");
    fireEvent.keyDown(divisor, { key: "ArrowRight" });
    expect(divisor).toHaveAttribute("aria-valuenow", "304");
    expect(localStorage.getItem("bybus.biblioteca.largura")).toBe("304");
  });

  it("opcoesDePai exclui a página e suas descendentes", () => {
    const todas = [meta("a", "A"), meta("b", "B", { paiId: "a" }), meta("c", "C", { paiId: "b" }), meta("d", "D")] as never;
    expect(opcoesDePai(todas, "a").map((o) => o.id)).toEqual(["d"]);
    expect(opcoesDePai(todas, null).map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("Arquivos da página", () => {
  it("lista os anexos com tamanho e deixa excluir; mostra os limites", async () => {
    const api = simularApi({
      ...rotasBase(true, { "GET /api/biblioteca/paginas/p1": detalhe("p1", "Manuais", "<!--html-->\n<p>x</p>", { anexos: [{ id: "a1", nome: "manual.pdf", tipo: "application/pdf", uso: "ARQUIVO", tamanho: 2048 }] }) }),
      "DELETE /api/biblioteca/anexos/a1": { ok: true },
    });
    montar(true);
    expect(await screen.findByRole("link", { name: "manual.pdf" })).toHaveAttribute("href", "/api/biblioteca/anexos/a1");
    expect(screen.getByText(/Limites: imagem 8 MB, arquivo 25 MB, vídeo 100 MB/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Excluir manual.pdf" }));
    await waitFor(() => expect(api.mock.calls.some(([url, i]) => String(url).endsWith("/anexos/a1") && i?.method === "DELETE")).toBe(true));
  });
});
