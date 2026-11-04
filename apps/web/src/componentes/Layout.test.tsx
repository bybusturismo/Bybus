import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BC, FLN, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { itensPermitidos, Layout } from "./Layout";

const rotulosMenu = () => within(screen.getByRole("navigation", { name: "Menu principal" })).getAllByRole("link").map((l) => l.textContent);

describe("Menu por permissão", () => {
  it("guia vê só Saídas (perfil e sair ficam no menu do usuário)", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("GUIA", ["manifesto:ver", "manifesto:contatos", "embarque:registrar"]) });
    expect(rotulosMenu()).toEqual(["Saídas"]);
    expect(screen.getByRole("button", { name: /^Conta de / })).toBeInTheDocument();
  });

  it("usa as permissões, não o código do perfil: perfil personalizado com pessoas:ver vê Equipe", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("ESCALA_BC", ["manifesto:ver", "pessoas:ver"]) });
    expect(rotulosMenu()).toEqual(["Saídas", "Escala de guias", "Guias e equipe"]);
  });

  it("admin vê todos os itens", () => {
    const todas = itensPermitidos(() => true);
    expect(todas.filter((i) => !i.planejado).map((i) => i.rotulo)).toEqual([
      "Saídas", "Conferência de embarque", "Escala de guias", "Fechamento e mensagens", "Importar reservas", "Integrações",
      "Passeios e pontos", "Guias e equipe",
      "Resumo financeiro", "Contas a pagar", "Contas a receber", "Extrato e conciliação", "Cartões de crédito", "Contas e categorias",
      "Frota e manutenção", "Checklist do veículo",
      "Vendas por canal", "Origem dos clientes", "Campanhas", "Calendário de conteúdo", "Avaliações", "Afiliados e QR codes", "Biblioteca", "Gestores de IA",
      "Praças", "Usuários", "Perfis de acesso", "Auditoria", "Meu perfil",
    ]);
    // Módulos planejados só aparecem para quem administra usuários.
    expect(itensPermitidos((p) => p !== "usuarios:gerenciar").some((i) => i.planejado)).toBe(false);
  });
});

describe("Marketing e Biblioteca no menu", () => {
  it("só aparecem com as permissões certas", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("MKT", ["marketing:ver"]) });
    expect(rotulosMenu()).toEqual(["Vendas por canal", "Origem dos clientes", "Campanhas", "Calendário de conteúdo", "Avaliações", "Afiliados e QR codes"]);
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
    expect(rotulosMenu()).toEqual(["Resumo financeiro", "Contas a pagar", "Contas a receber", "Extrato e conciliação", "Cartões de crédito", "Contas e categorias"]);
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

describe("Item ativo do menu", () => {
  it("acende só o item mais específico", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("FIN", ["financeiro:ver"]), rota: "/financeiro/extrato" });
    const menu = screen.getByRole("navigation", { name: "Menu principal" });
    expect(within(menu).getByRole("link", { name: /Extrato e conciliação/ })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("link", { name: /Resumo financeiro/ })).not.toHaveAttribute("aria-current");
  });

  it("subpágina sem item próprio acende o item pai, sem diferenciar maiúsculas", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("FROTA", ["frota:ver", "frota:checklist"]), rota: "/Frota/veiculos/" });
    const menu = screen.getByRole("navigation", { name: "Menu principal" });
    expect(within(menu).getByRole("link", { name: /Frota e manutenção/ })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("link", { name: /Checklist do veículo/ })).not.toHaveAttribute("aria-current");
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
