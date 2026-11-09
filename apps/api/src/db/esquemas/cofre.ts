import { boolean, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "../schema.js";

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/**
 * Cofre de senhas (09/11/2026, formato do APP TOMA): senhas da empresa por setor. Usuário, senha e observações são cifrados com
 * AES-256-GCM e a chave COFRE_CHAVE (só no .env do servidor, fora do banco e dos backups). Nome, categoria e site ficam abertos.
 */
export const cofreSetores = pgTable("cofre_setores", {
  id: uuid().primaryKey().defaultRandom(),
  nome: text().notNull(),
  criadoEm: agora(),
});

/** Quem vê cada setor (só quem foi indicado, inclusive administradores) e se pode editar. */
export const cofreMembros = pgTable("cofre_membros", {
  setorId: uuid().notNull().references(() => cofreSetores.id, { onDelete: "cascade" }),
  usuarioId: uuid().notNull().references(() => usuarios.id, { onDelete: "cascade" }),
  podeEditar: boolean().notNull().default(false),
}, (t) => [primaryKey({ columns: [t.setorId, t.usuarioId] })]);

export const cofreItens = pgTable("cofre_itens", {
  id: uuid().primaryKey().defaultRandom(),
  setorId: uuid().notNull().references(() => cofreSetores.id, { onDelete: "cascade" }),
  titulo: text().notNull(),
  categoria: text(),
  url: text(),
  usuarioCifrado: text(),
  senhaCifrada: text(),
  notasCifradas: text(),
  criadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
  atualizadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  atualizadoEm: agora(),
}, (t) => [index("cofre_itens_setor_idx").on(t.setorId)]);

/** Registro de acessos: entrar, errar a senha, ver, copiar, criar, editar, excluir, importar, mudar pessoas. Só o gestor vê. */
export const cofreRegistro = pgTable("cofre_registro", {
  id: uuid().primaryKey().defaultRandom(),
  itemId: uuid().references(() => cofreItens.id, { onDelete: "set null" }),
  titulo: text(),
  usuarioId: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  acao: text().notNull(),
  detalhe: text(),
  em: agora(),
}, (t) => [index("cofre_registro_em_idx").on(t.em)]);

/** Gestor do Cofre (uma linha): só ele cria setores, indica pessoas e vê o registro. Começa com o primeiro administrador. */
export const cofreConfig = pgTable("cofre_config", {
  id: text().primaryKey().default("padrao"),
  gestorId: uuid().references(() => usuarios.id, { onDelete: "set null" }),
});
