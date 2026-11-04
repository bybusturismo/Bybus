import { createHash, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { mensagens, unidades, usuarios, waConversas, waMensagens } from "../db/schema.js";
import { filtroUnidade, podeUnidade } from "../seguranca/escopo.js";
import { ErroHttp, exigir, type UsuarioSessao } from "../seguranca/sessao.js";
import { envioReal, enviarWhatsapp, normalizarDestino } from "../servicos/whatsapp.js";
import { conexaoEvolution, gravarSaida, obterConversa, processarAviso, reservasDoTelefone, type Conversa } from "../servicos/whatsappConversas.js";

const uuid = z.string().uuid();
const naoEncontrada = () => new ErroHttp(404, "NAO_ENCONTRADO", "Conversa não encontrada.");
const hash = (v: string) => createHash("sha256").update(v).digest();

/** Conversa com praça só para quem tem a praça; sem praça, para quem chegou até aqui (whatsapp:ver). */
function conversaVisivel(u: UsuarioSessao, unidadeId: string | null): boolean {
  return unidadeId === null || podeUnidade(u, unidadeId);
}
function filtroConversas(u: UsuarioSessao): SQL | undefined {
  if (u.todasUnidades) return undefined;
  return u.unidadeIds.length ? or(isNull(waConversas.unidadeId), inArray(waConversas.unidadeId, u.unidadeIds)) : isNull(waConversas.unidadeId);
}

export async function rotasWhatsapp(app: FastifyInstance, { db, config }: Contexto) {
  const ver = { preHandler: exigir(config, "whatsapp:ver") };
  const responder = (max: number) => ({
    preHandler: [exigir(config, "whatsapp:ver"), exigir(config, "whatsapp:responder")],
    config: { rateLimit: { max, timeWindow: "1 minute" } },
  });

  async function carregar(u: UsuarioSessao, id: string): Promise<Conversa> {
    const [c] = await db.select().from(waConversas).where(eq(waConversas.id, id));
    if (!c || !conversaVisivel(u, c.unidadeId)) throw naoEncontrada();
    return c;
  }

  const modo = () => ({ provedor: config.WHATSAPP_PROVEDOR, envioReal: envioReal(config), simulado: !envioReal(config), avisosLigados: !!config.WHATSAPP_WEBHOOK_TOKEN, conexao: conexaoEvolution.estado });

  // ---------- Aviso da Evolution (rede interna do Docker; sem login) ----------
  // Só a Evolution chama, por http://api:3333/api/interno/whatsapp/<token>. Quem vem da internet passa pelo Caddy, que sempre
  // põe X-Forwarded-For: recusado. Token ausente/errado/rota desligada: tudo 404, sem dizer qual. Nada de texto nos registros.
  app.post("/api/interno/whatsapp/:token", { bodyLimit: 1024 * 1024, config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } }, async (req, reply) => {
    const esperado = config.WHATSAPP_WEBHOOK_TOKEN;
    const recebido = String((req.params as { token?: string }).token ?? "");
    const confere = !!esperado && timingSafeEqual(hash(recebido), hash(esperado));
    if (!confere || req.headers["x-forwarded-for"] !== undefined) return reply.status(404).send({ codigo: "NAO_ENCONTRADO", mensagem: "Não encontrado." });
    await processarAviso(db, config, req.body);
    return { ok: true };
  });

  // ---------- Telas ----------
  app.get("/api/whatsapp/conversas", ver, async (req) => {
    const q = z.object({
      busca: z.string().trim().max(80).optional(),
      naoLidas: z.enum(["1", "true"]).optional(),
      limite: z.coerce.number().int().min(1).max(200).default(100),
    }).parse(req.query);
    const termo = q.busca?.replace(/[\\%_]/g, (c) => `\\${c}`);
    const digitos = q.busca?.replace(/\D/g, "") ?? "";
    const previa = (campo: string) => sql`(select ${sql.raw(campo)} from wa_mensagens m where m.conversa_id = ${waConversas.id} order by m.criado_em desc limit 1)`;
    const linhas = await db.select({
      id: waConversas.id, telefone: waConversas.telefone, nome: waConversas.nome, naoLidas: waConversas.naoLidas,
      ultimaMensagemEm: waConversas.ultimaMensagemEm, unidadeId: waConversas.unidadeId, unidadeCodigo: unidades.codigo,
      previa: sql<string | null>`left(${previa("texto")}, 140)`,
      previaTipo: sql<string | null>`${previa("tipo")}`,
      previaDirecao: sql<string | null>`${previa("direcao")}`,
    }).from(waConversas).leftJoin(unidades, eq(unidades.id, waConversas.unidadeId))
      .where(and(
        eq(waConversas.arquivada, false),
        filtroConversas(req.usuario!),
        q.naoLidas ? sql`${waConversas.naoLidas} > 0` : undefined,
        termo ? or(ilike(waConversas.nome, `%${termo}%`), digitos.length >= 3 ? ilike(waConversas.telefone, `%${digitos}%`) : undefined) : undefined,
      ))
      .orderBy(sql`${waConversas.ultimaMensagemEm} desc nulls last`).limit(q.limite);
    const [{ total } = { total: 0 }] = await db.select({ total: sql<number>`coalesce(sum(${waConversas.naoLidas}), 0)::int` }).from(waConversas).where(and(eq(waConversas.arquivada, false), filtroConversas(req.usuario!)));
    return { modo: modo(), naoLidasTotal: total, conversas: linhas };
  });

  app.get("/api/whatsapp/conversas/:id", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = await carregar(req.usuario!, id);
    const reservas = await reservasDoTelefone(db, c.chave, filtroUnidade(req.usuario!));
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    return {
      id: c.id, telefone: c.telefone, nome: c.nome, naoLidas: c.naoLidas, unidadeId: c.unidadeId, modo: modo(),
      reservas: reservas.map((r) => ({ reservaId: r.reservaId, saidaId: r.saidaId, data: r.data, passeio: r.passeio, titular: r.titular, canal: r.canal, passageiros: r.passageiros, proxima: r.data >= hoje })),
    };
  });

  app.get("/api/whatsapp/conversas/:id/mensagens", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const q = z.object({ antes: z.string().datetime().optional(), limite: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    await carregar(req.usuario!, id);
    const linhas = await db.select({ m: waMensagens, tipoFila: mensagens.tipo, enviadaPorNome: usuarios.nome })
      .from(waMensagens).leftJoin(mensagens, eq(mensagens.id, waMensagens.mensagemFilaId)).leftJoin(usuarios, eq(usuarios.id, waMensagens.enviadaPor))
      .where(and(eq(waMensagens.conversaId, id), q.antes ? lt(waMensagens.criadoEm, new Date(q.antes)) : undefined))
      .orderBy(desc(waMensagens.criadoEm), asc(waMensagens.id)).limit(q.limite + 1);
    const itens = linhas.slice(0, q.limite).map(({ m, tipoFila, enviadaPorNome }) => ({
      id: m.id, direcao: m.direcao, texto: m.texto, tipo: m.tipo, status: m.status, criadoEm: m.criadoEm,
      automatica: m.mensagemFilaId !== null, tipoFila: tipoFila ?? null, enviadaPor: enviadaPorNome ?? null,
    }));
    return { itens, temMais: linhas.length > q.limite };
  });

  app.post("/api/whatsapp/conversas/:id/lida", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await carregar(req.usuario!, id);
    await db.update(waConversas).set({ naoLidas: 0 }).where(eq(waConversas.id, id));
    return { ok: true };
  });

  /** Envia pelo provedor (simulado = nada sai) e grava na conversa. Falha também fica gravada, para a tela mostrar. */
  async function enviarNaConversa(req: Parameters<typeof auditar>[1], c: Conversa, texto: string, usuarioId: string) {
    const destino = c.jid ?? (c.telefone.startsWith("lid:") ? null : c.telefone);
    if (!destino) throw new ErroHttp(400, "SEM_DESTINO", "Esta conversa não tem um endereço para resposta.");
    const r = await enviarWhatsapp(config, destino, texto);
    const m = await gravarSaida(db, { conversaId: c.id, texto, status: r.status, idExterno: r.idExterno, enviadaPor: usuarioId });
    await db.update(waConversas).set({ naoLidas: 0 }).where(eq(waConversas.id, c.id));
    // LGPD: a auditoria guarda só a conversa (nunca o texto nem o telefone).
    await auditar(db, req, "whatsapp.responder", { tipo: "wa_conversa", id: c.id }, { conversaId: c.id });
    return { id: m?.id ?? null, status: r.status, erro: r.erro ?? null };
  }

  const textoResposta = z.string().trim().min(1, "Escreva a mensagem.").max(4096, "A mensagem pode ter até 4.096 caracteres.");

  app.post("/api/whatsapp/conversas/:id/responder", responder(30), async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { texto } = z.object({ texto: textoResposta }).parse(req.body);
    const c = await carregar(req.usuario!, id);
    return enviarNaConversa(req, c, texto, req.usuario!.id);
  });

  /** Nova conversa por telefone (abre a existente, se já houver). Com `texto`, já envia a primeira mensagem. */
  app.post("/api/whatsapp/conversas", responder(20), async (req) => {
    const corpo = z.object({ telefone: z.string().trim().min(8).max(30), nome: z.string().trim().max(120).optional(), texto: textoResposta.optional() }).parse(req.body);
    const destino = normalizarDestino(corpo.telefone);
    if (!destino || destino.endsWith("@g.us")) throw new ErroHttp(400, "TELEFONE_INVALIDO", "Telefone inválido. Use DDD + número (ex.: 48 99999-0000) ou com o código do país.");
    const c = await obterConversa(db, { telefone: destino, nome: corpo.nome || null });
    if (!conversaVisivel(req.usuario!, c.unidadeId)) throw naoEncontrada();
    await auditar(db, req, "whatsapp.nova_conversa", { tipo: "wa_conversa", id: c.id }, { conversaId: c.id });
    const envio = corpo.texto ? await enviarNaConversa(req, c, corpo.texto, req.usuario!.id) : null;
    return { id: c.id, envio };
  });
}
