import { sql } from "drizzle-orm";
import { boolean, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "../schema.js";

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/**
 * Documentos da empresa (11/11/2026): pastas com acesso TODOS (quem tem "documentos:ver") ou RESTRITO (administrador + perfis e
 * pessoas da lista). Os arquivos ficam cifrados no banco; cada abertura é registrada na auditoria.
 */
export const docPastas = pgTable("doc_pastas", {
  id: uuid().primaryKey().defaultRandom(),
  nome: text().notNull(),
  descricao: text(),
  ordem: integer().notNull().default(100),
  /** TODOS ou RESTRITO. */
  acesso: text().notNull().default("TODOS"),
  /** Códigos de perfil que veem a pasta restrita. */
  perfis: text().array().notNull().default(sql`'{}'::text[]`),
  /** Usuários que veem a pasta restrita. */
  usuarios: uuid().array().notNull().default(sql`'{}'::uuid[]`),
  criadoEm: agora(),
});

export const docArquivos = pgTable("doc_arquivos", {
  id: uuid().primaryKey().defaultRandom(),
  pastaId: uuid().notNull().references(() => docPastas.id),
  titulo: text().notNull(),
  descricao: text(),
  nomeArquivo: text().notNull(),
  mime: text().notNull(),
  tamanho: integer().notNull(),
  /** Conteúdo em base64, cifrado (AES-256-GCM, mesma chave da ficha dos usuários). */
  dadosCifrados: text().notNull(),
  /** Validade (certidões, alvarás, licenças); nula = sem vencimento. */
  vencimento: date({ mode: "string" }),
  ativo: boolean().notNull().default(true),
  enviadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
  atualizadoEm: agora(),
}, (t) => [index("doc_arquivos_pasta_idx").on(t.pastaId)]);
