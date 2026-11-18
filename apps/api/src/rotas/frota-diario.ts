import { calcularDiarioKm, resumirDiarioKm, validarDiarioKm } from "@bybus/core";
import { and, asc, desc, eq, gt, gte, lt, lte, ne, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { usuarios, veiculos, veiculosKmDiario } from "../db/schema.js";
import { ErroHttp } from "../seguranca/sessao.js";
import { hojeSp, registrarLeituraKm } from "../servicos/frota.js";
import { escopoVeiculos, garantirVeiculo } from "./frota.js";

interface Guarda { preHandler: (req: FastifyRequest) => Promise<void> }
const uuid = z.string().uuid();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");
const somarDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const kmBr = (n: number) => n.toLocaleString("pt-BR");
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const corpo = z.object({
  data: dataIso,
  kmInicial: z.number().int().min(0).max(5_000_000),
  kmFinal: z.number().int().min(0).max(5_000_000),
  /** Litros gastos no dia (opcional). */
  consumoLitros: z.number().min(0).max(2000).nullish().transform((v) => v ?? null),
  observacao: z.string().trim().max(300).nullish().transform((v) => v || null),
  /** Confirma mesmo com o km inicial menor que o km final do dia anterior (ou o final maior que o inicial do dia seguinte). */
  confirmarRecuo: z.boolean().optional(),
});

/**
 * Diário de km da frota (dono, 18/11/2026): DATA › PLACA › KM INICIAL › KM FINAL › CONSUMO. Um registro por veículo e dia.
 * Quem faz o checklist (motorista) ou gerencia a frota lança; só quem gerencia corrige e exclui. O km final vira leitura de km
 * (fonte DIARIO): atualiza o km atual do veículo e os planos de manutenção, sem nunca baixar o km.
 */
export async function rotasFrotaDiario(app: FastifyInstance, { db }: Contexto, { ler, lancar, gerenciar }: { ler: Guarda; lancar: Guarda; gerenciar: Guarda }) {
  /** Confere a sequência com o dia anterior e o seguinte do mesmo veículo. */
  async function conferirSequencia(veiculoId: string, data: string, kmInicial: number, kmFinal: number, ignorarId?: string): Promise<string | null> {
    const outro = ignorarId ? ne(veiculosKmDiario.id, ignorarId) : undefined;
    const [antes] = await db.select({ data: veiculosKmDiario.data, kmFinal: veiculosKmDiario.kmFinal }).from(veiculosKmDiario)
      .where(and(eq(veiculosKmDiario.veiculoId, veiculoId), lt(veiculosKmDiario.data, data), outro)).orderBy(desc(veiculosKmDiario.data)).limit(1);
    if (antes && kmInicial < antes.kmFinal) return `O km inicial (${kmBr(kmInicial)}) é menor que o km final de ${dataBr(antes.data)} (${kmBr(antes.kmFinal)}). Confira a digitação.`;
    const [depois] = await db.select({ data: veiculosKmDiario.data, kmInicial: veiculosKmDiario.kmInicial }).from(veiculosKmDiario)
      .where(and(eq(veiculosKmDiario.veiculoId, veiculoId), gt(veiculosKmDiario.data, data), outro)).orderBy(asc(veiculosKmDiario.data)).limit(1);
    if (depois && kmFinal > depois.kmInicial) return `O km final (${kmBr(kmFinal)}) é maior que o km inicial de ${dataBr(depois.data)} (${kmBr(depois.kmInicial)}). Confira a digitação.`;
    return null;
  }
  function validar(c: z.infer<typeof corpo>) {
    if (c.data > hojeSp()) throw new ErroHttp(400, "DATA_FUTURA", "A data não pode ser futura.");
    const erro = validarDiarioKm(c);
    if (erro) throw new ErroHttp(400, "KM_INVALIDO", erro);
  }

  app.get("/api/frota/km-diario", ler, async (req) => {
    const q = z.object({ veiculoId: uuid.optional(), de: dataIso, ate: dataIso }).parse(req.query);
    if (q.de > q.ate) throw new ErroHttp(400, "PERIODO_INVALIDO", "A data inicial deve ser anterior à final.");
    const filtro: SQL | undefined = and(escopoVeiculos(req.usuario!), q.veiculoId ? eq(veiculosKmDiario.veiculoId, q.veiculoId) : undefined);
    // 90 dias antes do período só para comparar o 1º dia com o anterior
    const linhas = await db.select({ r: veiculosKmDiario, placa: veiculos.placa, apelido: veiculos.apelido, lancadoPor: usuarios.nome })
      .from(veiculosKmDiario).innerJoin(veiculos, eq(veiculos.id, veiculosKmDiario.veiculoId)).leftJoin(usuarios, eq(usuarios.id, veiculosKmDiario.criadoPor))
      .where(and(filtro, gte(veiculosKmDiario.data, somarDias(q.de, -90)), lte(veiculosKmDiario.data, q.ate)))
      .orderBy(desc(veiculosKmDiario.data), asc(veiculos.placa)).limit(3000);
    const calc = calcularDiarioKm(linhas.map((l) => ({ ...l.r, placa: l.placa, apelido: l.apelido, lancadoPor: l.lancadoPor })));
    const itens = calc.filter((i) => i.data >= q.de);
    const placas = new Map(itens.map((i) => [i.veiculoId, { placa: i.placa, apelido: i.apelido }]));
    const resumo = resumirDiarioKm(itens).map((r) => ({ ...r, ...placas.get(r.veiculoId)! })).sort((a, b) => a.placa.localeCompare(b.placa));
    return { itens, resumo };
  });

  /** Sugestão do km inicial: o km final do último registro antes da data (ou o km atual do veículo). */
  app.get("/api/frota/km-diario/sugestao", ler, async (req) => {
    const q = z.object({ veiculoId: uuid, data: dataIso }).parse(req.query);
    const v = await garantirVeiculo(db, req.usuario!, q.veiculoId);
    const [doDia] = await db.select({ id: veiculosKmDiario.id }).from(veiculosKmDiario).where(and(eq(veiculosKmDiario.veiculoId, q.veiculoId), eq(veiculosKmDiario.data, q.data)));
    const [antes] = await db.select({ data: veiculosKmDiario.data, kmFinal: veiculosKmDiario.kmFinal }).from(veiculosKmDiario)
      .where(and(eq(veiculosKmDiario.veiculoId, q.veiculoId), lt(veiculosKmDiario.data, q.data))).orderBy(desc(veiculosKmDiario.data)).limit(1);
    return antes
      ? { kmInicial: antes.kmFinal, origem: `km final de ${dataBr(antes.data)}`, jaRegistrado: !!doDia }
      : { kmInicial: v.kmAtual, origem: "km atual do veículo", jaRegistrado: !!doDia };
  });

  app.post("/api/frota/km-diario", lancar, async (req, reply) => {
    const c = corpo.extend({ veiculoId: uuid }).parse(req.body);
    const v = await garantirVeiculo(db, req.usuario!, c.veiculoId);
    validar(c);
    const [ja] = await db.select({ id: veiculosKmDiario.id }).from(veiculosKmDiario).where(and(eq(veiculosKmDiario.veiculoId, c.veiculoId), eq(veiculosKmDiario.data, c.data)));
    if (ja) throw new ErroHttp(409, "JA_REGISTRADO", `${v.placa} já tem registro em ${dataBr(c.data)}. Corrija o registro existente em vez de lançar outro.`);
    if (!c.confirmarRecuo) {
      const aviso = await conferirSequencia(c.veiculoId, c.data, c.kmInicial, c.kmFinal);
      if (aviso) throw new ErroHttp(409, "KM_FORA_DE_SEQUENCIA", aviso);
    }
    let r;
    try {
      [r] = await db.insert(veiculosKmDiario).values({
        veiculoId: c.veiculoId, data: c.data, kmInicial: c.kmInicial, kmFinal: c.kmFinal, consumoLitros: c.consumoLitros, observacao: c.observacao, criadoPor: req.usuario!.id,
      }).returning();
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErroHttp(409, "JA_REGISTRADO", `${v.placa} já tem registro em ${dataBr(c.data)}.`);
      throw e;
    }
    const km = await registrarLeituraKm(db, { veiculoId: c.veiculoId, km: c.kmFinal, data: c.data, fonte: "DIARIO", usuarioId: req.usuario!.id });
    await auditar(db, req, "VEICULO_KM_DIARIO_LANCADO", { tipo: "veiculo", id: c.veiculoId }, { data: c.data, kmInicial: c.kmInicial, kmFinal: c.kmFinal, consumoLitros: c.consumoLitros, confirmouRecuo: !!c.confirmarRecuo });
    reply.code(201);
    return { ...r!, kmAtual: km.kmAtual };
  });

  async function registroVisivel(req: FastifyRequest, id: string) {
    const [r] = await db.select().from(veiculosKmDiario).where(eq(veiculosKmDiario.id, id));
    if (!r) throw new ErroHttp(404, "NAO_ENCONTRADO", "Registro não encontrado.");
    await garantirVeiculo(db, req.usuario!, r.veiculoId).catch(() => { throw new ErroHttp(404, "NAO_ENCONTRADO", "Registro não encontrado."); });
    return r;
  }

  app.patch("/api/frota/km-diario/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const atual = await registroVisivel(req, id);
    const c = corpo.parse(req.body);
    validar(c);
    if (c.data !== atual.data) {
      const [ja] = await db.select({ id: veiculosKmDiario.id }).from(veiculosKmDiario).where(and(eq(veiculosKmDiario.veiculoId, atual.veiculoId), eq(veiculosKmDiario.data, c.data)));
      if (ja) throw new ErroHttp(409, "JA_REGISTRADO", `Já existe registro deste veículo em ${dataBr(c.data)}.`);
    }
    if (!c.confirmarRecuo) {
      const aviso = await conferirSequencia(atual.veiculoId, c.data, c.kmInicial, c.kmFinal, id);
      if (aviso) throw new ErroHttp(409, "KM_FORA_DE_SEQUENCIA", aviso);
    }
    const [r] = await db.update(veiculosKmDiario).set({ data: c.data, kmInicial: c.kmInicial, kmFinal: c.kmFinal, consumoLitros: c.consumoLitros, observacao: c.observacao, atualizadoEm: new Date() })
      .where(eq(veiculosKmDiario.id, id)).returning();
    if (c.kmFinal !== atual.kmFinal) await registrarLeituraKm(db, { veiculoId: atual.veiculoId, km: c.kmFinal, data: c.data, fonte: "DIARIO", usuarioId: req.usuario!.id });
    await auditar(db, req, "VEICULO_KM_DIARIO_CORRIGIDO", { tipo: "veiculo", id: atual.veiculoId }, {
      antes: { data: atual.data, kmInicial: atual.kmInicial, kmFinal: atual.kmFinal, consumoLitros: atual.consumoLitros },
      depois: { data: c.data, kmInicial: c.kmInicial, kmFinal: c.kmFinal, consumoLitros: c.consumoLitros },
    });
    return r!;
  });

  app.delete("/api/frota/km-diario/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await registroVisivel(req, id);
    await db.delete(veiculosKmDiario).where(eq(veiculosKmDiario.id, id));
    await auditar(db, req, "VEICULO_KM_DIARIO_EXCLUIDO", { tipo: "veiculo", id: r.veiculoId }, { data: r.data, kmInicial: r.kmInicial, kmFinal: r.kmFinal, consumoLitros: r.consumoLitros });
    return { ok: true };
  });
}
