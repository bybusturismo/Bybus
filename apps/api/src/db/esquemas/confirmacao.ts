import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usuarios } from "../schema.js";

/**
 * Pontos de corte da confirmação da véspera (uma linha só, id "padrao"). Sem linha, valem os números do gerente
 * (REGRAS_CONFIRMACAO_PADRAO no núcleo).
 */
export const confirmacaoRegras = pgTable("confirmacao_regras", {
  id: text().primaryKey().default("padrao"),
  ligado: boolean().notNull().default(true),
  contarPor: text().notNull().default("RESERVAS"),
  pagasParaConfirmar: integer().notNull().default(10),
  totalParaConfirmar: integer().notNull().default(16),
  pagasMinimasNoTotal: integer().notNull().default(8),
  horaPrevia: text().notNull().default("09:00"),
  horaLimite: text().notNull().default("18:00"),
  atualizadoPor: uuid().references(() => usuarios.id),
  atualizadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
