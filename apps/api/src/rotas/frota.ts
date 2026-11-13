import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { arquivosDoDrive, baixarDoDrive, contaDeServico, ErroGoogle, idDoDrive } from "../servicos/googlePlanilhas.js";
import {
  DOCUMENTO_MAX_BYTES, GRUPOS_CUSTO_VEICULO, diasEntre, tipoDocumentoEmpresa, normalizarPlaca, placaValida, resumirChecklist, situacaoVencimento,
  FONTES_KM, SITUACOES_VEICULO, STATUS_ORDEM, TIPOS_DOC_VEICULO, TIPOS_ORDEM, TIPOS_VEICULO,
} from "@bybus/core";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import type { Db } from "../db/cliente.js";
import {
  checklistItens, finCategorias, finLancamentos, unidades, usuarios, veiculos, veiculosAbastecimentos, veiculosChecklists, veiculosDocumentos,
  veiculosKm, veiculosOrdens, veiculosOrdensAnexos, veiculosPlanos,
} from "../db/schema.js";
import { podeUnidade } from "../seguranca/escopo.js";
import { pode, type Permissao } from "../seguranca/permissoes.js";
import { ErroHttp, exigir, type UsuarioSessao } from "../seguranca/sessao.js";
import {
  calcularAbastecimentos, calcularPlano, garantirItensChecklist, hojeSp, itensAtivos, motivosIndisponibilidade, reavaliarSituacao,
  registrarLeituraKm, situacaoOperacional,
} from "../servicos/frota.js";

const uuid = z.string().uuid();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");
const mesIso = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês no formato AAAA-MM");
const texto = (max: number) => z.string().trim().max(max);
const opcional = (max: number) => texto(max).nullish().transform((v) => v || null);
const naoEncontrado = (o: string) => new ErroHttp(404, "NAO_ENCONTRADO", `${o} não encontrado(a).`);

/** Escopo por praça: o veículo pertence a uma unidade. */
function escopoVeiculos(u: UsuarioSessao): SQL | undefined {
  if (u.todasUnidades) return undefined;
  if (u.unidadeIds.length === 0) return sql`false`;
  return inArray(veiculos.unidadeId, u.unidadeIds);
}

async function garantirVeiculo(db: Db, u: UsuarioSessao, id: string) {
  const [v] = await db.select().from(veiculos).where(eq(veiculos.id, id));
  if (!v || !podeUnidade(u, v.unidadeId)) throw naoEncontrado("Veículo");
  return v;
}

/** Id dos veículos que o usuário enxerga (opcionalmente de um só). */
async function idsVisiveis(db: Db, u: UsuarioSessao, veiculoId?: string) {
  const f = escopoVeiculos(u);
  const linhas = await db.select({ id: veiculos.id }).from(veiculos).where(and(f, veiculoId ? eq(veiculos.id, veiculoId) : undefined));
  return linhas.map((l) => l.id);
}

const corpoVeiculo = z.object({
  unidadeId: uuid,
  placa: z.string().trim().refine(placaValida, "Placa inválida (ex.: ABC1D23 ou ABC-1234)").transform(normalizarPlaca),
  apelido: opcional(60),
  tipo: z.enum(TIPOS_VEICULO),
  modelo: opcional(120),
  ano: z.number().int().min(1980).max(2100).nullish(),
  capacidade: z.number().int().min(1).max(200).nullish(),
  chassi: opcional(40),
  renavam: opcional(20),
  linhaPrincipal: opcional(120),
  usoPublicitario: z.boolean().default(false),
  situacao: z.enum(SITUACOES_VEICULO).default("ATIVO"),
  kmAtual: z.number().int().min(0).max(5_000_000).default(0),
  observacoes: opcional(500),
  /** Link da pasta do Google Drive com os gabaritos e outros arquivos do veículo. */
  driveLink: z.string().trim().max(500).nullish().transform((v) => v || null)
    .refine((v) => v === null || idDoDrive(v) !== null, "Cole o link de uma pasta ou arquivo do Google Drive."),
});

