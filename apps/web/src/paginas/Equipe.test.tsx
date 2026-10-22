import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Pessoa } from "../api/tipos";
import { BC, corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { hojeIso, somarDias } from "../util/formato";
import { Equipe } from "./Equipe";

const hoje = hojeIso();
const completa = (p: Partial<Pessoa> & Pick<Pessoa, "id" | "nome" | "papeis">): Pessoa => ({
  unidadeId: FLN.id, idiomas: [], ativo: true, telefone: null, email: null, documentoTipo: null, documento: null, cnhCategoria: null, cnhValidade: null,
  cadasturNumero: null, cadasturValidade: null, diariaCentavos: null, observacoes: null, ...p,
});

describe("Equipe", () => {
  it("destaca CNH vencida e Cadastur vencendo em 30 dias", async () => {
    simularApi({
      "GET /api/pessoas": [
        completa({ id: "1", nome: "Motorista Fictício Davi", papeis: ["MOTORISTA"], cnhCategoria: "D", cnhValidade: somarDias(hoje, -1) }),
        completa({ id: "2", nome: "Guia Fictícia Ana", papeis: ["GUIA"], cadasturValidade: somarDias(hoje, 10), idiomas: ["Português", "Espanhol"], diariaCentavos: 30000 }),
        completa({ id: "3", nome: "Guia Fictício Caio", papeis: ["GUIA"], cadasturValidade: somarDias(hoje, 200) }),
      ],
    });
    renderizar(<Equipe />, { sessao: sessaoFicticia("SUPERVISOR", ["pessoas:ver", "pessoas:gerenciar"]) });
    const davi = (await screen.findByText("Motorista Fictício Davi")).closest("tr")!;
    expect(within(davi).getByText(/CNH vencida em/)).toHaveClass("etiqueta--perigo");
    const ana = screen.getByText("Guia Fictícia Ana").closest("tr")!;
    expect(within(ana).getByText(/Cadastur vence em/)).toHaveClass("etiqueta--atencao");
    expect(within(ana).getByText("R$ 300,00")).toBeInTheDocument();
    const caio = screen.getByText("Guia Fictício Caio").closest("tr")!;
    expect(within(caio).queryByText(/vence em|vencid/)).not.toBeInTheDocument();
    expect(screen.getByText("Documentos vencidos ou vencendo em 30 dias")).toBeInTheDocument();
  });

  it("só com pessoas:ver: lista resumida, sem contato e sem botão de cadastro", async () => {
    simularApi({ "GET /api/pessoas": [{ id: "1", nome: "Guia Fictícia Ana", papeis: ["GUIA"], unidadeId: FLN.id, idiomas: ["Português"], ativo: true }] });
    renderizar(<Equipe />, { sessao: sessaoFicticia("ATENDENTE", ["pessoas:ver"]) });
    expect(await screen.findByText("Guia Fictícia Ana")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Contato" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cadastrar pessoa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
  });

  it("cadastra guia: papéis múltiplos, praça, Cadastur, idiomas e diária em centavos", async () => {
    const api = simularApi({
      "GET /api/pessoas": [],
      "POST /api/pessoas": (c: unknown) => ({ id: "novo", ...(c as object) }),
    });
    renderizar(<Equipe />, { sessao: sessaoFicticia("ADMIN", ["pessoas:ver", "pessoas:gerenciar"], { unidades: [BC, FLN], todasUnidades: true }) });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Cadastrar pessoa" }));
    const d = screen.getByRole("dialog", { name: "Cadastrar pessoa" });
    await u.click(within(d).getByRole("button", { name: "Cadastrar" }));
    expect(within(d).getByText("Informe o nome (mínimo 2 letras).")).toBeInTheDocument();
    expect(within(d).getByText("Marque ao menos um papel.")).toBeInTheDocument();

    await u.type(within(d).getByLabelText("Nome completo"), "Guia Fictícia Duda");
    await u.click(within(d).getByRole("checkbox", { name: "Guia" }));
    await u.click(within(d).getByRole("checkbox", { name: "Motorista" }));
    await u.selectOptions(within(d).getByLabelText("Praça"), BC.id);
    await u.type(within(d).getByLabelText("Número no Cadastur"), "12.345678.10.0001-1");
    await u.type(within(d).getByLabelText("Validade do Cadastur"), somarDias(hoje, 5));
    expect(within(d).getByText(/Cadastur vence em/)).toBeInTheDocument();
    await u.type(within(d).getByLabelText("Idiomas"), "Português, Inglês");
    await u.selectOptions(within(d).getByLabelText("Categoria da CNH"), "D");
    await u.selectOptions(within(d).getByLabelText("Tipo de documento"), "CPF");
    await u.type(within(d).getByLabelText("Número do documento"), "52998224725");
    await u.type(within(d).getByLabelText("Diária (R$)"), "1.250,5");
    await u.click(within(d).getByRole("button", { name: "Cadastrar" }));

    expect(corpoEnviado(api, "POST", "/api/pessoas")).toEqual({
      nome: "Guia Fictícia Duda",
      papeis: ["GUIA", "MOTORISTA"],
      unidadeId: BC.id,
      telefone: null,
      email: null,
      diariaCentavos: 125050,
      observacoes: null,
      cnhCategoria: "D",
      cnhValidade: null,
      cadasturNumero: "12.345678.10.0001-1",
      cadasturValidade: somarDias(hoje, 5),
      idiomas: ["Português", "Inglês"],
      documentoTipo: "CPF",
      documento: "529.982.247-25",
    });
  });

  it("valida diária e CPF antes de enviar", async () => {
    const api = simularApi({ "GET /api/pessoas": [] });
    renderizar(<Equipe />, { sessao: sessaoFicticia("SUPERVISOR", ["pessoas:ver", "pessoas:gerenciar"]) });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Cadastrar pessoa" }));
    const d = screen.getByRole("dialog");
    // Quem não acessa todas as praças não tem a opção "Todas as praças".
    expect(within(within(d).getByLabelText("Praça")).queryByRole("option", { name: "Todas as praças" })).not.toBeInTheDocument();
    await u.type(within(d).getByLabelText("Nome completo"), "Colaborador Fictício");
    await u.click(within(d).getByRole("checkbox", { name: "Colaborador(a)" }));
    await u.type(within(d).getByLabelText("Diária (R$)"), "12,345");
    await u.selectOptions(within(d).getByLabelText("Tipo de documento"), "CPF");
    await u.type(within(d).getByLabelText("Número do documento"), "11122233300");
    await u.click(within(d).getByRole("button", { name: "Cadastrar" }));
    expect(within(d).getByText(/Valor inválido/)).toBeInTheDocument();
    expect(within(d).getByText(/CPF inválido/)).toBeInTheDocument();
    expect(api.mock.calls.some(([, i]) => i?.method === "POST")).toBe(false);
  });
});
