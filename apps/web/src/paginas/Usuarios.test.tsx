import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PerfilAcesso, Unidade, UsuarioAdmin } from "../api/tipos";
import { BC, corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { Usuarios } from "./Usuarios";

const perfil = (codigo: string, nome: string, permissoes: PerfilAcesso["permissoes"]): PerfilAcesso => ({ id: codigo, codigo, nome, descricao: null, permissoes, sistema: false, criadoEm: "" });
const PERFIS = [perfil("ADMIN", "Administrador", []), perfil("ATENDENTE", "Atendente / vendedor", ["manifesto:ver"]), perfil("ESCALA_BC", "Escala BC", ["pessoas:ver", "manifesto:ver"])];
const UNIDADES: Unidade[] = [{ ...BC, cidade: "Balneário Camboriú", uf: "SC", ativa: true }, { ...FLN, cidade: "Florianópolis", uf: "SC", ativa: true }];
const ALVO: UsuarioAdmin = {
  id: "u2", nome: "Atendente Demo", email: "atendente@bybus.test", perfil: "ATENDENTE", perfilNome: "Atendente / vendedor", todasUnidades: false, unidadeIds: [FLN.id],
  ativo: true, totpAtivo: false, trocarSenha: false, criadoEm: "2026-10-01T12:00:00Z",
};

describe("Usuários: perfil configurável e praças", () => {
  it("cria usuário com perfil vindo de /api/perfis e praças específicas", async () => {
    const api = simularApi({
      "GET /api/usuarios": [ALVO],
      "GET /api/perfis": PERFIS,
      "GET /api/unidades": UNIDADES,
      "POST /api/usuarios": { usuario: { ...ALVO, email: "novo@bybus.test" }, senhaTemporaria: "Temporaria-123x" },
    });
    renderizar(<Usuarios />, { sessao: sessaoFicticia("ADMIN", ["usuarios:gerenciar"], { unidades: [BC, FLN], todasUnidades: true }) });
    expect(await screen.findByRole("cell", { name: "FLN" })).toBeInTheDocument();
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Novo usuário" }));
    const d = screen.getByRole("dialog", { name: "Novo usuário" });
    expect(within(within(d).getByLabelText("Perfil")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Administrador", "Atendente / vendedor", "Escala BC"]);
    await u.type(within(d).getByLabelText("Nome"), "Pessoa Ficticia");
    await u.type(within(d).getByLabelText("E-mail"), "novo@bybus.test");
    await u.selectOptions(within(d).getByLabelText("Perfil"), "ESCALA_BC");
    await u.click(within(d).getByRole("button", { name: "Criar usuário" }));
    expect(within(d).getByRole("alert")).toHaveTextContent("Escolha ao menos uma praça");
    await u.click(within(d).getByRole("checkbox", { name: "Balneário Camboriú" }));
    await u.click(within(d).getByRole("button", { name: "Criar usuário" }));
    expect(corpoEnviado(api, "POST", "/api/usuarios")).toEqual({ nome: "Pessoa Ficticia", email: "novo@bybus.test", perfil: "ESCALA_BC", todasUnidades: false, unidadeIds: [BC.id] });
    expect(await screen.findByText("Temporaria-123x")).toBeInTheDocument();
  });

  it("muda para todas as praças e envia só o que mudou", async () => {
    const api = simularApi({ "GET /api/usuarios": [ALVO], "GET /api/perfis": PERFIS, "GET /api/unidades": UNIDADES, "PATCH /api/usuarios/u2": { usuario: ALVO } });
    renderizar(<Usuarios />, { sessao: sessaoFicticia("ADMIN", ["usuarios:gerenciar"], { unidades: [BC, FLN], todasUnidades: true }) });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Perfil e praças de Atendente Demo" }));
    const d = screen.getByRole("dialog");
    await u.click(within(d).getByRole("radio", { name: /Todas as praças/ }));
    await u.click(within(d).getByRole("button", { name: "Salvar acesso" }));
    expect(corpoEnviado(api, "PATCH", "/api/usuarios/u2")).toEqual({ todasUnidades: true, unidadeIds: [] });
  });

  it("quem não é Administrador não vê “Todas as praças” nem perfis com mais acesso que o seu", async () => {
    simularApi({ "GET /api/usuarios": [ALVO], "GET /api/perfis": PERFIS, "GET /api/unidades": [UNIDADES[1]] });
    renderizar(<Usuarios />, { sessao: sessaoFicticia("GERENTE_FLN", ["usuarios:gerenciar", "manifesto:ver"], { unidades: [FLN] }) });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Novo usuário" }));
    const d = screen.getByRole("dialog", { name: "Novo usuário" });
    expect(within(within(d).getByLabelText("Perfil")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Atendente / vendedor"]);
    expect(within(d).queryByRole("radio", { name: /Todas as praças/ })).not.toBeInTheDocument();
  });
});
