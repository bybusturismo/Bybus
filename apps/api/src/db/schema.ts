import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { CANAIS, CATEGORIAS, STATUS_EMBARQUE, STATUS_RESERVA, TIPOS_DOCUMENTO } from "@bybus/core";

/** Linhas de negócio da empresa (ADR 0005). */
export const LINHAS_NEGOCIO = ["CITY_TOUR", "FRETAMENTO", "PUBLICIDADE", "RECREATIVO"] as const;
export type LinhaNegocio = (typeof LINHAS_NEGOCIO)[number];

/** Papéis de uma pessoa no cadastro único (uma pessoa pode ter vários). */
export const PAPEIS_PESSOA = ["GUIA", "MOTORISTA", "COLABORADOR", "PARCEIRO"] as const;
export type PapelPessoa = (typeof PAPEIS_PESSOA)[number];

export const linhaNegocioEnum = pgEnum("linha_negocio", LINHAS_NEGOCIO);
export const canalEnum = pgEnum("canal", CANAIS);
export const categoriaEnum = pgEnum("categoria", CATEGORIAS);
export const tipoDocumentoEnum = pgEnum("tipo_documento", TIPOS_DOCUMENTO);
export const statusReservaEnum = pgEnum("status_reserva", STATUS_RESERVA);
export const statusEmbarqueEnum = pgEnum("status_embarque", STATUS_EMBARQUE);
export const statusSaidaEnum = pgEnum("status_saida", ["PREVISTA", "CONFIRMADA", "CANCELADA", "REALIZADA"]);

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** Praças/unidades (Florianópolis, Balneário Camboriú, Blumenau… e futuras franquias). */
export const unidades = pgTable("unidades", {
  id: uuid().primaryKey().defaultRandom(),
  codigo: text().notNull().unique(),
  nome: text().notNull(),
  cidade: text().notNull(),
  uf: text().notNull(),
  ativa: boolean().notNull().default(true),
  criadoEm: agora(),
});

/** Perfis de acesso configuráveis pelo administrador. `codigo` é a chave usada na API. */
export const perfis = pgTable("perfis", {
  id: uuid().primaryKey().defaultRandom(),
  codigo: text().notNull().unique(),
  nome: text().notNull(),
  descricao: text(),
  permissoes: text().array().notNull().default(sql`'{}'::text[]`),
  /** Perfis padrão do sistema (não podem ser excluídos; o ADMIN não pode ser alterado). */
  sistema: boolean().notNull().default(false),
  criadoEm: agora(),
});

export const usuarios = pgTable("usuarios", {
  id: uuid().primaryKey().defaultRandom(),
  nome: text().notNull(),
  email: text().notNull(),
  senhaHash: text().notNull(),
  perfilId: uuid().notNull().references(() => perfis.id),
  /** Acesso a todas as unidades (diretoria/franqueadora). Senão, só às de usuarios_unidades. */
  todasUnidades: boolean().notNull().default(false),
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

export const usuariosUnidades = pgTable("usuarios_unidades", {
  usuarioId: uuid().notNull().references(() => usuarios.id, { onDelete: "cascade" }),
  unidadeId: uuid().notNull().references(() => unidades.id),
}, (t) => [primaryKey({ columns: [t.usuarioId, t.unidadeId] })]);

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
  unidadeId: uuid().notNull().references(() => unidades.id),
  linha: linhaNegocioEnum().notNull().default("CITY_TOUR"),
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

/** Cadastro único de pessoas: guias, motoristas, colaboradores e parceiros (pessoa física). */
export const pessoas = pgTable("pessoas", {
  id: uuid().primaryKey().defaultRandom(),
  nome: text().notNull(),
  papeis: text().array().notNull().default(sql`'{}'::text[]`),
  unidadeId: uuid().references(() => unidades.id),
  telefone: text(),
  email: text(),
  documentoTipo: text(),
  documentoCifrado: text(),
  documentoFinal: text(),
  cnhCategoria: text(),
  cnhValidade: date({ mode: "string" }),
  cadasturNumero: text(),
  cadasturValidade: date({ mode: "string" }),
  idiomas: text().array().notNull().default(sql`'{}'::text[]`),
  /** Diária (guia) em centavos. */
  diariaCentavos: integer(),
  observacoes: text(),
  usuarioId: uuid().references(() => usuarios.id).unique(),
  ativo: boolean().notNull().default(true),
  criadoEm: agora(),
}, (t) => [index("pessoas_unidade_idx").on(t.unidadeId)]);

export const saidas = pgTable("saidas", {
  id: uuid().primaryKey().defaultRandom(),
  passeioId: uuid().notNull().references(() => passeios.id),
  data: date({ mode: "string" }).notNull(),
  status: statusSaidaEnum().notNull().default("PREVISTA"),
  capacidade: integer().notNull(),
  veiculo: text(),
  guia: text(),
  motorista: text(),
  guiaId: uuid().references(() => pessoas.id),
  motoristaId: uuid().references(() => pessoas.id),
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
