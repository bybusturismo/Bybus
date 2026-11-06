import type { FastifyInstance } from "fastify";
import type { Contexto } from "../app.js";
import { rotasAvaliacoes } from "./avaliacoes.js";
import { rotasBio } from "./bio.js";
import { rotasCampanhasRetorno } from "./campanhas-retorno.js";
import { rotasNps } from "./nps.js";
import { rotasOrcamentos } from "./orcamentos.js";
import { rotasRelatoriosMkt } from "./relatorios-mkt.js";

/** Marketing 2 (06/11/2026): avaliações, retorno de campanhas, relatórios, link na bio, orçamento de grupos e NPS/mensagens automáticas. */
export async function rotasMarketingExtras(app: FastifyInstance, ctx: Contexto) {
  await rotasAvaliacoes(app, ctx);
  await rotasCampanhasRetorno(app, ctx);
  await rotasRelatoriosMkt(app, ctx);
  await rotasBio(app, ctx);
  await rotasOrcamentos(app, ctx);
  await rotasNps(app, ctx);
}
