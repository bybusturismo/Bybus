import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { sugerirPontos } from "@bybus/core";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { passageiros, passeios, pontosEmbarque, reservas, saidas, usuarios } from "../db/schema.js";
import { filtroUnidade, garantirReserva } from "../seguranca/escopo.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { gerarLinkEmbarque, hashToken } from "../servicos/linkEmbarque.js";

const uuid = z.string().uuid();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const token = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
const hojeSp = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

const invalido = () => new ErroHttp(404, "LINK_INVALIDO", "Este link não é válido ou já expirou. Fale com a By Bus pelo WhatsApp.");

export async function rotasEmbarque(app: FastifyInstance, { db, config }: Contexto) {
  /** Reserva do link público (token válido e não expirado). */
  async function reservaDoToken(t: string) {
    const [r] = await db.select({ reserva: reservas, saida: saidas, passeio: passeios }).from(reservas)
      .innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .where(eq(reservas.tokenEmbarqueHash, hashToken(t)));
    if (!r || r.reserva.status !== "CONFIRMADA" || !r.reserva.tokenEmbarqueExpiraEm || r.reserva.tokenEmbarqueExpiraEm < new Date()) throw invalido();
    return r;
  }
  const pontosDe = (passeioId: string) => db.select({ id: pontosEmbarque.id, nome: pontosEmbarque.nome, horario: pontosEmbarque.horario, endereco: pontosEmbarque.endereco, ehTransfer: pontosEmbarque.ehTransfer })
    .from(pontosEmbarque).where(and(eq(pontosEmbarque.passeioId, passeioId), eq(pontosEmbarque.ativo, true))).orderBy(asc(pontosEmbarque.horario), asc(pontosEmbarque.ordem));
  const publico = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  // ---------- Link público do passageiro (sem login; só o necessário, nada de outros passageiros) ----------
  app.get("/api/publico/embarque/:token", publico, async (req) => {
    const { token: t } = z.object({ token }).parse(req.params);
    const { reserva, saida, passeio } = await reservaDoToken(t);
    const [{ total } = { total: 0 }] = await db.select({ total: sql<number>`count(*)::int` }).from(passageiros).where(eq(passageiros.reservaId, reserva.id));
    return {
      passeio: passeio.nome,
      cidade: passeio.cidade,
      data: saida.data,
      titular: reserva.contatoNome.split(/[\s,]+/).filter(Boolean)[0] ?? "",
      passageiros: total,
      pontos: await pontosDe(passeio.id),
      escolha: reserva.pontoEmbarqueId || reserva.hospedagemInformada
        ? { pontoId: reserva.pontoEmbarqueId, hospedagem: reserva.hospedagemInformada, pediuTransfer: reserva.pediuTransfer }
        : null,
      conferida: reserva.conferencia === "CONFERIDA",
      listaFechada: !!saida.listaFechadaEm,
    };
  });

  app.post("/api/publico/embarque/:token/sugestao", publico, async (req) => {
    const { token: t } = z.object({ token }).parse(req.params);
    const { hospedagem } = z.object({ hospedagem: z.string().trim().min(2).max(200) }).parse(req.body);
    const { passeio } = await reservaDoToken(t);
    return { sugestoes: sugerirPontos(hospedagem, await pontosDe(passeio.id)) };
  });

  app.post("/api/publico/embarque/:token", publico, async (req) => {
    const { token: t } = z.object({ token }).parse(req.params);
    const corpo = z.object({ pontoId: uuid, hospedagem: z.string().trim().max(200).default("") }).parse(req.body);
    const { reserva, saida, passeio } = await reservaDoToken(t);
    // Depois do fechamento ainda vale (o link vai na própria confirmação da véspera): a escolha entra no adendo,
    // e a equipe confere antes do embarque.
    const ponto = (await pontosDe(passeio.id)).find((p) => p.id === corpo.pontoId);
    if (!ponto) throw new ErroHttp(400, "PONTO_INVALIDO", "Escolha um dos pontos da lista.");
    // Escolha do cliente volta para a conferência da equipe.
    await db.update(reservas).set({
      pontoEmbarqueId: ponto.id, hospedagemInformada: corpo.hospedagem || null, pediuTransfer: ponto.ehTransfer,
      informadoPeloClienteEm: new Date(), conferencia: "PENDENTE", conferidaPor: null, conferidaEm: null, atualizadoEm: new Date(),
    }).where(eq(reservas.id, reserva.id));
    await db.update(passageiros).set({ pontoEmbarqueId: null }).where(eq(passageiros.reservaId, reserva.id));
    await auditar(db, req, "EMBARQUE_INFORMADO_PELO_CLIENTE", { tipo: "reserva", id: reserva.id }, { transfer: ponto.ehTransfer });
    return { ok: true, aposFechamento: !!saida.listaFechadaEm, ponto: { nome: ponto.nome, horario: ponto.horario, endereco: ponto.endereco } };
  });

  // ---------- Equipe ----------
  const editar = { preHandler: exigir(config, "reservas:editar") };

  /** Gera (ou regenera) o link de embarque da reserva. O link anterior deixa de valer. */
  app.post("/api/reservas/:id/link-embarque", editar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await garantirReserva(db, req.usuario!, id);
    const r = await gerarLinkEmbarque(db, id);
    await auditar(db, req, "LINK_EMBARQUE_GERADO", { tipo: "reserva", id });
    return { caminho: r.caminho, expiraEm: r.expiraEm };
  });

  /** Fila de conferência: reservas confirmadas das próximas saídas, com o que o colaborador precisa checar. */
  app.get("/api/conferencia", editar, async (req) => {
    const q = z.object({ de: dataIso.optional(), ate: dataIso.optional(), situacao: z.enum(["PENDENTE", "CONFERIDA", "TODAS"]).default("PENDENTE"), unidadeId: uuid.optional() }).parse(req.query);
    const de = q.de ?? hojeSp();
    const ate = q.ate ?? new Date(new Date(`${de}T12:00:00Z`).getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
    const linhas = await db.select({ reserva: reservas, saida: saidas, passeio: { id: passeios.id, nome: passeios.nome, unidadeId: passeios.unidadeId }, ponto: { id: pontosEmbarque.id, nome: pontosEmbarque.nome, horario: pontosEmbarque.horario, ehTransfer: pontosEmbarque.ehTransfer }, conferente: usuarios.nome })
      .from(reservas)
      .innerJoin(saidas, eq(saidas.id, reservas.saidaId))
      .innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .leftJoin(pontosEmbarque, eq(pontosEmbarque.id, reservas.pontoEmbarqueId))
      .leftJoin(usuarios, eq(usuarios.id, reservas.conferidaPor))
      .where(and(
        eq(reservas.status, "CONFIRMADA"), gte(saidas.data, de), lte(saidas.data, ate), filtroUnidade(req.usuario!),
        q.unidadeId ? eq(passeios.unidadeId, q.unidadeId) : undefined,
        q.situacao === "TODAS" ? undefined : eq(reservas.conferencia, q.situacao),
      ))
      .orderBy(asc(saidas.data), asc(pontosEmbarque.horario), asc(reservas.contatoNome))
      .limit(500);
    const ids = linhas.map((l) => l.reserva.id);
    const pax = ids.length ? await db.select({ reservaId: passageiros.reservaId, categoria: passageiros.categoria }).from(passageiros).where(inArray(passageiros.reservaId, ids)) : [];
    const porReserva = new Map<string, Record<string, number>>();
    for (const x of pax) {
      const c = porReserva.get(x.reservaId) ?? {};
      c[x.categoria] = (c[x.categoria] ?? 0) + 1;
      porReserva.set(x.reservaId, c);
    }
    const verContatos = pode(req.usuario!, "manifesto:contatos");
    return linhas.map(({ reserva: r, saida: s, passeio: p, ponto, conferente }) => {
      const categorias = porReserva.get(r.id) ?? {};
      const alertas: string[] = [];
      if (!ponto) alertas.push(r.hospedagemInformada ? "Ponto a definir" : "Sem ponto de embarque");
      if (!r.contatoTelefone) alertas.push("Sem telefone");
      if (r.pagamento === "A_PAGAR") alertas.push("Pagar no embarque");
      if (s.listaFechadaEm) alertas.push("Lista já fechada");
      return {
        id: r.id, saidaId: s.id, data: s.data, passeio: p.nome, passeioId: p.id, canal: r.canalOrigem ?? r.canal, codigoExterno: r.codigoExterno,
        contatoNome: r.contatoNome, contatoTelefone: verContatos ? r.contatoTelefone : null,
        passageiros: Object.values(categorias).reduce((a, n) => a + n, 0), categorias,
        pagamento: r.pagamento, formaPagamento: r.formaPagamento, origemCliente: r.origemCliente,
        ponto, hospedagemInformada: r.hospedagemInformada, pediuTransfer: r.pediuTransfer, informadoPeloClienteEm: r.informadoPeloClienteEm,
        conferencia: r.conferencia, conferidaEm: r.conferidaEm, conferidaPor: conferente,
        linkGerado: !!r.tokenEmbarqueHash && !!r.tokenEmbarqueExpiraEm && r.tokenEmbarqueExpiraEm > new Date(),
        alertas,
      };
    });
  });

  /** Conferir: o colaborador confirma (ou corrige) o ponto de embarque. */
  app.post("/api/reservas/:id/conferir", editar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = z.object({ pontoEmbarqueId: uuid.nullable().optional() }).parse(req.body ?? {});
    await garantirReserva(db, req.usuario!, id);
    const [r] = await db.select({ reserva: reservas, saida: saidas }).from(reservas).innerJoin(saidas, eq(saidas.id, reservas.saidaId)).where(eq(reservas.id, id));
    if (!r) throw new ErroHttp(404, "NAO_ENCONTRADO", "Reserva não encontrada.");
    const pontoId = corpo.pontoEmbarqueId !== undefined ? corpo.pontoEmbarqueId : r.reserva.pontoEmbarqueId;
    if (!pontoId) throw new ErroHttp(400, "PONTO_OBRIGATORIO", "Defina o ponto de embarque antes de conferir.");
    const [ponto] = await db.select({ ehTransfer: pontosEmbarque.ehTransfer }).from(pontosEmbarque).where(and(eq(pontosEmbarque.id, pontoId), eq(pontosEmbarque.passeioId, r.saida.passeioId)));
    if (!ponto) throw new ErroHttp(400, "PONTO_INVALIDO", "Ponto de embarque não pertence a este passeio.");
    await db.update(reservas).set({ pontoEmbarqueId: pontoId, pediuTransfer: ponto.ehTransfer, conferencia: "CONFERIDA", conferidaPor: req.usuario!.id, conferidaEm: new Date(), atualizadoEm: new Date() }).where(eq(reservas.id, id));
    await auditar(db, req, "RESERVA_CONFERIDA", { tipo: "reserva", id }, { pontoAlterado: pontoId !== r.reserva.pontoEmbarqueId });
    return { ok: true };
  });
}
