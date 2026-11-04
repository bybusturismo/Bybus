import { describe, expect, it } from "vitest";
import { canalVendaPaytour, dataHoraBrasiliaParaUtc, lerEmailBokun, lerValorBokun, pedidoPaytourParaReservas, ratearCentavos, reaisParaCentavos, type PedidoPaytour } from "../src/index.js";

describe("reaisParaCentavos", () => {
  it("lê os formatos dos canais sem erro de ponto flutuante", () => {
    expect(reaisParaCentavos("170.00")).toBe(17000);
    expect(reaisParaCentavos("0.10")).toBe(10);
    expect(reaisParaCentavos("1.234,50")).toBe(123450);
    expect(reaisParaCentavos("R$ 40,5")).toBe(4050);
    expect(reaisParaCentavos("1,234.56")).toBe(123456);
    expect(reaisParaCentavos("19.999")).toBe(2000);
    expect(reaisParaCentavos(12.34)).toBe(1234);
    expect(reaisParaCentavos("0")).toBe(0);
  });
  it("vazio, nulo e lixo viram null", () => {
    for (const v of [null, undefined, "", "null", "abc", "-"]) expect(reaisParaCentavos(v)).toBeNull();
  });
});

describe("ratearCentavos", () => {
  it("não perde nem cria centavo", () => {
    for (const [total, pesos] of [[10000, [1, 1, 1]], [1, [1, 1]], [999, [3, 7, 11, 2]], [0, [5, 5]]] as const) {
      const r = ratearCentavos(total, [...pesos]);
      expect(r.reduce((t, n) => t + n, 0)).toBe(total);
      expect(r.every((n) => n >= 0 && Number.isInteger(n))).toBe(true);
    }
    expect(ratearCentavos(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
  });
  it("proporcional ao peso; pesos zerados dividem por igual; um só grupo leva tudo", () => {
    expect(ratearCentavos(10000, [3, 1])).toEqual([7500, 2500]);
    expect(ratearCentavos(100, [0, 0])).toEqual([50, 50]);
    expect(ratearCentavos(12345, [7])).toEqual([12345]);
    expect(ratearCentavos(100, [])).toEqual([]);
  });
});

describe("dataHoraBrasiliaParaUtc", () => {
  it("soma 3 horas e vira o dia quando preciso", () => {
    expect(dataHoraBrasiliaParaUtc("2026-11-04 09:47:39")).toBe("2026-11-04T12:47:39.000Z");
    expect(dataHoraBrasiliaParaUtc("2026-11-04 22:30:00")).toBe("2026-11-05T01:30:00.000Z");
    expect(dataHoraBrasiliaParaUtc("lixo")).toBeNull();
    expect(dataHoraBrasiliaParaUtc(null)).toBeNull();
  });
});

describe("canalVendaPaytour", () => {
  const base = { canalReserva: "PAYTOUR" };
  it("segue a ordem OTA > parceiro > afiliado > maquininha > admin > site", () => {
    expect(canalVendaPaytour({ ...base })).toBe("SITE");
    expect(canalVendaPaytour({ ...base, operadorId: "48" })).toBe("ADMIN");
    expect(canalVendaPaytour({ ...base, operadorId: "48", afiliadoId: "454" })).toBe("AFILIADO");
    expect(canalVendaPaytour({ ...base, afiliadoId: "454", parceiroId: "415" })).toBe("PARCEIRO");
    expect(canalVendaPaytour({ ...base, operadorId: "48", metodoPagamento: "maquininha_cielo" })).toBe("BALCAO");
    expect(canalVendaPaytour({ canalReserva: "VIATOR", operadorId: "48", afiliadoId: "9" })).toBe("OTA");
  });
  it('"null", vazio e "0" não contam como preenchidos', () => {
    expect(canalVendaPaytour({ ...base, operadorId: "null", afiliadoId: "", parceiroId: "0" })).toBe("SITE");
  });
});

const itens = (v1: string, v2: string, opcional = true) => [
  { id: 1, nome_produto: "City Tour Toda Ilha", produto_disponibilidade_data: "2026-11-11", quantidade: "2", valor: v1 },
  { id: 2, nome_produto: "Passeio de Escuna", produto_disponibilidade_data: "2026-11-12", quantidade: "1", valor: v2, ...(opcional ? { opcionais: [{ valor: "20.00" }] } : {}) },
];

describe("valores no pedido da Paytour", () => {
  const pedido: PedidoPaytour = {
    id: 7, status: "aprovado", valor: "170.00", desconto: "10.00", cupom_id: "415", metodo_pagamento: "cielo", parcelas_pagamento: 3,
    data_hora_pedido: "2026-11-04 23:30:00", operador_id: "48", afiliado_id: "null", afiliado_comissao: "null", pagamento_pendente: "1", pagamento_pendente_valor: "40.00",
    utm_source: "google", cliente_cidade: "Curitiba", itens: itens("100.00", "60.00"),
  };

  it("grava o pedido em centavos e reparte o valor e o desconto entre as reservas", () => {
    const rs = pedidoPaytourParaReservas(pedido);
    expect(rs).toHaveLength(2);
    // pesos 100,00 e 80,00 (60 + opcional 20) → 170,00 rateado
    expect(rs.map((r) => r.valorCentavos)).toEqual([9444, 7556]);
    expect(rs.reduce((t, r) => t + (r.valorCentavos ?? 0), 0)).toBe(17000);
    expect(rs.reduce((t, r) => t + (r.descontoCentavos ?? 0), 0)).toBe(1000);
    expect(rs[0]!.venda).toMatchObject({
      pedidoCodigo: "PAYTOUR-7", canalVenda: "ADMIN", valorCentavos: 17000, descontoCentavos: 1000, subtotalCentavos: 18000, cupomExternoId: "415",
      parcelas: 3, dataHoraCompra: "2026-11-05T02:30:00.000Z", operadorId: "48", afiliadoId: null, afiliadoComissaoCentavos: null,
      pagamentoPendenteCentavos: 4000, utmSource: "google", clienteCidade: "Curitiba",
    });
    expect(rs[1]!.venda).toEqual(rs[0]!.venda);
  });

  it("sem valor nos itens, reparte pelas pessoas; sem valor no pedido, não grava venda", () => {
    const rs = pedidoPaytourParaReservas({ ...pedido, itens: itens("", "", false) });
    expect(rs.map((r) => r.valorCentavos)).toEqual([11333, 5667]); // 2 pessoas × 1 pessoa
    const sem = pedidoPaytourParaReservas({ id: 8, status: "aprovado", itens: itens("", "", false) });
    expect(sem.every((r) => r.venda === null && r.valorCentavos === null)).toBe(true);
  });

  it("pagamento pendente já quitado não conta como saldo; OTA e afiliado mudam o canal de venda", () => {
    const quitado = pedidoPaytourParaReservas({ ...pedido, pagamento_pendente_pago_em: "2026-11-05" });
    expect(quitado[0]!.venda!.pagamentoPendenteCentavos).toBe(0);
    const afil = pedidoPaytourParaReservas({ ...pedido, afiliado_id: "454", afiliado_comissao: "45.00" });
    expect(afil[0]!.venda).toMatchObject({ canalVenda: "AFILIADO", afiliadoId: "454", afiliadoComissaoCentavos: 4500 });
    const ota = pedidoPaytourParaReservas({ ...pedido, cliente_email: "x@expmessaging.tripadvisor.com" });
    expect(ota[0]!.venda!.canalVenda).toBe("OTA");
  });
});

describe("valor no e-mail da Bókun", () => {
  const email = (linha: string) => `| Booking ref. | VIA-900000002 |
| Product | Floripa City Tour |
| Sold by | Viator.com |
| Booking channel | Viator.com |
| Customer | Exemplo, Maria |
| Date | Sat 24.Oct '26 @ 08:00 |
| PAX | 2 Adult |
| Created | Wed, October 21 2026 @ 05:07 |
${linha}`;
  it("lê o total em reais", () => {
    expect(lerValorBokun("BRL 480.00")).toEqual({ centavos: 48000, moeda: "BRL" });
    expect(lerValorBokun("R$ 1.480,50")).toEqual({ centavos: 148050, moeda: "BRL" });
    expect(lerValorBokun("480.00 BRL")).toEqual({ centavos: 48000, moeda: "BRL" });
    expect(lerValorBokun("USD 90.00")).toEqual({ centavos: null, moeda: "USD" });
  });
  it("grava a venda (OTA) quando o e-mail traz o total em reais", () => {
    const r = lerEmailBokun("New booking", email("| Total price | BRL 480.00 |"))!;
    expect(r.valorCentavos).toBe(48000);
    expect(r.venda).toMatchObject({ pedidoCodigo: "VIA-900000002", canalVenda: "OTA", fonte: "BOKUN_EMAIL", valorCentavos: 48000, dataHoraCompra: "2026-10-21T08:07:00.000Z" });
  });
  it("sem total, ou em outra moeda, não grava valor (com aviso no segundo caso)", () => {
    expect(lerEmailBokun("New booking", email(""))!.venda).toBeNull();
    const usd = lerEmailBokun("New booking", email("| Total | USD 90.00 |"))!;
    expect(usd.venda).toBeNull();
    expect(usd.avisos.join(" ")).toContain("USD");
  });
});
