import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BC, FLN, renderizar, sessaoFicticia } from "../teste/ajuda";
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
      "Passeios e pontos", "Guias e equipe", "Frota e manutenção", "Checklist do veículo",
      "Vendas por canal", "Origem dos clientes", "Campanhas", "Calendário de conteúdo", "Avaliações", "Afiliados e QR codes", "Biblioteca",
      "Praças", "Usuários", "Perfis de acesso", "Auditoria", "Minha conta",
    ]);
    // Módulos planejados só aparecem para quem administra usuários.
    expect(itensPermitidos((p) => p !== "usuarios:gerenciar").some((i) => i.planejado)).toBe(false);
  });
});

describe("Marketing e Biblioteca no menu", () => {
  it("só aparecem com as permissões certas", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("MKT", ["marketing:ver"]) });
    expect(rotulosMenu()).toEqual(["Vendas por canal", "Origem dos clientes", "Campanhas", "Calendário de conteúdo", "Avaliações", "Afiliados e QR codes", "Minha conta"]);
  });

  it("biblioteca:ver mostra só a Biblioteca", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("LEITOR", ["biblioteca:ver"]) });
    expect(rotulosMenu()).toEqual(["Biblioteca", "Minha conta"]);
  });

  it("os itens planejados de marketing viraram telas reais", () => {
    const planejados = itensPermitidos(() => true).filter((i) => i.planejado).map((i) => i.para);
    expect(planejados.some((p) => /avaliacoes|origem-clientes|campanhas|afiliados/.test(p))).toBe(false);
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
