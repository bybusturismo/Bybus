import { and, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  DOCUMENTO_MAX_BYTES, STATUS_GRUPO, TIPOS_ANEXO_GRUPO, TIPOS_GRUPO, planoDeCobranca, tipoDocumentoEmpresa, totalDoGrupo,
} from "@bybus/core";
import type { Contexto } from "../app.js";
import { auditar } from "../auditoria.js";
import { finCategorias, finLancamentos, gruposAnexos, gruposFechados, pessoas } from "../db/schema.js";
import { podeUnidade } from "../seguranca/escopo.js";
import { ErroHttp, exigir, type UsuarioSessao } from "../seguranca/sessao.js";
import { garantirPlano } from "../servicos/financeiro.js";
import { dataIso, hojeSp } from "../servicos/marketingComum.js";

const texto = (max: number) => z.string().trim().max(max);
const opcional = (max: number) => texto(max).nullish().transform((v) => v || null);
const centavos = z.number().int().min(0).max(1_000_000_000).nullish();
const naoEncontrado = () => new ErroHttp(404, "NAO_ENCONTRADO", "Grupo não encontrado.");

/**
 * Grupos fechados (dono, 13/11/2026): cadastro completo, cobrança (sinal e saldo viram contas a receber no financeiro),
 * anexos (contrato assinado, comprovantes, NF) e histórico de anos anteriores. Acesso: quem lança reservas (reservas:editar),
 * como os pedidos de orçamento de grupo. CPF do representante cifrado.
 */
