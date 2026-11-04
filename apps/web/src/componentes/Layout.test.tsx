import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BC, FLN, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { itensPermitidos, Layout } from "./Layout";

const rotulosMenu = () => within(screen.getByRole("navigation", { name: "Menu principal" })).getAllByRole("link").map((l) => l.textContent);

describe("Menu por permissão", () => {
  it("guia vê só Saídas e Minha conta", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("GUIA", ["manifesto:ver", "manifesto:contatos", "embarque:registrar"]) });
    expect(rotulosMenu()).toEqual(["Saídas", "Minha conta"]);
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });

  it("usa as permissões, não o código do perfil: perfil personalizado com pessoas:ver vê Equipe", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("ESCALA_BC", ["manifesto:ver", "pessoas:ver"]) });
    expect(rotulosMenu()).toEqual(["Saídas", "Escala de guias", "Guias e equipe", "Minha conta"]);
  });

  it("admin vê todos os itens", () => {
    const todas = itensPermitidos(() => true);
    expect(todas.filter((i) => !i.planejado).map((i) => i.rotulo)).toEqual([
      "Saídas", "Conferência de embarque", "Escala de guias", "Fechamento e mensagens", "Importar reservas", "Integrações",
      "Passeios e pontos", "Guias e equipe", "Gestores de IA", "Praças", "Usuários", "Perfis de acesso", "Auditoria", "Minha conta",
    ]);
    // Módulos planejados só aparecem para quem administra usuários.
    expect(itensPermitidos((p) => p !== "usuarios:gerenciar").some((i) => i.planejado)).toBe(false);
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
  it("o botão no topo só aparece com ia:usar e abre o painel ao lado do conteúdo", async () => {
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
