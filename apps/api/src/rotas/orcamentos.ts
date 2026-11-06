import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gte, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { STATUS_ORCAMENTO, TIPOS_GRUPO, normalizarUtm, tempoDoFormularioOk } from "@bybus/core";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { orcamentosGrupo, passeios, perfis, usuarios } from "../db/schema.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { dataIso, hojeSp, naoEncontrado, texto, uuid } from "../servicos/marketingComum.js";

/** Versão do texto de consentimento mostrado no formulário público (guardada junto do pedido). */
export const CONSENTIMENTO_VERSAO = "2026-11-06";
const LIMITE_POR_HORA = 100;

const protocolo = (id: string) => id.slice(0, 8).toUpperCase();

export async function rotasOrcamentos(app: FastifyInstance, { db, config }: Contexto) {
  // Orçamentos pertencem à área Reservas: mesma permissão de quem lança reservas (sem perfil novo).
  const operar = { preHandler: exigir(config, "reservas:editar") };
  // Pública: poucas tentativas por hora por IP (o limite global de pedidos por hora vem logo abaixo).
  const publicoEnvio = { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } };
  const publicoLeitura = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  const assinar = (ms: number) => createHmac("sha256", config.CHAVE_CRIPTOGRAFIA).update(`orcamento|${ms}`).digest("hex");
  /** Instante em que o formulário foi aberto, se a assinatura for válida (o servidor não guarda nada). */
  function lerToken(t: string): number | null {
    const [ms, sig] = t.split(".");
    if (!ms || !sig || !/^\d{10,15}$/.test(ms)) return null;
    const esperado = Buffer.from(assinar(Number(ms)));
    const recebido = Buffer.from(sig);
    return recebido.length === esperado.length && timingSafeEqual(recebido, esperado) ? Number(ms) : null;
  }

  // ───────────── Página pública /orcamento ─────────────

  app.get("/api/publico/orcamento/formulario", publicoLeitura, async () => {
    const agora = Date.now();
    const lista = await db.select({ nome: passeios.nome }).from(passeios).where(eq(passeios.ativo, true)).orderBy(asc(passeios.nome));
    return { token: `${agora}.${assinar(agora)}`, passeios: [...new Set(lista.map((p) => p.nome))], tipos: TIPOS_GRUPO, consentimentoVersao: CONSENTIMENTO_VERSAO };
  });

  const esquemaPublico = z.object({
    nome: texto(120).min(2, "Informe o seu nome."),
    organizacao: texto(160).min(2, "Informe a escola, empresa ou grupo."),
    tipoGrupo: z.enum(TIPOS_GRUPO),
    telefone: texto(30).optional(),
    email: texto(160).email("E-mail inválido.").optional().or(z.literal("")),
    dataPretendida: dataIso.nullish().transform((v) => v ?? null),
    pessoas: z.number().int().min(1, "Informe quantas pessoas.").max(5000),
    servico: texto(200).min(2, "Informe o passeio ou serviço."),
    cidadeOrigem: texto(100).optional(),
    mensagem: texto(1500).optional(),
    consentimento: z.literal(true, { errorMap: () => ({ message: "É preciso concordar com o uso dos seus dados para receber o orçamento." }) }),
    /** Campo isca: invisível para pessoas; robôs preenchem. */
    site: z.string().max(300).optional(),
    formToken: z.string().max(100),
    utmSource: z.string().max(80).optional(), utmMedium: z.string().max(80).optional(), utmCampaign: z.string().max(120).optional(),
  }).refine((d) => (d.telefone && d.telefone.replace(/\D/g, "").length >= 8) || d.email, { message: "Informe um telefone (com DDD) ou um e-mail para contato.", path: ["telefone"] });

  app.post("/api/publico/orcamento", publicoEnvio, async (req) => {
    const d = esquemaPublico.parse(req.body);
    // Isca preenchida: finge sucesso (o robô não aprende nada) e não grava.
    if (d.site && d.site.trim()) return { ok: true, protocolo: "00000000" };
    const aberto = lerToken(d.formToken);
    if (aberto == null || !tempoDoFormularioOk(aberto, Date.now())) {
      throw new ErroHttp(400, "FORMULARIO_EXPIRADO", "Não foi possível enviar agora. Recarregue a página, preencha com calma e envie de novo.");
    }
    if (d.dataPretendida && d.dataPretendida < hojeSp()) throw new ErroHttp(400, "DATA_PASSADA", "A data pretendida não pode ser no passado.");
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(orcamentosGrupo).where(gte(orcamentosGrupo.criadoEm, new Date(Date.now() - 3_600_000)));
    if (n >= LIMITE_POR_HORA) throw new ErroHttp(429, "MUITAS_REQUISICOES", "Recebemos muitos pedidos agora. Tente novamente em alguns minutos ou fale conosco pelo WhatsApp.");
    const utm = (v?: string) => normalizarUtm(v).slice(0, 60) || null;
    const [novo] = await db.insert(orcamentosGrupo).values({
      nome: d.nome, organizacao: d.organizacao, tipoGrupo: d.tipoGrupo, telefone: d.telefone?.trim() || null, email: d.email?.trim().toLowerCase() || null,
      dataPretendida: d.dataPretendida, pessoas: d.pessoas, servico: d.servico, cidadeOrigem: d.cidadeOrigem?.trim() || null, mensagem: d.mensagem?.trim() || null,
      consentimentoEm: new Date(), consentimentoVersao: CONSENTIMENTO_VERSAO, utmSource: utm(d.utmSource), utmMedium: utm(d.utmMedium), utmCampaign: utm(d.utmCampaign),
    }).returning({ id: orcamentosGrupo.id });
    // Auditoria sem IP e sem dado pessoal (a requisição é pública).
    await auditar(db, null, "ORCAMENTO_RECEBIDO", { tipo: "orcamento", id: novo!.id }, { tipoGrupo: d.tipoGrupo, pessoas: d.pessoas, origem: utm(d.utmSource) });
    return { ok: true, protocolo: protocolo(novo!.id) };
  });

  // ───────────── Tela Orçamentos (área Reservas) ─────────────

  app.get("/api/orcamentos", operar, async (req) => {
    const q = z.object({ status: z.enum(STATUS_ORCAMENTO).optional() }).parse(req.query);
    const verContatos = pode(req.usuario!, "manifesto:contatos");
    const lista = await db.select({ o: orcamentosGrupo, responsavel: usuarios.nome }).from(orcamentosGrupo).leftJoin(usuarios, eq(usuarios.id, orcamentosGrupo.responsavelId))
      .where(q.status ? eq(orcamentosGrupo.status, q.status) : undefined).orderBy(desc(orcamentosGrupo.criadoEm)).limit(500);
    return lista.map(({ o, responsavel }) => ({
      id: o.id, protocolo: protocolo(o.id), nome: o.nome, organizacao: o.organizacao, tipoGrupo: o.tipoGrupo,
      telefone: verContatos ? o.telefone : null, email: verContatos ? o.email : null, contatosOcultos: !verContatos,
      dataPretendida: o.dataPretendida, pessoas: o.pessoas, servico: o.servico, cidadeOrigem: o.cidadeOrigem, mensagem: o.mensagem,
      utmSource: o.utmSource, utmMedium: o.utmMedium, utmCampaign: o.utmCampaign, status: o.status, responsavelId: o.responsavelId, responsavel, anotacoes: o.anotacoes,
      anonimizado: !!o.anonimizadoEm, criadoEm: o.criadoEm, consentimentoEm: o.consentimentoEm,
    }));
  });

  app.get("/api/orcamentos/resumo", operar, async () => {
    const r = await db.select({ status: orcamentosGrupo.status, n: sql<number>`count(*)::int` }).from(orcamentosGrupo).groupBy(orcamentosGrupo.status);
    return { novos: r.find((x) => x.status === "NOVO")?.n ?? 0, porStatus: Object.fromEntries(STATUS_ORCAMENTO.map((s) => [s, r.find((x) => x.status === s)?.n ?? 0])) };
  });

  /** Quem pode ficar responsável: usuários ativos que lançam reservas (e administradores). */
  app.get("/api/orcamentos/responsaveis", operar, async () =>
    db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).innerJoin(perfis, eq(perfis.id, usuarios.perfilId))
      .where(and(eq(usuarios.ativo, true), or(eq(perfis.codigo, "ADMIN"), sql`'reservas:editar' = any(${perfis.permissoes})`))).orderBy(asc(usuarios.nome)));

  app.patch("/api/orcamentos/:id", operar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = z.object({ status: z.enum(STATUS_ORCAMENTO).optional(), responsavelId: uuid.nullish(), anotacoes: texto(3000).nullish() }).parse(req.body);
    const [atual] = await db.select().from(orcamentosGrupo).where(eq(orcamentosGrupo.id, id));
    if (!atual) throw naoEncontrado("Orçamento");
    if (atual.anonimizadoEm && c.anotacoes) throw new ErroHttp(409, "ANONIMIZADO", "Pedido anonimizado: não aceita novas anotações.");
    if (c.responsavelId) {
      const [u] = await db.select({ ativo: usuarios.ativo }).from(usuarios).where(eq(usuarios.id, c.responsavelId));
      if (!u?.ativo) throw new ErroHttp(400, "RESPONSAVEL_INVALIDO", "Responsável inexistente ou inativo.");
    }
    const set: Partial<typeof orcamentosGrupo.$inferInsert> = { atualizadoEm: new Date() };
    if (c.status) set.status = c.status;
    if (c.responsavelId !== undefined) set.responsavelId = c.responsavelId ?? null;
    if (c.anotacoes !== undefined) set.anotacoes = c.anotacoes?.trim() || null;
    await db.update(orcamentosGrupo).set(set).where(eq(orcamentosGrupo.id, id));
    await auditar(db, req, "ORCAMENTO_ATUALIZADO", { tipo: "orcamento", id }, {
      campos: Object.keys(c), statusAntes: atual.status, statusDepois: c.status ?? atual.status, responsavelAntes: atual.responsavelId, responsavelDepois: c.responsavelId === undefined ? atual.responsavelId : c.responsavelId,
    });
    return { ok: true };
  });

  /** LGPD: apaga os dados pessoais do pedido (a pedido do titular) e mantém só a contagem. */
  app.post("/api/orcamentos/:id/anonimizar", operar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [o] = await db.select({ id: orcamentosGrupo.id, anonimizadoEm: orcamentosGrupo.anonimizadoEm }).from(orcamentosGrupo).where(eq(orcamentosGrupo.id, id));
    if (!o) throw naoEncontrado("Orçamento");
    if (o.anonimizadoEm) return { ok: true };
    await db.update(orcamentosGrupo).set({ nome: "Anonimizado", organizacao: "Anonimizado", telefone: null, email: null, mensagem: null, cidadeOrigem: null, anotacoes: null, anonimizadoEm: new Date(), atualizadoEm: new Date() }).where(eq(orcamentosGrupo.id, id));
    await auditar(db, req, "ORCAMENTO_ANONIMIZADO", { tipo: "orcamento", id });
    return { ok: true };
  });
}
