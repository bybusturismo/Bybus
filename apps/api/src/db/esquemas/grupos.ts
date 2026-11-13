import { boolean, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { orcamentosGrupo, pessoas, unidades, usuarios } from "../schema.js";

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/**
 * Grupo fechado (escola, empresa, excursão) — dono, 13/11/2026: tudo do grupo num lugar só, para histórico, valores de anos
 * anteriores, roteiros já feitos e plano de contato. Dinheiro em centavos. Os pagamentos são contas a receber do financeiro
 * (fin_lancamentos.grupo_fechado_id): uma fonte só.
 */
export const gruposFechados = pgTable("grupos_fechados", {
  id: uuid().primaryKey().defaultRandom(),
  unidadeId: uuid().references(() => unidades.id),
  /** Nome do grupo / instituição (ex.: escola). */
  nome: text().notNull(),
  /** ESCOLA, EMPRESA, EXCURSAO, EVENTO ou OUTRO. */
  estilo: text().notNull().default("ESCOLA"),
  /** ORCAMENTO, CONFIRMADO, REALIZADO ou CANCELADO. */
  status: text().notNull().default("ORCAMENTO"),
  dataPasseio: date({ mode: "string" }),
  horarioInicio: text(),
  localInicio: text(),
  guiaId: uuid().references(() => pessoas.id, { onDelete: "set null" }),
  veiculo: text(),
  roteiro: text(),
  duracaoTexto: text(),
  almoco: boolean().notNull().default(false),
  localAlmoco: text(),
  pessoas: integer(),
  pessoasMinimo: integer(),
  cortesias: integer().notNull().default(0),
  valorPorPessoaCentavos: integer(),
  valorTotalCentavos: integer(),
  /** % do sinal para reservar a data (regra geral 50%). */
  sinalPercentual: integer().notNull().default(50),
  nfEmitida: boolean().notNull().default(false),
  nfNumero: text(),
  // Contratante (instituição) e representante.
  razaoSocial: text(),
  cnpj: text(),
  endereco: text(),
  representanteNome: text(),
  representanteCargo: text(),
  representanteTelefone: text(),
  representanteEmail: text(),
  /** CPF do representante, cifrado (LGPD). */
  representanteCpfCifrado: text(),
  observacoes: text(),
  /** Link da lista de passageiros para o representante (só o hash do token; 13/11/2026). */
  listaTokenHash: text().unique(),
  listaExpiraEm: timestamp({ withTimezone: true }),
  listaAtualizadaEm: timestamp({ withTimezone: true }),
  orcamentoId: uuid().references(() => orcamentosGrupo.id, { onDelete: "set null" }),
  criadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
  atualizadoEm: agora(),
}, (t) => [index("grupos_fechados_data_idx").on(t.dataPasseio), index("grupos_fechados_nome_idx").on(t.nome)]);

/** Contrato assinado, comprovantes de pagamento, lista e outros. Conteúdo cifrado. */
export const gruposAnexos = pgTable("grupos_anexos", {
  id: uuid().primaryKey().defaultRandom(),
  grupoId: uuid().notNull().references(() => gruposFechados.id, { onDelete: "cascade" }),
  /** CONTRATO, COMPROVANTE, LISTA, NF ou OUTRO. */
  tipo: text().notNull(),
  nomeArquivo: text().notNull(),
  mime: text().notNull(),
  tamanho: integer().notNull(),
  dadosCifrados: text().notNull(),
  enviadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
}, (t) => [index("grupos_anexos_grupo_idx").on(t.grupoId)]);

/** Passageiros do grupo (nome e documento; o documento fica cifrado). */
export const gruposPassageiros = pgTable("grupos_passageiros", {
  id: uuid().primaryKey().defaultRandom(),
  grupoId: uuid().notNull().references(() => gruposFechados.id, { onDelete: "cascade" }),
  ordem: integer().notNull(),
  nome: text().notNull(),
  tipoDocumento: text(),
  documentoCifrado: text(),
  nascimento: date({ mode: "string" }),
  /** ALUNO, PROFESSOR, ACOMPANHANTE ou OUTRO. */
  categoria: text().notNull().default("ALUNO"),
  /** EQUIPE, REPRESENTANTE ou PLANILHA. */
  origem: text().notNull().default("EQUIPE"),
  criadoEm: agora(),
}, (t) => [index("grupos_passageiros_grupo_idx").on(t.grupoId, t.ordem)]);

/**
 * Configurações gerais do sistema (chave/valor), começando pelos dados da empresa no contrato e no recibo (13/11/2026):
 * razão social, CNPJ, endereço, foro e quem assina pela empresa. Nada disso fica no código.
 */
export const configuracoes = pgTable("configuracoes", {
  chave: text().primaryKey(),
  valor: text().notNull(),
  atualizadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  atualizadoEm: agora(),
});

/**
 * Documento enviado para assinatura eletrônica (13/11/2026). A versão assinada fica congelada: o PDF original (cifrado), o
 * hash SHA-256 dele e o conteúdo usado para gerá-lo (para montar a versão final com a folha de assinaturas).
 */
export const assinaturaDocumentos = pgTable("assinatura_documentos", {
  id: uuid().primaryKey().defaultRandom(),
  grupoId: uuid().references(() => gruposFechados.id, { onDelete: "set null" }),
  titulo: text().notNull(),
  /** PENDENTE, CONCLUIDO ou CANCELADO. */
  status: text().notNull().default("PENDENTE"),
  /** Código público para conferir a autenticidade (página /verificar/<código>). */
  codigoVerificacao: text().notNull().unique(),
  blocosJson: text().notNull(),
  pdfCifrado: text().notNull(),
  hashOriginal: text().notNull(),
  pdfFinalCifrado: text(),
  hashFinal: text(),
  criadoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: agora(),
  concluidoEm: timestamp({ withTimezone: true }),
  canceladoEm: timestamp({ withTimezone: true }),
}, (t) => [index("assinatura_documentos_grupo_idx").on(t.grupoId)]);

/** Quem assina: link próprio (hash do token), código de confirmação por e-mail e a trilha da assinatura. */
export const assinaturaSignatarios = pgTable("assinatura_signatarios", {
  id: uuid().primaryKey().defaultRandom(),
  documentoId: uuid().notNull().references(() => assinaturaDocumentos.id, { onDelete: "cascade" }),
  ordem: integer().notNull(),
  /** CONTRATANTE, CONTRATADA ou TESTEMUNHA. */
  papel: text().notNull(),
  nome: text().notNull(),
  email: text().notNull(),
  cpfCifrado: text(),
  tokenHash: text().notNull().unique(),
  codigoHash: text(),
  codigoExpiraEm: timestamp({ withTimezone: true }),
  codigoTentativas: integer().notNull().default(0),
  codigosEnviados: integer().notNull().default(0),
  visualizadoEm: timestamp({ withTimezone: true }),
  assinadoEm: timestamp({ withTimezone: true }),
  nomeDigitado: text(),
  cpfDigitadoCifrado: text(),
  ip: text(),
  navegador: text(),
}, (t) => [index("assinatura_signatarios_doc_idx").on(t.documentoId)]);
