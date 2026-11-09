import { createHash, timingSafeEqual } from "node:crypto";
import { aplicarVariaveis, ATALHO_RESPOSTA_REGEX, ETIQUETAS_CONVERSA, IDIOMAS_RESPOSTA, janelaResposta, normalizarAtalho, RESPOSTAS_INICIAIS } from "@bybus/core";
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { mensagens, perfis, respostasRapidas, unidades, usuarios, waConversas, waMensagens } from "../db/schema.js";
import { filtroUnidade, podeUnidade } from "../seguranca/escopo.js";
import { ErroHttp, exigir, type UsuarioSessao } from "../seguranca/sessao.js";
import { envioReal, enviarWhatsapp, normalizarDestino } from "../servicos/whatsapp.js";
import { enviarDirect, estadoInstagram, instagramReal } from "../servicos/instagram/cliente.js";
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

  const modo = () => ({ provedor: config.WHATSAPP_PROVEDOR, envioReal: envioReal(config), simulado: !envioReal(config), avisosLigados: config.WHATSAPP_PROVEDOR === "meta" ? !!config.META_APP_SECRET && !!config.META_WA_VERIFY_TOKEN : !!config.WHATSAPP_WEBHOOK_TOKEN, conexao: conexaoEvolution.estado, instagram: estadoInstagram(config) });

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
      canal: z.enum(["WHATSAPP", "INSTAGRAM"]).optional(),
      etiqueta: z.enum(ETIQUETAS_CONVERSA).optional(),
      /** "eu" = atribuídas a mim; "sem" = sem atendente. */
      atendente: z.enum(["eu", "sem"]).optional(),
      limite: z.coerce.number().int().min(1).max(200).default(100),
    }).parse(req.query);
    const termo = q.busca?.replace(/[\\%_]/g, (c) => `\\${c}`);
    const digitos = q.busca?.replace(/\D/g, "") ?? "";
    const previa = (campo: string) => sql`(select ${sql.raw(campo)} from wa_mensagens m where m.conversa_id = ${waConversas.id} order by m.criado_em desc limit 1)`;
    const linhas = await db.select({
      id: waConversas.id, canal: waConversas.canal, telefone: waConversas.telefone, nome: waConversas.nome, naoLidas: waConversas.naoLidas,
      etiquetas: waConversas.etiquetas, atendenteId: waConversas.atendenteId, atendenteNome: usuarios.nome,
      ultimaMensagemEm: waConversas.ultimaMensagemEm, unidadeId: waConversas.unidadeId, unidadeCodigo: unidades.codigo,
      previa: sql<string | null>`left(${previa("texto")}, 140)`,
      previaTipo: sql<string | null>`${previa("tipo")}`,
      previaDirecao: sql<string | null>`${previa("direcao")}`,
    }).from(waConversas).leftJoin(unidades, eq(unidades.id, waConversas.unidadeId)).leftJoin(usuarios, eq(usuarios.id, waConversas.atendenteId))
      .where(and(
        eq(waConversas.arquivada, false),
        filtroConversas(req.usuario!),
        q.canal ? eq(waConversas.canal, q.canal) : undefined,
        q.etiqueta ? sql`${q.etiqueta} = any(${waConversas.etiquetas})` : undefined,
        q.atendente === "eu" ? eq(waConversas.atendenteId, req.usuario!.id) : q.atendente === "sem" ? isNull(waConversas.atendenteId) : undefined,
        q.naoLidas ? sql`${waConversas.naoLidas} > 0` : undefined,
        termo ? or(ilike(waConversas.nome, `%${termo}%`), digitos.length >= 3 ? ilike(waConversas.telefone, `%${digitos}%`) : undefined) : undefined,
      ))
      .orderBy(sql`${waConversas.ultimaMensagemEm} desc nulls last`).limit(q.limite);
    const [{ total } = { total: 0 }] = await db.select({ total: sql<number>`coalesce(sum(${waConversas.naoLidas}), 0)::int` }).from(waConversas).where(and(eq(waConversas.arquivada, false), filtroConversas(req.usuario!)));
    const porCanal = await db.select({ canal: waConversas.canal, n: sql<number>`coalesce(sum(${waConversas.naoLidas}), 0)::int` }).from(waConversas).where(and(eq(waConversas.arquivada, false), filtroConversas(req.usuario!))).groupBy(waConversas.canal);
    const [{ minhas } = { minhas: 0 }] = await db.select({ minhas: sql<number>`count(*)::int` }).from(waConversas).where(and(eq(waConversas.arquivada, false), eq(waConversas.atendenteId, req.usuario!.id), filtroConversas(req.usuario!)));
    return { modo: modo(), naoLidasTotal: total, naoLidasPorCanal: Object.fromEntries(porCanal.map((x) => [x.canal, x.n])), minhasConversas: minhas, conversas: linhas };
  });

  app.get("/api/whatsapp/conversas/:id", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = await carregar(req.usuario!, id);
    const reservas = await reservasDoTelefone(db, c.chave, filtroUnidade(req.usuario!));
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const alvo = reservas.find((r) => r.data >= hoje) ?? reservas[0];
    const primeiroNome = (c.nome ?? alvo?.titular ?? "").trim().split(/\s+/)[0] ?? "";
    const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
    return {
      id: c.id, canal: c.canal, telefone: c.telefone, nome: c.nome, naoLidas: c.naoLidas, unidadeId: c.unidadeId, modo: modo(),
      etiquetas: c.etiquetas, atendenteId: c.atendenteId,
      // Janela de 24 h do Direct (só Instagram): a tela avisa e bloqueia o envio fora dela.
      janela: c.canal === "INSTAGRAM" ? janelaResposta(c.ultimaEntradaEm) : null,
      // Valores para as variáveis das respostas prontas (da reserva mais próxima de hoje).
      variaveis: { nome: primeiroNome || null, passeio: alvo?.passeio ?? null, data: alvo ? dataBr(alvo.data) : null, ponto: alvo?.ponto ?? null, horario: alvo?.horario ?? null },
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
    if (c.canal === "INSTAGRAM") {
      // Regra da Meta: Direct só pode ser respondido até 24 h depois da última mensagem do cliente.
      if (!janelaResposta(c.ultimaEntradaEm).aberta) throw new ErroHttp(409, "JANELA_24H_FECHADA", "Já se passaram mais de 24 horas desde a última mensagem do cliente: o Instagram não permite responder por aqui.");
      if (!c.idContato) throw new ErroHttp(400, "SEM_DESTINO", "Esta conversa não tem um endereço para resposta.");
      let status: "ENVIADA" | "SIMULADA" | "FALHA" = "SIMULADA";
      let idExterno: string | undefined;
      let erro: string | null = null;
      if (instagramReal(config)) {
        const r = await enviarDirect(config, c.idContato, texto);
        status = r.ok ? "ENVIADA" : "FALHA";
        idExterno = r.dados?.message_id;
        erro = r.ok ? null : `META_${r.codigo ?? r.status}`;
      }
      const m = await gravarSaida(db, { conversaId: c.id, texto, status, idExterno, enviadaPor: usuarioId });
      await db.update(waConversas).set({ naoLidas: 0 }).where(eq(waConversas.id, c.id));
      await auditar(db, req, "instagram.responder", { tipo: "wa_conversa", id: c.id }, { conversaId: c.id });
      return { id: m?.id ?? null, status, erro };
    }
    const destino = c.jid ?? (c.telefone.startsWith("lid:") ? null : c.telefone);
    if (!destino) throw new ErroHttp(400, "SEM_DESTINO", "Esta conversa não tem um endereço para resposta.");
    // WhatsApp oficial: texto livre só dentro de 24 h da última mensagem do cliente (a tela avisa quando a janela fechou).
    if (config.WHATSAPP_PROVEDOR === "meta" && envioReal(config) && !janelaResposta(c.ultimaEntradaEm).aberta) {
      throw new ErroHttp(409, "JANELA_24H_FECHADA", "Já se passaram mais de 24 horas desde a última mensagem do cliente: pelo WhatsApp oficial só dá para responder depois que ele escrever de novo (ou com um modelo aprovado).");
    }
    const r = await enviarWhatsapp(config, destino, texto, fetch, { janelaAberta: true });
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

  // ---------- Etiquetas e atendente ----------
  app.put("/api/whatsapp/conversas/:id/etiquetas", responder(120), async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { etiquetas } = z.object({ etiquetas: z.array(z.enum(ETIQUETAS_CONVERSA)).max(ETIQUETAS_CONVERSA.length) }).parse(req.body);
    await carregar(req.usuario!, id);
    const unicas = [...new Set(etiquetas)];
    await db.update(waConversas).set({ etiquetas: unicas }).where(eq(waConversas.id, id));
    await auditar(db, req, "conversa.etiquetas", { tipo: "wa_conversa", id }, { conversaId: id, etiquetas: unicas });
    return { etiquetas: unicas };
  });

  /** Quem pode assumir conversas: usuários ativos com whatsapp:ver (e administradores). */
  app.get("/api/whatsapp/atendentes", ver, async () =>
    db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).innerJoin(perfis, eq(perfis.id, usuarios.perfilId))
      .where(and(eq(usuarios.ativo, true), or(eq(perfis.codigo, "ADMIN"), sql`'whatsapp:ver' = any(${perfis.permissoes})`))).orderBy(asc(usuarios.nome)));

  app.post("/api/whatsapp/conversas/:id/atribuir", responder(120), async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { usuarioId } = z.object({ usuarioId: uuid.nullable() }).parse(req.body);
    await carregar(req.usuario!, id);
    if (usuarioId) {
      const [u] = await db.select({ ativo: usuarios.ativo, perfil: perfis.codigo, permissoes: perfis.permissoes }).from(usuarios).innerJoin(perfis, eq(perfis.id, usuarios.perfilId)).where(eq(usuarios.id, usuarioId));
      if (!u?.ativo || !(u.perfil === "ADMIN" || u.permissoes.includes("whatsapp:ver"))) throw new ErroHttp(400, "ATENDENTE_INVALIDO", "Essa pessoa não pode atender conversas.");
    }
    await db.update(waConversas).set({ atendenteId: usuarioId }).where(eq(waConversas.id, id));
    await auditar(db, req, "conversa.atribuir", { tipo: "wa_conversa", id }, { conversaId: id, para: usuarioId });
    return { atendenteId: usuarioId };
  });

  // ---------- Respostas prontas ----------
  const esquemaResposta = z.object({
    atalho: z.string().trim().min(1).max(40).transform(normalizarAtalho).refine((a) => ATALHO_RESPOSTA_REGEX.test(a), "Atalho: letras, números e hífen."),
    titulo: z.string().trim().min(1, "Informe o título.").max(80),
    idioma: z.enum(IDIOMAS_RESPOSTA).default("PT"),
    texto: z.string().trim().min(1, "Escreva o texto.").max(2000),
    revisada: z.boolean().optional(),
  });

  app.get("/api/whatsapp/respostas-rapidas", ver, async (req) => {
    const q = z.object({ idioma: z.enum(IDIOMAS_RESPOSTA).optional() }).parse(req.query);
    const linhas = await db.select().from(respostasRapidas).where(q.idioma ? eq(respostasRapidas.idioma, q.idioma) : undefined).orderBy(asc(respostasRapidas.atalho), asc(respostasRapidas.idioma));
    return linhas.map((r) => ({ id: r.id, atalho: r.atalho, titulo: r.titulo, idioma: r.idioma, texto: r.texto, revisada: r.revisada }));
  });

  const duplicada = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505";

  app.post("/api/whatsapp/respostas-rapidas", responder(60), async (req) => {
    const d = esquemaResposta.parse(req.body);
    try {
      const [nova] = await db.insert(respostasRapidas).values({ atalho: d.atalho, titulo: d.titulo, idioma: d.idioma, texto: d.texto, revisada: d.revisada ?? true, criadoPor: req.usuario!.id }).returning();
      await auditar(db, req, "resposta_rapida.criar", { tipo: "resposta_rapida", id: nova!.id }, { atalho: d.atalho, idioma: d.idioma });
      return nova;
    } catch (e) {
      if (duplicada(e)) throw new ErroHttp(409, "ATALHO_REPETIDO", "Já existe uma resposta com esse atalho nesse idioma.");
      throw e;
    }
  });

  app.patch("/api/whatsapp/respostas-rapidas/:id", responder(60), async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const d = esquemaResposta.partial().parse(req.body);
    try {
      // Editar o texto sem dizer o contrário conta como revisão feita por quem editou.
      const [nova] = await db.update(respostasRapidas).set({ ...d, ...(d.texto !== undefined && d.revisada === undefined ? { revisada: true } : {}), atualizadoEm: new Date() }).where(eq(respostasRapidas.id, id)).returning();
      if (!nova) throw new ErroHttp(404, "NAO_ENCONTRADO", "Resposta não encontrada.");
      await auditar(db, req, "resposta_rapida.editar", { tipo: "resposta_rapida", id }, { campos: Object.keys(d) });
      return nova;
    } catch (e) {
      if (duplicada(e)) throw new ErroHttp(409, "ATALHO_REPETIDO", "Já existe uma resposta com esse atalho nesse idioma.");
      throw e;
    }
  });

  app.delete("/api/whatsapp/respostas-rapidas/:id", responder(60), async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const apagadas = await db.delete(respostasRapidas).where(eq(respostasRapidas.id, id)).returning({ id: respostasRapidas.id });
    if (!apagadas.length) throw new ErroHttp(404, "NAO_ENCONTRADO", "Resposta não encontrada.");
    await auditar(db, req, "resposta_rapida.excluir", { tipo: "resposta_rapida", id }, {});
    return { ok: true };
  });

  /** Carrega as sugestões iniciais (PT/EN/ES) que ainda não existem; nascem "não revisadas" para o dono conferir. Idempotente. */
  app.post("/api/whatsapp/respostas-rapidas/sugestoes", responder(6), async (req) => {
    const criadas = await db.insert(respostasRapidas).values(RESPOSTAS_INICIAIS.map((r) => ({ ...r, revisada: false, criadoPor: req.usuario!.id }))).onConflictDoNothing().returning({ id: respostasRapidas.id });
    await auditar(db, req, "resposta_rapida.sugestoes", undefined, { criadas: criadas.length });
    return { criadas: criadas.length };
  });

  /** Aplica as variáveis a uma resposta para a conversa aberta (o mesmo cálculo que a tela faz; útil para conferência). */
  app.post("/api/whatsapp/conversas/:id/aplicar-resposta", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { respostaId } = z.object({ respostaId: uuid }).parse(req.body);
    const c = await carregar(req.usuario!, id);
    const [r] = await db.select().from(respostasRapidas).where(eq(respostasRapidas.id, respostaId));
    if (!r) throw new ErroHttp(404, "NAO_ENCONTRADO", "Resposta não encontrada.");
    const reservas = await reservasDoTelefone(db, c.chave, filtroUnidade(req.usuario!));
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const alvo = reservas.find((x) => x.data >= hoje) ?? reservas[0];
    const nome = ((c.nome ?? alvo?.titular ?? "").trim().split(/\s+/)[0]) || null;
    return aplicarVariaveis(r.texto, { nome, passeio: alvo?.passeio, data: alvo ? `${alvo.data.slice(8, 10)}/${alvo.data.slice(5, 7)}/${alvo.data.slice(0, 4)}` : null, ponto: alvo?.ponto, horario: alvo?.horario });
  });
}
