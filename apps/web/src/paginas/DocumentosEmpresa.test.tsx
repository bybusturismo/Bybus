import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { DocumentosEmpresa } from "./DocumentosEmpresa";

const resposta = (admin: boolean) => ({
  podeGerenciar: true, podeDefinirAcesso: admin,
  pastas: [
    { id: "p1", nome: "Societário", descricao: "Contrato social", acesso: "RESTRITO", arquivos: 1, ...(admin ? { perfis: [], usuarios: [] } : {}) },
    { id: "p2", nome: "Contratos", descricao: null, acesso: "TODOS", arquivos: 0 },
  ],
  arquivos: [{ id: "a1", pastaId: "p1", titulo: "Cartão CNPJ fictício", descricao: null, nomeArquivo: "cnpj.pdf", mime: "application/pdf", tamanho: 20480, vencimento: "2026-11-20", situacao: "A_VENCER", enviadoPor: "Pessoa Fictícia", criadoEm: "2026-11-11T12:00:00Z" }],
  alertas: [{ id: "a1", pastaId: "p1", titulo: "Cartão CNPJ fictício", vencimento: "2026-11-20", situacao: "A_VENCER" }],
});

describe("Documentos da empresa", () => {
  it("mostra pastas (com cadeado nas restritas), vencimentos e o documento para abrir; administrador vê 'Quem vê'", async () => {
    simularApi({ "GET /api/documentos": resposta(true), "GET /api/documentos/opcoes-acesso": { perfis: [{ codigo: "SUPERVISOR", nome: "Supervisor" }], usuarios: [{ id: "u1", nome: "Pessoa Fictícia" }] } });
    renderizar(<DocumentosEmpresa />, { sessao: sessaoFicticia("ADMIN", ["documentos:ver", "documentos:gerenciar"]) });
    const linha = await screen.findByRole("row", { name: /Cartão CNPJ fictício/ });
    expect(linha).toHaveTextContent("Vence em breve");
    expect(within(linha).getByRole("link", { name: "Abrir" })).toHaveAttribute("href", "/api/documentos/arquivos/a1/conteudo");
    expect(screen.getByText(/Pasta restrita/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Quem vê/ }));
    const janela = await screen.findByRole("dialog");
    expect(await within(janela).findByLabelText("Supervisor")).toBeInTheDocument();
  });

  it("quem não é administrador não vê o botão de acesso", async () => {
    simularApi({ "GET /api/documentos": resposta(false) });
    renderizar(<DocumentosEmpresa />, { sessao: sessaoFicticia("GESTOR", ["documentos:ver", "documentos:gerenciar"]) });
    await screen.findByRole("row", { name: /Cartão CNPJ fictício/ });
    expect(screen.queryByRole("button", { name: /Quem vê/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar documento/ })).toBeEnabled();
  });
});
