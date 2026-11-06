import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BC, FLN, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { itensPermitidos, Layout } from "./Layout";

const rotulosMenu = () => within(screen.getByRole("navigation", { name: "Menu principal" })).getAllByRole("link").map((l) => l.textContent);

describe("Menu por permissão", () => {
  it("guia vê só o que a permissão libera (perfil e sair ficam no menu do usuário)", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("GUIA", ["manifesto:ver", "manifesto:contatos", "embarque:registrar"]) });
    expect(rotulosMenu()).toEqual(["Listas de passageiros", "Rastreamento", "Transfer", "Listagem de reservas"]);
    expect(screen.getByRole("button", { name: /^Conta de / })).toBeInTheDocument();
  });

  it("usa as permissões, não o código do perfil: perfil personalizado com pessoas:ver vê Equipe", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("ESCALA_BC", ["manifesto:ver", "pessoas:ver"]) });
    expect(rotulosMenu()).toEqual(["Listas de passageiros", "Rastreamento", "Transfer", "Escala de guias", "Listagem de reservas", "Guias e equipe"]);
  });

  it("admin vê todos os itens", () => {
    const todas = itensPermitidos(() => true);
    expect(todas.filter((i) => !i.planejado).map((i) => i.rotulo)).toEqual([
      "Listas de passageiros", "Rastreamento", "Transfer", "Meu transfer", "Escala de guias", "Rastreio do motorista",
      "Listagem de reservas", "Orçamentos", "WhatsApp", "Importar reservas",
      "Passeios e pontos", "Guias e equipe",
      "Financeiro", "Frota", "Marketing",
      "Gestores de IA", "Biblioteca",
      "Integrações", "Praças", "Usuários", "Perfis de acesso", "Auditoria", "Meu perfil",
    ]);
    // Módulos planejados só aparecem para quem administra usuários.
    expect(itensPermitidos((p) => p !== "usuarios:gerenciar").some((i) => i.planejado)).toBe(false);
  });
});

describe("Rastreamento no menu", () => {
  it("o item de rastreamento é real (não é mais módulo planejado)", () => {
    expect(itensPermitidos(() => true).filter((i) => i.planejado).some((i) => /rastreamento/.test(i.para))).toBe(false);
    expect(itensPermitidos(() => true).find((i) => i.rotulo === "Rastreamento")?.para).toBe("/rastreamento");
  });

  it("o motorista vê o rastreio dele; quem só vê a lista não", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("MOTORISTA", ["manifesto:ver", "rastreio:transmitir"]) });
    expect(rotulosMenu()).toEqual(["Listas de passageiros", "Rastreamento", "Transfer", "Rastreio do motorista", "Listagem de reservas"]);
  });

  it("o transfer aparece para quem vê a lista; a tela do motorista do transfer só com transfer:operar", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("MOTORISTA", ["manifesto:ver", "transfer:operar"]) });
    expect(rotulosMenu()).toEqual(["Listas de passageiros", "Rastreamento", "Transfer", "Meu transfer", "Listagem de reservas"]);
  });
});

describe("Marketing e Biblioteca no menu", () => {
  it("só aparecem com as permissões certas", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("MKT", ["marketing:ver"]) });
    expect(rotulosMenu()).toEqual(["Marketing"]);
  });

  it("biblioteca:ver mostra só a Biblioteca", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("LEITOR", ["biblioteca:ver"]) });
    expect(rotulosMenu()).toEqual(["Biblioteca"]);
  });

  it("os itens planejados de marketing viraram telas reais", () => {
    const planejados = itensPermitidos(() => true).filter((i) => i.planejado).map((i) => i.para);
    expect(planejados.some((p) => /avaliacoes|origem-clientes|campanhas|afiliados/.test(p))).toBe(false);
  });
});

describe("Menu do financeiro", () => {
  it("só aparece para quem tem financeiro:ver", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("FIN", ["financeiro:ver"]) });
    expect(rotulosMenu()).toEqual(["Financeiro"]);
  });

  it("não aparece sem a permissão", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("GUIA", ["manifesto:ver"]) });
    expect(rotulosMenu().some((r) => r?.includes("financeiro") || r === "Contas a pagar")).toBe(false);
  });
});

describe("Seletor de praça", () => {
  it("não aparece para quem tem uma praça só", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("SUPERVISOR", ["manifesto:ver"], { unidades: [FLN] }) });
    expect(screen.queryByLabelText("Praça")).not.toBeInTheDocument();
  });

  it("aparece com mais de uma praça e avisa a escolha", async () => {
    const escolher = vi.fn();
    renderizar(<Layout />, { sessao: sessaoFicticia("ADMIN", ["manifesto:ver"], { unidades: [BC, FLN], escolherPraca: escolher, todasUnidades: true }) });
    const seletor = screen.getByLabelText("Praça");
    expect(within(seletor).getAllByRole("option").map((o) => o.textContent)).toEqual(["Todas as praças", "Balneário Camboriú", "Florianópolis"]);
    await userEvent.setup().selectOptions(seletor, BC.id);
    expect(escolher).toHaveBeenCalledWith(BC.id);
  });
});

