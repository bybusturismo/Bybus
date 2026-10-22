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
    expect(rotulosMenu()).toEqual(["Saídas", "Equipe", "Minha conta"]);
  });

  it("admin vê todos os itens", () => {
    const todas = itensPermitidos(() => true).map((i) => i.rotulo);
    expect(todas).toEqual(["Saídas", "Importar", "Equipe", "Passeios", "Praças", "Usuários", "Perfis de acesso", "Auditoria", "Minha conta"]);
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
