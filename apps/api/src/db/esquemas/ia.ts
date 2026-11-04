import { sql } from "drizzle-orm";
import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "../schema.js";

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const STATUS_AVALIACAO = ["EXECUTANDO", "CONCLUIDA", "PARCIAL", "FALHA", "LIMITE"] as const;
export type StatusAvaliacao = (typeof STATUS_AVALIACAO)[number];

export const STATUS_ACAO = ["SUGERIDA", "APROVADA", "CONCLUIDA", "DESCARTADA"] as const;
export type StatusAcao = (typeof STATUS_ACAO)[number];

/** Uma avaliação da diretoria virtual (diária ou manual): retratos agregados, pareceres, debate e síntese. */
export const iaAvaliacoes = pgTable("ia_avaliacoes", {
  id: uuid().primaryKey().defaultRandom(),
  /** Dia avaliado (America/Sao_Paulo). */
  dataRef: date({ mode: "string" }).notNull(),
  /** AUTOMATICA (agenda das 6h30) ou MANUAL ("Rodar agora"). */
  origem: text().notNull().default("MANUAL"),
  status: text().notNull().default("EXECUTANDO"),
  modelo: text().notNull(),
  modeloSintese: text().notNull(),
  iniciadaPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  iniciadaEm: agora(),
  concluidaEm: timestamp({ withTimezone: true }),
  erro: text(),
  /** O que cada gestor recebeu: só números agregados (LGPD). Guardado para auditar o que foi enviado à IA. */
  retratos: jsonb(),
  /** Síntese final: resumo, vulnerabilidades, oportunidades, ações sugeridas, pontos de discordância. */
  sintese: jsonb(),
  custoMicroUsd: integer().notNull().default(0),
}, (t) => [index("ia_avaliacoes_data_idx").on(t.dataRef)]);

/** Parecer de um gestor: rodada 1 = avaliação da própria área; rodada 2 = debate (leu os achados dos outros). */
export const iaPareceres = pgTable("ia_pareceres", {
  id: uuid().primaryKey().defaultRandom(),
  avaliacaoId: uuid().notNull().references(() => iaAvaliacoes.id, { onDelete: "cascade" }),
  gestor: text().notNull(),
  rodada: integer().notNull(),
  conteudo: jsonb().notNull(),
  criadoEm: agora(),
}, (t) => [uniqueIndex("ia_pareceres_uq").on(t.avaliacaoId, t.gestor, t.rodada)]);

/** Ação sugerida pela IA. Só vira tarefa/aviso quando uma pessoa aprova (SUGERIDA → APROVADA → CONCLUIDA, ou DESCARTADA). */
export const iaAcoes = pgTable("ia_acoes", {
  id: uuid().primaryKey().defaultRandom(),
  avaliacaoId: uuid().notNull().references(() => iaAvaliacoes.id, { onDelete: "cascade" }),
  titulo: text().notNull(),
  detalhe: text().notNull(),
  /** Gestor/área responsável (id do gestor). */
  area: text().notNull(),
  prioridade: text().notNull().default("media"),
  prazoDias: integer(),
  status: text().notNull().default("SUGERIDA"),
  decididaPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  decididaEm: timestamp({ withTimezone: true }),
  observacao: text(),
  criadoEm: agora(),
}, (t) => [index("ia_acoes_avaliacao_idx").on(t.avaliacaoId), index("ia_acoes_status_idx").on(t.status)]);

/** Registro de cada chamada à IA: quem pediu, ferramentas consultadas, tokens e custo (nunca o texto das conversas). */
export const iaUso = pgTable("ia_uso", {
  id: uuid().primaryKey().defaultRandom(),
  criadoEm: agora(),
  /** Competência AAAA-MM (America/Sao_Paulo), para o limite mensal. */
  mesRef: text().notNull(),
  /** AVALIACAO, DEBATE, SINTESE ou ASSISTENTE. */
  tipo: text().notNull(),
  modelo: text().notNull(),
  tokensEntrada: integer().notNull().default(0),
  tokensSaida: integer().notNull().default(0),
  tokensCacheLeitura: integer().notNull().default(0),
  tokensCacheEscrita: integer().notNull().default(0),
  custoMicroUsd: integer().notNull().default(0),
  usuarioId: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  avaliacaoId: uuid().references(() => iaAvaliacoes.id, { onDelete: "set null" }),
  gestor: text(),
  ferramentas: text().array().notNull().default(sql`'{}'::text[]`),
}, (t) => [index("ia_uso_mes_idx").on(t.mesRef)]);
