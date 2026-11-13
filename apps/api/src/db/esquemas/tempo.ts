import { date, doublePrecision, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { unidades } from "../schema.js";

/** Previsão do tempo por praça e dia (13/11/2026). Atualizada a cada 3 h; dias passados ficam como registro de como estava. */
export const tempoPrevisoes = pgTable("tempo_previsoes", {
  unidadeId: uuid().notNull().references(() => unidades.id),
  data: date({ mode: "string" }).notNull(),
  icone: text().notNull(),
  tempMin: integer(),
  tempMax: integer(),
  chuvaMm: doublePrecision(),
  atualizadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.unidadeId, t.data] })]);

/** Média histórica (1991–2020, NASA POWER) por praça e dia do ano "MM-DD": usada além do alcance da previsão. */
export const tempoNormais = pgTable("tempo_normais", {
  unidadeId: uuid().notNull().references(() => unidades.id),
  diaAno: text().notNull(),
  probChuva: integer().notNull(),
  tempMin: integer().notNull(),
  tempMax: integer().notNull(),
  chuvaMm: doublePrecision().notNull(),
}, (t) => [primaryKey({ columns: [t.unidadeId, t.diaAno] })]);
