import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderizar, sessaoFicticia } from "../teste/ajuda";
import { itensPermitidos, Layout } from "./Layout";

describe("Menu por perfil", () => {
  it("guia vê só Saídas e Minha conta", () => {
    renderizar(<Layout />, { sessao: sessaoFicticia("GUIA", ["manifesto:ver", "manifesto:contatos", "embarque:registrar"]) });
    const menu = screen.getByRole("navigation", { name: "Menu principal" });
    expect(within(menu).getAllByRole("link").map((l) => l.textContent)).toEqual(["Saídas", "Minha conta"]);
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });

  it("admin vê todos os itens", () => {
    const todas = itensPermitidos(() => true).map((i) => i.rotulo);
    expect(todas).toEqual(["Saídas", "Importar", "Usuários", "Auditoria", "Minha conta"]);
  });
});
