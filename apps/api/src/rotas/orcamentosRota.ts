import { and, desc, eq, ilike, isNotNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  TABELA_VAZIA, VEICULOS_ORCAMENTO, cargaHorariaMin, distanciaKm, montarOrcamentoPdf, precoPelaTabela, resumoRotaOrs, type PontoOrcamento, type TabelaPrecos,
} from "@bybus/core";
import type { Contexto } from "../app.js";
import { auditar } from "../auditoria.js";
import { configuracoes, gruposFechados, orcamentosRota, pontosEmbarque } from "../db/schema.js";
import { podeUnidade } from "../seguranca/escopo.js";
import { ErroHttp, exigir, type UsuarioSessao } from "../seguranca/sessao.js";
import { dataIso, hojeSp } from "../servicos/marketingComum.js";
import { gerarPdfTimbrado } from "../servicos/pdfTimbrado.js";
import { dadosEmpresaContrato } from "./grupos.js";

const CHAVE_TABELA = "orcamento_tabela_precos";
const AGENTE = "BybusGestao/1.0 (+https://gestao.bybusturismo.com.br)";
const ORS = "https://api.openrouteservice.org";
/** Sem chave do OpenRouteService: linha reta × 1,3 (curvas das ruas) a 40 km/h de média. */
const FATOR_RUAS = 1.3;
const VELOCIDADE_MEDIA_KMH = 40;

const ponto = z.object({ nome: z.string().trim().min(2).max(160), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), permanenciaMin: z.number().int().min(0).max(600).default(0) });
const centavos = z.number().int().min(0).max(1_000_000_000);
const tabelaVeiculo = z.object({ valorKmCentavos: centavos, valorHoraCentavos: centavos, horasMinimas: z.number().min(0).max(24), minimoCentavos: centavos });

/**
 * Orçamento de grupos com rota (dono, 13/11/2026): pontos de visitação, rota pelas ruas (OpenRouteService; sem chave, uma
 * estimativa), veículo (van, micro ou ônibus), carga horária e valor pela tabela por veículo (ajustável), PDF no timbrado
 * e "virar grupo" quando fechar. Acesso: quem lança reservas; a tabela de preços, o financeiro.
 */
