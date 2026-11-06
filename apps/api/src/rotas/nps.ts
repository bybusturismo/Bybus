import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CODIGOS_FLUXO, FLUXOS, IDIOMAS, abreCasoInterno, calcularNps, canalDeAvaliacao, classificarNps, conviteDeAvaliacaoPublica, montarPedidoAvaliacao, nomeCurto, notaNpsValida, renderizarModelo, type CodigoFluxo, type Idioma,
} from "@bybus/core";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { avaliacaoPedidos, fluxosMensagem, npsRespostas, orcamentosGrupo, passeios, pessoas, reservas, saidas, usuarios } from "../db/schema.js";
import { filtroUnidade, garantirReserva } from "../seguranca/escopo.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { envioReal } from "../servicos/whatsapp.js";
import { hashToken } from "../servicos/linkEmbarque.js";
import { lerConfigAvaliacao, linksDaPraca } from "../servicos/avaliacoes.js";
import { lerFluxos, rodarMensagensAutomaticas } from "../servicos/mensagensAuto.js";
import { dataBr, exigirPraca, naoEncontrado, periodoPadrao, texto, uuid } from "../servicos/marketingComum.js";

const token = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
const invalido = () => new ErroHttp(404, "LINK_INVALIDO", "Este link não é válido ou já expirou. Fale com a By Bus pelo WhatsApp.");
const STATUS_CASO = ["ABERTO", "EM_TRATATIVA", "RESOLVIDO"] as const;

