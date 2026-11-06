import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { campanhas, reservas, saidas, unidades, usuarios } from "../schema.js";

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** Nota e quantidade de avaliações lançadas à mão por semana, por canal (Google, Tripadvisor, Viator…) e por alvo (própria ou concorrente). */
export const avaliacaoExternas = pgTable("avaliacao_externas", {
  id: uuid().primaryKey().defaultRandom(),
  /** Segunda-feira da semana do lançamento. */
  semana: date({ mode: "string" }).notNull(),
  canal: text().notNull(),
  /** "PROPRIA" ou o nome do concorrente (texto livre, sem dado pessoal). */
  alvo: text().notNull().default("PROPRIA"),
  unidadeId: uuid().references(() => unidades.id),
  /** Nota × 100 (4,78 = 478). */
  notaCentesimos: integer().notNull(),
  /** Total de avaliações do canal na data. */
  quantidade: integer().notNull(),
  registradoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
}, (t) => [index("avaliacao_externas_semana_idx").on(t.semana)]);

/** Custo diário de anúncios importado por CSV (Google Ads / Meta Ads). As APIs ficam como próxima etapa. */
export const campanhaCustos = pgTable("campanha_custos", {
  id: uuid().primaryKey().defaultRandom(),
  campanhaId: uuid().notNull().references(() => campanhas.id, { onDelete: "cascade" }),
  dia: date({ mode: "string" }).notNull(),
  custoCentavos: integer().notNull(),
  cliques: integer(),
  impressoes: integer(),
  fonte: text().notNull().default("CSV"),
  importadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
}, (t) => [uniqueIndex("campanha_custos_dia_uq").on(t.campanhaId, t.dia)]);

/** Relatório semanal/mensal de marketing: só números agregados (LGPD). `unidadeId` nulo = consolidado de todas as praças. */
export const relatoriosMarketing = pgTable("relatorios_marketing", {
  id: uuid().primaryKey().defaultRandom(),
  tipo: text().notNull(),
  de: date({ mode: "string" }).notNull(),
  ate: date({ mode: "string" }).notNull(),
  unidadeId: uuid().references(() => unidades.id),
  dados: jsonb().notNull(),
  /** Texto-resumo só com os números (sempre existe) e o resumo escrito pela IA (quando ligada). */
  resumoNumeros: text().notNull(),
  resumoIa: text(),
  geradoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  geradoEm: agora(),
}, (t) => [index("relatorios_marketing_periodo_idx").on(t.de)]);

/** Botão da página pública /bio (link na bio). */
export const bioBotoes = pgTable("bio_botoes", {
  id: uuid().primaryKey().defaultRandom(),
  rotulo: text().notNull(),
  url: text().notNull(),
  tipo: text().notNull().default("OUTRO"),
  ordem: integer().notNull().default(0),
  destaque: boolean().notNull().default(false),
  ativo: boolean().notNull().default(true),
  criadoEm: agora(),
  atualizadoEm: agora(),
});

/** Cliques agregados por dia, botão (id ou "visita") e origem (utm_source normalizado ou "direto"). Sem IP nem dado pessoal. */
export const bioCliques = pgTable("bio_cliques", {
  id: uuid().primaryKey().defaultRandom(),
  dia: date({ mode: "string" }).notNull(),
  chave: text().notNull(),
  origem: text().notNull().default("direto"),
  contagem: integer().notNull().default(0),
}, (t) => [uniqueIndex("bio_cliques_uq").on(t.dia, t.chave, t.origem)]);

/** Pedido de orçamento de grupo vindo da página pública /orcamento. */
export const orcamentosGrupo = pgTable("orcamentos_grupo", {
  id: uuid().primaryKey().defaultRandom(),
  nome: text().notNull(),
  organizacao: text().notNull(),
  tipoGrupo: text().notNull().default("OUTRO"),
  telefone: text(),
  email: text(),
  dataPretendida: date({ mode: "string" }),
  pessoas: integer().notNull(),
  servico: text().notNull(),
  cidadeOrigem: text(),
  mensagem: text(),
  /** Consentimento LGPD explícito: instante e versão do texto aceito. */
  consentimentoEm: timestamp({ withTimezone: true }).notNull(),
  consentimentoVersao: text().notNull(),
  utmSource: text(),
  utmMedium: text(),
  utmCampaign: text(),
  status: text().notNull().default("NOVO"),
  responsavelId: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  anotacoes: text(),
  /** Anonimizado a pedido do titular (LGPD): dados pessoais apagados, o pedido fica só como contagem. */
  anonimizadoEm: timestamp({ withTimezone: true }),
  criadoEm: agora(),
  atualizadoEm: agora(),
}, (t) => [index("orcamentos_grupo_status_idx").on(t.status, t.criadoEm)]);

/** Fluxo de mensagem automática: liga/desliga e texto por idioma (nulo = modelo padrão do sistema). */
export const fluxosMensagem = pgTable("fluxos_mensagem", {
  codigo: text().primaryKey(),
  ligado: boolean().notNull().default(false),
  textoPt: text(),
  textoEn: text(),
  textoEs: text(),
  /** Código do cupom de retorno (só no fluxo CUPOM_RETORNO). */
  extra: text(),
  atualizadoEm: agora(),
  atualizadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
});

/** NPS pós-passeio: uma resposta por reserva; o link público leva um token (só o hash fica aqui). */
export const npsRespostas = pgTable("nps_respostas", {
  id: uuid().primaryKey().defaultRandom(),
  reservaId: uuid().notNull().unique().references(() => reservas.id, { onDelete: "cascade" }),
  saidaId: uuid().notNull().references(() => saidas.id),
  tokenHash: text().notNull().unique(),
  tokenExpiraEm: timestamp({ withTimezone: true }).notNull(),
  idioma: text().notNull().default("pt"),
  enviadoEm: agora(),
  nota: integer(),
  comentario: text(),
  respondidoEm: timestamp({ withTimezone: true }),
  /** PROMOTOR, NEUTRO ou DETRATOR (derivado da nota). */
  classe: text(),
  /** O cliente aceitou receber o convite de avaliação pública (independe da nota). */
  aceitouConvite: boolean(),
  /** Caso interno (nota 0 a 6): ABERTO, EM_TRATATIVA ou RESOLVIDO. */
  casoStatus: text(),
  casoNota: text(),
  casoResponsavelId: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  casoAtualizadoEm: timestamp({ withTimezone: true }),
}, (t) => [index("nps_respostas_resp_idx").on(t.respondidoEm), index("nps_respostas_saida_idx").on(t.saidaId)]);
