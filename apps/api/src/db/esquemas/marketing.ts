import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { reservas, saidas, unidades, usuarios } from "../schema.js";

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** Campanha de mídia/cupom. `unidadeId` nulo = vale para todas as praças. Dinheiro em centavos. */
export const campanhas = pgTable("campanhas", {
  id: uuid().primaryKey().defaultRandom(),
  unidadeId: uuid().references(() => unidades.id),
  nome: text().notNull(),
  /** Ver MIDIAS_CAMPANHA no core. */
  midia: text().notNull(),
  inicio: date({ mode: "string" }).notNull(),
  fim: date({ mode: "string" }),
  investimentoCentavos: integer().notNull().default(0),
  cupom: text(),
  utmCampanha: text(),
  /** Meta em número de reservas. */
  metaReservas: integer(),
  observacoes: text(),
  ativa: boolean().notNull().default(true),
  criadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
  atualizadoEm: agora(),
}, (t) => [index("campanhas_inicio_idx").on(t.inicio)]);

/**
 * Resultado atribuído à campanha, lançado à mão por mês.
 * A Paytour ainda não entrega cupom/UTM por pedido (a confirmar), por isso a atribuição é um lançamento manual.
 */
export const campanhaResultados = pgTable("campanha_resultados", {
  id: uuid().primaryKey().defaultRandom(),
  campanhaId: uuid().notNull().references(() => campanhas.id, { onDelete: "cascade" }),
  /** AAAA-MM */
  mes: text().notNull(),
  reservas: integer().notNull().default(0),
  passageiros: integer().notNull().default(0),
  receitaCentavos: integer(),
  /** De onde veio o número (ex.: "Relatório de cupom da Paytour", "Google Ads"). A confirmar. */
  fonte: text().notNull().default("MANUAL"),
  criadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
}, (t) => [index("campanha_resultados_campanha_idx").on(t.campanhaId), uniqueIndex("campanha_resultados_mes_uq").on(t.campanhaId, t.mes)]);

/** Calendário de conteúdo (posts por rede). */
export const conteudos = pgTable("conteudos", {
  id: uuid().primaryKey().defaultRandom(),
  unidadeId: uuid().references(() => unidades.id),
  titulo: text().notNull(),
  rede: text().notNull(),
  /** IDEIA, PRODUCAO, AGENDADO ou PUBLICADO. */
  status: text().notNull().default("IDEIA"),
  dataPrevista: date({ mode: "string" }),
  legenda: text(),
  link: text(),
  responsavelId: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
  atualizadoEm: agora(),
}, (t) => [index("conteudos_data_idx").on(t.dataPrevista)]);

/** Pedido de avaliação pós-passeio, um por reserva. O envio por WhatsApp é ligado depois (provedor a contratar). */
export const avaliacaoPedidos = pgTable("avaliacao_pedidos", {
  id: uuid().primaryKey().defaultRandom(),
  reservaId: uuid().notNull().unique().references(() => reservas.id, { onDelete: "cascade" }),
  saidaId: uuid().notNull().references(() => saidas.id),
  /** Texto já preenchido com o modelo da época (sem telefone: o contato fica na reserva). */
  texto: text().notNull(),
  /** PENDENTE, ENVIADA_MANUAL, SIMULADA, SEM_TELEFONE ou IGNORADA. */
  status: text().notNull().default("PENDENTE"),
  /** Idioma da mensagem (pt, en ou es), deduzido do país/DDI do cliente e editável. */
  idioma: text().notNull().default("pt"),
  /** GOOGLE, TRIPADVISOR, VIATOR (avalia na própria Viator, sem link) ou NENHUM (sem link cadastrado). */
  canalAvaliacao: text().notNull().default("NENHUM"),
  link: text(),
  /** Quando o pedido foi feito (à mão, simulado ou enviado), do lembrete e da avaliação. */
  pedidoEm: timestamp({ withTimezone: true }),
  lembreteEm: timestamp({ withTimezone: true }),
  avaliadoEm: timestamp({ withTimezone: true }),
  criadoEm: agora(),
  atualizadoEm: agora(),
}, (t) => [index("avaliacao_pedidos_saida_idx").on(t.saidaId)]);

/** Nota interna (coluna "Pesquisa" da lista em papel): 1 a 5, uma por reserva. */
export const avaliacaoNotas = pgTable("avaliacao_notas", {
  id: uuid().primaryKey().defaultRandom(),
  reservaId: uuid().notNull().unique().references(() => reservas.id, { onDelete: "cascade" }),
  saidaId: uuid().notNull().references(() => saidas.id),
  nota: integer().notNull(),
  comentario: text(),
  registradoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
}, (t) => [index("avaliacao_notas_saida_idx").on(t.saidaId)]);

/** Afiliados próprios (hotéis, pousadas, parceiros) com código e QR code. */
export const afiliados = pgTable("afiliados", {
  id: uuid().primaryKey().defaultRandom(),
  unidadeId: uuid().references(() => unidades.id),
  nome: text().notNull(),
  tipo: text().notNull().default("HOTEL"),
  codigo: text().notNull().unique(),
  /** Comissão em pontos-base (1500 = 15%). Regra de comissão a confirmar com o dono. */
  comissaoPontosBase: integer(),
  contato: text(),
  /** Id do afiliado correspondente na Paytour (ligação pendente: a confirmar). */
  paytourAfiliadoId: text(),
  observacoes: text(),
  ativo: boolean().notNull().default(true),
  criadoEm: agora(),
  atualizadoEm: agora(),
});

/** Configurações simples do marketing (modelo da mensagem, link do Tripadvisor, endereço base da loja). */
export const marketingConfig = pgTable("marketing_config", {
  chave: text().primaryKey(),
  valor: text().notNull(),
  atualizadoEm: agora(),
  atualizadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
});