export async function rotasFrota(app: FastifyInstance, { db, config, cofre }: Contexto) {
  const ver = { preHandler: exigir(config, "frota:ver") };
  const gerenciar = { preHandler: exigir(config, "frota:gerenciar") };

  /** Qualquer uma das permissões (ex.: motorista só com frota:checklist). */
  const umaDe = (...permissoes: Permissao[]) => ({
    preHandler: async (req: FastifyRequest) => {
      await exigir(config)(req);
      if (!permissoes.some((p) => pode(req.usuario!, p))) throw new ErroHttp(403, "SEM_PERMISSAO", "Seu perfil não tem acesso a esta função.");
    },
  });

  // ---------- Veículos ----------
  app.get("/api/frota/veiculos", ver, async (req) => {
    const q = z.object({ unidadeId: uuid.optional(), situacao: z.enum(SITUACOES_VEICULO).optional() }).parse(req.query);
    const lista = await db.select({ v: veiculos, unidadeNome: unidades.nome }).from(veiculos).innerJoin(unidades, eq(unidades.id, veiculos.unidadeId))
      .where(and(escopoVeiculos(req.usuario!), q.unidadeId ? eq(veiculos.unidadeId, q.unidadeId) : undefined, q.situacao ? eq(veiculos.situacao, q.situacao) : undefined))
      .orderBy(asc(unidades.nome), asc(veiculos.placa));
    const hoje = hojeSp();
    const sit = await situacaoOperacional(db, lista.map((l) => l.v), hoje);
    return lista.map(({ v, unidadeNome }) => {
      const s = sit.get(v.id)!;
      return {
        ...v, unidadeNome, disponivel: s.disponivel, motivosBloqueio: s.motivos,
        documentosVencidos: s.documentos.filter((d) => situacaoVencimento(d.vencimento, hoje) === "VENCIDO").length,
        documentosAVencer: s.documentos.filter((d) => situacaoVencimento(d.vencimento, hoje) === "A_VENCER").length,
        manutencoesPendentes: s.planos.filter((p) => p.situacao === "VENCIDA" || p.situacao === "PROXIMA").length,
      };
    });
  });

  /**
   * Lista enxuta para escolher o veículo em outras telas (ex.: Saídas, onde `saidas.veiculo` continua sendo o texto da placa).
   * Traz a disponibilidade para a tela poder avisar ou bloquear quando houver motivo.
   */
  app.get("/api/frota/veiculos/opcoes", umaDe("frota:ver", "saidas:gerenciar", "escala:gerenciar", "frota:checklist"), async (req) => {
    const q = z.object({ unidadeId: uuid.optional() }).parse(req.query);
    const lista = await db.select().from(veiculos)
      .where(and(escopoVeiculos(req.usuario!), q.unidadeId ? eq(veiculos.unidadeId, q.unidadeId) : undefined, sql`${veiculos.situacao} <> 'INATIVO'`))
      .orderBy(asc(veiculos.placa));
    const sit = await situacaoOperacional(db, lista, hojeSp());
    return lista.map((v) => ({
      id: v.id, placa: v.placa, apelido: v.apelido, tipo: v.tipo, capacidade: v.capacidade, unidadeId: v.unidadeId,
      disponivel: sit.get(v.id)!.disponivel, motivosBloqueio: sit.get(v.id)!.motivos,
    }));
  });

  /** Disponibilidade de um veículo pela placa (para a escala/saída consultar e bloquear). */
  app.get("/api/frota/disponibilidade/:placa", umaDe("frota:ver", "saidas:gerenciar", "escala:gerenciar"), async (req) => {
    const { placa } = z.object({ placa: z.string().max(20) }).parse(req.params);
    const [v] = await db.select().from(veiculos).where(eq(veiculos.placa, normalizarPlaca(placa)));
    if (!v || !podeUnidade(req.usuario!, v.unidadeId)) throw naoEncontrado("Veículo");
    const motivos = (await motivosIndisponibilidade(db, v.placa, hojeSp()))!;
    return { placa: v.placa, disponivel: motivos.length === 0, motivosBloqueio: motivos };
  });

  app.get("/api/frota/veiculos/:id", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const v = await garantirVeiculo(db, req.usuario!, id);
    const s = (await situacaoOperacional(db, [v], hojeSp())).get(v.id)!;
    return { ...v, disponivel: s.disponivel, motivosBloqueio: s.motivos, documentos: s.documentos, planos: s.planos, ordensAbertas: s.ordensAbertas };
  });

  app.post("/api/frota/veiculos", gerenciar, async (req, reply) => {
    const c = corpoVeiculo.parse(req.body);
    if (!podeUnidade(req.usuario!, c.unidadeId)) throw new ErroHttp(403, "SEM_PERMISSAO", "Você não tem acesso a esta praça.");
    const [dup] = await db.select({ id: veiculos.id }).from(veiculos).where(eq(veiculos.placa, c.placa));
    if (dup) throw new ErroHttp(409, "PLACA_DUPLICADA", "Já existe um veículo com esta placa.");
    const [v] = await db.insert(veiculos).values(c).returning();
    // Leitura inicial: base para calcular o km rodado no mês.
    if (c.kmAtual > 0) await db.insert(veiculosKm).values({ veiculoId: v!.id, data: hojeSp(), km: c.kmAtual, fonte: "MANUAL", criadoPor: req.usuario!.id });
    await auditar(db, req, "VEICULO_CRIADO", { tipo: "veiculo", id: v!.id }, { placa: v!.placa, tipo: v!.tipo });
    reply.code(201);
    return v;
  });

  app.patch("/api/frota/veiculos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const atual = await garantirVeiculo(db, req.usuario!, id);
    const { kmAtual: _km, ...resto } = corpoVeiculo.partial().parse(req.body); // o km só muda por leitura (registrada e auditável)
    if (resto.unidadeId && !podeUnidade(req.usuario!, resto.unidadeId)) throw new ErroHttp(403, "SEM_PERMISSAO", "Você não tem acesso a esta praça.");
    if (resto.placa && resto.placa !== atual.placa) {
      const [dup] = await db.select({ id: veiculos.id }).from(veiculos).where(eq(veiculos.placa, resto.placa));
      if (dup) throw new ErroHttp(409, "PLACA_DUPLICADA", "Já existe um veículo com esta placa.");
    }
    const [v] = await db.update(veiculos).set({ ...resto, atualizadoEm: new Date() }).where(eq(veiculos.id, id)).returning();
    await auditar(db, req, "VEICULO_ALTERADO", { tipo: "veiculo", id }, { campos: Object.keys(resto), situacao: v!.situacao });
    return v;
  });

  // ---------- Arquivos do Drive (gabaritos e outros, 11/11/2026) ----------
  const arquivosDoVeiculo = async (u: UsuarioSessao, id: string) => {
    const v = await garantirVeiculo(db, u, id);
    const conta = contaDeServico(config);
    if (!v.driveLink) return { v, conta, lista: null };
    if (!conta) throw new ErroHttp(409, "GOOGLE_NAO_CONFIGURADO", "A leitura do Google ainda não foi configurada no servidor (ligar-google.sh).");
    try {
      return { v, conta, lista: await arquivosDoDrive(conta, idDoDrive(v.driveLink)!) };
    } catch (e) {
      if (e instanceof ErroGoogle) throw new ErroHttp(502, "GOOGLE_ERRO", e.message);
      throw e;
    }
  };

  app.get("/api/frota/veiculos/:id/drive", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { v, conta, lista } = await arquivosDoVeiculo(req.usuario!, id);
    return { link: v.driveLink, email: conta?.client_email ?? null, pasta: lista?.nome ?? null, itens: lista?.itens ?? [] };
  });

  /** Abre (ou baixa, com ?baixar=1) um arquivo da pasta do veículo. Só arquivos daquela pasta: o servidor confere na lista. */
  app.get("/api/frota/veiculos/:id/drive/:arquivoId", ver, async (req, reply) => {
    const { id, arquivoId } = z.object({ id: uuid, arquivoId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/) }).parse(req.params);
    const { baixar } = z.object({ baixar: z.string().optional() }).parse(req.query);
    const { conta, lista } = await arquivosDoVeiculo(req.usuario!, id);
    const item = lista?.itens.find((i) => i.id === arquivoId);
    if (!conta || !item) throw new ErroHttp(404, "NAO_ENCONTRADO", "Arquivo não encontrado na pasta deste veículo.");
    let arq;
    try { arq = await baixarDoDrive(conta, item); } catch (e) { if (e instanceof ErroGoogle) throw new ErroHttp(502, "GOOGLE_ERRO", e.message); throw e; }
    // Imagens e PDF abrem no navegador; o resto baixa. Nome do arquivo seguro para o cabeçalho.
    const exibir = !baixar && /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/.test(arq.tipo);
    const nome = arq.nome.replace(/[^\w.\- ()À-ú]/g, "_").slice(0, 150) || "arquivo";
    reply.header("Content-Type", exibir ? arq.tipo : "application/octet-stream")
      .header("Content-Disposition", `${exibir ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(nome)}`)
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, max-age=300");
    return reply.send(arq.dados);
  });

  // ---------- Documentos ----------
  const corpoDoc = z.object({
    veiculoId: uuid,
    tipo: z.enum(TIPOS_DOC_VEICULO),
    descricao: opcional(120),
    numero: opcional(60),
    vencimento: dataIso,
    observacao: opcional(300),
  });

  app.get("/api/frota/documentos", ver, async (req) => {
    const q = z.object({ veiculoId: uuid.optional(), situacao: z.enum(["VENCIDO", "A_VENCER", "EM_DIA"]).optional() }).parse(req.query);
    const ids = await idsVisiveis(db, req.usuario!, q.veiculoId);
    if (!ids.length) return [];
    const linhas = await db.select({ d: veiculosDocumentos, placa: veiculos.placa, apelido: veiculos.apelido }).from(veiculosDocumentos)
      .innerJoin(veiculos, eq(veiculos.id, veiculosDocumentos.veiculoId))
      .where(inArray(veiculosDocumentos.veiculoId, ids)).orderBy(asc(veiculosDocumentos.vencimento));
    const hoje = hojeSp();
    return linhas
      .map(({ d, placa, apelido }) => ({ ...d, placa, apelido, situacao: situacaoVencimento(d.vencimento, hoje), dias: diasEntre(hoje, d.vencimento) }))
      .filter((d) => !q.situacao || d.situacao === q.situacao);
  });

  app.post("/api/frota/documentos", gerenciar, async (req, reply) => {
    const c = corpoDoc.parse(req.body);
    await garantirVeiculo(db, req.usuario!, c.veiculoId);
    const [d] = await db.insert(veiculosDocumentos).values(c).returning();
    await auditar(db, req, "VEICULO_DOCUMENTO_CRIADO", { tipo: "veiculo_documento", id: d!.id }, { veiculoId: c.veiculoId, tipo: c.tipo, vencimento: c.vencimento });
    reply.code(201);
    return d;
  });

  app.patch("/api/frota/documentos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [atual] = await db.select().from(veiculosDocumentos).where(eq(veiculosDocumentos.id, id));
    if (!atual) throw naoEncontrado("Documento");
    await garantirVeiculo(db, req.usuario!, atual.veiculoId).catch(() => { throw naoEncontrado("Documento"); });
    const { veiculoId: _v, ...resto } = corpoDoc.partial().parse(req.body);
    const [d] = await db.update(veiculosDocumentos).set(resto).where(eq(veiculosDocumentos.id, id)).returning();
    await auditar(db, req, "VEICULO_DOCUMENTO_ALTERADO", { tipo: "veiculo_documento", id }, { campos: Object.keys(resto), vencimento: d!.vencimento });
    return d;
  });

  app.delete("/api/frota/documentos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [atual] = await db.select().from(veiculosDocumentos).where(eq(veiculosDocumentos.id, id));
    if (!atual) throw naoEncontrado("Documento");
    await garantirVeiculo(db, req.usuario!, atual.veiculoId).catch(() => { throw naoEncontrado("Documento"); });
    await db.delete(veiculosDocumentos).where(eq(veiculosDocumentos.id, id));
    await auditar(db, req, "VEICULO_DOCUMENTO_EXCLUIDO", { tipo: "veiculo_documento", id }, { veiculoId: atual.veiculoId, tipo: atual.tipo });
    return { ok: true };
  });

  // ---------- Planos de manutenção preventiva ----------
  const corpoPlano = z.object({
    veiculoId: uuid,
    nome: texto(120).min(2),
    intervaloKm: z.number().int().min(100).max(1_000_000).nullish(),
    intervaloDias: z.number().int().min(1).max(3650).nullish(),
    ultimoKm: z.number().int().min(0).max(5_000_000).nullish(),
    ultimaData: dataIso.nullish(),
    critico: z.boolean().default(false),
    ativo: z.boolean().default(true),
  });
  const temIntervalo = (p: { intervaloKm?: number | null; intervaloDias?: number | null }) => !!p.intervaloKm || !!p.intervaloDias;

  app.get("/api/frota/planos", ver, async (req) => {
    const q = z.object({ veiculoId: uuid.optional(), situacao: z.enum(["EM_DIA", "PROXIMA", "VENCIDA", "SEM_BASE"]).optional() }).parse(req.query);
    const f = escopoVeiculos(req.usuario!);
    const linhas = await db.select({ p: veiculosPlanos, v: veiculos }).from(veiculosPlanos).innerJoin(veiculos, eq(veiculos.id, veiculosPlanos.veiculoId))
      .where(and(f, q.veiculoId ? eq(veiculosPlanos.veiculoId, q.veiculoId) : undefined)).orderBy(asc(veiculos.placa), asc(veiculosPlanos.nome));
    const hoje = hojeSp();
    return linhas
      .map(({ p, v }) => ({ ...calcularPlano(p, v.kmAtual, hoje), placa: v.placa, apelido: v.apelido, kmAtual: v.kmAtual }))
      .filter((p) => !q.situacao || p.situacao === q.situacao);
  });

  app.post("/api/frota/planos", gerenciar, async (req, reply) => {
    const c = corpoPlano.parse(req.body);
    if (!temIntervalo(c)) throw new ErroHttp(400, "SEM_INTERVALO", "Informe o intervalo em km, em dias ou os dois.");
    await garantirVeiculo(db, req.usuario!, c.veiculoId);
    const [p] = await db.insert(veiculosPlanos).values(c).returning();
    await auditar(db, req, "VEICULO_PLANO_CRIADO", { tipo: "veiculo_plano", id: p!.id }, { veiculoId: c.veiculoId, nome: c.nome });
    reply.code(201);
    return p;
  });

  app.patch("/api/frota/planos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [atual] = await db.select().from(veiculosPlanos).where(eq(veiculosPlanos.id, id));
    if (!atual) throw naoEncontrado("Plano");
    await garantirVeiculo(db, req.usuario!, atual.veiculoId).catch(() => { throw naoEncontrado("Plano"); });
    const { veiculoId: _v, ...resto } = corpoPlano.partial().parse(req.body);
    if (!temIntervalo({ intervaloKm: resto.intervaloKm === undefined ? atual.intervaloKm : resto.intervaloKm, intervaloDias: resto.intervaloDias === undefined ? atual.intervaloDias : resto.intervaloDias })) {
      throw new ErroHttp(400, "SEM_INTERVALO", "Informe o intervalo em km, em dias ou os dois.");
    }
    const [p] = await db.update(veiculosPlanos).set(resto).where(eq(veiculosPlanos.id, id)).returning();
    await auditar(db, req, "VEICULO_PLANO_ALTERADO", { tipo: "veiculo_plano", id }, { campos: Object.keys(resto) });
    return p;
  });

  // ---------- Ordens de manutenção ----------
  const corpoOrdem = z.object({
    veiculoId: uuid,
    planoId: uuid.nullish(),
    tipo: z.enum(TIPOS_ORDEM),
    // Descrição longa do serviço (dono, 13/11/2026: mais de 10 linhas).
    descricao: texto(5000).min(3),
    oficina: opcional(120),
    pecas: opcional(2000),
    imobiliza: z.boolean().default(false),
    abertaEm: dataIso.optional(),
    km: z.number().int().min(0).max(5_000_000).nullish(),
    kmRevisao: z.number().int().min(0).max(5_000_000).nullish(),
    valorPecasCentavos: z.number().int().min(0).max(100_000_000).default(0),
    valorServicoCentavos: z.number().int().min(0).max(100_000_000).default(0),
    custoCentavos: z.number().int().min(0).max(100_000_000).default(0),
  });
  /** Custo total = peças + serviço quando um deles foi informado; senão, o custo digitado. */
  const comCusto = <T extends { valorPecasCentavos?: number; valorServicoCentavos?: number; custoCentavos?: number }>(c: T, atual?: { valorPecasCentavos: number; valorServicoCentavos: number }) => {
    const pecas = c.valorPecasCentavos ?? atual?.valorPecasCentavos ?? 0;
    const servico = c.valorServicoCentavos ?? atual?.valorServicoCentavos ?? 0;
    return pecas + servico > 0 && (c.valorPecasCentavos !== undefined || c.valorServicoCentavos !== undefined) ? { ...c, custoCentavos: pecas + servico } : c;
  };

  app.get("/api/frota/ordens", ver, async (req) => {
    const q = z.object({ veiculoId: uuid.optional(), status: z.enum(STATUS_ORDEM).optional(), tipo: z.enum(TIPOS_ORDEM).optional() }).parse(req.query);
    const linhas = await db.select({ o: veiculosOrdens, placa: veiculos.placa, apelido: veiculos.apelido }).from(veiculosOrdens).innerJoin(veiculos, eq(veiculos.id, veiculosOrdens.veiculoId))
      .where(and(escopoVeiculos(req.usuario!), q.veiculoId ? eq(veiculosOrdens.veiculoId, q.veiculoId) : undefined, q.status ? eq(veiculosOrdens.status, q.status) : undefined, q.tipo ? eq(veiculosOrdens.tipo, q.tipo) : undefined))
      .orderBy(desc(veiculosOrdens.abertaEm), desc(veiculosOrdens.criadoEm)).limit(300);
    const hoje = hojeSp();
    const anexos = linhas.length ? await db.select({ id: veiculosOrdensAnexos.id, ordemId: veiculosOrdensAnexos.ordemId, tipo: veiculosOrdensAnexos.tipo, nomeArquivo: veiculosOrdensAnexos.nomeArquivo, tamanho: veiculosOrdensAnexos.tamanho })
      .from(veiculosOrdensAnexos).where(inArray(veiculosOrdensAnexos.ordemId, linhas.map((l) => l.o.id))) : [];
    return linhas.map(({ o, placa, apelido }) => ({
      ...o, placa, apelido, anexos: anexos.filter((a) => a.ordemId === o.id),
      diasParado: o.status === "CANCELADA" ? null : diasEntre(o.abertaEm, o.concluidaEm ?? hoje),
    }));
  });

  app.post("/api/frota/ordens", gerenciar, async (req, reply) => {
    const c = corpoOrdem.parse(req.body);
    const v = await garantirVeiculo(db, req.usuario!, c.veiculoId);
    if (c.planoId) {
      const [pl] = await db.select({ veiculoId: veiculosPlanos.veiculoId }).from(veiculosPlanos).where(eq(veiculosPlanos.id, c.planoId));
      if (!pl || pl.veiculoId !== v.id) throw new ErroHttp(400, "PLANO_INVALIDO", "O plano não pertence a este veículo.");
    }
    const [o] = await db.insert(veiculosOrdens).values({ ...comCusto(c), abertaEm: c.abertaEm ?? hojeSp(), criadoPor: req.usuario!.id }).returning();
    if (c.imobiliza) await reavaliarSituacao(db, v.id);
    await auditar(db, req, "VEICULO_ORDEM_ABERTA", { tipo: "veiculo_ordem", id: o!.id }, { veiculoId: v.id, tipo: c.tipo, imobiliza: c.imobiliza });
    reply.code(201);
    return o;
  });

  app.patch("/api/frota/ordens/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [atual] = await db.select().from(veiculosOrdens).where(eq(veiculosOrdens.id, id));
    if (!atual) throw naoEncontrado("Ordem");
    const v = await garantirVeiculo(db, req.usuario!, atual.veiculoId).catch(() => { throw naoEncontrado("Ordem"); });
    if (atual.status === "CONCLUIDA" || atual.status === "CANCELADA") throw new ErroHttp(409, "ORDEM_ENCERRADA", "Ordem já encerrada; não pode mais ser alterada.");
    const { veiculoId: _v, planoId: _p, tipo: _t, ...resto } = corpoOrdem.partial().extend({ status: z.enum(STATUS_ORDEM).optional(), concluidaEm: dataIso.optional() }).parse(req.body);
    const hoje = hojeSp();
    const encerrando = resto.status === "CONCLUIDA" || resto.status === "CANCELADA";
    const concluidaEm = encerrando ? (resto.concluidaEm ?? hoje) : undefined;
    if (concluidaEm && concluidaEm < (resto.abertaEm ?? atual.abertaEm)) throw new ErroHttp(400, "DATA_INVALIDA", "A conclusão não pode ser anterior à abertura.");
    const { concluidaEm: _c, ...campos } = resto;
    const [o] = await db.update(veiculosOrdens).set({ ...comCusto(campos, atual), ...(concluidaEm ? { concluidaEm } : {}) }).where(eq(veiculosOrdens.id, id)).returning();
    if (resto.status === "CONCLUIDA") {
      const km = o!.km ?? v.kmAtual;
      if (o!.km != null) await registrarLeituraKm(db, { veiculoId: v.id, km: o!.km, data: concluidaEm!, fonte: "ORDEM", usuarioId: req.usuario!.id });
      if (atual.planoId && atual.tipo === "PREVENTIVA") await db.update(veiculosPlanos).set({ ultimoKm: Math.max(km, 0), ultimaData: concluidaEm! }).where(eq(veiculosPlanos.id, atual.planoId));
    }
    await reavaliarSituacao(db, v.id);
    await auditar(db, req, "VEICULO_ORDEM_ALTERADA", { tipo: "veiculo_ordem", id }, { status: o!.status, custoCentavos: o!.custoCentavos });
    return o;
  });

  // ---------- Anexos da ordem: OS, NF de peças, NFS-e (13/11/2026) ----------
  const ordemDoUsuario = async (u: UsuarioSessao, id: string) => {
    const [o] = await db.select().from(veiculosOrdens).where(eq(veiculosOrdens.id, id));
    if (!o) throw naoEncontrado("Ordem");
    await garantirVeiculo(db, u, o.veiculoId).catch(() => { throw naoEncontrado("Ordem"); });
    return o;
  };
  app.post("/api/frota/ordens/:id/anexos", { ...gerenciar, bodyLimit: 22 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ tipo: z.enum(["OS", "NF", "NFSE", "OUTRO"]), nome: z.string().trim().min(1).max(160), base64: z.string().min(8) }).parse(req.body);
    await ordemDoUsuario(req.usuario!, id);
    const bytes = Buffer.from(b.base64, "base64");
    if (bytes.length > DOCUMENTO_MAX_BYTES) throw new ErroHttp(400, "ARQUIVO_GRANDE", "O arquivo pode ter até 15 MB.");
    const nome = b.nome.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
    // PDF, imagens, Word/Excel e o XML da nota fiscal.
    const ehXml = /\.xml$/i.test(nome) && /^\s*</.test(bytes.subarray(0, 200).toString("utf8").replace(/^\uFEFF/, ""));
    const mime = tipoDocumentoEmpresa(bytes, nome) ?? (ehXml ? "application/xml" : null);
    if (!mime) throw new ErroHttp(400, "ARQUIVO_TIPO", "Envie PDF, JPG, PNG, o XML da nota ou documento do Word/Excel.");
    const [a] = await db.insert(veiculosOrdensAnexos).values({ ordemId: id, tipo: b.tipo, nomeArquivo: nome, mime, tamanho: bytes.length, dadosCifrados: cofre.cifrar(bytes.toString("base64")), enviadoPor: req.usuario!.id }).returning({ id: veiculosOrdensAnexos.id });
    await auditar(db, req, "VEICULO_ORDEM_ANEXO", { tipo: "veiculo_ordem", id }, { anexoId: a!.id, tipoAnexo: b.tipo, tamanho: bytes.length });
    reply.code(201);
    return { id: a!.id };
  });
  app.get("/api/frota/anexos/:id", ver, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { baixar } = z.object({ baixar: z.string().optional() }).parse(req.query);
    const [a] = await db.select().from(veiculosOrdensAnexos).where(eq(veiculosOrdensAnexos.id, id));
    if (!a) throw naoEncontrado("Anexo");
    await ordemDoUsuario(req.usuario!, a.ordemId).catch(() => { throw naoEncontrado("Anexo"); });
    const bytes = Buffer.from(cofre.decifrar(a.dadosCifrados), "base64");
    const exibir = !baixar && /^(application\/pdf|image\/(jpeg|png))$/.test(a.mime);
    return reply.header("Content-Type", a.mime).header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `${exibir ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.nomeArquivo)}`).send(bytes);
  });
  app.delete("/api/frota/anexos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [a] = await db.select().from(veiculosOrdensAnexos).where(eq(veiculosOrdensAnexos.id, id));
    if (!a) throw naoEncontrado("Anexo");
    await ordemDoUsuario(req.usuario!, a.ordemId).catch(() => { throw naoEncontrado("Anexo"); });
    await db.delete(veiculosOrdensAnexos).where(eq(veiculosOrdensAnexos.id, id));
    await auditar(db, req, "VEICULO_ORDEM_ANEXO_EXCLUIDO", { tipo: "veiculo_ordem", id: a.ordemId }, { anexoId: id, tipoAnexo: a.tipo });
    return { ok: true };
  });

  // ---------- Abastecimentos ----------
  const corpoAbast = z.object({
    veiculoId: uuid,
    data: dataIso,
    km: z.number().int().min(0).max(5_000_000),
    litros: z.number().positive().max(2000),
    valorCentavos: z.number().int().min(0).max(100_000_000),
    posto: opcional(120),
    tanqueCheio: z.boolean().default(true),
  });

  app.get("/api/frota/abastecimentos", ver, async (req) => {
    const q = z.object({ veiculoId: uuid.optional(), de: dataIso.optional(), ate: dataIso.optional() }).parse(req.query);
    const ids = await idsVisiveis(db, req.usuario!, q.veiculoId);
    if (!ids.length) return { itens: [], resumo: [] };
    const todos = await db.select().from(veiculosAbastecimentos).where(inArray(veiculosAbastecimentos.veiculoId, ids));
    const calc = calcularAbastecimentos(todos);
    const veics = await db.select({ id: veiculos.id, placa: veiculos.placa, apelido: veiculos.apelido }).from(veiculos).where(inArray(veiculos.id, ids));
    const rotulo = new Map(veics.map((v) => [v.id, v]));
    const filtrados = calc.filter((a) => (!q.de || a.data >= q.de) && (!q.ate || a.data <= q.ate));
    const itens = filtrados.sort((a, b) => b.data.localeCompare(a.data) || b.km - a.km).slice(0, 300)
      .map((a) => ({ ...a, placa: rotulo.get(a.veiculoId)?.placa ?? "", apelido: rotulo.get(a.veiculoId)?.apelido ?? null }));
    const resumo = veics.map((v) => {
      const meus = filtrados.filter((a) => a.veiculoId === v.id);
      const kmls = meus.map((a) => a.kml).filter((x): x is number => x != null);
      return {
        veiculoId: v.id, placa: v.placa, apelido: v.apelido,
        litros: Math.round(meus.reduce((s, a) => s + a.litros, 0) * 100) / 100,
        valorCentavos: meus.reduce((s, a) => s + a.valorCentavos, 0),
        mediaKml: kmls.length ? Math.round((kmls.reduce((s, x) => s + x, 0) / kmls.length) * 100) / 100 : null,
        alertas: meus.filter((a) => a.alerta).length,
      };
    }).filter((r) => r.litros > 0);
    return { itens, resumo };
  });

  app.post("/api/frota/abastecimentos", gerenciar, async (req, reply) => {
    const c = corpoAbast.parse(req.body);
    await garantirVeiculo(db, req.usuario!, c.veiculoId);
    const [dup] = await db.select({ id: veiculosAbastecimentos.id }).from(veiculosAbastecimentos).where(and(eq(veiculosAbastecimentos.veiculoId, c.veiculoId), eq(veiculosAbastecimentos.km, c.km)));
    if (dup) throw new ErroHttp(409, "KM_REPETIDO", "Já existe um abastecimento deste veículo com este km.");
    const [a] = await db.insert(veiculosAbastecimentos).values({ ...c, criadoPor: req.usuario!.id }).returning();
    await registrarLeituraKm(db, { veiculoId: c.veiculoId, km: c.km, data: c.data, fonte: "ABASTECIMENTO", usuarioId: req.usuario!.id });
    const todos = await db.select().from(veiculosAbastecimentos).where(eq(veiculosAbastecimentos.veiculoId, c.veiculoId));
    const calculado = calcularAbastecimentos(todos).find((x) => x.id === a!.id)!;
    await auditar(db, req, "VEICULO_ABASTECIMENTO_CRIADO", { tipo: "veiculo_abastecimento", id: a!.id }, { veiculoId: c.veiculoId, litros: c.litros, valorCentavos: c.valorCentavos });
    reply.code(201);
    return calculado;
  });

  app.delete("/api/frota/abastecimentos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [a] = await db.select().from(veiculosAbastecimentos).where(eq(veiculosAbastecimentos.id, id));
    if (!a) throw naoEncontrado("Abastecimento");
    await garantirVeiculo(db, req.usuario!, a.veiculoId).catch(() => { throw naoEncontrado("Abastecimento"); });
    await db.delete(veiculosAbastecimentos).where(eq(veiculosAbastecimentos.id, id));
    await auditar(db, req, "VEICULO_ABASTECIMENTO_EXCLUIDO", { tipo: "veiculo_abastecimento", id }, { veiculoId: a.veiculoId, litros: a.litros });
    return { ok: true };
  });

  // ---------- Leituras de km ----------
  app.get("/api/frota/leituras-km", ver, async (req) => {
    const q = z.object({ veiculoId: uuid.optional() }).parse(req.query);
    const linhas = await db.select({ l: veiculosKm, placa: veiculos.placa }).from(veiculosKm).innerJoin(veiculos, eq(veiculos.id, veiculosKm.veiculoId))
      .where(and(escopoVeiculos(req.usuario!), q.veiculoId ? eq(veiculosKm.veiculoId, q.veiculoId) : undefined))
      .orderBy(desc(veiculosKm.data), desc(veiculosKm.km)).limit(200);
    return linhas.map(({ l, placa }) => ({ ...l, placa }));
  });

  /** Leitura manual. A integração com o rastreador (Khronos) usará `registrarLeituraKm` com fonte KHRONOS (ver docs). */
  app.post("/api/frota/leituras-km", gerenciar, async (req, reply) => {
    const c = z.object({ veiculoId: uuid, km: z.number().int().min(0).max(5_000_000), data: dataIso.optional(), fonte: z.enum(FONTES_KM).default("MANUAL") }).parse(req.body);
    if (c.fonte === "KHRONOS") throw new ErroHttp(400, "FONTE_RESERVADA", "A fonte Khronos é reservada para a integração automática com o rastreador.");
    await garantirVeiculo(db, req.usuario!, c.veiculoId);
    const r = await registrarLeituraKm(db, { veiculoId: c.veiculoId, km: c.km, data: c.data ?? hojeSp(), fonte: c.fonte, usuarioId: req.usuario!.id, estrito: true });
    await auditar(db, req, "VEICULO_KM_REGISTRADO", { tipo: "veiculo", id: c.veiculoId }, { km: c.km, fonte: c.fonte });
    reply.code(201);
    return r;
  });

  // ---------- Checklist diário ----------
  const leituraChecklist = umaDe("frota:checklist", "frota:ver");

  app.get("/api/frota/checklist/itens", leituraChecklist, async (req) => {
    await garantirItensChecklist(db);
    const { todos } = z.object({ todos: z.enum(["true", "false"]).optional() }).parse(req.query);
    if (todos === "true" && pode(req.usuario!, "frota:gerenciar")) return db.select().from(checklistItens).orderBy(asc(checklistItens.ordem), asc(checklistItens.descricao));
    return itensAtivos(db);
  });

  const corpoItem = z.object({ grupo: texto(60).min(2), descricao: texto(200).min(3), critico: z.boolean().default(false), ordem: z.number().int().min(0).max(100_000).optional(), ativo: z.boolean().default(true) });

  app.post("/api/frota/checklist/itens", gerenciar, async (req, reply) => {
    await garantirItensChecklist(db);
    const c = corpoItem.parse(req.body);
    const [{ max } = { max: 0 }] = await db.select({ max: sql<number>`coalesce(max(${checklistItens.ordem}), 0)::int` }).from(checklistItens);
    const [i] = await db.insert(checklistItens).values({ ...c, ordem: c.ordem ?? max + 10 }).returning();
    await auditar(db, req, "CHECKLIST_ITEM_CRIADO", { tipo: "checklist_item", id: i!.id }, { critico: c.critico });
    reply.code(201);
    return i;
  });

  app.patch("/api/frota/checklist/itens/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = corpoItem.partial().parse(req.body);
    const [i] = await db.update(checklistItens).set(c).where(eq(checklistItens.id, id)).returning();
    if (!i) throw naoEncontrado("Item");
    await auditar(db, req, "CHECKLIST_ITEM_ALTERADO", { tipo: "checklist_item", id }, { campos: Object.keys(c) });
    return i;
  });

  /** Veículos que o usuário pode inspecionar hoje e se o checklist do dia já foi feito. */
  app.get("/api/frota/checklist/veiculos", leituraChecklist, async (req) => {
    const hoje = hojeSp();
    const lista = await db.select().from(veiculos).where(and(escopoVeiculos(req.usuario!), sql`${veiculos.situacao} <> 'INATIVO'`)).orderBy(asc(veiculos.placa));
    const feitos = lista.length ? await db.select({ veiculoId: veiculosChecklists.veiculoId, aprovado: veiculosChecklists.aprovado }).from(veiculosChecklists)
      .where(and(inArray(veiculosChecklists.veiculoId, lista.map((v) => v.id)), eq(veiculosChecklists.data, hoje))) : [];
    return lista.map((v) => {
      const meus = feitos.filter((f) => f.veiculoId === v.id);
      return { id: v.id, placa: v.placa, apelido: v.apelido, tipo: v.tipo, kmAtual: v.kmAtual, situacao: v.situacao, feitoHoje: meus.length > 0, aprovadoHoje: meus.length ? meus.every((f) => f.aprovado) : null };
    });
  });

  app.get("/api/frota/checklists", ver, async (req) => {
    const q = z.object({ veiculoId: uuid.optional(), de: dataIso.optional(), ate: dataIso.optional(), somenteProblemas: z.enum(["true", "false"]).optional() }).parse(req.query);
    const linhas = await db.select({ c: veiculosChecklists, placa: veiculos.placa, apelido: veiculos.apelido, motorista: usuarios.nome }).from(veiculosChecklists)
      .innerJoin(veiculos, eq(veiculos.id, veiculosChecklists.veiculoId)).leftJoin(usuarios, eq(usuarios.id, veiculosChecklists.usuarioId))
      .where(and(escopoVeiculos(req.usuario!), q.veiculoId ? eq(veiculosChecklists.veiculoId, q.veiculoId) : undefined,
        q.de ? gte(veiculosChecklists.data, q.de) : undefined, q.ate ? lte(veiculosChecklists.data, q.ate) : undefined,
        q.somenteProblemas === "true" ? sql`exists (select 1 from jsonb_array_elements(${veiculosChecklists.respostas}) r where (r->>'ok')::boolean = false)` : undefined))
      .orderBy(desc(veiculosChecklists.data), desc(veiculosChecklists.criadoEm)).limit(200);
    return linhas.map(({ c, placa, apelido, motorista }) => ({ ...c, placa, apelido, motorista, resumo: resumirChecklist(c.respostas) }));
  });

  app.post("/api/frota/checklists", umaDe("frota:checklist"), async (req, reply) => {
    const c = z.object({
      veiculoId: uuid,
      km: z.number().int().min(0).max(5_000_000).nullish(),
      observacao: opcional(500),
      respostas: z.array(z.object({ itemId: uuid, ok: z.boolean(), observacao: opcional(300) })).min(1).max(200),
    }).parse(req.body);
    const v = await garantirVeiculo(db, req.usuario!, c.veiculoId);
    if (v.situacao === "INATIVO") throw new ErroHttp(409, "VEICULO_INATIVO", "Este veículo está inativo.");
    await garantirItensChecklist(db);
    const itens = await itensAtivos(db);
    const porId = new Map(itens.map((i) => [i.id, i]));
    const enviados = new Set(c.respostas.map((r) => r.itemId));
    if (enviados.size !== c.respostas.length || c.respostas.some((r) => !porId.has(r.itemId))) throw new ErroHttp(400, "ITENS_INVALIDOS", "Há itens repetidos ou que não existem mais no checklist. Atualize a tela.");
    const faltando = itens.filter((i) => !enviados.has(i.id));
    if (faltando.length) throw new ErroHttp(400, "ITENS_FALTANDO", `Responda todos os itens (faltam ${faltando.length}).`);
    const semObs = c.respostas.find((r) => !r.ok && !(r.observacao && r.observacao.length >= 3));
    if (semObs) throw new ErroHttp(400, "OBSERVACAO_OBRIGATORIA", `Descreva o problema do item "${porId.get(semObs.itemId)!.descricao}".`);

    const hoje = hojeSp();
    if (c.km != null) await registrarLeituraKm(db, { veiculoId: v.id, km: c.km, data: hoje, fonte: "CHECKLIST", usuarioId: req.usuario!.id, estrito: true });
    const respostas = itens.map((i) => {
      const r = c.respostas.find((x) => x.itemId === i.id)!;
      return { itemId: i.id, grupo: i.grupo, descricao: i.descricao, critico: i.critico, ok: r.ok, observacao: r.ok ? null : r.observacao ?? null };
    });
    const resumo = resumirChecklist(respostas);

    // Problema em item de segurança: abre ordem corretiva que imobiliza o veículo até a equipe liberar.
    let ordemId: string | null = null;
    if (!resumo.aprovado) {
      const criticos = respostas.filter((r) => !r.ok && r.critico).map((r) => `${r.descricao}${r.observacao ? ` (${r.observacao})` : ""}`);
      const [o] = await db.insert(veiculosOrdens).values({
        veiculoId: v.id, tipo: "CORRETIVA", status: "ABERTA", imobiliza: true, abertaEm: hoje, km: c.km ?? null,
        descricao: `Checklist do motorista reprovado: ${criticos.join("; ")}`.slice(0, 500), criadoPor: req.usuario!.id,
      }).returning({ id: veiculosOrdens.id });
      ordemId = o!.id;
      await reavaliarSituacao(db, v.id);
    }
    const [salvo] = await db.insert(veiculosChecklists).values({ veiculoId: v.id, data: hoje, usuarioId: req.usuario!.id, km: c.km ?? null, aprovado: resumo.aprovado, observacao: c.observacao, respostas, ordemId }).returning();
    await auditar(db, req, "VEICULO_CHECKLIST_REGISTRADO", { tipo: "veiculo_checklist", id: salvo!.id }, { veiculoId: v.id, aprovado: resumo.aprovado, naoOk: resumo.naoOk, ordemId });
    reply.code(201);
    return { id: salvo!.id, aprovado: resumo.aprovado, resumo, ordemId, veiculoBloqueado: !resumo.aprovado };
  });

  // ---------- Painel ----------
  app.get("/api/frota/painel", ver, async (req) => {
    const q = z.object({ mes: mesIso.optional() }).parse(req.query);
    const hoje = hojeSp();
    const mes = q.mes ?? hoje.slice(0, 7);
    const inicio = `${mes}-01`;
    const proximoMes = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5)), 1)).toISOString().slice(0, 10);
    const fim = new Date(Date.parse(`${proximoMes}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

    const lista = await db.select().from(veiculos).where(escopoVeiculos(req.usuario!)).orderBy(asc(veiculos.placa));
    const ids = lista.map((v) => v.id);
    const sit = await situacaoOperacional(db, lista, hoje);
    const emOperacao = lista.filter((v) => v.situacao !== "INATIVO");
    const disponiveis = emOperacao.filter((v) => sit.get(v.id)!.disponivel);

    const rotulo = (id: string) => { const v = lista.find((x) => x.id === id)!; return { veiculoId: id, placa: v.placa, apelido: v.apelido }; };
    const vencimentos = [...sit.entries()].flatMap(([id, s]) => s.documentos.map((d) => ({ ...rotulo(id), documentoId: d.id, tipo: d.tipo, descricao: d.descricao, vencimento: d.vencimento, situacao: situacaoVencimento(d.vencimento, hoje), dias: diasEntre(hoje, d.vencimento) })))
      .filter((d) => d.situacao !== "EM_DIA").sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const manutencoes = [...sit.entries()].flatMap(([id, s]) => s.planos.filter((p) => p.situacao === "VENCIDA" || p.situacao === "PROXIMA")
      .map((p) => ({ ...rotulo(id), planoId: p.id, nome: p.nome, critico: p.critico, situacao: p.situacao, kmRestante: p.kmRestante, diasRestantes: p.diasRestantes })))
      .sort((a, b) => (a.situacao === b.situacao ? 0 : a.situacao === "VENCIDA" ? -1 : 1));

    const [ordens, abast, kms, checklistsHoje] = ids.length ? await Promise.all([
      db.select().from(veiculosOrdens).where(and(inArray(veiculosOrdens.veiculoId, ids), eq(veiculosOrdens.status, "CONCLUIDA"), gte(veiculosOrdens.concluidaEm, inicio), lte(veiculosOrdens.concluidaEm, fim))),
      db.select().from(veiculosAbastecimentos).where(inArray(veiculosAbastecimentos.veiculoId, ids)),
      db.select({ veiculoId: veiculosKm.veiculoId, data: veiculosKm.data, km: veiculosKm.km }).from(veiculosKm).where(and(inArray(veiculosKm.veiculoId, ids), lte(veiculosKm.data, fim))),
      db.select({ veiculoId: veiculosChecklists.veiculoId, aprovado: veiculosChecklists.aprovado }).from(veiculosChecklists).where(and(inArray(veiculosChecklists.veiculoId, ids), eq(veiculosChecklists.data, hoje))),
    ]) : [[], [], [], []];
    // Custos lançados no financeiro (grupos Frota e Posto) com a placa do veículo: só para quem pode ver o financeiro.
    const placaChave = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const verFinanceiro = pode(req.usuario!, "financeiro:ver") || pode(req.usuario!, "financeiro:gerenciar");
    const lancFin = verFinanceiro && ids.length
      ? await db.select({ veiculo: finLancamentos.veiculo, valor: sql<number>`coalesce(${finLancamentos.valorPagoCentavos}, ${finLancamentos.valorCentavos})`.mapWith(Number) })
        .from(finLancamentos).innerJoin(finCategorias, eq(finCategorias.id, finLancamentos.categoriaId))
        .where(and(eq(finLancamentos.tipo, "PAGAR"), inArray(finCategorias.grupo, [...GRUPOS_CUSTO_VEICULO]), isNotNull(finLancamentos.veiculo), gte(finLancamentos.competencia, inicio), lte(finLancamentos.competencia, fim)))
      : [];
    const calcAbast = calcularAbastecimentos(abast);
    const abastMes = calcAbast.filter((a) => a.data >= inicio && a.data <= fim);

    const custos = lista.map((v) => {
      const manutencao = ordens.filter((o) => o.veiculoId === v.id).reduce((s, o) => s + o.custoCentavos, 0);
      const combustivel = abastMes.filter((a) => a.veiculoId === v.id).reduce((s, a) => s + a.valorCentavos, 0);
      const meusKm = kms.filter((k) => k.veiculoId === v.id);
      const fimKm = meusKm.length ? Math.max(...meusKm.map((k) => k.km)) : null;
      const antes = meusKm.filter((k) => k.data < inicio).map((k) => k.km);
      const noMes = meusKm.filter((k) => k.data >= inicio).map((k) => k.km);
      const iniKm = antes.length ? Math.max(...antes) : noMes.length ? Math.min(...noMes) : null;
      const kmRodados = fimKm != null && iniKm != null && fimKm > iniKm ? fimKm - iniKm : 0;
      const financeiro = lancFin.filter((x) => x.veiculo && placaChave(x.veiculo) === placaChave(v.placa)).reduce((s, x) => s + x.valor, 0);
      const total = manutencao + combustivel + financeiro;
      return { ...rotulo(v.id), manutencaoCentavos: manutencao, combustivelCentavos: combustivel, financeiroCentavos: financeiro, totalCentavos: total, kmRodados, custoPorKmCentavos: kmRodados > 0 ? Math.round(total / kmRodados) : null };
    }).filter((c) => c.totalCentavos > 0 || c.kmRodados > 0);

    const litrosMes = abastMes.reduce((s, a) => s + a.litros, 0);
    const kmls = abastMes.map((a) => a.kml).filter((x): x is number => x != null);
    const trintaDias = new Date(Date.parse(`${hoje}T12:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);

    return {
      mes,
      disponibilidade: {
        total: emOperacao.length, disponiveis: disponiveis.length,
        percentual: emOperacao.length ? Math.round((disponiveis.length / emOperacao.length) * 100) : null,
        indisponiveis: emOperacao.filter((v) => !sit.get(v.id)!.disponivel).map((v) => ({ ...rotulo(v.id), motivos: sit.get(v.id)!.motivos })),
      },
      vencimentos: vencimentos.slice(0, 15),
      vencimentosTotais: { vencidos: vencimentos.filter((d) => d.situacao === "VENCIDO").length, aVencer: vencimentos.filter((d) => d.situacao === "A_VENCER").length },
      manutencoes: manutencoes.slice(0, 15),
      ordensAbertas: ids.length ? (await db.select({ n: sql<number>`count(*)::int` }).from(veiculosOrdens).where(and(inArray(veiculosOrdens.veiculoId, ids), inArray(veiculosOrdens.status, ["ABERTA", "EM_ANDAMENTO"]))))[0]!.n : 0,
      checklist: {
        pendentesHoje: emOperacao.filter((v) => v.situacao === "ATIVO" && !checklistsHoje.some((c) => c.veiculoId === v.id)).map((v) => rotulo(v.id)),
        reprovadosHoje: checklistsHoje.filter((c) => !c.aprovado).length,
      },
      custos,
      totais: {
        manutencaoCentavos: custos.reduce((s, c) => s + c.manutencaoCentavos, 0),
        combustivelCentavos: custos.reduce((s, c) => s + c.combustivelCentavos, 0),
        financeiroCentavos: custos.reduce((s, c) => s + c.financeiroCentavos, 0),
        litros: Math.round(litrosMes * 100) / 100,
        mediaKml: kmls.length ? Math.round((kmls.reduce((s, x) => s + x, 0) / kmls.length) * 100) / 100 : null,
      },
      alertasConsumo: calcAbast.filter((a) => a.alerta && a.data >= trintaDias).map((a) => ({ ...rotulo(a.veiculoId), abastecimentoId: a.id, data: a.data, kml: a.kml, alerta: a.alerta })).slice(0, 10),
    };
  });
}
