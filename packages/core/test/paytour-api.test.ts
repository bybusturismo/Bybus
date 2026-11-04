import { describe, expect, it } from "vitest";
import { pedidoPaytourParaReservas, type PedidoPaytour } from "../src/index.js";

// Formato do exemplo da documentação da API v2 da Paytour, com dados FICTÍCIOS.
const pedido: PedidoPaytour = {
  id: "200",
  status: "aprovado",
  cliente_nome: "Cliente Fictício",
  cliente_email: "cliente@exemplo.com",
  cliente_cpf: "52998224725",
  cliente_celular: "(48) 90000-0000",
  cliente_ddi: "+55",
  afiliado_id: "null",
  observacao: "null",
  observacoes: [{ observacao: "Espelho da VIA-107000001" }],
  itens: [
    {
      id: "526", produto_tipo: "passeio", quantidade: "1", nome_produto: "City Tour Toda Ilha",
      produto_disponibilidade_data: "2026-11-10", produto_disponibilidade_hora: "08:00 até 17:00",
      produto_faixa_etaria_nome: "Adulto", voucher_code: "59525165252", nome_utilizador: "Pessoa Um",
      formulario: [
        { chave: "nome", valor: "Pessoa Um Fictícia", label: "Nome", tipo: "nome_completo" },
        { chave: "cpf", valor: "529.982.247-25", label: "CPF", tipo: "cpf" },
        { chave: "ponto_embarque", valor: "Hotel Majestic", label: "Ponto de embarque", tipo: "select" },
      ],
    },
    { id: "527", produto_tipo: "passeio", quantidade: "2", produto_disponibilidade_hora_de: null, nome_produto: "City Tour Toda Ilha", produto_disponibilidade_data: "2026-11-10", produto_faixa_etaria_nome: "Criança", formulario: [] },
  ],
};

describe("pedidoPaytourParaReservas", () => {
  it("monta a reserva com passageiros, categorias, documento, ponto e horário", () => {
    const [r, ...resto] = pedidoPaytourParaReservas(pedido);
    expect(resto).toHaveLength(0);
    expect(r).toMatchObject({
      canal: "PAYTOUR", codigoExterno: "PAYTOUR-200", data: "2026-11-10", horario: "08:00", produto: "City Tour Toda Ilha",
      contatoNome: "Cliente Fictício", pontoEmbarqueTexto: "Hotel Majestic", cancelada: false,
    });
    expect(r!.passageiros).toEqual([
      { nome: "Pessoa Um Fictícia", categoria: "ADULTO", documentoTipo: "CPF", documento: "529.982.247-25" },
      { nome: "", categoria: "INFANTIL", documentoTipo: null, documento: null },
      { nome: "", categoria: "INFANTIL", documentoTipo: null, documento: null },
    ]);
    expect(r!.referencias).toEqual(expect.arrayContaining(["VIA-107000001", "59525165252"]));
    expect(r!.avisos).toEqual([]);
  });

  it("cancelamento, espelho de OTA (doc 1111), formulário em objeto e vários passeios no pedido", () => {
    const rs = pedidoPaytourParaReservas({
      id: 9, status: "cancelado",
      itens: [
        { id: 1, nome_produto: "City Tour Toda Ilha", produto_disponibilidade_data: "2026-11-11", formulario: { nome: { valor: "Fulano Fictício", tipo: "nome_completo" }, documento: { valor: "1111" } } },
        { id: 2, nome_produto: "Passeio de Escuna", produto_disponibilidade_data: "2026-11-12" },
      ],
    });
    expect(rs.map((r) => r.codigoExterno)).toEqual(["PAYTOUR-9-2026-11-11-city-tour-toda-ilha", "PAYTOUR-9-2026-11-12-passeio-de-escuna"]);
    expect(rs.every((r) => r.cancelada)).toBe(true);
    expect(rs[0]).toMatchObject({ canal: "VIATOR" });
    expect(rs[0]!.passageiros[0]).toMatchObject({ nome: "Fulano Fictício", documento: null });
  });

  it("status desconhecido gera aviso; afiliado Decolar vira canal de origem", () => {
    const [r] = pedidoPaytourParaReservas({ id: 3, status: "aguardando", afiliado_id: "45", itens: [{ id: 1, nome_produto: "X", produto_disponibilidade_data: "2026-11-13" }] }, { "45": "decolarinternobybus" });
    expect(r!.avisos.join(" ")).toMatch(/aguardando/);
    expect(r!.canal).toBe("DECOLAR");
  });
});

it("usa o horário de início quando a Paytour informa (formato real: \"18:00:00\" e rótulo \"Noite\")", () => {
  const [r] = pedidoPaytourParaReservas({ id: 5, status: "aprovado", itens: [{ id: 1, quantidade: "1", nome_produto: "City Tour - Passeio Bruxólico", produto_disponibilidade_data: "2026-11-20", produto_disponibilidade_hora: "Noite", produto_disponibilidade_hora_de: "18:00:00",
    formulario: [{ chave: "ponto_de_embarque", label: "Ponto de embarque", tipo: "hospedagem", valor: "18h30 no ponto de táxi do Villa Romana Shopping." }, { chave: "documento_rg_cpf_passaporte", label: " Documento: RG/CPF/Passaporte", tipo: "text", valor: "1111" }] }] });
  expect(r).toMatchObject({ horario: "18:00", pontoEmbarqueTexto: "18h30 no ponto de táxi do Villa Romana Shopping.", canal: "VIATOR" });
});

