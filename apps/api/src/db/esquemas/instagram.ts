import { boolean, customType, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conteudos, usuarios } from "../schema.js";

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Números diários da conta (agregados; nenhum dado de pessoa). Um registro por dia civil (America/Sao_Paulo). */
export const igMetricasDia = pgTable("ig_metricas_dia", {
  data: date({ mode: "string" }).primaryKey(),
  /** Seguidores no momento da leitura do dia (foto do perfil). */
  seguidores: integer(),
  alcance: integer(),
  /** "views" na API atual (substitui as impressões) — nome a confirmar na doc oficial. */
  visualizacoes: integer(),
  visitasPerfil: integer(),
  cliquesSite: integer(),
  atualizadoEm: agora(),
});

/** Posts da conta com as métricas lidas (atualizadas a cada rodada). */
export const igPosts = pgTable("ig_posts", {
  id: uuid().primaryKey().defaultRandom(),
  idExterno: text().notNull(),
  /** IMAGEM, VIDEO, CARROSSEL, REELS ou STORY. */
  tipo: text().notNull(),
  legenda: text(),
  link: text(),
  publicadoEm: timestamp({ withTimezone: true }),
  curtidas: integer(),
  comentarios: integer(),
  salvamentos: integer(),
  compartilhamentos: integer(),
  alcance: integer(),
  visualizacoes: integer(),
  atualizadoEm: agora(),
}, (t) => [uniqueIndex("ig_posts_externo_uq").on(t.idExterno), index("ig_posts_data_idx").on(t.publicadoEm)]);

/**
 * Comentários recebidos nos posts (aviso da Meta). LGPD: texto e autor ficam só no banco, nunca em log.
 * Resposta e ocultação são feitas pela tela e pelo provedor real (ou simuladas).
 */
export const igComentarios = pgTable("ig_comentarios", {
  id: uuid().primaryKey().defaultRandom(),
  idExterno: text().notNull(),
  /** Post comentado (id na Meta) e uma prévia da legenda, quando o post já foi lido. */
  midiaId: text(),
  /** Comentário-pai quando este é uma resposta. */
  paiIdExterno: text(),
  autorId: text(),
  autorUsuario: text(),
  texto: text(),
  /** Quando foi escrito (aviso da Meta); nulo = hora em que chegou. */
  escritoEm: timestamp({ withTimezone: true }),
  oculto: boolean().notNull().default(false),
  lido: boolean().notNull().default(false),
  /** Resposta pública nossa. */
  respostaTexto: text(),
  respostaIdExterno: text(),
  /** ENVIADA, SIMULADA ou FALHA. */
  respostaStatus: text(),
  respostaPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  respostaEm: timestamp({ withTimezone: true }),
  criadoEm: agora(),
}, (t) => [uniqueIndex("ig_comentarios_externo_uq").on(t.idExterno), index("ig_comentarios_data_idx").on(t.criadoEm)]);

/** Mídia anexada a um conteúdo agendado, guardada no banco (como os anexos da Biblioteca): limite de tamanho e tipo conferido pelo conteúdo. */
export const conteudoMidias = pgTable("conteudo_midias", {
  id: uuid().primaryKey().defaultRandom(),
  conteudoId: uuid().notNull().references(() => conteudos.id, { onDelete: "cascade" }),
  ordem: integer().notNull().default(0),
  nome: text().notNull(),
  tipo: text().notNull(),
  /** IMAGEM ou VIDEO. */
  uso: text().notNull(),
  tamanho: integer().notNull(),
  dados: bytea().notNull(),
  criadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
}, (t) => [index("conteudo_midias_conteudo_idx").on(t.conteudoId, t.ordem)]);

/**
 * Endereço público e temporário de UMA mídia, para a Meta buscar o arquivo na hora de publicar.
 * Guarda só o hash do token (o token em si vai só na URL entregue à Meta); expira em minutos.
 */
export const igMidiaTokens = pgTable("ig_midia_tokens", {
  id: uuid().primaryKey().defaultRandom(),
  tokenHash: text().notNull(),
  midiaId: uuid().notNull().references(() => conteudoMidias.id, { onDelete: "cascade" }),
  expiraEm: timestamp({ withTimezone: true }).notNull(),
  criadoEm: agora(),
}, (t) => [uniqueIndex("ig_midia_tokens_hash_uq").on(t.tokenHash), index("ig_midia_tokens_expira_idx").on(t.expiraEm)]);

/**
 * Banco de mídias do Marketing: fotos e vídeos reaproveitáveis nos posts, com etiquetas (passeio, ponto turístico, temporada).
 * Mesmo armazenamento dos anexos da Biblioteca (bytea no banco, tipo conferido pelo conteúdo, limite de tamanho).
 */
export const bancoMidias = pgTable("banco_midias", {
  id: uuid().primaryKey().defaultRandom(),
  nome: text().notNull(),
  tipo: text().notNull(),
  /** IMAGEM ou VIDEO. */
  uso: text().notNull(),
  tamanho: integer().notNull(),
  dados: bytea().notNull(),
  passeio: text(),
  pontoTuristico: text(),
  temporada: text(),
  criadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
}, (t) => [index("banco_midias_criado_idx").on(t.criadoEm)]);
