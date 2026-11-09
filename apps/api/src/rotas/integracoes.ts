import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ehEmailDecolar, lerEmailBokun, lerEmailDecolar, type ReservaImportada } from "@bybus/core";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { deveAnonimizar } from "../config.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { ClientePaytour, ErroPaytour, estadoPaytour, paytourConfigurada, sincronizarPaytour } from "../servicos/paytour.js";
import { gravarEstadoIntegracao, lerEstadoIntegracao } from "../servicos/estadoIntegracao.js";
import { importarReservas, USUARIO_INTEGRACAO } from "../servicos/importacao.js";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { passeios, paytourProdutos, unidades } from "../db/schema.js";

/** ATENCAO: e-mail do canal que pede resposta da equipe (ex.: Decolar pedindo mudança de data ou estorno). */
export type ResultadoEmail = "IMPORTADO" | "SEM_LEITOR" | "ATENCAO" | "NAO_RECONHECIDO";

/** A Decolar não manda aviso automático de cancelamento: mudanças e estornos chegam como conversa com a equipe. */
const PEDE_ACAO = /precisamos da sua ajuda|altera[cç][aã]o|cancelamento|reembolso|estorno|solicita[cç][aã]o/i;

/** Escolhe o leitor pelo remetente/assunto/conteúdo. "SEM_LEITOR" fica para canais futuros (o robô reenvia depois). */
export function lerEmailReserva(m: { remetente: string; assunto: string; corpo: string }): { resultado: ResultadoEmail; reserva?: ReservaImportada; canal?: string } {
  const de = m.remetente.toLowerCase();
  if (de.includes("bokun.io") || /^(new|cancelled|updated) booking/i.test(m.assunto)) {
    const r = lerEmailBokun(m.assunto, m.corpo);
    return r ? { resultado: "IMPORTADO", reserva: r, canal: "BOKUN" } : { resultado: "NAO_RECONHECIDO", canal: "BOKUN" };
  }
  if (de.includes("decolar") || de.includes("despegar") || ehEmailDecolar(m.assunto, m.corpo)) {
    const r = lerEmailDecolar(m.assunto, m.corpo);
    if (r) return { resultado: "IMPORTADO", reserva: r, canal: "DECOLAR" };
    return { resultado: PEDE_ACAO.test(`${m.assunto} ${m.corpo.slice(0, 5000)}`) ? "ATENCAO" : "NAO_RECONHECIDO", canal: "DECOLAR" };
  }
  return { resultado: "NAO_RECONHECIDO" };
}

function tokenConfere(req: FastifyRequest, esperado: string): boolean {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  if (!m) return false;
  const h = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(h(m[1]!), h(esperado));
}

