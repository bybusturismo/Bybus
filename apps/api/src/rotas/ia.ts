import { dataSaoPaulo, GESTORES, mesSaoPaulo } from "@bybus/core";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { iaAcoes, iaAvaliacoes, iaPareceres, STATUS_ACAO } from "../db/schema.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { conversar } from "../servicos/ia/assistente.js";
import { avaliacaoEmAndamento, iniciarAvaliacao, processarAvaliacao } from "../servicos/ia/avaliacao.js";
import { ErroIA, iaConfigurada } from "../servicos/ia/cliente.js";
import { resumoDeUso } from "../servicos/ia/orcamento.js";
import { gastoDoMesMicro, montarRetratos } from "../servicos/ia/retratos.js";

const uuid = z.string().uuid();

/** Traduz erros da IA para respostas HTTP claras (nunca vaza detalhe interno). */
function paraHttp(e: unknown): never {
  if (e instanceof ErroIA) {
    const status = e.codigo === "IA_DESLIGADA" ? 503 : e.codigo === "IA_LIMITE" ? 429 : 502;
    throw new ErroHttp(status, e.codigo, e.message);
  }
  throw e;
}

export async function rotasIa(app: FastifyInstance, { db, config }: Contexto) {
  const usar = { preHandler: exigir(config, "ia:usar") };
  const gestoresPre = exigir(config, "ia:gestores");
  /** Gestores de IA veem a empresa inteira: exige o acesso a todas as praças (os dados são consolidados). */
  const gestores = {
    preHandler: async (req: Parameters<typeof gestoresPre>[0]) => {
      await gestoresPre(req);
      if (!req.usuario!.todasUnidades) throw new ErroHttp(403, "SEM_PERMISSAO", "Os gestores de IA consolidam todas as praças: é preciso ter acesso a todas elas.");
    },
  };

  /** Estado da IA (ligada? modelo? uso do mês?). Quem só usa o assistente não vê custos. */
  app.get("/api/ia/estado", usar, async (req) => {
    const u = req.usuario!;
    const ligada = iaConfigurada(config);
    const base = { ligada, assistente: true, gestores: pode(u, "ia:gestores") && u.todasUnidades };
    if (!base.gestores) return base;
    const gasto = await gastoDoMesMicro(db, mesSaoPaulo(new Date()));
    return {
      ...base,
      modelo: config.IA_MODELO,
      modeloSintese: config.IA_MODELO_SINTESE ?? config.IA_MODELO,
      limiteMesUsd: config.IA_LIMITE_MES_USD,
      gastoMesUsd: gasto / 1_000_000,
      avaliacaoDiaria: config.IA_AVALIACAO_DIARIA && ligada,
      horario: config.IA_AVALIACAO_HORARIO,
      emAndamento: (await avaliacaoEmAndamento(db)) !== null,
    };
  });

  // ---------- Turistinha (assistente) ----------

  app.post("/api/ia/assistente", { ...usar, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    if (!iaConfigurada(config)) throw new ErroHttp(503, "IA_DESLIGADA", "IA desligada: a chave da Anthropic ainda não foi configurada.");
    const corpo = z.object({
      mensagens: z.array(z.object({ papel: z.enum(["usuario", "assistente"]), texto: z.string().trim().min(1).max(4000) })).min(1).max(20),
    }).parse(req.body);
    if (corpo.mensagens.at(-1)!.papel !== "usuario") throw new ErroHttp(400, "DADOS_INVALIDOS", "A última mensagem deve ser da pessoa.");
    try {
      const r = await conversar(db, config, req.usuario!, corpo.mensagens, req.log);
      // Auditoria sem o texto da conversa: só quais consultas foram feitas.
      await auditar(db, req, "IA_ASSISTENTE_CONSULTA", { tipo: "ia" }, { ferramentas: r.ferramentas });
      return r;
    } catch (e) {
      return paraHttp(e);
    }
  });

  // ---------- Gestores de IA ----------

  app.get("/api/ia/gestores", gestores, async () => GESTORES.map((g) => ({ id: g.id, nome: g.nome, descricao: g.descricao })));

  /** Indicadores do dia calculados direto do banco (sem IA): funcionam mesmo com a IA desligada. */
  app.get("/api/ia/retratos", gestores, async () => {
    const hoje = dataSaoPaulo(new Date());
    return { data: hoje, retratos: await montarRetratos(db, hoje, { limiteMesUsd: config.IA_LIMITE_MES_USD }) };
  });

  app.get("/api/ia/avaliacoes", gestores, async (req) => {
    const { limite } = z.object({ limite: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
    const linhas = await db.select().from(iaAvaliacoes).orderBy(desc(iaAvaliacoes.iniciadaEm)).limit(limite);
    const ids = linhas.map((l) => l.id);
    const contagem = ids.length
      ? await db.select({ avaliacaoId: iaAcoes.avaliacaoId, status: iaAcoes.status, n: sql<number>`count(*)::int` }).from(iaAcoes).where(inArray(iaAcoes.avaliacaoId, ids)).groupBy(iaAcoes.avaliacaoId, iaAcoes.status)
      : [];
    return linhas.map((l) => ({
      id: l.id, dataRef: l.dataRef, origem: l.origem, status: l.status, modelo: l.modelo, modeloSintese: l.modeloSintese,
      iniciadaEm: l.iniciadaEm, concluidaEm: l.concluidaEm, erro: l.erro, custoUsd: l.custoMicroUsd / 1_000_000,
      resumo: (l.sintese as { resumo?: string } | null)?.resumo ?? null,
      acoes: Object.fromEntries(contagem.filter((c) => c.avaliacaoId === l.id).map((c) => [c.status, c.n])),
    }));
  });

  app.get("/api/ia/avaliacoes/:id", gestores, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [a] = await db.select().from(iaAvaliacoes).where(eq(iaAvaliacoes.id, id));
    if (!a) throw new ErroHttp(404, "NAO_ENCONTRADO", "Avaliação não encontrada.");
    const pareceres = await db.select().from(iaPareceres).where(eq(iaPareceres.avaliacaoId, id)).orderBy(iaPareceres.rodada);
    const acoes = await db.select().from(iaAcoes).where(eq(iaAcoes.avaliacaoId, id)).orderBy(iaAcoes.criadoEm);
    return {
      id: a.id, dataRef: a.dataRef, origem: a.origem, status: a.status, modelo: a.modelo, modeloSintese: a.modeloSintese,
      iniciadaEm: a.iniciadaEm, concluidaEm: a.concluidaEm, erro: a.erro, custoUsd: a.custoMicroUsd / 1_000_000,
      retratos: a.retratos, sintese: a.sintese,
      pareceres: pareceres.map((p) => ({ gestor: p.gestor, rodada: p.rodada, conteudo: p.conteudo })),
      acoes: acoes.map((x) => ({ id: x.id, titulo: x.titulo, detalhe: x.detalhe, area: x.area, prioridade: x.prioridade, prazoDias: x.prazoDias, status: x.status, decididaEm: x.decididaEm, observacao: x.observacao })),
    };
  });

  /** "Rodar agora": responde na hora (202) e processa em segundo plano; a tela consulta o andamento. */
  app.post("/api/ia/avaliacoes", gestores, async (req, reply) => {
    if (!iaConfigurada(config)) throw new ErroHttp(503, "IA_DESLIGADA", "IA desligada: a chave da Anthropic ainda não foi configurada.");
    if (await avaliacaoEmAndamento(db)) throw new ErroHttp(409, "EM_ANDAMENTO", "Já há uma avaliação em andamento. Aguarde terminar.");
    const id = await iniciarAvaliacao(db, config, "MANUAL", req.usuario!.id);
    await auditar(db, req, "IA_AVALIACAO_INICIADA", { tipo: "ia_avaliacao", id });
    void processarAvaliacao(db, config, id, req.log).catch((e) => req.log.error({ erro: e instanceof Error ? e.message : e }, "Falha inesperada na avaliação de IA"));
    return reply.status(202).send({ id });
  });

  // ---------- Ações sugeridas: só viram tarefa/aviso quando uma pessoa aprova ----------

  app.get("/api/ia/acoes", gestores, async (req) => {
    const q = z.object({ status: z.enum(STATUS_ACAO).optional() }).parse(req.query);
    const base = db
      .select({ id: iaAcoes.id, avaliacaoId: iaAcoes.avaliacaoId, titulo: iaAcoes.titulo, detalhe: iaAcoes.detalhe, area: iaAcoes.area, prioridade: iaAcoes.prioridade, prazoDias: iaAcoes.prazoDias, status: iaAcoes.status, decididaEm: iaAcoes.decididaEm, observacao: iaAcoes.observacao, criadaEm: iaAcoes.criadoEm })
      .from(iaAcoes);
    return (q.status ? base.where(eq(iaAcoes.status, q.status)) : base).orderBy(desc(iaAcoes.criadoEm)).limit(200);
  });

  const TRANSICOES: Record<string, string[]> = { SUGERIDA: ["APROVADA", "DESCARTADA"], APROVADA: ["CONCLUIDA", "DESCARTADA"] };
  app.patch("/api/ia/acoes/:id", gestores, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = z.object({ status: z.enum(["APROVADA", "DESCARTADA", "CONCLUIDA"]), observacao: z.string().trim().max(500).optional() }).parse(req.body);
    const [a] = await db.select().from(iaAcoes).where(eq(iaAcoes.id, id));
    if (!a) throw new ErroHttp(404, "NAO_ENCONTRADO", "Ação não encontrada.");
    if (!TRANSICOES[a.status]?.includes(corpo.status)) throw new ErroHttp(409, "TRANSICAO_INVALIDA", `Uma ação ${a.status.toLowerCase()} não pode passar para ${corpo.status.toLowerCase()}.`);
    await db.update(iaAcoes).set({ status: corpo.status, decididaPor: req.usuario!.id, decididaEm: new Date(), observacao: corpo.observacao ?? a.observacao }).where(eq(iaAcoes.id, id));
    await auditar(db, req, `IA_ACAO_${corpo.status}`, { tipo: "ia_acao", id }, { titulo: a.titulo, area: a.area });
    return { ok: true, status: corpo.status };
  });

  app.get("/api/ia/uso", gestores, async () => resumoDeUso(db, config));
}
