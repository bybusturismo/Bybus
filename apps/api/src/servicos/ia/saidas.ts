import { IDS_GESTORES } from "@bybus/core";
import { z } from "zod";
import type { FerramentaIA } from "./cliente.js";

/**
 * Saída estruturada obrigatória: o modelo entrega o resultado chamando uma ferramenta de registro
 * (achados, vulnerabilidades, oportunidades, ações sugeridas). O JSON Schema segue as regras do `strict`
 * (todas as propriedades obrigatórias, sem propriedades extras); o Zod valida de novo no servidor.
 */

const texto = { type: "string" };
const gravidade = { type: "string", enum: ["baixa", "media", "alta"] };
const impacto = { type: "string", enum: ["baixo", "medio", "alto"] };
const area = { type: "string", enum: [...IDS_GESTORES] };

const objeto = (propriedades: Record<string, unknown>) => ({ type: "object", properties: propriedades, required: Object.keys(propriedades), additionalProperties: false });
const lista = (item: unknown) => ({ type: "array", items: item });

const achado = objeto({ titulo: texto, detalhe: texto, gravidade, evidencia: texto });
const vulnerabilidade = objeto({ titulo: texto, detalhe: texto, gravidade, evidencia: texto });
const oportunidade = objeto({ titulo: texto, detalhe: texto, impacto, evidencia: texto });
const acao = objeto({ titulo: texto, detalhe: texto, prioridade: gravidade, prazo_dias: { type: "integer" }, area });

const ferramenta = (name: string, description: string, propriedades: Record<string, unknown>): FerramentaIA => ({
  name,
  description,
  input_schema: { type: "object", properties: propriedades, required: Object.keys(propriedades), additionalProperties: false },
});

export const FERRAMENTA_AVALIACAO = ferramenta(
  "registrar_avaliacao",
  "Registra a avaliação da sua área. Chame exatamente uma vez, com listas vazias quando não houver nada a dizer. Baseie-se só nos números do retrato.",
  { achados: lista(achado), vulnerabilidades: lista(vulnerabilidade), oportunidades: lista(oportunidade), acoes_sugeridas: lista(acao) },
);

export const FERRAMENTA_DEBATE = ferramenta(
  "registrar_debate",
  "Registra sua participação no debate: comentários sobre os achados dos outros gestores, riscos que cruzam áreas e ações novas (só as que surgiram da conversa). Chame exatamente uma vez.",
  {
    comentarios: lista(objeto({ gestor: area, tipo: { type: "string", enum: ["concordo", "complemento", "discordo"] }, texto })),
    riscos_cruzados: lista(objeto({ titulo: texto, detalhe: texto, areas: lista(area) })),
    acoes_sugeridas: lista(acao),
  },
);

export const FERRAMENTA_SINTESE = ferramenta(
  "registrar_sintese",
  "Registra a síntese final da diretoria. Chame exatamente uma vez. Sem duplicar itens: una os que tratam do mesmo problema.",
  {
    resumo: texto,
    vulnerabilidades: lista(vulnerabilidade),
    oportunidades: lista(oportunidade),
    acoes_sugeridas: lista(acao),
    pontos_de_discordia: lista(texto),
  },
);

const t = z.string().trim().min(1).max(1200);
const grav = z.enum(["baixa", "media", "alta"]);
const gest = z.enum(IDS_GESTORES);

export const zAchado = z.object({ titulo: t, detalhe: t, gravidade: grav, evidencia: z.string().trim().max(1200) });
export const zVulnerabilidade = zAchado;
export const zOportunidade = z.object({ titulo: t, detalhe: t, impacto: z.enum(["baixo", "medio", "alto"]), evidencia: z.string().trim().max(1200) });
export const zAcao = z.object({ titulo: t, detalhe: t, prioridade: grav, prazo_dias: z.number().int().min(0).max(365), area: gest });

export const zAvaliacao = z.object({
  achados: z.array(zAchado).max(30),
  vulnerabilidades: z.array(zVulnerabilidade).max(30),
  oportunidades: z.array(zOportunidade).max(30),
  acoes_sugeridas: z.array(zAcao).max(30),
});

export const zDebate = z.object({
  comentarios: z.array(z.object({ gestor: gest, tipo: z.enum(["concordo", "complemento", "discordo"]), texto: t })).max(40),
  riscos_cruzados: z.array(z.object({ titulo: t, detalhe: t, areas: z.array(gest).max(8) })).max(20),
  acoes_sugeridas: z.array(zAcao).max(20),
});

export const zSintese = z.object({
  resumo: z.string().trim().min(1).max(4000),
  vulnerabilidades: z.array(zVulnerabilidade).max(40),
  oportunidades: z.array(zOportunidade).max(40),
  acoes_sugeridas: z.array(zAcao).max(40),
  pontos_de_discordia: z.array(t).max(20),
});

export type Avaliacao = z.infer<typeof zAvaliacao>;
export type Debate = z.infer<typeof zDebate>;
export type Sintese = z.infer<typeof zSintese>;
export type AcaoSugerida = z.infer<typeof zAcao>;
