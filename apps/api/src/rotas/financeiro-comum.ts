import { ehDataIso } from "@bybus/core";
import { z } from "zod";

/** Esquemas de entrada compartilhados pelas rotas do financeiro. */
export const uuid = z.string().uuid();
export const dataIso = z.string().refine(ehDataIso, "Data no formato AAAA-MM-DD");
export const mesIso = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês no formato AAAA-MM");
export const centavos = z.number().int().max(100_000_000_00);
export const valorPositivo = centavos.positive("Informe um valor maior que zero.");
export const naoNegativo = centavos.min(0);
export const placa = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,10}$/, "Placa inválida.");
/** Placa opcional: vazio ("") vale como "sem veículo" (use `|| null` ao gravar). */
export const veiculoOpcional = placa.nullish().or(z.literal(""));
