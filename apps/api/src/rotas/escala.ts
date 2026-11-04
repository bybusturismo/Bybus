import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { escalas, passeios, pessoas, saidas } from "../db/schema.js";
import { garantirPasseio } from "../seguranca/escopo.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { aplicarEscalaNaSaida, validarPessoaDaPraca } from "../servicos/escala.js";
import { hojeSp, motivosIndisponibilidade } from "../servicos/frota.js";

const uuid = z.string().uuid();
const mesIso = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês no formato AAAA-MM");
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");

function diasDoMes(mes: string): string[] {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`);
}

export async function rotasEscala(app: FastifyInstance, { db, config }: Contexto) {
  const ver = { preHandler: exigir(config, "pessoas:ver") };
  const gerenciar = { preHandler: exigir(config, "escala:gerenciar") };

  /** Escala do mês de um passeio: um item por dia, com guia/motorista, origem (escala ou troca) e alertas. */
  app.get("/api/escala", ver, async (req) => {
    const q = z.object({ passeioId: uuid, mes: mesIso }).parse(req.query);
    const unidadeId = await garantirPasseio(db, req.usuario!, q.passeioId);
    const [passeio] = await db.select().from(passeios).where(eq(passeios.id, q.passeioId));
    const dias = diasDoMes(q.mes);
    const linhas = await db.select().from(escalas).where(and(eq(escalas.passeioId, q.passeioId), gte(escalas.data, dias[0]!), lte(escalas.data, dias.at(-1)!)));
    const listaSaidas = await db.select({ id: saidas.id, data: saidas.data, status: saidas.status }).from(saidas)
      .where(and(eq(saidas.passeioId, q.passeioId), gte(saidas.data, dias[0]!), lte(saidas.data, dias.at(-1)!)));
    const ids = [...new Set(linhas.flatMap((l) => [l.guiaId, l.motoristaId]).concat(passeio?.motoristaPadraoId ?? null).filter((x): x is string => !!x))];
    const equipe = ids.length ? await db.select({ id: pessoas.id, nome: pessoas.nome, cadasturValidade: pessoas.cadasturValidade }).from(pessoas).where(inArray(pessoas.id, ids)) : [];
    const nome = (id: string | null | undefined) => equipe.find((p) => p.id === id)?.nome ?? null;
    return {
      passeio: { id: passeio!.id, nome: passeio!.nome, unidadeId, motoristaPadraoId: passeio!.motoristaPadraoId, motoristaPadrao: nome(passeio!.motoristaPadraoId), veiculoPadrao: passeio!.veiculoPadrao },
      dias: dias.map((data) => {
        const l = linhas.find((x) => x.data === data);
        const guia = equipe.find((p) => p.id === l?.guiaId);
        const alertas: string[] = [];
        if (guia?.cadasturValidade && guia.cadasturValidade < data) alertas.push("Cadastur do guia vencido nesta data.");
        return {
          data,
          guiaId: l?.guiaId ?? null, guia: guia?.nome ?? null,
          motoristaId: l?.motoristaId ?? null, motorista: nome(l?.motoristaId),
          origem: l?.origem ?? null, motivo: l?.motivo ?? null, publicada: l?.publicada ?? false,
          saida: listaSaidas.find((s) => s.data === data) ?? null,
          alertas,
        };
      }),
    };
  });

  /**
   * Planejamento do mês (dias livres ou ainda não publicados). Dia já publicado só muda pela troca com motivo.
   * `publicar` = fecha o planejamento: daí em diante as mudanças ficam registradas como troca de força maior.
   */
  app.put("/api/escala", gerenciar, async (req) => {
    const corpo = z.object({
      passeioId: uuid,
      mes: mesIso,
      publicar: z.boolean().default(false),
      motoristaPadraoId: uuid.nullish(),
      veiculoPadrao: z.string().trim().max(40).nullish(),
      dias: z.array(z.object({ data: dataIso, guiaId: uuid.nullable(), motoristaId: uuid.nullable() })).max(31),
    }).parse(req.body);
    const unidadeId = await garantirPasseio(db, req.usuario!, corpo.passeioId);
    const [antes] = await db.select({ motoristaPadraoId: passeios.motoristaPadraoId }).from(passeios).where(eq(passeios.id, corpo.passeioId));
    const mudouPadrao = corpo.motoristaPadraoId !== undefined && (corpo.motoristaPadraoId ?? null) !== (antes?.motoristaPadraoId ?? null);
    const validos = new Set(diasDoMes(corpo.mes));
    if (corpo.dias.some((d) => !validos.has(d.data))) throw new ErroHttp(400, "DATA_FORA_DO_MES", "Há dias fora do mês informado.");
    for (const d of corpo.dias) {
      await validarPessoaDaPraca(db, d.guiaId, "GUIA", unidadeId);
      await validarPessoaDaPraca(db, d.motoristaId, "MOTORISTA", unidadeId);
    }
    if (corpo.motoristaPadraoId !== undefined) await validarPessoaDaPraca(db, corpo.motoristaPadraoId, "MOTORISTA", unidadeId);
    if (corpo.veiculoPadrao) {
      const motivos = await motivosIndisponibilidade(db, corpo.veiculoPadrao, hojeSp());
      if (motivos?.length) throw new ErroHttp(409, "VEICULO_INDISPONIVEL", `Veículo indisponível: ${motivos.join("; ")}.`);
    }

    const existentes = corpo.dias.length
      ? await db.select().from(escalas).where(and(eq(escalas.passeioId, corpo.passeioId), inArray(escalas.data, corpo.dias.map((d) => d.data))))
      : [];
    const bloqueados = corpo.dias.filter((d) => {
      const e = existentes.find((x) => x.data === d.data);
      return e?.publicada && (e.guiaId !== d.guiaId || e.motoristaId !== d.motoristaId);
    });
    if (bloqueados.length) {
      throw new ErroHttp(409, "TROCA_EXIGE_MOTIVO", `Escala já publicada em ${bloqueados.map((d) => d.data.split("-").reverse().join("/")).join(", ")}: use “Trocar” e informe o motivo.`);
    }

    await db.transaction(async (tx) => {
      if (corpo.motoristaPadraoId !== undefined || corpo.veiculoPadrao !== undefined) {
        await tx.update(passeios).set({
          ...(corpo.motoristaPadraoId !== undefined ? { motoristaPadraoId: corpo.motoristaPadraoId } : {}),
          ...(corpo.veiculoPadrao !== undefined ? { veiculoPadrao: corpo.veiculoPadrao || null } : {}),
        }).where(eq(passeios.id, corpo.passeioId));
      }
      for (const d of corpo.dias) {
        const e = existentes.find((x) => x.data === d.data);
        const valores = { guiaId: d.guiaId, motoristaId: d.motoristaId, origem: e?.origem === "TROCA" ? "TROCA" : "ESCALA", publicada: (e?.publicada ?? false) || corpo.publicar, alteradoPor: req.usuario!.id, atualizadoEm: new Date() };
        await tx.insert(escalas).values({ passeioId: corpo.passeioId, data: d.data, ...valores })
          .onConflictDoUpdate({ target: [escalas.passeioId, escalas.data], set: valores });
      }
      if (corpo.publicar) {
        await tx.update(escalas).set({ publicada: true }).where(and(eq(escalas.passeioId, corpo.passeioId), inArray(escalas.data, [...validos])));
      }
    });
    // Só os dias que mudaram sobrescrevem a saída; os demais apenas preenchem o que estiver vazio
    // (não desfaz um ajuste feito direto na saída).
    for (const d of corpo.dias) {
      const e = existentes.find((x) => x.data === d.data);
      const mudou = !e || e.guiaId !== d.guiaId || e.motoristaId !== d.motoristaId || mudouPadrao;
      await aplicarEscalaNaSaida(db, corpo.passeioId, d.data, mudou);
    }
    await auditar(db, req, corpo.publicar ? "ESCALA_PUBLICADA" : "ESCALA_SALVA", { tipo: "passeio", id: corpo.passeioId }, { mes: corpo.mes, dias: corpo.dias.length });
    return { ok: true };
  });

  /** Troca de guia/motorista num dia (força maior): motivo obrigatório, fica na auditoria e vai para a saída do dia. */
  app.post("/api/escala/troca", gerenciar, async (req) => {
    const corpo = z.object({
      passeioId: uuid,
      data: dataIso,
      guiaId: uuid.nullable().optional(),
      motoristaId: uuid.nullable().optional(),
      motivo: z.string().trim().min(5, "Descreva o motivo da troca.").max(300),
    }).parse(req.body);
    if (corpo.guiaId === undefined && corpo.motoristaId === undefined) throw new ErroHttp(400, "NADA_A_TROCAR", "Informe o novo guia ou motorista.");
    const unidadeId = await garantirPasseio(db, req.usuario!, corpo.passeioId);
    await validarPessoaDaPraca(db, corpo.guiaId, "GUIA", unidadeId);
    await validarPessoaDaPraca(db, corpo.motoristaId, "MOTORISTA", unidadeId);
    const [antes] = await db.select().from(escalas).where(and(eq(escalas.passeioId, corpo.passeioId), eq(escalas.data, corpo.data)));
    const valores = {
      ...(corpo.guiaId !== undefined ? { guiaId: corpo.guiaId } : {}),
      ...(corpo.motoristaId !== undefined ? { motoristaId: corpo.motoristaId } : {}),
      origem: "TROCA", motivo: corpo.motivo, publicada: true, alteradoPor: req.usuario!.id, atualizadoEm: new Date(),
    };
    await db.insert(escalas).values({ passeioId: corpo.passeioId, data: corpo.data, ...valores }).onConflictDoUpdate({ target: [escalas.passeioId, escalas.data], set: valores });
    await aplicarEscalaNaSaida(db, corpo.passeioId, corpo.data, true);
    // Auditoria com ids (sem nomes) e o motivo.
    await auditar(db, req, "ESCALA_TROCA", { tipo: "passeio", id: corpo.passeioId }, {
      data: corpo.data, motivo: corpo.motivo,
      guiaAntes: antes?.guiaId ?? null, guiaDepois: corpo.guiaId ?? antes?.guiaId ?? null,
      motoristaAntes: antes?.motoristaId ?? null, motoristaDepois: corpo.motoristaId ?? antes?.motoristaId ?? null,
    });
    return { ok: true };
  });

  /** Guias e motoristas disponíveis para a praça do passeio (para os seletores da escala). */
  app.get("/api/escala/equipe", ver, async (req) => {
    const q = z.object({ passeioId: uuid }).parse(req.query);
    const unidadeId = await garantirPasseio(db, req.usuario!, q.passeioId);
    const lista = await db.select({ id: pessoas.id, nome: pessoas.nome, papeis: pessoas.papeis, unidadeId: pessoas.unidadeId, cadasturValidade: pessoas.cadasturValidade })
      .from(pessoas).where(eq(pessoas.ativo, true)).orderBy(asc(pessoas.nome));
    const daPraca = lista.filter((p) => !p.unidadeId || p.unidadeId === unidadeId);
    return {
      guias: daPraca.filter((p) => p.papeis.includes("GUIA")).map(({ id, nome, cadasturValidade }) => ({ id, nome, cadasturValidade })),
      motoristas: daPraca.filter((p) => p.papeis.includes("MOTORISTA")).map(({ id, nome }) => ({ id, nome })),
    };
  });
}
