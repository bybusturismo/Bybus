import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Pedido de venda (a compra inteira), vindo da Paytour ou do e-mail da Bókun. Um pedido pode gerar várias
 * reservas (uma por passeio e data): cada reserva guarda a sua parte do valor (reservas.valor_centavos).
 * Dinheiro em centavos (BRL); instantes em UTC. Só leitura da origem: nada é gravado na Paytour.
 */
export const vendas = pgTable("vendas", {
  id: uuid().primaryKey().defaultRandom(),
  /** "PAYTOUR-<id do pedido>" ou o código da reserva no canal (ex.: "VIA-107216084"). Único: reimportar atualiza. */
  pedidoCodigo: text().notNull().unique(),
  /** PAYTOUR_API ou BOKUN_EMAIL. */
  fonte: text().notNull(),
  /** SITE, ADMIN, AFILIADO, PARCEIRO, OTA ou BALCAO (regra em packages/core/src/vendas/vendas.ts). */
  canalVenda: text().notNull(),
  valorCentavos: integer().notNull(),
  subtotalCentavos: integer(),
  descontoCentavos: integer().notNull().default(0),
  cupomExternoId: text(),
  metodoPagamento: text(),
  metodoPagamentoExterno: text(),
  tipoPagamento: text(),
  parcelas: integer(),
  dataHoraCompra: timestamp({ withTimezone: true }),
  operadorId: text(),
  afiliadoId: text(),
  afiliadoComissaoCentavos: integer(),
  parceiroId: text(),
  parceiroComissaoCentavos: integer(),
  /** Saldo a pagar enquanto houver pagamento pendente. */
  pagamentoPendenteCentavos: integer().notNull().default(0),
  utmSource: text(),
  utmMedium: text(),
  utmCampaign: text(),
  clienteCidade: text(),
  criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("vendas_compra_idx").on(t.dataHoraCompra)]);
