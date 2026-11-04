import { type AnyPgColumn, customType, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "../schema.js";

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Páginas da Biblioteca (manuais e procedimentos), em árvore: cada página pode ter subpáginas. */
export const bibliotecaPaginas = pgTable("biblioteca_paginas", {
  id: uuid().primaryKey().defaultRandom(),
  paiId: uuid().references((): AnyPgColumn => bibliotecaPaginas.id),
  titulo: text().notNull(),
  /** Emoji que acompanha o título. */
  icone: text(),
  /** HTML limpo começando por `<!--html-->`; sem a marca, é Markdown (páginas antigas). */
  conteudo: text().notNull().default(""),
  /** Texto puro do conteúdo, para a busca (sem marcas de HTML). */
  textoBusca: text(),
  /** EQUIPE (quem tem biblioteca:ver) ou RESTRITO (só quem edita ou está na lista de pessoas). Vale também para as subpáginas. */
  acesso: text().notNull().default("EQUIPE"),
  /** Posição entre as irmãs (1, 2, 3…); renumerada ao arrastar. */
  ordem: integer().notNull().default(0),
  /** Chave estável das páginas semeadas (permite reexecutar a semente sem duplicar). */
  chaveSemente: text(),
  criadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  atualizadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
  atualizadoEm: agora(),
  /** Lixeira: preenchido na página excluída e em todas as subpáginas dela (mesmo instante). Nulo = ativa. */
  excluidaEm: timestamp({ withTimezone: true }),
}, (t) => [index("biblioteca_pai_idx").on(t.paiId), uniqueIndex("biblioteca_chave_uq").on(t.chaveSemente)]);

/** Acesso por pessoa (ver ou editar). A lista da página mais próxima vale para as subpáginas. */
export const bibliotecaAcessos = pgTable("biblioteca_acessos", {
  id: uuid().primaryKey().defaultRandom(),
  paginaId: uuid().notNull().references(() => bibliotecaPaginas.id, { onDelete: "cascade" }),
  usuarioId: uuid().notNull().references(() => usuarios.id, { onDelete: "cascade" }),
  /** VER ou EDITAR. */
  nivel: text().notNull(),
}, (t) => [uniqueIndex("biblioteca_acessos_uq").on(t.paginaId, t.usuarioId)]);

/** Quem já editou a página (colaboradores), com a última edição de cada um. */
export const bibliotecaColaboradores = pgTable("biblioteca_colaboradores", {
  paginaId: uuid().notNull().references(() => bibliotecaPaginas.id, { onDelete: "cascade" }),
  usuarioId: uuid().notNull().references(() => usuarios.id, { onDelete: "cascade" }),
  ultimaEdicaoEm: agora(),
}, (t) => [primaryKey({ columns: [t.paginaId, t.usuarioId] })]);

/**
 * Anexos da página (imagens do texto, vídeos e arquivos), guardados no próprio banco (bytea): sem pasta nem volume extra no Docker
 * e já cobertos pelo backup do banco. O tipo é conferido pelo conteúdo do arquivo, não só pelo que o navegador declarou.
 */
export const bibliotecaAnexos = pgTable("biblioteca_anexos", {
  id: uuid().primaryKey().defaultRandom(),
  paginaId: uuid().notNull().references(() => bibliotecaPaginas.id, { onDelete: "cascade" }),
  nome: text().notNull(),
  tipo: text().notNull(),
  /** IMAGEM, VIDEO ou ARQUIVO. */
  uso: text().notNull(),
  tamanho: integer().notNull(),
  dados: bytea().notNull(),
  criadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
}, (t) => [index("biblioteca_anexos_pagina_idx").on(t.paginaId)]);
