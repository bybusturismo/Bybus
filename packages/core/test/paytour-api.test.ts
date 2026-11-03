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
    { id: "527", produto_tipo: "passeio", quantidade: "2", nome_produto: "City Tour Toda Ilha", produto_disponibilidade_data: "2026-11-10", produto_faixa_etaria_nome: "Criança", formulario: [] },
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
    expect(rs.map((r) => r.codigoExterno)).toEqual(["PAYTOUR-9-2026-11-11-1", "PAYTOUR-9-2026-11-12-2"]);
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
