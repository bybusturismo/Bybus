import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PERMISSOES, type PerfilAcesso, type PermissaoCatalogo } from "../api/tipos";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { Perfis } from "./Perfis";

const SENSIVEIS = ["usuarios:gerenciar", "unidades:gerenciar", "manifesto:documentos", "pessoas:gerenciar", "auditoria:ver"];
const CATALOGO: PermissaoCatalogo[] = PERMISSOES.map((codigo) => ({ codigo, descricao: `Descrição de ${codigo}`, exigeMfa: SENSIVEIS.includes(codigo) }));
const perfil = (codigo: string, nome: string, permissoes: PerfilAcesso["permissoes"], sistema = true): PerfilAcesso => ({
  id: `id-${codigo}`, codigo, nome, descricao: null, permissoes, sistema, criadoEm: "2026-10-22T00:00:00Z",
});
const PERFIS = [perfil("ADMIN", "Administrador", ["usuarios:gerenciar"]), perfil("GUIA", "Guia de turismo", ["manifesto:ver", "embarque:registrar"])];

function montar() {
  const api = simularApi({
    "GET /api/perfis": PERFIS,
    "GET /api/permissoes": CATALOGO,
    "GET /api/usuarios": [{ id: "u9", perfil: "GUIA" }],
    "POST /api/perfis": (c: unknown) => ({ ...perfil("X", "X", []), ...(c as object), sistema: false }),
  });
  renderizar(<Perfis />, { sessao: sessaoFicticia("ADMIN", [...PERMISSOES], { todasUnidades: true }) });
  return api;
}

describe("Perfis de acesso", () => {
  it("ADMIN aparece bloqueado e abre somente leitura com todas as permissões", async () => {
    montar();
    const linha = (await screen.findByText("Administrador")).closest("tr")!;
    expect(within(linha).getByText("bloqueado")).toBeInTheDocument();
    expect(within(linha).getByText(`${PERMISSOES.length} de ${PERMISSOES.length}`)).toBeInTheDocument();
    await userEvent.setup().click(within(linha).getByRole("button", { name: "Ver perfil Administrador" }));
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByText("Somente leitura")).toBeInTheDocument();
    const caixas = within(dialogo).getAllByRole("checkbox");
    expect(caixas).toHaveLength(PERMISSOES.length);
    caixas.forEach((c) => {
      expect(c).toBeChecked();
      expect(c).toBeDisabled();
    });
    expect(within(dialogo).queryByRole("button", { name: /Salvar/ })).not.toBeInTheDocument();
  });

  it("cria perfil personalizado com permissões agrupadas por área e indicação de MFA", async () => {
    const api = montar();
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Novo perfil" }));
    const dialogo = screen.getByRole("dialog", { name: "Novo perfil" });
    expect(within(dialogo).getAllByRole("group").map((g) => g.querySelector("legend")?.textContent)).toEqual([
      "Administração", "Equipe", "Produtos e pontos", "Saídas e reservas", "Lista de passageiros e embarque",
    ]);
    await u.type(within(dialogo).getByLabelText("Código"), "escala bc");
    expect(within(dialogo).getByLabelText("Código")).toHaveValue("ESCALA_BC");
    await u.type(within(dialogo).getByLabelText("Nome do perfil"), "Escala BC");
    await u.click(within(dialogo).getByRole("checkbox", { name: /Descrição de pessoas:gerenciar/ }));
    await u.click(within(dialogo).getByRole("checkbox", { name: /Descrição de manifesto:ver/ }));
    expect(within(dialogo).getByText(/obrigado a ativar a verificação em duas etapas/)).toBeInTheDocument();
    await u.click(within(dialogo).getByRole("button", { name: "Criar perfil" }));
    expect(corpoEnviado(api, "POST", "/api/perfis")).toEqual({ codigo: "ESCALA_BC", nome: "Escala BC", descricao: null, permissoes: ["pessoas:gerenciar", "manifesto:ver"] });
  });

  it("ao editar avisa que alterar permissões desconecta quem usa o perfil", async () => {
    montar();
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Editar perfil Guia de turismo" }));
    const dialogo = screen.getByRole("dialog");
    await u.click(within(dialogo).getByRole("checkbox", { name: /Descrição de manifesto:contatos/ }));
    expect(within(dialogo).getByText(/encerra imediatamente as sessões de quem usa este perfil \(1 usuário/)).toBeInTheDocument();
  });

  it("quem não é Administrador não edita perfis do sistema nem concede o que não tem", async () => {
    simularApi({
      "GET /api/perfis": [...PERFIS, perfil("ESCALA", "Escala", ["manifesto:ver"], false)],
      "GET /api/permissoes": CATALOGO,
      "GET /api/usuarios": [],
    });
    renderizar(<Perfis />, { sessao: sessaoFicticia("GERENTE", ["usuarios:gerenciar", "manifesto:ver", "pessoas:ver"]) });
    expect(await screen.findByRole("button", { name: "Ver perfil Guia de turismo" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Editar perfil Escala" }));
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByRole("checkbox", { name: /Descrição de pessoas:ver/ })).toBeEnabled();
    expect(within(dialogo).getByRole("checkbox", { name: /Descrição de auditoria:ver/ })).toBeDisabled();
  });
});
