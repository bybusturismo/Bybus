import { type AnyPgColumn, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "../schema.js";

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** Páginas da Biblioteca (manuais e procedimentos), em árvore: cada página pode ter subpáginas. Conteúdo em Markdown. */
export const bibliotecaPaginas = pgTable("biblioteca_paginas", {
  id: uuid().primaryKey().defaultRandom(),
  paiId: uuid().references((): AnyPgColumn => bibliotecaPaginas.id),
  titulo: text().notNull(),
  conteudo: text().notNull().default(""),
  /** EQUIPE (quem tem biblioteca:ver) ou RESTRITO (só quem tem biblioteca:editar). Vale também para as subpáginas. */
  acesso: text().notNull().default("EQUIPE"),
  ordem: integer().notNull().default(0),
  /** Chave estável das páginas semeadas (permite reexecutar a semente sem duplicar). */
  chaveSemente: text(),
  criadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  atualizadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
  atualizadoEm: agora(),
}, (t) => [index("biblioteca_pai_idx").on(t.paiId), uniqueIndex("biblioteca_chave_uq").on(t.chaveSemente)]);