export async function rotasNps(app: FastifyInstance, { db, config }: Contexto) {
  const ver = { preHandler: exigir(config, "marketing:ver") };
  const gerenciar = { preHandler: exigir(config, "marketing:gerenciar") };
  const logado = { preHandler: exigir(config) };
  const publico = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };
  const periodo = periodoPadrao(89, 0);

  // ───────────── Fluxos de mensagem automática ─────────────

  async function listaFluxos() {
    const f = await lerFluxos(db, config);
    const [linhas] = [await db.select({ codigo: fluxosMensagem.codigo }).from(fluxosMensagem)];
    return {
      envio: { real: envioReal(config), nota: envioReal(config) ? "Envio real pelo WhatsApp ligado." : "Modo simulado: as mensagens vão para a fila como “Simulada” e nada sai de verdade." },
      fluxos: CODIGOS_FLUXO.map((codigo) => ({
        ...f[codigo], rotulo: FLUXOS[codigo].rotulo, quando: FLUXOS[codigo].quando, editavel: FLUXOS[codigo].editavel, variaveis: FLUXOS[codigo].variaveis, padroes: FLUXOS[codigo].modelos,
        origemDoLigado: codigo === "VESPERA" ? "FECHAMENTO" : linhas.some((l) => l.codigo === codigo) ? "TELA" : codigo === "COMPRA" ? "VARIAVEL_DE_AMBIENTE" : "PADRAO",
      })),
    };
  }
  app.get("/api/marketing/mensagens", ver, async () => listaFluxos());

  app.patch("/api/marketing/mensagens/:codigo", gerenciar, async (req) => {
    const u = req.usuario!;
    // Os fluxos valem para a empresa toda: só quem enxerga todas as praças altera.
    if (!u.todasUnidades) throw new ErroHttp(403, "SEM_PERMISSAO", "Só quem enxerga todas as praças altera as mensagens automáticas.");
    const { codigo } = z.object({ codigo: z.enum(CODIGOS_FLUXO) }).parse(req.params);
    if (codigo === "VESPERA") throw new ErroHttp(400, "FLUXO_FIXO", "A véspera é o fechamento da lista (Operação › Fechamento) e não é alterada aqui.");
    const c = z.object({
      ligado: z.boolean().optional(),
      textos: z.object({ pt: texto(1000).min(10).nullable(), en: texto(1000).min(10).nullable(), es: texto(1000).min(10).nullable() }).partial().optional(),
      extra: z.string().trim().max(30).regex(/^[A-Za-z0-9-]*$/, "Cupom: só letras, números e hífen").nullish(),
    }).parse(req.body);
    if (c.textos && !FLUXOS[codigo].editavel) throw new ErroHttp(400, "TEXTO_FIXO", "O texto deste fluxo é editado em outro lugar.");
    if (codigo === "POS_PASSEIO") for (const i of IDIOMAS) if (c.textos?.[i] && !c.textos[i]!.includes("{linkNps}")) throw new ErroHttp(400, "FALTA_LINK", "O texto do pós-passeio precisa conter {linkNps}, o link da pesquisa.");
    if (codigo === "CUPOM_RETORNO" && c.ligado === true) {
      const atual = await lerFluxos(db, config);
      if (!(c.extra ?? atual.CUPOM_RETORNO.extra)) throw new ErroHttp(400, "FALTA_CUPOM", "Informe o código do cupom de retorno antes de ligar.");
    }
    const atual = (await lerFluxos(db, config))[codigo];
    const valores = {
      ligado: c.ligado ?? atual.ligado,
      ...(c.textos && "pt" in c.textos ? { textoPt: c.textos.pt ?? null } : {}), ...(c.textos && "en" in c.textos ? { textoEn: c.textos.en ?? null } : {}), ...(c.textos && "es" in c.textos ? { textoEs: c.textos.es ?? null } : {}),
      ...(c.extra !== undefined ? { extra: c.extra ? c.extra.toUpperCase() : null } : {}),
      atualizadoEm: new Date(), atualizadoPor: u.id,
    };
    await db.insert(fluxosMensagem).values({ codigo, ...valores }).onConflictDoUpdate({ target: fluxosMensagem.codigo, set: valores });
    await auditar(db, req, "FLUXO_MENSAGEM_EDITADO", { tipo: "fluxo_mensagem", id: codigo }, { ligadoAntes: atual.ligado, ligadoDepois: valores.ligado, campos: Object.keys(c) });
    return listaFluxos();
  });

  /** Roda agora a rotina (confirmação da compra, NPS e fila de avaliações). No modo simulado nada sai. */
  app.post("/api/marketing/mensagens/rodar", gerenciar, async (req) => {
    if (!req.usuario!.todasUnidades) throw new ErroHttp(403, "SEM_PERMISSAO", "Só quem enxerga todas as praças roda as mensagens automáticas.");
    const r = await rodarMensagensAutomaticas(db, config, new Date(), { ignorarHorario: true });
    await auditar(db, req, "MENSAGENS_AUTOMATICAS_RODADAS", { tipo: "fluxo_mensagem" }, r);
    return { ...r, simulado: !envioReal(config) };
  });

  // ───────────── Painel de NPS e casos internos ─────────────

  /** NPS por mês, passeio e guia (só agregados), pela data do passeio. */
  app.get("/api/marketing/nps", ver, async (req) => {
    const p = periodo.parse(req.query);
    const u = req.usuario!;
    exigirPraca(u, p.unidadeId);
    const linhas = await db.select({ nota: npsRespostas.nota, aceitou: npsRespostas.aceitouConvite, data: saidas.data, passeio: passeios.nome, guia: pessoas.nome }).from(npsRespostas)
      .innerJoin(saidas, eq(saidas.id, npsRespostas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).leftJoin(pessoas, eq(pessoas.id, saidas.guiaId))
      .where(and(gte(saidas.data, p.de), lte(saidas.data, p.ate), filtroUnidade(u), p.unidadeId ? eq(passeios.unidadeId, p.unidadeId) : undefined)).limit(20000);
    const respondidas = linhas.filter((l) => l.nota != null);
    const agrupar = (chave: (l: (typeof respondidas)[number]) => string) => {
      const m = new Map<string, number[]>();
      for (const l of respondidas) m.set(chave(l), [...(m.get(chave(l)) ?? []), l.nota!]);
      return [...m.entries()].map(([k, notas]) => ({ chave: k, ...calcularNps(notas) }));
    };
    const geral = calcularNps(respondidas.map((l) => l.nota!));
    return {
      periodo: { de: p.de, ate: p.ate },
      geral: { ...geral, enviados: linhas.length, taxaResposta: linhas.length ? Math.round((respondidas.length / linhas.length) * 1000) / 10 : null, aceitaramConvite: respondidas.filter((l) => l.aceitou).length },
      porMes: agrupar((l) => l.data.slice(0, 7)).sort((a, b) => a.chave.localeCompare(b.chave)),
      porPasseio: agrupar((l) => l.passeio).sort((a, b) => b.total - a.total),
      porGuia: agrupar((l) => l.guia ?? "Sem guia").sort((a, b) => b.total - a.total),
    };
  });

  /** Casos internos (nota 0 a 6). Só o primeiro nome do titular e o comentário; o contato fica na reserva. */
  app.get("/api/marketing/nps/casos", ver, async (req) => {
    const q = z.object({ status: z.enum(STATUS_CASO).optional() }).parse(req.query);
    const u = req.usuario!;
    const l = await db.select({ n: npsRespostas, nome: reservas.contatoNome, data: saidas.data, passeio: passeios.nome, guia: pessoas.nome, responsavel: usuarios.nome }).from(npsRespostas)
      .innerJoin(reservas, eq(reservas.id, npsRespostas.reservaId)).innerJoin(saidas, eq(saidas.id, npsRespostas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .leftJoin(pessoas, eq(pessoas.id, saidas.guiaId)).leftJoin(usuarios, eq(usuarios.id, npsRespostas.casoResponsavelId))
      .where(and(isNotNull(npsRespostas.casoStatus), q.status ? eq(npsRespostas.casoStatus, q.status) : undefined, filtroUnidade(u))).orderBy(sql`case ${npsRespostas.casoStatus} when 'ABERTO' then 0 when 'EM_TRATATIVA' then 1 else 2 end`, desc(npsRespostas.respondidoEm)).limit(300);
    return l.map(({ n, nome, data, passeio, guia, responsavel }) => ({
      id: n.id, reservaId: n.reservaId, nota: n.nota, comentario: n.comentario, titular: nomeCurto(nome), data, passeio, guia, casoStatus: n.casoStatus, casoNota: n.casoNota,
      responsavel, respondidoEm: n.respondidoEm,
    }));
  });

  app.patch("/api/marketing/nps/casos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = z.object({ casoStatus: z.enum(STATUS_CASO).optional(), casoNota: texto(2000).nullish() }).parse(req.body);
    const [n] = await db.select().from(npsRespostas).where(and(eq(npsRespostas.id, id), isNotNull(npsRespostas.casoStatus)));
    if (!n) throw naoEncontrado("Caso");
    await garantirReserva(db, req.usuario!, n.reservaId);
    const set: Partial<typeof npsRespostas.$inferInsert> = { casoAtualizadoEm: new Date(), casoResponsavelId: req.usuario!.id };
    if (c.casoStatus) set.casoStatus = c.casoStatus;
    if (c.casoNota !== undefined) set.casoNota = c.casoNota?.trim() || null;
    await db.update(npsRespostas).set(set).where(eq(npsRespostas.id, id));
    await auditar(db, req, "NPS_CASO_ATUALIZADO", { tipo: "nps", id }, { statusAntes: n.casoStatus, statusDepois: c.casoStatus ?? n.casoStatus, anotou: c.casoNota !== undefined });
    return { ok: true };
  });

  /** Avisos para a Visão Geral: só contadores, conforme as permissões de quem pergunta. */
  app.get("/api/marketing/avisos", logado, async (req) => {
    const u = req.usuario!;
    const orcamentosNovos = pode(u, "reservas:editar") ? (await db.select({ n: sql<number>`count(*)::int` }).from(orcamentosGrupo).where(eq(orcamentosGrupo.status, "NOVO")))[0]?.n ?? 0 : 0;
    const casosNps = pode(u, "marketing:ver")
      ? (await db.select({ n: sql<number>`count(*)::int` }).from(npsRespostas).innerJoin(saidas, eq(saidas.id, npsRespostas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
        .where(and(eq(npsRespostas.casoStatus, "ABERTO"), filtroUnidade(u))))[0]?.n ?? 0
      : 0;
    return { orcamentosNovos, casosNpsAbertos: casosNps };
  });

  // ───────────── Página pública do NPS (sem login) ─────────────

  async function doToken(t: string) {
    const [x] = await db.select({ n: npsRespostas, nome: reservas.contatoNome, data: saidas.data, passeio: passeios.nome, unidadeId: passeios.unidadeId, canal: sql<string>`coalesce(${reservas.canalOrigem}, ${reservas.canal})::text` })
      .from(npsRespostas).innerJoin(reservas, eq(reservas.id, npsRespostas.reservaId)).innerJoin(saidas, eq(saidas.id, npsRespostas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .where(eq(npsRespostas.tokenHash, hashToken(t)));
    if (!x || x.n.tokenExpiraEm < new Date()) throw invalido();
    return x;
  }

  // Só o necessário: passeio, data, primeiro nome, idioma e se já respondeu. Nada de telefone, e-mail, outros passageiros ou ids.
  app.get("/api/publico/nps/:token", publico, async (req) => {
    const { token: t } = z.object({ token }).parse(req.params);
    const x = await doToken(t);
    return { passeio: x.passeio, data: x.data, titular: nomeCurto(x.nome), idioma: x.n.idioma, respondido: x.n.respondidoEm != null };
  });

  app.post("/api/publico/nps/:token", publico, async (req) => {
    const { token: t } = z.object({ token }).parse(req.params);
    const c = z.object({
      nota: z.number().int().min(0).max(10).refine(notaNpsValida),
      comentario: z.string().trim().max(500).optional(),
      aceitaConvite: z.boolean().default(false),
    }).parse(req.body);
    const x = await doToken(t);
    if (x.n.respondidoEm) throw new ErroHttp(409, "JA_RESPONDIDO", "Esta pesquisa já foi respondida. Obrigado!");
    const agora = new Date();
    const idioma = x.n.idioma as Idioma;
    // Atualização condicional: duas respostas simultâneas gravam só a primeira.
    const [gravado] = await db.update(npsRespostas).set({
      nota: c.nota, comentario: c.comentario || null, respondidoEm: agora, classe: classificarNps(c.nota), aceitouConvite: c.aceitaConvite,
      casoStatus: abreCasoInterno(c.nota) ? "ABERTO" : null, casoAtualizadoEm: abreCasoInterno(c.nota) ? agora : null,
    }).where(and(eq(npsRespostas.id, x.n.id), sql`${npsRespostas.respondidoEm} is null`)).returning({ id: npsRespostas.id });
    if (!gravado) throw new ErroHttp(409, "JA_RESPONDIDO", "Esta pesquisa já foi respondida. Obrigado!");
    // Auditoria sem IP e sem texto do cliente.
    await auditar(db, null, "NPS_RESPONDIDO", { tipo: "nps", id: x.n.id }, { classe: classificarNps(c.nota), aceitouConvite: c.aceitaConvite, comentario: !!c.comentario });

    // Convite de avaliação pública: vale para TODOS que concordarem. A nota NÃO decide quem recebe (sem "review gating").
    let convite: { viator: boolean; canais: Array<{ tipo: "GOOGLE" | "TRIPADVISOR"; link: string }> } | null = null;
    if (conviteDeAvaliacaoPublica(c.aceitaConvite, c.nota)) {
      const cfg = await lerConfigAvaliacao(db);
      const links = linksDaPraca(cfg, x.unidadeId);
      if (x.canal === "VIATOR") convite = { viator: true, canais: [] };
      else convite = { viator: false, canais: [...(links.google ? [{ tipo: "GOOGLE" as const, link: links.google }] : []), ...(links.tripadvisor ? [{ tipo: "TRIPADVISOR" as const, link: links.tripadvisor }] : [])] };
      // O pedido de avaliação da reserva passa a "Enviada" (convite entregue pela própria página).
      const [ped] = await db.select({ id: avaliacaoPedidos.id, status: avaliacaoPedidos.status }).from(avaliacaoPedidos).where(eq(avaliacaoPedidos.reservaId, x.n.reservaId));
      if (ped) {
        if (["PENDENTE", "SEM_TELEFONE"].includes(ped.status)) await db.update(avaliacaoPedidos).set({ status: "ENVIADA", pedidoEm: agora, atualizadoEm: agora }).where(eq(avaliacaoPedidos.id, ped.id));
      } else {
        const canalSel = canalDeAvaliacao({ canalReal: x.canal, links });
        const m = montarPedidoAvaliacao({ nome: x.nome, passeio: x.passeio, data: dataBr(x.data), idioma, canalReal: x.canal, links, modelos: cfg.modelos });
        await db.insert(avaliacaoPedidos).values({ reservaId: x.n.reservaId, saidaId: x.n.saidaId, texto: m.texto, idioma, canalAvaliacao: canalSel.canal, link: canalSel.link, status: "ENVIADA", pedidoEm: agora }).onConflictDoNothing();
      }
    }
    // Cupom de retorno (opcional), para todos que responderam.
    const fluxos = await lerFluxos(db, config);
    const cr = fluxos.CUPOM_RETORNO;
    const cupom = cr.ligado && cr.extra ? { codigo: cr.extra, texto: renderizarModelo(cr.textos[idioma], { nome: nomeCurto(x.nome), cupom: cr.extra }) } : null;
    return { ok: true, convite, cupom };
  });
}
