import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { unidades, usuarios } from "../schema.js";

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** Veículos da frota (placa sem hífen, em maiúsculas). Uma praça por veículo (escopo por unidade). */
export const veiculos = pgTable("veiculos", {
  id: uuid().primaryKey().defaultRandom(),
  unidadeId: uuid().notNull().references(() => unidades.id),
  placa: text().notNull(),
  apelido: text(),
  tipo: text().notNull(),
  modelo: text(),
  ano: integer(),
  capacidade: integer(),
  chassi: text(),
  renavam: text(),
  /** Linha principal (texto livre: "City Tour Toda Ilha", "Fretamento"…). */
  linhaPrincipal: text(),
  usoPublicitario: boolean().notNull().default(false),
  situacao: text().notNull().default("ATIVO"),
  kmAtual: integer().notNull().default(0),
  observacoes: text(),
  /** Link da pasta (ou arquivo) do Google Drive com os gabaritos e outros arquivos do veículo (11/11/2026). */
  driveLink: text(),
  criadoEm: agora(),
  atualizadoEm: agora(),
}, (t) => [uniqueIndex("veiculos_placa_uq").on(t.placa)]);

export const veiculosDocumentos = pgTable("veiculos_documentos", {
  id: uuid().primaryKey().defaultRandom(),
  veiculoId: uuid().notNull().references(() => veiculos.id),
  tipo: text().notNull(),
  descricao: text(),
  numero: text(),
  vencimento: date({ mode: "string" }).notNull(),
  observacao: text(),
  criadoEm: agora(),
}, (t) => [index("veiculos_documentos_veiculo_idx").on(t.veiculoId)]);

/** Plano de manutenção preventiva por km e/ou por tempo. `critico` = vencido bloqueia o veículo. */
export const veiculosPlanos = pgTable("veiculos_planos", {
  id: uuid().primaryKey().defaultRandom(),
  veiculoId: uuid().notNull().references(() => veiculos.id),
  nome: text().notNull(),
  intervaloKm: integer(),
  intervaloDias: integer(),
  ultimoKm: integer(),
  ultimaData: date({ mode: "string" }),
  critico: boolean().notNull().default(false),
  ativo: boolean().notNull().default(true),
  criadoEm: agora(),
}, (t) => [index("veiculos_planos_veiculo_idx").on(t.veiculoId)]);

/** Ordem de manutenção (preventiva ou corretiva). Custo em centavos; tempo parado = conclusão − abertura. */
export const veiculosOrdens = pgTable("veiculos_ordens", {
  id: uuid().primaryKey().defaultRandom(),
  veiculoId: uuid().notNull().references(() => veiculos.id),
  planoId: uuid().references(() => veiculosPlanos.id),
  tipo: text().notNull(),
  status: text().notNull().default("ABERTA"),
  descricao: text().notNull(),
  oficina: text(),
  pecas: text(),
  /** Enquanto aberta, tira o veículo de operação (situação "manutenção"). */
  imobiliza: boolean().notNull().default(false),
  abertaEm: date({ mode: "string" }).notNull(),
  concluidaEm: date({ mode: "string" }),
  km: integer(),
  custoCentavos: integer().notNull().default(0),
  criadoPor: uuid().references(() => usuarios.id),
  criadoEm: agora(),
}, (t) => [index("veiculos_ordens_veiculo_idx").on(t.veiculoId)]);

export const veiculosAbastecimentos = pgTable("veiculos_abastecimentos", {
  id: uuid().primaryKey().defaultRandom(),
  veiculoId: uuid().notNull().references(() => veiculos.id),
  data: date({ mode: "string" }).notNull(),
  km: integer().notNull(),
  litros: doublePrecision().notNull(),
  valorCentavos: integer().notNull(),
  posto: text(),
  tanqueCheio: boolean().notNull().default(true),
  criadoPor: uuid().references(() => usuarios.id),
  criadoEm: agora(),
}, (t) => [index("veiculos_abastecimentos_veiculo_idx").on(t.veiculoId, t.km)]);

/** Leituras de quilometragem. `fonte` KHRONOS é reservada para a integração com o rastreador. */
export const veiculosKm = pgTable("veiculos_km", {
  id: uuid().primaryKey().defaultRandom(),
  veiculoId: uuid().notNull().references(() => veiculos.id),
  data: date({ mode: "string" }).notNull(),
  km: integer().notNull(),
  fonte: text().notNull().default("MANUAL"),
  criadoPor: uuid().references(() => usuarios.id),
  criadoEm: agora(),
}, (t) => [index("veiculos_km_veiculo_idx").on(t.veiculoId, t.data)]);

/** Itens configuráveis do checklist diário. */
export const checklistItens = pgTable("checklist_itens", {
  id: uuid().primaryKey().defaultRandom(),
  grupo: text().notNull(),
  descricao: text().notNull(),
  critico: boolean().notNull().default(false),
  ordem: integer().notNull().default(0),
  ativo: boolean().notNull().default(true),
});

/** Checklist preenchido. `respostas` guarda uma cópia dos itens (a lista pode mudar depois). */
export const veiculosChecklists = pgTable("veiculos_checklists", {
  id: uuid().primaryKey().defaultRandom(),
  veiculoId: uuid().notNull().references(() => veiculos.id),
  data: date({ mode: "string" }).notNull(),
  usuarioId: uuid().references(() => usuarios.id),
  km: integer(),
  aprovado: boolean().notNull(),
  observacao: text(),
  respostas: jsonb().$type<Array<{ itemId: string; grupo: string; descricao: string; critico: boolean; ok: boolean; observacao: string | null }>>().notNull(),
  ordemId: uuid().references(() => veiculosOrdens.id),
  criadoEm: agora(),
}, (t) => [index("veiculos_checklists_veiculo_idx").on(t.veiculoId, t.data)]);
