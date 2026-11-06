import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MIDIAS_CAMPANHA, UTM_PADRAO_POR_MIDIA, lerCsvAds, montarLinkUtm, normalizarUtm, utmDoAfiliado } from "@bybus/core";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { afiliados, campanhaCustos, campanhas, marketingConfig } from "../db/schema.js";
import { podeUnidade } from "../seguranca/escopo.js";
import { ErroHttp, exigir, type UsuarioSessao } from "../seguranca/sessao.js";
import { atribuicaoDeVendas, custosDasCampanhas } from "../servicos/atribuicao.js";
import { exigirPraca, naoEncontrado, periodoPadrao, texto, urlHttps, uuid, visivel } from "../servicos/marketingComum.js";

const URL_LOJA_PADRAO = "https://loja.bybusturismo.com.br";
const MAX_LINHAS_CSV = 5000;

export async function rotasCampanhasRetorno(app: FastifyInstance, { db, config }: Contexto) {
  const ver = { preHandler: exigir(config, "marketing:ver") };
  const gerenciar = { preHandler: exigir(config, "marketing:gerenciar") };
  const periodo = periodoPadrao(29, 0);

  const urlLoja = async () => (await db.select().from(marketingConfig).where(eq(marketingConfig.chave, "url_loja")))[0]?.valor ?? URL_LOJA_PADRAO;
  const podeAlterar = (u: UsuarioSessao, unidadeId: string | null) => (unidadeId ? podeUnidade(u, unidadeId) : u.todasUnidades);

  async function campanhaVisivel(u: UsuarioSessao, id: string, alterar = false) {
    const [c] = await db.select().from(campanhas).where(and(eq(campanhas.id, id), visivel(u, campanhas.unidadeId)));
    if (!c) throw naoEncontrado("Campanha");
    if (alterar && !podeAlterar(u, c.unidadeId)) throw new ErroHttp(403, "SEM_PERMISSAO", c.unidadeId ? "Você só pode alterar itens das suas praças." : "Só quem enxerga todas as praças altera itens de todas as praças.");
    return c;
  }

  /**
   * Retorno por campanha e por afiliado no período (dia da compra): pedidos da Paytour ligados por UTM/cupom/afiliado,
   * reservas, passageiros, receita, custo (importado por CSV no período ou investimento total da campanha) e retorno.
   */
  app.get("/api/marketing/retorno", ver, async (req) => {
    const u = req.usuario!;
    const p = periodo.parse(req.query);
    exigirPraca(u, p.unidadeId);
    const lista = await db.select().from(campanhas).where(and(visivel(u, campanhas.unidadeId), p.unidadeId ? sql`(${campanhas.unidadeId} is null or ${campanhas.unidadeId} = ${p.unidadeId})` : undefined)).orderBy(desc(campanhas.inicio), asc(campanhas.nome));
    const auto = await atribuicaoDeVendas(db, u, lista, { de: p.de, ate: p.ate, unidadeId: p.unidadeId });
    const custos = await custosDasCampanhas(db, lista.map((c) => c.id), { de: p.de, ate: p.ate });
    const afs = await db.select().from(afiliados).where(visivel(u, afiliados.unidadeId)).orderBy(asc(afiliados.nome));
    return {
      periodo: { de: p.de, ate: p.ate },
      campanhas: lista.map((c) => {
        const t = auto.porCampanha.get(c.id);
        const custo = custos.get(c.id);
        const investimento = custo ? custo.custoCentavos : c.investimentoCentavos;
        const reservas = t?.reservas ?? 0;
        return {
          id: c.id, nome: c.nome, midia: c.midia, cupom: c.cupom, utmCampanha: c.utmCampanha, ativa: c.ativa,
          pedidos: t?.vendas ?? 0, reservas, passageiros: t?.passageiros ?? 0, receitaCentavos: t?.receitaCentavos ?? null, porUtm: t?.porUtm ?? 0, porCupom: t?.porCupom ?? 0,
          investimentoCentavos: investimento, custoOrigem: custo ? "CSV" : "TOTAL_DA_CAMPANHA", cliques: custo?.cliques ?? null, impressoes: custo?.impressoes ?? null,
          custoPorReservaCentavos: reservas > 0 && investimento > 0 ? Math.round(investimento / reservas) : null,
          retorno: t?.receitaCentavos != null && investimento > 0 ? Math.round((t.receitaCentavos / investimento) * 100) / 100 : null,
          semUtm: !c.utmCampanha && !c.cupom,
        };
      }),
      afiliados: afs.map((a) => {
        const t = auto.porAfiliado.get(a.id);
        return { id: a.id, nome: a.nome, codigo: a.codigo, ativo: a.ativo, pedidos: t?.vendas ?? 0, reservas: t?.reservas ?? 0, passageiros: t?.passageiros ?? 0, receitaCentavos: t?.receitaCentavos ?? null, comissaoPontosBase: a.comissaoPontosBase };
      }),
      semAtribuicao: { pedidosComSinal: auto.comSinal, semCampanhaNemAfiliado: auto.semAtribuicao },
      apis: { situacao: "PROXIMA_ETAPA", nota: "Custo por importação de CSV do Google Ads e do Meta Ads. A integração direta pelas APIs (aprovação das plataformas) é a próxima etapa." },
    };
  });

  /** Gera o link com UTM (e o QR é desenhado na tela). Por campanha, por afiliado ou livre. Não grava nada, exceto `salvarUtm` na campanha. */
  app.post("/api/marketing/links", ver, async (req) => {
    const u = req.usuario!;
    const c = z.object({
      destino: urlHttps.optional(),
      campanhaId: uuid.optional(), afiliadoId: uuid.optional(),
      origem: texto(60).optional(), midia: texto(60).optional(), campanha: texto(80).optional(), conteudo: texto(60).optional(),
      salvarUtm: z.boolean().default(false),
    }).refine((x) => !(x.campanhaId && x.afiliadoId), "Escolha campanha ou afiliado, não os dois.").parse(req.body);
    const destino = c.destino ?? (await urlLoja());
    let origem = c.origem ?? "", midia = c.midia ?? "", campanha = c.campanha ?? "", ref: string | null = null;
    let salvouUtm = false;
    if (c.campanhaId) {
      const cp = await campanhaVisivel(u, c.campanhaId, c.salvarUtm);
      const padrao = UTM_PADRAO_POR_MIDIA[cp.midia as (typeof MIDIAS_CAMPANHA)[number]] ?? UTM_PADRAO_POR_MIDIA.OUTRA;
      origem ||= padrao.origem; midia ||= padrao.midia; campanha ||= cp.utmCampanha || normalizarUtm(cp.nome);
      if (c.salvarUtm && normalizarUtm(campanha) !== (cp.utmCampanha ?? "")) {
        if (cp.utmCampanha) throw new ErroHttp(409, "UTM_JA_DEFINIDO", "Esta campanha já tem outro UTM salvo; edite a campanha para trocá-lo.");
        await db.update(campanhas).set({ utmCampanha: normalizarUtm(campanha), atualizadoEm: new Date() }).where(eq(campanhas.id, cp.id));
        await auditar(db, req, "CAMPANHA_EDITADA", { tipo: "campanha", id: cp.id }, { campos: ["utmCampanha"] });
        salvouUtm = true;
      }
    } else if (c.afiliadoId) {
      const [a] = await db.select().from(afiliados).where(and(eq(afiliados.id, c.afiliadoId), visivel(u, afiliados.unidadeId)));
      if (!a) throw naoEncontrado("Afiliado");
      const x = utmDoAfiliado(a.codigo);
      origem ||= x.origem; midia ||= x.midia; campanha ||= x.campanha; ref = a.codigo;
    }
    if (!origem || !midia || !campanha) throw new ErroHttp(400, "DADOS_INVALIDOS", "Informe campanha, origem e mídia (ou escolha uma campanha ou um afiliado).");
    return { url: montarLinkUtm(destino, { origem, midia, campanha, ref, conteudo: c.conteudo }), utm: { origem: normalizarUtm(origem), midia: normalizarUtm(midia), campanha: normalizarUtm(campanha) }, salvouUtm };
  });

  // ───────────── Custo importado por CSV (Google Ads / Meta Ads) ─────────────

  app.post("/api/marketing/campanhas/:id/custos/csv", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { csv, fonte } = z.object({ csv: z.string().min(10).max(600_000), fonte: z.enum(["GOOGLE_ADS", "META_ADS", "CSV"]).default("CSV") }).parse(req.body);
    await campanhaVisivel(req.usuario!, id, true);
    const r = lerCsvAds(csv);
    if (r.linhas.length === 0) throw new ErroHttp(400, "CSV_INVALIDO", r.erros[0] ?? "Nenhuma linha com data e custo.");
    if (r.linhas.length > MAX_LINHAS_CSV) throw new ErroHttp(400, "CSV_GRANDE", `O arquivo tem mais de ${MAX_LINHAS_CSV} dias; exporte um período menor.`);
    for (const l of r.linhas) {
      await db.insert(campanhaCustos).values({ campanhaId: id, dia: l.dia, custoCentavos: l.custoCentavos, cliques: l.cliques, impressoes: l.impressoes, fonte, importadoPor: req.usuario!.id })
        .onConflictDoUpdate({ target: [campanhaCustos.campanhaId, campanhaCustos.dia], set: { custoCentavos: l.custoCentavos, cliques: l.cliques, impressoes: l.impressoes, fonte, importadoPor: req.usuario!.id } });
    }
    const total = r.linhas.reduce((s, l) => s + l.custoCentavos, 0);
    await auditar(db, req, "CAMPANHA_CUSTOS_IMPORTADOS", { tipo: "campanha", id }, { dias: r.linhas.length, custoCentavos: total, fonte, ignoradas: r.erros.length });
    return { importados: r.linhas.length, ignoradas: r.erros, custoCentavos: total, de: r.linhas[0]!.dia, ate: r.linhas[r.linhas.length - 1]!.dia };
  });

  app.get("/api/marketing/campanhas/:id/custos", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await campanhaVisivel(req.usuario!, id);
    return db.select({ dia: campanhaCustos.dia, custoCentavos: campanhaCustos.custoCentavos, cliques: campanhaCustos.cliques, impressoes: campanhaCustos.impressoes, fonte: campanhaCustos.fonte })
      .from(campanhaCustos).where(eq(campanhaCustos.campanhaId, id)).orderBy(desc(campanhaCustos.dia)).limit(400);
  });

  app.delete("/api/marketing/campanhas/:id/custos", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await campanhaVisivel(req.usuario!, id, true);
    await db.delete(campanhaCustos).where(eq(campanhaCustos.campanhaId, id));
    await auditar(db, req, "CAMPANHA_CUSTOS_REMOVIDOS", { tipo: "campanha", id });
    return { ok: true };
  });
}
