import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { passeios, pessoas, pontosEmbarque, reservas, saidas, usuarios, veiculos } from "../schema.js";

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/**
 * Padrões do transfer de um passeio (uma linha por passeio): taxa única por passageiro, ponto de encontro com o ônibus,
 * van e motorista fixos (aplicados a cada dia, como o motorista/veículo padrão da escala).
 */
export const transferConfig = pgTable("transfer_config", {
  passeioId: uuid().primaryKey().references(() => passeios.id),
  /** Taxa única por passageiro com assento, igual em todos os bairros (centavos). [A CONFIRMAR] entre R$ 35 e R$ 45. */
  taxaPorPassageiroCentavos: integer().notNull().default(4500), // R$ 45,00 por passageiro (dono, 05/11/2026)
  taxaAConfirmar: boolean().notNull().default(false),
  /** Minutos somados a cada parada seguinte dentro do mesmo bairro, no cálculo do horário de busca. */
  intervaloMinutos: integer().notNull().default(5),
  /** Ponto de embarque do passeio onde a van encontra o ônibus (Villa Romana Shopping). */
  pontoEncontroId: uuid().references(() => pontosEmbarque.id),
  /** Horário "HH:MM" previsto de chegada da van ao ponto de encontro; nulo = usa o horário do ponto. */
  chegadaPrevista: text(),
  motoristaPadraoId: uuid().references(() => pessoas.id),
  veiculoPadraoId: uuid().references(() => veiculos.id),
  /** Placa/descrição em texto, quando a van não está no cadastro da frota. */
  veiculoPadraoTexto: text(),
  lugaresPadrao: integer(),
  atualizadoEm: agora(),
});

/** Bairros de transfer de um passeio, em ordem de busca (do mais longe do centro para o mais perto). */
export const transferBairros = pgTable("transfer_bairros", {
  id: uuid().primaryKey().defaultRandom(),
  passeioId: uuid().notNull().references(() => passeios.id),
  nome: text().notNull(),
  /** 1 = primeiro a ser buscado. */
  ordemBusca: integer().notNull(),
  /** Horário "HH:MM" de chegada da van ao bairro; nulo = a confirmar. */
  horarioReferencia: text(),
  horarioAConfirmar: boolean().notNull().default(true),
  /** Ponto de embarque de transfer da Paytour que corresponde ao bairro (vários bairros podem dividir o mesmo ponto). */
  pontoEmbarqueId: uuid().references(() => pontosEmbarque.id),
  ativo: boolean().notNull().default(true),
}, (t) => [uniqueIndex("transfer_bairros_passeio_nome_uq").on(t.passeioId, sql`lower(${t.nome})`)]);

/** O transfer de uma saída (um por saída): quem leva, em que van e onde encontra o ônibus. */
export const transferDias = pgTable("transfer_dias", {
  id: uuid().primaryKey().defaultRandom(),
  saidaId: uuid().notNull().unique().references(() => saidas.id),
  veiculoId: uuid().references(() => veiculos.id),
  veiculoTexto: text(),
  motoristaId: uuid().references(() => pessoas.id),
  lugares: integer(),
  pontoEncontroId: uuid().references(() => pontosEmbarque.id),
  chegadaPrevista: text(),
  observacoes: text(),
  criadoEm: agora(),
  atualizadoEm: agora(),
});

/** Uma reserva dentro do transfer do dia: onde buscar, quando, em que ordem e a cobrança da taxa. */
export const transferReservas = pgTable("transfer_reservas", {
  id: uuid().primaryKey().defaultRandom(),
  transferDiaId: uuid().notNull().references(() => transferDias.id, { onDelete: "cascade" }),
  reservaId: uuid().notNull().unique().references(() => reservas.id),
  bairroId: uuid().references(() => transferBairros.id),
  /** Hotel/endereço de busca (começa com o que o cliente informou no link de embarque). */
  enderecoBusca: text(),
  /** Horário "HH:MM" de busca (calculado, ou digitado à mão quando "horario" está em `editados`). */
  horarioBusca: text(),
  /** Posição na ordem de busca (0 = primeiro). */
  ordem: integer().notNull().default(0),
  /** A_CONFIRMAR, CONFIRMADO (com o cliente), BUSCADO ou NAO_APARECEU. */
  situacao: text().notNull().default("A_CONFIRMAR"),
  situacaoEm: timestamp({ withTimezone: true }),
  situacaoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  /** Taxa total da reserva (centavos): taxa por passageiro × passageiros com assento. */
  taxaCentavos: integer().notNull().default(0),
  /** PIX, DINHEIRO ou INCLUIDO_NO_PASSEIO; nula enquanto não recebida. */
  taxaForma: text(),
  /** A_RECEBER ou RECEBIDO. */
  taxaSituacao: text().notNull().default("A_RECEBER"),
  recebidoPor: uuid().references(() => usuarios.id, { onDelete: "set null" }),
  recebidoEm: timestamp({ withTimezone: true }),
  /** Campos ajustados à mão, que o recálculo automático não sobrescreve: bairro, endereco, horario, taxa. */
  editados: text().array().notNull().default(sql`'{}'::text[]`),
  /** Falso quando a reserva deixou de ser de transfer (cancelada ou mudou de ponto); o registro fica para o histórico. */
  ativo: boolean().notNull().default(true),
  criadoEm: agora(),
  atualizadoEm: agora(),
}, (t) => [index("transfer_reservas_dia_idx").on(t.transferDiaId, t.ordem)]);
