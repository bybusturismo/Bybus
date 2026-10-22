import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { CANAIS, CATEGORIAS, STATUS_EMBARQUE, STATUS_RESERVA, TIPOS_DOCUMENTO } from "@bybus/core";

export const PERFIS = ["ADMIN", "SUPERVISOR", "ATENDENTE", "GUIA", "MOTORISTA"] as const;
export type Perfil = (typeof PERFIS)[number];

export const perfilEnum = pgEnum("perfil", PERFIS);
export const canalEnum = pgEnum("canal", CANAIS);
export const categoriaEnum = pgEnum("categoria", CATEGORIAS);
export const tipoDocumentoEnum = pgEnum("tipo_documento", TIPOS_DOCUMENTO);
export const statusReservaEnum = pgEnum("status_reserva", STATUS_RESERVA);
export const statusEmbarqueEnum = pgEnum("status_embarque", STATUS_EMBARQUE);
export const statusSaidaEnum = pgEnum("status_saida", ["PREVISTA", "CONFIRMADA", "CANCELADA", "REALIZADA"]);

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const usuarios = pgTable("usuarios", {
  id: uuid().primaryKey().defaultRandom(),
  nome: text().notNull(),
  email: text().notNull(),
  senhaHash: text().notNull(),
  perfil: perfilEnum().notNull(),
  ativo: boolean().notNull().default(true),
  trocarSenha: boolean().notNull().default(true),
  totpSegredoCifrado: text(),
  totpAtivo: boolean().notNull().default(false),
  /** Último passo de tempo TOTP aceito (impede reutilizar o mesmo código). */
  totpUltimoPasso: integer(),
  /** Quantos bloqueios seguidos (bloqueio progressivo). */
  bloqueios: integer().notNull().default(0),
  tentativasFalhas: integer().notNull().default(0),
  bloqueadoAte: timestamp({ withTimezone: true }),
  criadoEm: agora(),
}, (t) => [uniqueIndex("usuarios_email_uq").on(sql`lower(${t.email})`)]);

export const sessoes = pgTable("sessoes", {
  /** SHA-256 do token do cookie (o token em si nunca é guardado). */
  id: text().primaryKey(),
  usuarioId: uuid().notNull().references(() => usuarios.id, { onDelete: "cascade" }),
  criadaEm: agora(),
  expiraEm: timestamp({ withTimezone: true }).notNull(),
  ultimoUso: agora(),
  ip: text(),
  userAgent: text(),
  revogada: boolean().notNull().default(false),
}, (t) => [index("sessoes_usuario_idx").on(t.usuarioId)]);

export const auditoria = pgTable("auditoria", {
  id: uuid().primaryKey().defaultRandom(),
  // Sem ON DELETE: a auditoria é imutável (usuários são desativados, nunca apagados).
  usuarioId: uuid().references(() => usuarios.id),
  acao: text().notNull(),
  entidade: text(),
  entidadeId: text(),
  dados: jsonb(),
  ip: text(),
  criadoEm: agora(),
}, (t) => [index("auditoria_criado_idx").on(t.criadoEm)]);

export const passeios = pgTable("passeios", {
  id: uuid().primaryKey().defaultRandom(),
  codigo: text().notNull().unique(),
  nome: text().notNull(),
  cidade: text().notNull(),
  capacidadePadrao: integer().notNull(),
  minimoConfirmacao: integer().notNull(),
  minimoSupervisor: integer().notNull(),
  /** Expressão regular (case-insensitive) para reconhecer o produto nas importações. */
  padraoProduto: text(),
  ativo: boolean().notNull().default(true),
});

export const pontosEmbarque = pgTable("pontos_embarque", {
  id: uuid().primaryKey().defaultRandom(),
  passeioId: uuid().notNull().references(() => passeios.id),
  ordem: integer().notNull(),
  horario: text().notNull(),
  nome: text().notNull(),
  endereco: text(),
  ehTransfer: boolean().notNull().default(false),
  ativo: boolean().notNull().default(true),
}, (t) => [uniqueIndex("pontos_passeio_ordem_uq").on(t.passeioId, t.ordem)]);

export const saidas = pgTable("saidas", {
  id: uuid().primaryKey().defaultRandom(),
  passeioId: uuid().notNull().references(() => passeios.id),
  data: date({ mode: "string" }).notNull(),
  status: statusSaidaEnum().notNull().default("PREVISTA"),
  capacidade: integer().notNull(),
  veiculo: text(),
  guia: text(),
  motorista: text(),
  observacoes: text(),
  criadoEm: agora(),
}, (t) => [uniqueIndex("saidas_passeio_data_uq").on(t.passeioId, t.data)]);

export const reservas = pgTable("reservas", {
  id: uuid().primaryKey().defaultRandom(),
  saidaId: uuid().notNull().references(() => saidas.id),
  canal: canalEnum().notNull(),
  /** Canal real quando a reserva é espelho (ex.: Paytour com doc. 1111 → VIATOR). */
  canalOrigem: canalEnum(),
  codigoExterno: text(),
  referencias: text().array().notNull().default(sql`'{}'::text[]`),
  contatoNome: text().notNull(),
  contatoTelefone: text(),
  contatoEmail: text(),
  pontoEmbarqueId: uuid().references(() => pontosEmbarque.id),
  status: statusReservaEnum().notNull().default("CONFIRMADA"),
  observacoes: text(),
  origem: text().notNull().default("MANUAL"),
  criadoEm: agora(),
  atualizadoEm: agora(),
}, (t) => [
  uniqueIndex("reservas_canal_codigo_uq").on(t.canal, t.codigoExterno),
  index("reservas_saida_idx").on(t.saidaId),
]);

export const passageiros = pgTable("passageiros", {
  id: uuid().primaryKey().defaultRandom(),
  /** Ordem de cadastro (estável) — mantém a sequência dos passageiros dentro da reserva. */
  seq: integer().generatedAlwaysAsIdentity(),
  reservaId: uuid().notNull().references(() => reservas.id, { onDelete: "cascade" }),
  nome: text().notNull().default(""),
  categoria: categoriaEnum().notNull(),
  documentoTipo: tipoDocumentoEnum(),
  /** Documento criptografado (AES-256-GCM). */
  documentoCifrado: text(),
  /** Últimos 4 caracteres, para exibição mascarada. */
  documentoFinal: text(),
  documentoValido: boolean(),
  documentoPais: text(),
  pontoEmbarqueId: uuid().references(() => pontosEmbarque.id),
  embarque: statusEmbarqueEnum().notNull().default("PENDENTE"),
  embarqueEm: timestamp({ withTimezone: true }),
  embarquePor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
}, (t) => [index("passageiros_reserva_idx").on(t.reservaId)]);