export async function rotasGrupos(app: FastifyInstance, { db, config, cofre }: Contexto) {
  const acesso = { preHandler: exigir(config, "reservas:editar") };
  const escopo = (u: UsuarioSessao): SQL | undefined => (u.todasUnidades ? undefined : u.unidadeIds.length ? or(inArray(gruposFechados.unidadeId, u.unidadeIds), sql`${gruposFechados.unidadeId} is null`) : sql`${gruposFechados.unidadeId} is null`);

  async function grupoDoUsuario(u: UsuarioSessao, id: string) {
    const [g] = await db.select().from(gruposFechados).where(eq(gruposFechados.id, id));
    if (!g || !(u.todasUnidades || !g.unidadeId || podeUnidade(u, g.unidadeId))) throw naoEncontrado();
    return g;
  }

  const corpo = z.object({
    unidadeId: z.string().uuid().nullish(),
    nome: texto(160).min(2, "Informe o nome do grupo ou da instituição."),
    estilo: z.enum(TIPOS_GRUPO).default("ESCOLA"),
    status: z.enum(STATUS_GRUPO).default("ORCAMENTO"),
    dataPasseio: dataIso.nullish(),
    horarioInicio: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
    localInicio: opcional(200),
    guiaId: z.string().uuid().nullish(),
    veiculo: opcional(120),
    roteiro: opcional(8000),
    duracaoTexto: opcional(120),
    almoco: z.boolean().default(false),
    localAlmoco: opcional(200),
    pessoas: z.number().int().min(0).max(5000).nullish(),
    pessoasMinimo: z.number().int().min(0).max(5000).nullish(),
    cortesias: z.number().int().min(0).max(200).default(0),
    valorPorPessoaCentavos: centavos,
    /** Vazio = calcula pelo valor por pessoa e pessoas (com o mínimo). */
    valorTotalCentavos: centavos,
    sinalPercentual: z.number().int().min(0).max(100).default(50),
    nfEmitida: z.boolean().default(false),
    nfNumero: opcional(60),
    razaoSocial: opcional(200),
    cnpj: opcional(20),
    endereco: opcional(300),
    representanteNome: opcional(160),
    representanteCargo: opcional(80),
    representanteTelefone: opcional(40),
    representanteEmail: z.string().trim().email("E-mail do representante inválido.").max(160).nullish().or(z.literal("")).transform((v) => v || null),
    representanteCpf: z.string().trim().max(20).nullish().transform((v) => (v ? v.replace(/\D/g, "") : null)),
    observacoes: opcional(4000),
    orcamentoId: z.string().uuid().nullish(),
  });

  function paraBanco(c: Partial<z.infer<typeof corpo>>) {
    const { representanteCpf, ...resto } = c;
    const total = resto.valorTotalCentavos ?? totalDoGrupo({ valorPorPessoaCentavos: resto.valorPorPessoaCentavos ?? null, pessoas: resto.pessoas ?? null, pessoasMinimo: resto.pessoasMinimo ?? null });
    return {
      ...resto,
      ...(resto.valorTotalCentavos !== undefined || resto.valorPorPessoaCentavos !== undefined || resto.pessoas !== undefined ? { valorTotalCentavos: total } : {}),
      ...(representanteCpf !== undefined ? { representanteCpfCifrado: representanteCpf ? cofre.cifrar(representanteCpf) : null } : {}),
    };
  }

  async function validarGuia(guiaId: string | null | undefined) {
    if (!guiaId) return;
    const [p] = await db.select({ id: pessoas.id }).from(pessoas).where(eq(pessoas.id, guiaId));
    if (!p) throw new ErroHttp(400, "GUIA_INVALIDO", "Guia não encontrado.");
  }
  function validarPraca(u: UsuarioSessao, unidadeId: string | null | undefined) {
    if (unidadeId && !podeUnidade(u, unidadeId)) throw new ErroHttp(403, "SEM_PERMISSAO", "Você não tem acesso a esta praça.");
  }

  /** Pago e em aberto de cada grupo, pelas contas a receber ligadas a ele. */
  async function financeiroDos(ids: string[]) {
    if (!ids.length) return new Map<string, { cobradoCentavos: number; recebidoCentavos: number }>();
    const r = await db.select({
      id: finLancamentos.grupoFechadoId,
      cobrado: sql<number>`coalesce(sum(${finLancamentos.valorCentavos}), 0)`.mapWith(Number),
      recebido: sql<number>`coalesce(sum(case when ${finLancamentos.situacao} = 'REALIZADO' then coalesce(${finLancamentos.valorPagoCentavos}, ${finLancamentos.valorCentavos}) else 0 end), 0)`.mapWith(Number),
    }).from(finLancamentos).where(inArray(finLancamentos.grupoFechadoId, ids)).groupBy(finLancamentos.grupoFechadoId);
    return new Map(r.map((x) => [x.id!, { cobradoCentavos: x.cobrado, recebidoCentavos: x.recebido }]));
  }

  app.get("/api/grupos", acesso, async (req) => {
    const q = z.object({ q: z.string().trim().max(100).optional(), status: z.enum(STATUS_GRUPO).optional(), estilo: z.enum(TIPOS_GRUPO).optional(), ano: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
    const busca = q.q ? `%${q.q}%` : null;
    const lista = await db.select({
      id: gruposFechados.id, nome: gruposFechados.nome, estilo: gruposFechados.estilo, status: gruposFechados.status, dataPasseio: gruposFechados.dataPasseio,
      pessoas: gruposFechados.pessoas, valorPorPessoaCentavos: gruposFechados.valorPorPessoaCentavos, valorTotalCentavos: gruposFechados.valorTotalCentavos,
      representanteNome: gruposFechados.representanteNome, representanteTelefone: gruposFechados.representanteTelefone, nfEmitida: gruposFechados.nfEmitida,
      unidadeId: gruposFechados.unidadeId, guia: pessoas.nome,
    }).from(gruposFechados).leftJoin(pessoas, eq(pessoas.id, gruposFechados.guiaId))
      .where(and(escopo(req.usuario!), q.status ? eq(gruposFechados.status, q.status) : undefined, q.estilo ? eq(gruposFechados.estilo, q.estilo) : undefined,
        q.ano ? sql`extract(year from ${gruposFechados.dataPasseio}) = ${q.ano}` : undefined,
        busca ? or(ilike(gruposFechados.nome, busca), ilike(gruposFechados.representanteNome, busca), ilike(gruposFechados.roteiro, busca)) : undefined))
      .orderBy(desc(gruposFechados.dataPasseio), desc(gruposFechados.criadoEm)).limit(500);
    const fin = await financeiroDos(lista.map((g) => g.id));
    return lista.map((g) => ({ ...g, ...(fin.get(g.id) ?? { cobradoCentavos: 0, recebidoCentavos: 0 }) }));
  });

  app.get("/api/grupos/:id", acesso, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const g = await grupoDoUsuario(req.usuario!, id);
    const { representanteCpfCifrado, ...resto } = g;
    const cobrancas = await db.select({
      id: finLancamentos.id, descricao: finLancamentos.descricao, valorCentavos: finLancamentos.valorCentavos, vencimento: finLancamentos.vencimento,
      situacao: finLancamentos.situacao, pagoEm: finLancamentos.pagoEm, valorPagoCentavos: finLancamentos.valorPagoCentavos,
    }).from(finLancamentos).where(eq(finLancamentos.grupoFechadoId, id)).orderBy(finLancamentos.vencimento);
    const anexos = await db.select({ id: gruposAnexos.id, tipo: gruposAnexos.tipo, nomeArquivo: gruposAnexos.nomeArquivo, tamanho: gruposAnexos.tamanho, criadoEm: gruposAnexos.criadoEm })
      .from(gruposAnexos).where(eq(gruposAnexos.grupoId, id)).orderBy(desc(gruposAnexos.criadoEm));
    // Histórico: outros passeios do mesmo grupo (mesmo CNPJ ou mesmo nome), para conferir valores e roteiros de anos anteriores.
    const anteriores = await db.select({
      id: gruposFechados.id, dataPasseio: gruposFechados.dataPasseio, status: gruposFechados.status, pessoas: gruposFechados.pessoas,
      valorPorPessoaCentavos: gruposFechados.valorPorPessoaCentavos, valorTotalCentavos: gruposFechados.valorTotalCentavos, roteiro: gruposFechados.roteiro,
    }).from(gruposFechados).where(and(ne(gruposFechados.id, id), escopo(req.usuario!),
      g.cnpj ? or(eq(gruposFechados.cnpj, g.cnpj), sql`lower(${gruposFechados.nome}) = lower(${g.nome})`) : sql`lower(${gruposFechados.nome}) = lower(${g.nome})`))
      .orderBy(desc(gruposFechados.dataPasseio)).limit(20);
    return { ...resto, representanteCpf: representanteCpfCifrado ? cofre.decifrar(representanteCpfCifrado) : null, cobrancas, anexos, anteriores };
  });

  app.post("/api/grupos", acesso, async (req, reply) => {
    const c = corpo.parse(req.body);
    validarPraca(req.usuario!, c.unidadeId);
    await validarGuia(c.guiaId);
    const [g] = await db.insert(gruposFechados).values({ ...(paraBanco(c) as typeof gruposFechados.$inferInsert), criadoPor: req.usuario!.id }).returning({ id: gruposFechados.id });
    await auditar(db, req, "GRUPO_CRIADO", { tipo: "grupo_fechado", id: g!.id }, { nome: c.nome, status: c.status, dataPasseio: c.dataPasseio ?? null });
    reply.code(201);
    return { id: g!.id };
  });

  app.patch("/api/grupos/:id", acesso, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const atual = await grupoDoUsuario(req.usuario!, id);
    const c = corpo.partial().parse(req.body);
    if (c.unidadeId !== undefined) validarPraca(req.usuario!, c.unidadeId);
    await validarGuia(c.guiaId);
    // Recalcula o total com os valores atuais para os campos que não vieram.
    const mistura = { valorPorPessoaCentavos: c.valorPorPessoaCentavos !== undefined ? c.valorPorPessoaCentavos : atual.valorPorPessoaCentavos, pessoas: c.pessoas !== undefined ? c.pessoas : atual.pessoas, pessoasMinimo: c.pessoasMinimo !== undefined ? c.pessoasMinimo : atual.pessoasMinimo };
    const dados = paraBanco({ ...c, ...(c.valorPorPessoaCentavos !== undefined || c.pessoas !== undefined || c.pessoasMinimo !== undefined ? mistura : {}) });
    await db.update(gruposFechados).set({ ...dados, atualizadoEm: new Date() }).where(eq(gruposFechados.id, id));
    await auditar(db, req, "GRUPO_ALTERADO", { tipo: "grupo_fechado", id }, { campos: Object.keys(c).filter((k) => k !== "representanteCpf") });
    return { ok: true };
  });

  /** Cria as contas a receber do grupo (sinal e saldo) no financeiro. Uma vez só: depois, ajuste pelo financeiro. */
  app.post("/api/grupos/:id/cobranca", acesso, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { vencimentoSinal } = z.object({ vencimentoSinal: dataIso.optional() }).parse(req.body ?? {});
    const g = await grupoDoUsuario(req.usuario!, id);
    if (!g.valorTotalCentavos) throw new ErroHttp(400, "SEM_VALOR", "Informe o valor por pessoa e a quantidade (ou o valor total) antes de gerar a cobrança.");
    const [ja] = await db.select({ id: finLancamentos.id }).from(finLancamentos).where(eq(finLancamentos.grupoFechadoId, id)).limit(1);
    if (ja) throw new ErroHttp(409, "COBRANCA_EXISTENTE", "A cobrança deste grupo já foi gerada. Ajustes de valor e data são feitos em Financeiro › A receber.");
    await garantirPlano(db);
    const [cat] = await db.select({ id: finCategorias.id }).from(finCategorias).where(eq(finCategorias.codigo, "REC_GRUPOS"));
    const plano = planoDeCobranca({ totalCentavos: g.valorTotalCentavos, sinalPercentual: g.sinalPercentual, vencimentoSinal: vencimentoSinal ?? hojeSp(), dataPasseio: g.dataPasseio });
    const competencia = g.dataPasseio ?? hojeSp();
    await db.insert(finLancamentos).values(plano.map((p) => ({
      tipo: "RECEBER", descricao: `${g.nome} — ${p.descricao}`, contraparte: g.razaoSocial || g.nome, categoriaId: cat!.id, unidadeId: g.unidadeId,
      linha: "CITY_TOUR", valorCentavos: p.valorCentavos, competencia, vencimento: p.vencimento, origem: "GRUPO", grupoFechadoId: id, criadoPor: req.usuario!.id,
    })));
    await auditar(db, req, "GRUPO_COBRANCA_GERADA", { tipo: "grupo_fechado", id }, { parcelas: plano.length, totalCentavos: g.valorTotalCentavos });
    return { parcelas: plano };
  });

  // ---------- Anexos ----------
  app.post("/api/grupos/:id/anexos", { ...acesso, bodyLimit: 22 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ tipo: z.enum(TIPOS_ANEXO_GRUPO), nome: z.string().trim().min(1).max(160), base64: z.string().min(8) }).parse(req.body);
    await grupoDoUsuario(req.usuario!, id);
    const bytes = Buffer.from(b.base64, "base64");
    if (bytes.length > DOCUMENTO_MAX_BYTES) throw new ErroHttp(400, "ARQUIVO_GRANDE", "O arquivo pode ter até 15 MB.");
    const nome = b.nome.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
    const ehXml = /\.xml$/i.test(nome) && /^\s*</.test(bytes.subarray(0, 200).toString("utf8").replace(/^﻿/, ""));
    const mime = tipoDocumentoEmpresa(bytes, nome) ?? (ehXml ? "application/xml" : null);
    if (!mime) throw new ErroHttp(400, "ARQUIVO_TIPO", "Envie PDF, JPG, PNG, XML da nota ou documento do Word/Excel.");
    const [a] = await db.insert(gruposAnexos).values({ grupoId: id, tipo: b.tipo, nomeArquivo: nome, mime, tamanho: bytes.length, dadosCifrados: cofre.cifrar(bytes.toString("base64")), enviadoPor: req.usuario!.id }).returning({ id: gruposAnexos.id });
    await auditar(db, req, "GRUPO_ANEXO", { tipo: "grupo_fechado", id }, { anexoId: a!.id, tipoAnexo: b.tipo, tamanho: bytes.length });
    reply.code(201);
    return { id: a!.id };
  });

  async function anexoDoUsuario(req: FastifyRequest, id: string) {
    const [a] = await db.select().from(gruposAnexos).where(eq(gruposAnexos.id, id));
    if (!a) throw new ErroHttp(404, "NAO_ENCONTRADO", "Anexo não encontrado.");
    await grupoDoUsuario(req.usuario!, a.grupoId).catch(() => { throw new ErroHttp(404, "NAO_ENCONTRADO", "Anexo não encontrado."); });
    return a;
  }
  app.get("/api/grupos/anexos/:id", acesso, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { baixar } = z.object({ baixar: z.string().optional() }).parse(req.query);
    const a = await anexoDoUsuario(req, id);
    const bytes = Buffer.from(cofre.decifrar(a.dadosCifrados), "base64");
    const exibir = !baixar && /^(application\/pdf|image\/(jpeg|png))$/.test(a.mime);
    return reply.header("Content-Type", a.mime).header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `${exibir ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.nomeArquivo)}`).send(bytes);
  });
  app.delete("/api/grupos/anexos/:id", acesso, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const a = await anexoDoUsuario(req, id);
    await db.delete(gruposAnexos).where(eq(gruposAnexos.id, id));
    await auditar(db, req, "GRUPO_ANEXO_EXCLUIDO", { tipo: "grupo_fechado", id: a.grupoId }, { anexoId: id, tipoAnexo: a.tipo });
    return { ok: true };
  });
}