describe("Turistinha (assistente de IA)", () => {
  it("o botão flutuante (canto inferior direito) só aparece com ia:usar e abre o painel ao lado do conteúdo", async () => {
    simularApi({ "GET /api/ia/estado": { ligada: true, assistente: true, gestores: false } });
    const { unmount } = renderizar(<Layout />, { sessao: sessaoFicticia("GUIA", ["manifesto:ver"]) });
    expect(screen.queryByRole("button", { name: /Turistinha/ })).not.toBeInTheDocument();
    unmount();

    renderizar(<Layout />, { sessao: sessaoFicticia("ATENDENTE", ["manifesto:ver", "ia:usar"]) });
    const botao = screen.getByRole("button", { name: /Turistinha/ });
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("complementary", { name: "Assistente Turistinha" })).not.toBeInTheDocument();
    await userEvent.setup().click(botao);
    const painel = await screen.findByRole("complementary", { name: "Assistente Turistinha" });
    // Não é flutuante: está no mesmo contêiner do layout, depois do conteúdo principal.
    expect(painel.parentElement).toBe(screen.getByRole("main").parentElement);
    expect(botao).toHaveAttribute("aria-expanded", "true");
    await userEvent.setup().click(within(painel).getByRole("button", { name: "Fechar o Turistinha" }));
    expect(screen.queryByRole("complementary", { name: "Assistente Turistinha" })).not.toBeInTheDocument();
  });
});

describe("Item ativo do menu (um item por módulo)", () => {
  it("uma aba do financeiro acende o item do módulo", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("FIN", ["financeiro:ver"]), rota: "/financeiro/extrato" });
    const menu = screen.getByRole("navigation", { name: "Menu principal" });
    expect(within(menu).getByRole("link", { name: /Financeiro/ })).toHaveAttribute("aria-current", "page");
  });

  it("subpágina da frota acende Frota, sem diferenciar maiúsculas, e o checklist avulso não aparece para quem vê a frota", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("FROTA", ["frota:ver", "frota:checklist"]), rota: "/Frota/veiculos/" });
    const menu = screen.getByRole("navigation", { name: "Menu principal" });
    expect(within(menu).getByRole("link", { name: /Frota/ })).toHaveAttribute("aria-current", "page");
    expect(within(menu).queryByRole("link", { name: /Checklist do veículo/ })).not.toBeInTheDocument();
  });

  it("quem só faz o checklist continua com o item dele", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("MOTORISTA", ["frota:checklist"]) });
    expect(rotulosMenu()).toEqual(["Checklist do veículo"]);
  });

  it("outra aba do marketing acende Marketing; Saídas e Conferência acendem Listas de passageiros", () => {
    const { unmount } = renderizar(<Layout />, { sessao: sessaoFicticia("MKT", ["marketing:ver"]), rota: "/marketing/origem" });
    expect(within(screen.getByRole("navigation", { name: "Menu principal" })).getByRole("link", { name: /Marketing/ })).toHaveAttribute("aria-current", "page");
    unmount();
    renderizar(<Layout />, { sessao: sessaoFicticia("ATENDENTE", ["manifesto:ver", "reservas:editar"]), rota: "/listas/conferir" });
    expect(within(screen.getByRole("navigation", { name: "Menu principal" })).getByRole("link", { name: /Listas de passageiros/ })).toHaveAttribute("aria-current", "page");
  });
});

describe("Menu do usuário e Configurações (pedido do dono, 04/11)", () => {
  it("foto/iniciais no canto superior direito abrem perfil, configurações e sair", async () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("ADMIN", ["usuarios:gerenciar", "importacoes:executar", "manifesto:ver"]) });
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: /^Conta de / }));
    const lista = screen.getByRole("menu");
    expect(within(lista).getByRole("menuitem", { name: /Meu perfil/ })).toHaveAttribute("href", "/conta");
    expect(within(lista).getByRole("menuitem", { name: /Configurações/ })).toHaveAttribute("href", "/configuracoes");
    expect(within(lista).getByRole("menuitem", { name: /Sair/ })).toBeInTheDocument();
  });

  it("Configurações vira um botão discreto no rodapé do menu, sem a área no menu lateral (Integrações incluída)", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("ADMIN", ["usuarios:gerenciar", "importacoes:executar", "manifesto:ver"]) });
    const rotulos = rotulosMenu();
    expect(rotulos).toContain("Configurações");
    expect(rotulos).not.toContain("Usuários");
    expect(rotulos).not.toContain("Integrações");
  });
});
