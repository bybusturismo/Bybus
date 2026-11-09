import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { Cofre } from "./Cofre";

const ITENS = { setores: [{ id: "s1", nome: "Marketing", podeEditar: true }], itens: [{ id: "i1", setorId: "s1", titulo: "Instagram Fictício", categoria: "Redes", url: null, usuario: "bybus.ficticio", temSenha: true, temNotas: false, atualizadoEm: "2026-11-09T12:00:00Z", atualizadoPorNome: null }] };

describe("Cofre de senhas", () => {
  it("pede a senha para abrir", async () => {
    const api = simularApi({ "GET /api/cofre/estado": { configurado: true, aberto: false, ate: null, gestor: true, temSetor: true }, "POST /api/cofre/abrir": { ok: true, ate: "2099-01-01T00:00:00Z" } });
    renderizar(<Cofre />, { sessao: sessaoFicticia("ADMIN", []) });
    await userEvent.setup().type(await screen.findByLabelText("Sua senha"), "minha-senha-1");
    await userEvent.setup().click(screen.getByRole("button", { name: "Abrir o Cofre" }));
    expect(corpoEnviado(api, "POST", "/api/cofre/abrir")).toEqual({ senha: "minha-senha-1" });
  });

  it("lista sem a senha e só mostra ao clicar", async () => {
    simularApi({
      "GET /api/cofre/estado": { configurado: true, aberto: true, ate: "2099-01-01T00:00:00Z", gestor: false, temSetor: true },
      "GET /api/cofre/itens": ITENS,
      "POST /api/cofre/itens/i1/revelar": { valor: "Senha-Ficticia-123" },
    });
    renderizar(<Cofre />, { sessao: sessaoFicticia("ATENDENTE", []) });
    expect(await screen.findByText("Instagram Fictício")).toBeInTheDocument();
    expect(screen.getByText("Usuário: bybus.ficticio")).toBeInTheDocument();
    expect(screen.queryByText("Senha-Ficticia-123")).toBeNull();
    expect(screen.queryByRole("button", { name: "Setores e pessoas" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Mostrar a senha de Instagram Fictício" }));
    expect(await screen.findByText("Senha-Ficticia-123")).toBeInTheDocument();
  });

  it("sem chave no servidor avisa que não está configurado", async () => {
    simularApi({ "GET /api/cofre/estado": { configurado: false, aberto: false, ate: null, gestor: true, temSetor: false } });
    renderizar(<Cofre />, { sessao: sessaoFicticia("ADMIN", []) });
    expect(await screen.findByText("Cofre ainda não configurado")).toBeInTheDocument();
  });
});