export async function rotasIntegracoes(app: FastifyInstance, { db, config, cofre }: Contexto) {
  /**
   * Recebe e-mails de confirmação de reserva enviados pelo robô do Gmail (integracoes/gmail/Codigo.gs).
   * Idempotente: o mesmo e-mail (ou reserva) enviado de novo não duplica passageiros.
   */
  app.post("/api/integracoes/emails", { bodyLimit: 2 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    if (!config.INTEGRACAO_EMAIL_TOKEN) throw new ErroHttp(404, "NAO_ENCONTRADO", "Integração desligada.");
    if (!tokenConfere(req, config.INTEGRACAO_EMAIL_TOKEN)) throw new ErroHttp(401, "NAO_AUTORIZADO", "Token inválido.");
    const corpo = z.object({
      mensagens: z.array(z.object({
        id: z.string().min(1).max(200),
        remetente: z.string().max(500),
        assunto: z.string().max(1000).default(""),
        corpo: z.string().max(200_000),
      })).min(1).max(50),
    }).parse(req.body);

    const lidas = corpo.mensagens.map((m) => ({ id: m.id, ...lerEmailReserva(m) }));
    const reservas = lidas.flatMap((l) => (l.reserva ? [l.reserva] : []));
    const importacao = reservas.length
      ? await importarReservas(db, cofre, reservas, { confirmar: true, origem: "EMAIL_AUTOMATICO", usuario: USUARIO_INTEGRACAO, anonimizar: deveAnonimizar(config) })
      : null;
    const resumo = { mensagens: lidas.length, ...(importacao?.resumo ?? {}), semLeitor: lidas.filter((l) => l.resultado === "SEM_LEITOR").length, precisamAtencao: lidas.filter((l) => l.resultado === "ATENCAO").length, naoReconhecidas: lidas.filter((l) => l.resultado === "NAO_RECONHECIDO").length };
    await auditar(db, req, "IMPORTACAO_EMAIL_AUTOMATICA", { tipo: "importacao" }, resumo);
    await gravarEstadoIntegracao(db, "emails", { cursor: null, ultimoResultado: resumo, ultimoErro: null });
    // Devolve só o resultado por mensagem (o robô marca no Gmail o que já foi processado). Sem dados pessoais.
    return { resumo, mensagens: lidas.map((l) => ({ id: l.id, resultado: l.resultado, canal: l.canal ?? null })) };
  });

  const pre = { preHandler: exigir(config, "importacoes:executar") };
  const cliente = paytourConfigurada(config) ? new ClientePaytour({ url: config.PAYTOUR_URL, appKey: config.PAYTOUR_APP_KEY, appSecret: config.PAYTOUR_APP_SECRET }) : null;

  /** Situação do robô de e-mails (sem expor o token). */
  app.get("/api/integracoes/emails", pre, async () => {
    const e = await lerEstadoIntegracao(db, "emails");
    return { configurada: !!config.INTEGRACAO_EMAIL_TOKEN, ultimaExecucaoEm: e?.ultimaExecucaoEm ?? null, ultimoResultado: e?.ultimoResultado ?? null };
  });

  // ---------- Produtos da Paytour que nenhum passeio reconhece (09/11/2026) ----------
  const escaparRegex = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  app.get("/api/integracoes/paytour/produtos", pre, async (req) => {
    const pendentes = await db.select().from(paytourProdutos).where(isNull(paytourProdutos.decisao)).orderBy(desc(paytourProdutos.pedidos));
    const lista = await db.select({ id: passeios.id, nome: passeios.nome, unidadeId: passeios.unidadeId }).from(passeios).where(eq(passeios.ativo, true)).orderBy(asc(passeios.nome));
    const pracas = await db.select({ id: unidades.id, nome: unidades.nome, cidade: unidades.cidade }).from(unidades).where(eq(unidades.ativa, true)).orderBy(asc(unidades.nome));
    const u = req.usuario!;
    const pode = (id: string) => u.todasUnidades || u.unidadeIds.includes(id);
    return { produtos: pendentes.map((p) => ({ produto: p.produto, pedidos: p.pedidos, ultimaVezEm: p.ultimaVezEm })), passeios: lista.filter((x) => pode(x.unidadeId)), pracas: pracas.filter((x) => pode(x.id)) };
  });

  app.post("/api/integracoes/paytour/produtos/decidir", pre, async (req) => {
    const b = z.object({
      produto: z.string().min(1).max(300),
      acao: z.enum(["REVENDA", "PASSEIO_EXISTENTE", "NOVO_PASSEIO"]),
      passeioId: z.string().uuid().optional(),
      unidadeId: z.string().uuid().optional(),
    }).parse(req.body);
    const u = req.usuario!;
    const [p] = await db.select().from(paytourProdutos).where(and(eq(paytourProdutos.produto, b.produto), isNull(paytourProdutos.decisao)));
    if (!p) throw new ErroHttp(404, "NAO_ENCONTRADO", "Produto não encontrado (talvez já classificado).");
    const exato = `^${escaparRegex(b.produto)}$`;
    let passeioId: string | null = null;
    if (b.acao === "PASSEIO_EXISTENTE") {
      const [x] = b.passeioId ? await db.select().from(passeios).where(eq(passeios.id, b.passeioId)) : [];
      if (!x || !(u.todasUnidades || u.unidadeIds.includes(x.unidadeId))) throw new ErroHttp(404, "NAO_ENCONTRADO", "Passeio não encontrado.");
      await db.update(passeios).set({ padraoProduto: x.padraoProduto ? `(?:${x.padraoProduto})|${exato}` : exato }).where(eq(passeios.id, x.id));
      passeioId = x.id;
    } else if (b.acao === "NOVO_PASSEIO") {
      const [pr] = b.unidadeId ? await db.select().from(unidades).where(eq(unidades.id, b.unidadeId)) : [];
      if (!pr || !(u.todasUnidades || u.unidadeIds.includes(pr.id))) throw new ErroHttp(400, "SEM_PRACA", "Escolha a praça do passeio novo.");
      const base = b.produto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "PASSEIO";
      const existentes = new Set((await db.select({ c: passeios.codigo }).from(passeios)).map((x) => x.c));
      let codigo = base;
      for (let i = 2; existentes.has(codigo); i++) codigo = `${base}_${i}`;
      const [novo] = await db.insert(passeios).values({ codigo, nome: b.produto.slice(0, 150), cidade: pr.cidade, unidadeId: pr.id, capacidadePadrao: 46, minimoConfirmacao: 1, minimoSupervisor: 1, padraoProduto: exato })
        .returning({ id: passeios.id });
      passeioId = novo!.id;
    }
    await db.update(paytourProdutos).set({ decisao: b.acao === "REVENDA" ? "REVENDA" : "PASSEIO", passeioId, decididoPor: u.id, decididoEm: new Date() }).where(eq(paytourProdutos.produto, b.produto));
    await auditar(db, req, "PAYTOUR_PRODUTO_CLASSIFICADO", { tipo: "importacao" }, { acao: b.acao, passeioId });
    return { ok: true, passeioId };
  });

  /** Situação da conexão com a Paytour (sem expor as credenciais). */
  app.get("/api/integracoes/paytour", pre, async () => {
    const e = await estadoPaytour(db);
    return {
      configurada: !!cliente,
      automaticaACadaMinutos: cliente ? config.PAYTOUR_SINCRONIZAR_MINUTOS : 0,
      ultimaExecucaoEm: e?.ultimaExecucaoEm ?? null,
      ultimoResultado: e?.ultimoResultado ?? null,
      ultimoErro: e?.ultimoErro ?? null,
    };
  });

  /** Sincroniza agora. `desde` (AAAA-MM-DD) relê a partir de uma data. */
  app.post("/api/integracoes/paytour/sincronizar", { ...pre, config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req) => {
    if (!cliente) throw new ErroHttp(409, "PAYTOUR_NAO_CONFIGURADA", "Configure PAYTOUR_APP_KEY e PAYTOUR_APP_SECRET no servidor.");
    const corpo = z.object({ desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body ?? {});
    try {
      const r = await sincronizarPaytour(db, cofre, config, cliente, corpo);
      await auditar(db, req, "SINCRONIZACAO_PAYTOUR_MANUAL", { tipo: "importacao" }, { pedidos: r.pedidos, ...r.resumo });
      return r;
    } catch (e) {
      if (e instanceof ErroPaytour) throw new ErroHttp(502, "PAYTOUR_FALHOU", e.message);
      throw e;
    }
  });
}