it("faixas reais da Paytour: \"Preço único\" e \"Sênior e PNE\"", () => {
  const [r] = pedidoPaytourParaReservas({ id: 6, status: "aprovado", itens: [
    { id: 1, quantidade: "1", nome_produto: "X", produto_disponibilidade_data: "2026-11-20", produto_faixa_etaria_nome: "Preço único" },
    { id: 2, quantidade: "1", nome_produto: "X", produto_disponibilidade_data: "2026-11-20", produto_faixa_etaria_nome: "Sênior e PNE" },
  ] });
  expect(r!.passageiros.map((p) => p.categoria)).toEqual(["ADULTO", "SENIOR"]);
  expect(r!.avisos).toEqual([]);
});

it("formato antigo do formulário (objeto com chaves com hífen) e campo de embarque \"ciente\"", () => {
  const [r] = pedidoPaytourParaReservas({ id: 8, status: "aprovado", itens: [{ id: 1, quantidade: "1", nome_produto: "City Tour - Passeio Bruxólico", produto_disponibilidade_data: "2026-10-30",
    produto_faixa_etaria_nome: "VALOR PROMOCIONAL MORADOR",
    formulario: { "informe-o-hotel-ou-endereco-de-estada": "Hotel Qualquer", "nome-completo": "Pessoa Antiga Fictícia", "documento-rgcpfpassaporte": "529.982.247-25", "embarque-as-18h30-no-ponto-de-taxi-do-villa-romana-shopping": "Ciente" } }] });
  expect(r!.passageiros[0]).toMatchObject({ nome: "Pessoa Antiga Fictícia", documentoTipo: "CPF", categoria: "ADULTO" });
  expect(r!.pontoEmbarqueTexto).toBe("embarque as 18h30 no ponto de taxi do villa romana shopping");
  expect(r!.avisos).toEqual([]);
});

it("pedido \"reprovado\" (pagamento recusado) não entra na lista", () => {
  const [r] = pedidoPaytourParaReservas({ id: 10, status: "reprovado", itens: [{ id: 1, nome_produto: "X", produto_disponibilidade_data: "2026-11-20" }] });
  expect(r!.cancelada).toBe(true);
});

it("canal pelos rastros do pedido: Civitatis (integração nativa), Tripadvisor e Decolar pelo e-mail", () => {
  const item = { id: 1, nome_produto: "City Tour Toda Ilha", produto_disponibilidade_data: "2026-11-20" };
  const [civ] = pedidoPaytourParaReservas({ id: 11, status: "aprovado", tipo_pagamento: "civitatis", metodo_pagamento: "integracao_parceiro", cliente_email: "reserva@civitatis.exemplo", itens: [item] });
  expect(civ).toMatchObject({ canal: "CIVITATIS", avisos: [] });
  const [ta] = pedidoPaytourParaReservas({ id: 12, status: "aprovado", cliente_email: "S-abc+123@expmessaging.tripadvisor.com", itens: [item] });
  expect(ta!.canal).toBe("VIATOR");
  expect(ta!.avisos.join()).toMatch(/espelho de VIATOR/);
  const [dec] = pedidoPaytourParaReservas({ id: 13, status: "aprovado", cliente_email: "cliente@reservas.decolar.exemplo", itens: [item] });
  expect(dec!.canal).toBe("DECOLAR");
});

it("pagamento e origem pelo pedido da Paytour", () => {
  const item = { id: 1, nome_produto: "City Tour Toda Ilha", produto_disponibilidade_data: "2026-11-20" };
  const r = (extra: Record<string, unknown>) => pedidoPaytourParaReservas({ id: 20, status: "aprovado", itens: [item], ...extra } as never)[0]!;
  expect(r({ metodo_pagamento: "pagamento_no_dia", metodo_pagamento_externo: "dinheiro", cliente_uf: "rs" })).toMatchObject({ pagamento: "A_PAGAR", formaPagamento: "Pagar no dia (dinheiro)", origemCliente: "RS" });
  expect(r({ metodo_pagamento: "zoop_pix", cliente_pais: "ARG", cliente_estrangeiro: "1" })).toMatchObject({ pagamento: "PAGO", formaPagamento: "Pix", origemCliente: "ARG" });
  expect(r({ metodo_pagamento: "cortesia" })).toMatchObject({ pagamento: "CORTESIA" });
  expect(r({ metodo_pagamento: "cielo", pagamento_pendente: "1" })).toMatchObject({ pagamento: "A_PAGAR", formaPagamento: "Saldo a pagar" });
  expect(r({ metodo_pagamento: "cielo", cliente_email: "x@expmessaging.tripadvisor.com" })).toMatchObject({ canal: "VIATOR", pagamento: "PAGO", formaPagamento: "Pago na Viator" });
});