export async function rotasOrcamentosRota(app: FastifyInstance, { db, config }: Contexto) {
  const acesso = { preHandler: exigir(config, "reservas:editar") };
  const escopo = (u: UsuarioSessao) => (u.todasUnidades ? undefined : sql`(${orcamentosRota.unidadeId} is null or ${orcamentosRota.unidadeId} in (${u.unidadeIds.length ? sql.join(u.unidadeIds.map((i) => sql`${i}`), sql`, `) : sql`null`}))`);

  async function tabela(): Promise<TabelaPrecos> {
    const [c] = await db.select({ valor: configuracoes.valor }).from(configuracoes).where(eq(configuracoes.chave, CHAVE_TABELA));
    return c ? { ...TABELA_VAZIA, ...(JSON.parse(c.valor) as Partial<TabelaPrecos>) } : TABELA_VAZIA;
  }
  async function doUsuario(u: UsuarioSessao, id: string) {
    const [o] = await db.select().from(orcamentosRota).where(eq(orcamentosRota.id, id));
    if (!o || !(u.todasUnidades || !o.unidadeId || podeUnidade(u, o.unidadeId))) throw new ErroHttp(404, "NAO_ENCONTRADO", "Orçamento não encontrado.");
    return o;
  }

  app.get("/api/orcamentos-rota/tabela", acesso, async () => tabela());
  app.put("/api/orcamentos-rota/tabela", { preHandler: exigir(config, "financeiro:gerenciar") }, async (req) => {
    const t = z.object({ VAN: tabelaVeiculo, MICRO: tabelaVeiculo, ONIBUS: tabelaVeiculo }).parse(req.body);
    await db.insert(configuracoes).values({ chave: CHAVE_TABELA, valor: JSON.stringify(t), atualizadoPor: req.usuario!.id })
      .onConflictDoUpdate({ target: configuracoes.chave, set: { valor: JSON.stringify(t), atualizadoPor: req.usuario!.id, atualizadoEm: new Date() } });
    await auditar(db, req, "ORCAMENTO_TABELA_ALTERADA", { tipo: "configuracoes", id: CHAVE_TABELA }, t);
    return t;
  });

  /** Procura um local: primeiro nos pontos já cadastrados (com coordenadas), depois no OpenRouteService (ou OpenStreetMap). */
  app.post("/api/orcamentos-rota/localizar", { ...acesso, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { texto } = z.object({ texto: z.string().trim().min(3).max(160) }).parse(req.body);
    const locais = await db.selectDistinct({ nome: pontosEmbarque.nome, lat: pontosEmbarque.latitude, lng: pontosEmbarque.longitude }).from(pontosEmbarque)
      .where(and(ilike(pontosEmbarque.nome, `%${texto}%`), isNotNull(pontosEmbarque.latitude))).limit(5);
    const saida = locais.map((l) => ({ nome: l.nome, lat: l.lat!, lng: l.lng!, fonte: "CADASTRO" as const }));
    try {
      if (config.ORS_CHAVE) {
        const r = await fetch(`${ORS}/geocode/search?api_key=${encodeURIComponent(config.ORS_CHAVE)}&text=${encodeURIComponent(texto)}&boundary.country=BR&focus.point.lat=-27.59&focus.point.lon=-48.55&size=5`, { headers: { "User-Agent": AGENTE }, signal: AbortSignal.timeout(15_000) });
        if (r.ok) {
          const j = (await r.json()) as { features?: Array<{ properties?: { label?: string }; geometry?: { coordinates?: [number, number] } }> };
          for (const f of j.features ?? []) if (f.geometry?.coordinates) saida.push({ nome: f.properties?.label ?? texto, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], fonte: "MAPA" as never });
        }
      } else {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=5&q=${encodeURIComponent(texto)}`, { headers: { "User-Agent": AGENTE }, signal: AbortSignal.timeout(15_000) });
        if (r.ok) for (const f of (await r.json()) as Array<{ display_name: string; lat: string; lon: string }>) saida.push({ nome: f.display_name, lat: Number(f.lat), lng: Number(f.lon), fonte: "MAPA" as never });
      }
    } catch { /* sem internet ou serviço fora: fica só o que há no cadastro */ }
    return saida.slice(0, 8);
  });

  /** Rota pelas ruas entre os pontos, na ordem. Ônibus e micro usam o perfil de veículo pesado. */
  async function calcularRota(pontos: Array<{ lat: number; lng: number }>, veiculo: string) {
    if (pontos.length < 2) return { distanciaKm: 0, duracaoMin: 0, trechos: [], fonte: "SEM_ROTA" as const };
    if (config.ORS_CHAVE) {
      try {
        const perfil = veiculo === "VAN" ? "driving-car" : "driving-hgv";
        const r = await fetch(`${ORS}/v2/directions/${perfil}`, {
          method: "POST", headers: { Authorization: config.ORS_CHAVE, "Content-Type": "application/json", Accept: "application/json", "User-Agent": AGENTE },
          body: JSON.stringify({ coordinates: pontos.map((p) => [p.lng, p.lat]) }), signal: AbortSignal.timeout(20_000),
        });
        const resumo = r.ok ? resumoRotaOrs(await r.json()) : null;
        if (resumo) return { ...resumo, fonte: "OPENROUTESERVICE" as const };
      } catch { /* cai na estimativa */ }
    }
    const trechos = pontos.slice(1).map((p, i) => {
      const km = Math.round(distanciaKm(pontos[i]!, p) * FATOR_RUAS * 10) / 10;
      return { km, min: Math.round((km / VELOCIDADE_MEDIA_KMH) * 60) };
    });
    return { distanciaKm: Math.round(trechos.reduce((t, x) => t + x.km, 0) * 10) / 10, duracaoMin: trechos.reduce((t, x) => t + x.min, 0), trechos, fonte: "ESTIMATIVA" as const };
  }

  app.post("/api/orcamentos-rota/calcular", { ...acesso, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const b = z.object({ pontos: z.array(ponto).min(2).max(40), veiculo: z.enum(VEICULOS_ORCAMENTO), folgaMin: z.number().int().min(0).max(600).default(30) }).parse(req.body);
    const rota = await calcularRota(b.pontos, b.veiculo);
    const carga = cargaHorariaMin(rota.duracaoMin, b.pontos as PontoOrcamento[], b.folgaMin);
    return { ...rota, cargaHorariaMin: carga, preco: precoPelaTabela(rota.distanciaKm, carga, (await tabela())[b.veiculo]) };
  });

  const corpo = z.object({
    unidadeId: z.string().uuid().nullish(),
    cliente: z.string().trim().min(2).max(160), contato: z.string().trim().max(200).nullish().transform((v) => v || null),
    dataPasseio: dataIso.nullish(), horarioInicio: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
    veiculo: z.enum(VEICULOS_ORCAMENTO), pessoas: z.number().int().min(1).max(5000).nullish(),
    pontos: z.array(ponto).max(40), folgaMin: z.number().int().min(0).max(600).default(30),
    /** Valor ajustado à mão (vazio = o calculado pela tabela). */
    valorFinalCentavos: centavos.nullish(), validadeDias: z.number().int().min(1).max(120).default(15),
    observacoes: z.string().trim().max(4000).nullish().transform((v) => v || null),
  });

  /** Recalcula rota, carga horária e valor (regra no servidor). */
  async function calculado(c: z.infer<typeof corpo>) {
    const rota = await calcularRota(c.pontos, c.veiculo);
    const carga = cargaHorariaMin(rota.duracaoMin, c.pontos as PontoOrcamento[], c.folgaMin);
    const preco = precoPelaTabela(rota.distanciaKm, carga, (await tabela())[c.veiculo]);
    return { distanciaKm: rota.distanciaKm, duracaoRotaMin: rota.duracaoMin, cargaHorariaMin: carga, valorCalculadoCentavos: preco.totalCentavos, fonteRota: rota.fonte };
  }
  async function proximoNumero() {
    const ano = hojeSp().slice(0, 4);
    const [n] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(orcamentosRota).where(sql`${orcamentosRota.numero} like ${`${ano}-%`}`);
    return `${ano}-${String((n?.n ?? 0) + 1).padStart(4, "0")}`;
  }

  app.get("/api/orcamentos-rota", acesso, async (req) => db.select().from(orcamentosRota).where(escopo(req.usuario!)).orderBy(desc(orcamentosRota.criadoEm)).limit(300));
  app.get("/api/orcamentos-rota/:id", acesso, async (req) => doUsuario(req.usuario!, z.object({ id: z.string().uuid() }).parse(req.params).id));

  app.post("/api/orcamentos-rota", acesso, async (req, reply) => {
    const c = corpo.parse(req.body);
    if (c.unidadeId && !podeUnidade(req.usuario!, c.unidadeId)) throw new ErroHttp(403, "SEM_PERMISSAO", "Você não tem acesso a esta praça.");
    const calc = await calculado(c);
    const { fonteRota, ...valores } = calc;
    let numero = await proximoNumero();
    for (let i = 0; i < 3; i++) {
      const r = await db.insert(orcamentosRota).values({ ...c, ...valores, numero, criadoPor: req.usuario!.id }).onConflictDoNothing().returning({ id: orcamentosRota.id });
      if (r.length) {
        await auditar(db, req, "ORCAMENTO_ROTA_CRIADO", { tipo: "orcamento_rota", id: r[0]!.id }, { numero, fonteRota });
        reply.code(201);
        return { id: r[0]!.id, numero, fonteRota };
      }
      numero = `${numero.slice(0, 5)}${String(Number(numero.slice(5)) + 1).padStart(4, "0")}`;
    }
    throw new ErroHttp(409, "NUMERO", "Não consegui numerar o orçamento. Tente de novo.");
  });

  app.put("/api/orcamentos-rota/:id", acesso, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await doUsuario(req.usuario!, id);
    const c = corpo.parse(req.body);
    const { fonteRota, ...valores } = await calculado(c);
    await db.update(orcamentosRota).set({ ...c, ...valores, atualizadoEm: new Date() }).where(eq(orcamentosRota.id, id));
    await auditar(db, req, "ORCAMENTO_ROTA_ALTERADO", { tipo: "orcamento_rota", id }, { fonteRota });
    return { ok: true, fonteRota };
  });

  app.get("/api/orcamentos-rota/:id/pdf", acesso, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const o = await doUsuario(req.usuario!, id);
    const empresa = await dadosEmpresaContrato(db);
    const blocos = montarOrcamentoPdf({
      numero: o.numero, cliente: o.cliente, contato: o.contato, dataPasseio: o.dataPasseio, horarioInicio: o.horarioInicio, veiculo: o.veiculo as never, pessoas: o.pessoas,
      pontos: o.pontos as PontoOrcamento[], distanciaKm: o.distanciaKm ?? 0, duracaoRotaMin: o.duracaoRotaMin ?? 0, cargaHorariaMin: o.cargaHorariaMin ?? 0,
      valorCentavos: o.valorFinalCentavos ?? o.valorCalculadoCentavos ?? 0, validadeDias: o.validadeDias, observacoes: o.observacoes,
      emitidoEm: hojeSp(), cidade: empresa.cidadeForo, sinalPercentual: 50,
    });
    const pdf = await gerarPdfTimbrado(`Orçamento ${o.numero}`, blocos, `Orçamento ${o.numero} · ${o.cliente}`);
    await auditar(db, req, "ORCAMENTO_ROTA_PDF", { tipo: "orcamento_rota", id }, {});
    return reply.header("Content-Type", "application/pdf").header("Cache-Control", "no-store").header("Content-Disposition", `inline; filename="orcamento-${o.numero}.pdf"`).send(pdf);
  });

  /** Fechou: vira grupo fechado (cadastro já preenchido com data, roteiro, veículo, pessoas e valor). */
  app.post("/api/orcamentos-rota/:id/grupo", acesso, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const o = await doUsuario(req.usuario!, id);
    if (o.grupoId) return { grupoId: o.grupoId, existente: true };
    const pontos = o.pontos as PontoOrcamento[];
    const total = o.valorFinalCentavos ?? o.valorCalculadoCentavos ?? null;
    const [g] = await db.insert(gruposFechados).values({
      unidadeId: o.unidadeId, nome: o.cliente, status: "CONFIRMADO", dataPasseio: o.dataPasseio, horarioInicio: o.horarioInicio, localInicio: pontos[0]?.nome ?? null,
      veiculo: { VAN: "Van", MICRO: "Micro-ônibus", ONIBUS: "Ônibus" }[o.veiculo] ?? o.veiculo, roteiro: pontos.map((p) => `${p.nome}${p.permanenciaMin ? ` (${p.permanenciaMin} min)` : ""}`).join("\n"),
      duracaoTexto: o.cargaHorariaMin ? `${Math.floor(o.cargaHorariaMin / 60)}h${String(o.cargaHorariaMin % 60).padStart(2, "0")}` : null,
      pessoas: o.pessoas, valorTotalCentavos: total, valorPorPessoaCentavos: total && o.pessoas ? Math.round(total / o.pessoas) : null,
      representanteNome: o.contato, observacoes: `Criado do orçamento ${o.numero}.${o.observacoes ? `\n${o.observacoes}` : ""}`, criadoPor: req.usuario!.id,
    }).returning({ id: gruposFechados.id });
    await db.update(orcamentosRota).set({ grupoId: g!.id, atualizadoEm: new Date() }).where(eq(orcamentosRota.id, id));
    await auditar(db, req, "ORCAMENTO_ROTA_VIROU_GRUPO", { tipo: "orcamento_rota", id }, { grupoId: g!.id });
    return { grupoId: g!.id, existente: false };
  });
}
