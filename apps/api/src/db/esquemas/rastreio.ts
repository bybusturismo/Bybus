import { sql } from "drizzle-orm";
import { doublePrecision, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { reservas, saidas, usuarios } from "../schema.js";

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** Uma transmissão do celular do motorista numa saída (liga/desliga). Só uma aberta por saída. */
export const rastreioSessoes = pgTable("rastreio_sessoes", {
  id: uuid().primaryKey().defaultRandom(),
  saidaId: uuid().notNull().references(() => saidas.id),
  motoristaUsuarioId: uuid().notNull().references(() => usuarios.id),
  /** ONIBUS (paradas = pontos de embarque) ou TRANSFER (van; paradas = hotéis do transfer, 11/11/2026). */
  tipo: text().notNull().default("ONIBUS"),
  iniciadaEm: agora(),
  encerradaEm: timestamp({ withTimezone: true }),
  ultimaPosicaoEm: timestamp({ withTimezone: true }),
  /** Último ponto da rota (índice na ordem de embarque dos pontos ativos) em que o ônibus já chegou; -1 = nenhum. */
  ultimoPontoVisitado: integer().notNull().default(-1),
}, (t) => [
  index("rastreio_sessoes_saida_idx").on(t.saidaId, t.iniciadaEm),
  uniqueIndex("rastreio_sessoes_aberta_tipo_uq").on(t.saidaId, t.tipo).where(sql`${t.encerradaEm} is null`),
]);

/** Posições do GPS do motorista, só durante a sessão. Apagadas após 30 dias (LGPD). */
export const rastreioPosicoes = pgTable("rastreio_posicoes", {
  id: uuid().primaryKey().defaultRandom(),
  sessaoId: uuid().notNull().references(() => rastreioSessoes.id, { onDelete: "cascade" }),
  lat: doublePrecision().notNull(),
  lng: doublePrecision().notNull(),
  precisaoM: doublePrecision(),
  /** m/s, como o GPS informa. */
  velocidade: doublePrecision(),
  direcao: doublePrecision(),
  registradaEm: timestamp({ withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex("rastreio_posicoes_sessao_tempo_uq").on(t.sessaoId, t.registradaEm),
  index("rastreio_posicoes_tempo_idx").on(t.registradaEm),
]);

/** Link público de acompanhamento por reserva: só o hash SHA-256 do token fica no banco. */
export const rastreioLinks = pgTable("rastreio_links", {
  reservaId: uuid().primaryKey().references(() => reservas.id, { onDelete: "cascade" }),
  tokenHash: text().notNull().unique(),
  expiraEm: timestamp({ withTimezone: true }).notNull(),
  criadoEm: agora(),
});
