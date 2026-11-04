import {
  calcularBaixa, centavosParaTexto, lerCsvExtrato, lerOfx, prepararLinhas, somarDiasIso, sugerirCategoria, sugerirCorrespondencias,
  CANAIS, FORMAS_PAGAMENTO, LINHAS_FINANCEIRO,
  type ExtratoLido, type LancamentoCandidato, type RegraCategoria,
} from "@bybus/core";
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { finCategorias, finContas, finExtratoLinhas, finExtratos, finLancamentos, finRecusas, finRegras } from "../db/schema.js";
import { ErroHttp } from "../seguranca/sessao.js";
import { dataIso, uuid, veiculoOpcional } from "./financeiro-comum.js";
import { estaConciliado, filtroPraca, garantirConta, garantirLancamento, garantirLinha, hojeSP, validarCategoria, validarPracaDoRegistro } from "../servicos/financeiro.js";

const MAX_LINHAS = 20_000;

interface Guardas {
  ver: { preHandler: (req: FastifyRequest) => Promise<void> };
  gerenciar: { preHandler: (req: FastifyRequest) => Promise<void> };
}

/** Extrato, importação (OFX/CSV), conciliação e transferências entre contas. Nada concilia sozinho. */
export async function rotasFinanceiroExtrato(app: FastifyInstance, { db }: Contexto, { ver, gerenciar }: Guardas) {
  // ------------------------------------------------------------------ importação
  app.post("/api/financeiro/extratos/importar", { ...gerenciar, bodyLimit: 6 * 1024 * 1024 }, async (req) => {
    const u = req.usuario!;
    const corpo = z.object({
      contaId: uuid, formato: z.enum(["OFX", "CSV"]), conteudo: z.string().min(1).max(5_500_000),
      arquivo: z.string().trim().max(200).nullish(), confirmar: z.boolean().default(false),
    }).parse(req.body);
    const conta = await garantirConta(db, u, corpo.contaId);
    if (!conta.ativa) throw new ErroHttp(400, "CONTA_INATIVA", "Esta conta está desativada.");
    if (conta.tipo === "CAIXA") throw new ErroHttp(400, "CONTA_SEM_EXTRATO", "Caixa em dinheiro não tem extrato: lance os recebimentos e pagamentos direto nas contas a receber e a pagar.");

    let lido: ExtratoLido;
    try {
      lido = corpo.formato === "OFX" ? lerOfx(corpo.conteudo) : lerCsvExtrato(corpo.conteudo, { faturaCartao: conta.tipo === "CARTAO" });
    } catch (e) {
      throw new ErroHttp(400, "ARQUIVO_INVALIDO", (e as Error).message);
    }
    if (lido.linhas.length > MAX_LINHAS) throw new ErroHttp(400, "ARQUIVO_GRANDE", `O arquivo tem mais de ${MAX_LINHAS} lançamentos. Divida por período.`);
    const avisos: string[] = [];
    if (lido.formato === "OFX" && lido.ehCartao !== (conta.tipo === "CARTAO")) avisos.push(lido.ehCartao ? "O arquivo parece ser de cartão de crédito, mas a conta escolhida não é um cartão." : "O arquivo parece ser de conta bancária, mas a conta escolhida é um cartão.");
    if (lido.conta && conta.finalConta && !lido.conta.endsWith(conta.finalConta)) avisos.push("O número da conta no arquivo não termina com os dígitos cadastrados nesta conta. Confira se escolheu a conta certa.");
    if (lido.ignoradas.length) avisos.push(`${lido.ignoradas.length} linha(s) ignorada(s) por data/valor inválido ou zerado.`);

    const { preparadas } = prepararLinhas(lido.linhas);
    const existentes = new Set<string>();
    for (let i = 0; i < preparadas.length; i += 1000) {
      const ids = preparadas.slice(i, i + 1000).map((l) => l.idUnico);
      const r = await db.select({ idUnico: finExtratoLinhas.idUnico }).from(finExtratoLinhas).where(and(eq(finExtratoLinhas.contaId, conta.id), inArray(finExtratoLinhas.idUnico, ids)));
      for (const x of r) existentes.add(x.idUnico);
    }
    const novas = preparadas.filter((l) => !existentes.has(l.idUnico));
    const repetidas = lido.linhas.length - novas.length;
    const resumo = { total: lido.linhas.length, novas: novas.length, repetidas, ignoradas: lido.ignoradas.slice(0, 20), avisos, inicio: lido.inicio, fim: lido.fim, saldoCentavos: lido.saldoCentavos };
    if (!corpo.confirmar) return { previa: true as const, ...resumo, amostra: novas.slice(0, 10).map((l) => ({ data: l.data, valorCentavos: l.valorCentavos, descricao: l.descricao })) };

    const extratoId = await db.transaction(async (tx) => {
      const [ext] = await tx.insert(finExtratos).values({
        contaId: conta.id, arquivo: corpo.arquivo ?? null, formato: lido.formato, inicio: lido.inicio, fim: lido.fim, saldoCentavos: lido.saldoCentavos,
        linhas: lido.linhas.length, novas: novas.length, repetidas, importadoPor: u.id,
      }).returning({ id: finExtratos.id });
      let gravadas = 0;
      for (let i = 0; i < novas.length; i += 500) {
        const r = await tx.insert(finExtratoLinhas).values(novas.slice(i, i + 500).map((l) => ({
          contaId: conta.id, extratoId: ext!.id, idUnico: l.idUnico, data: l.data, valorCentavos: l.valorCentavos, descricao: l.descricao, documento: l.documento,
        }))).onConflictDoNothing().returning({ id: finExtratoLinhas.id });
        gravadas += r.length;
      }
      if (gravadas !== novas.length) await tx.update(finExtratos).set({ novas: gravadas, repetidas: lido.linhas.length - gravadas }).where(eq(finExtratos.id, ext!.id));
      return ext!.id;
    });
    await auditar(db, req, "FIN_EXTRATO_IMPORTADO", { tipo: "fin_conta", id: conta.id }, { formato: lido.formato, arquivo: corpo.arquivo ?? null, novas: novas.length, repetidas });
    return { previa: false as const, extratoId, ...resumo };
  });

  app.get("/api/financeiro/extratos", ver, async (req) => {
    const { contaId } = z.object({ contaId: uuid }).parse(req.query);
    await garantirConta(db, req.usuario!, contaId);
    return db.select().from(finExtratos).where(eq(finExtratos.contaId, contaId)).orderBy(desc(finExtratos.criadoEm)).limit(20);
  });

  // ------------------------------------------------------------------ linhas e sugestões
  app.get("/api/financeiro/extrato/linhas", ver, async (req) => {
    const u = req.usuario!;
    const q = z.object({
      contaId: uuid, status: z.enum(["PENDENTE", "CONCILIADO", "TRANSFERENCIA", "IGNORADO"]).optional(),
      de: dataIso.optional(), ate: dataIso.optional(), q: z.string().trim().max(100).optional(),
      pagina: z.coerce.number().int().min(1).max(10_000).default(1), limite: z.coerce.number().int().min(1).max(200).default(100),
    }).parse(req.query);
    const conta = await garantirConta(db, u, q.contaId);
    const busca = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const where = and(
      eq(finExtratoLinhas.contaId, conta.id),
      q.status ? eq(finExtratoLinhas.status, q.status) : undefined,
      q.de ? gte(finExtratoLinhas.data, q.de) : undefined, q.ate ? lte(finExtratoLinhas.data, q.ate) : undefined,
      busca ? ilike(finExtratoLinhas.descricao, busca) : undefined,
    );
    const linhas = await db.select({
      id: finExtratoLinhas.id, data: finExtratoLinhas.data, valorCentavos: finExtratoLinhas.valorCentavos, descricao: finExtratoLinhas.descricao,
      documento: finExtratoLinhas.documento, status: finExtratoLinhas.status, lancamentoId: finExtratoLinhas.lancamentoId, parLinhaId: finExtratoLinhas.parLinhaId,
      manual: finExtratoLinhas.manual, observacao: finExtratoLinhas.observacao, lancamentoDescricao: finLancamentos.descricao,
    }).from(finExtratoLinhas).leftJoin(finLancamentos, eq(finLancamentos.id, finExtratoLinhas.lancamentoId))
      .where(where).orderBy(desc(finExtratoLinhas.data), asc(finExtratoLinhas.id)).limit(q.limite).offset((q.pagina - 1) * q.limite);

    const [totalRow] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(finExtratoLinhas).where(where);
    const porStatus = await db.select({ status: finExtratoLinhas.status, n: sql<number>`count(*)`.mapWith(Number) }).from(finExtratoLinhas).where(eq(finExtratoLinhas.contaId, conta.id)).groupBy(finExtratoLinhas.status);

    const pendentes = linhas.filter((l) => l.status === "PENDENTE");
    let enriquecidas: Array<Record<string, unknown>> = linhas;
    if (pendentes.length) {
      const datas = pendentes.map((l) => l.data).sort();
      const de = somarDiasIso(datas[0]!, -60);
      const ate = somarDiasIso(datas.at(-1)!, 60);
      const candidatosDb = await db.select({
        id: finLancamentos.id, tipo: finLancamentos.tipo, valorCentavos: finLancamentos.valorCentavos, vencimento: finLancamentos.vencimento,
        descricao: finLancamentos.descricao, contraparte: finLancamentos.contraparte, categoriaNome: finCategorias.nome,
      }).from(finLancamentos).innerJoin(finCategorias, eq(finCategorias.id, finLancamentos.categoriaId))
        .where(and(filtroPraca(u, finLancamentos.unidadeId), eq(finLancamentos.situacao, "ABERTO"), gte(finLancamentos.vencimento, de), lte(finLancamentos.vencimento, ate)))
        .orderBy(asc(finLancamentos.vencimento)).limit(3000);
      const candidatos: LancamentoCandidato[] = candidatosDb.map((c) => ({ id: c.id, tipo: c.tipo as "PAGAR" | "RECEBER", valorCentavos: c.valorCentavos, vencimento: c.vencimento, descricao: c.descricao, contraparte: c.contraparte }));
      const recusas = await db.select().from(finRecusas).where(inArray(finRecusas.linhaId, pendentes.map((l) => l.id)));
      const regrasDb = await db.select().from(finRegras).where(eq(finRegras.ativa, true));
      const catsRows = await db.select({ id: finCategorias.id, nome: finCategorias.nome, tipo: finCategorias.tipo }).from(finCategorias);
      const nomesCat = new Map(catsRows.map((c) => [c.id, c.nome]));
      const tiposCat = new Map(catsRows.map((c) => [c.id, c.tipo]));
      // Regra sem tipo vale pelo tipo da categoria: nunca sugere categoria de despesa para uma entrada.
      const regras: RegraCategoria[] = regrasDb.map((r) => ({ id: r.id, texto: r.texto, tipo: (r.tipo ?? tiposCat.get(r.categoriaId) ?? null) as RegraCategoria["tipo"], categoriaId: r.categoriaId, prioridade: r.prioridade }));
      // Possíveis pares de transferência: linha pendente de outra conta visível, valor oposto, até 3 dias de diferença.
      const contasVisiveis = await db.select({ id: finContas.id, nome: finContas.nome }).from(finContas).where(filtroPraca(u, finContas.unidadeId));
      const idsContas = contasVisiveis.filter((c) => c.id !== conta.id).map((c) => c.id);
      const candidatosPar = idsContas.length ? await db.select({ id: finExtratoLinhas.id, contaId: finExtratoLinhas.contaId, data: finExtratoLinhas.data, valorCentavos: finExtratoLinhas.valorCentavos, descricao: finExtratoLinhas.descricao })
        .from(finExtratoLinhas).where(and(inArray(finExtratoLinhas.contaId, idsContas), eq(finExtratoLinhas.status, "PENDENTE"), gte(finExtratoLinhas.data, somarDiasIso(datas[0]!, -3)), lte(finExtratoLinhas.data, somarDiasIso(datas.at(-1)!, 3)),
          inArray(finExtratoLinhas.valorCentavos, pendentes.map((l) => -l.valorCentavos)))).limit(2000) : [];
      const porId = new Map(candidatosDb.map((c) => [c.id, c]));
      enriquecidas = linhas.map((l) => {
        if (l.status !== "PENDENTE") return l;
        const recusados = new Set(recusas.filter((r) => r.linhaId === l.id).map((r) => r.lancamentoId));
        const sugestoes = sugerirCorrespondencias({ valorCentavos: l.valorCentavos, data: l.data, descricao: l.descricao }, candidatos, recusados, 3)
          .map((s) => ({ ...s, lancamento: { descricao: porId.get(s.lancamentoId)!.descricao, contraparte: porId.get(s.lancamentoId)!.contraparte, valorCentavos: porId.get(s.lancamentoId)!.valorCentavos, vencimento: porId.get(s.lancamentoId)!.vencimento, categoriaNome: porId.get(s.lancamentoId)!.categoriaNome } }));
        const regra = sugerirCategoria(l.descricao, l.valorCentavos, regras);
        const regraDb = regra ? regrasDb.find((r) => r.id === regra.id)! : null;
        const pares = candidatosPar.filter((p) => p.valorCentavos === -l.valorCentavos && Math.abs((Date.parse(p.data) - Date.parse(l.data)) / 86_400_000) <= 3).slice(0, 3)
          .map((p) => ({ id: p.id, contaId: p.contaId, contaNome: contasVisiveis.find((c) => c.id === p.contaId)?.nome ?? "", data: p.data, descricao: p.descricao }));
        return {
          ...l, sugestoes, pares,
          categoriaSugerida: regraDb ? { regraId: regraDb.id, categoriaId: regraDb.categoriaId, categoriaNome: nomesCat.get(regraDb.categoriaId) ?? "", unidadeId: regraDb.unidadeId, linha: regraDb.linha } : null,
        };
      });
    }
    return { conta: { id: conta.id, nome: conta.nome, tipo: conta.tipo }, linhas: enriquecidas, total: totalRow!.n, porStatus: Object.fromEntries(porStatus.map((s) => [s.status, s.n])) };
  });

  // ------------------------------------------------------------------ decisões sobre uma linha
  const idLinha = z.object({ id: uuid });

  app.post("/api/financeiro/extrato/linhas/:id/conciliar", gerenciar, async (req) => {
    const u = req.usuario!;
    const { id } = idLinha.parse(req.params);
    const corpo = z.object({ lancamentoId: uuid, diferenca: z.enum(["JUROS", "MULTA", "DESCONTO"]).optional() }).parse(req.body);
    const { linha, conta } = await garantirLinha(db, u, id);
    if (linha.status !== "PENDENTE") throw new ErroHttp(409, "LINHA_JA_DECIDIDA", "Esta linha já foi conciliada, ignorada ou marcada como transferência.");
    const lanc = await garantirLancamento(db, u, corpo.lancamentoId);
    if (lanc.tipo !== (linha.valorCentavos < 0 ? "PAGAR" : "RECEBER")) throw new ErroHttp(400, "SENTIDO_INCOMPATIVEL", linha.valorCentavos < 0 ? "Saída só concilia com conta a pagar." : "Entrada só concilia com conta a receber.");
    if (await estaConciliado(db, lanc.id)) throw new ErroHttp(409, "LANCAMENTO_JA_CONCILIADO", "Este lançamento já está conciliado com outra linha.");
    const valorLinha = Math.abs(linha.valorCentavos);

    let juros = 0, multa = 0, desconto = 0;
    if (lanc.situacao === "ABERTO") {
      const diferenca = valorLinha - lanc.valorCentavos;
      if (diferenca !== 0) {
        const ok = diferenca > 0 ? corpo.diferenca === "JUROS" || corpo.diferenca === "MULTA" : corpo.diferenca === "DESCONTO";
        if (!ok) throw new ErroHttp(400, "DIFERENCA_SEM_DESTINO", `O valor da linha difere do lançamento em ${centavosParaTexto(Math.abs(diferenca))}. Informe se é ${diferenca > 0 ? "juros ou multa" : "desconto"} para conciliar.`);
        if (corpo.diferenca === "JUROS") juros = diferenca; else if (corpo.diferenca === "MULTA") multa = diferenca; else desconto = -diferenca;
      }
      if (calcularBaixa({ valorCentavos: lanc.valorCentavos, jurosCentavos: juros, multaCentavos: multa, descontoCentavos: desconto }) !== valorLinha) throw new ErroHttp(400, "BAIXA_INVALIDA", "Valores não fecham com a linha do extrato.");
    } else {
      if ((lanc.valorPagoCentavos ?? 0) !== valorLinha) throw new ErroHttp(409, "VALOR_DIFERENTE", "O lançamento já baixado tem valor pago diferente da linha. Reabra a baixa para conciliar.");
      if (lanc.contaId && lanc.contaId !== conta.id) throw new ErroHttp(409, "CONTA_DIFERENTE", "O lançamento foi baixado em outra conta.");
    }

    try {
      await db.transaction(async (tx) => {
        if (lanc.situacao === "ABERTO") {
          const r = await tx.update(finLancamentos).set({
            situacao: "REALIZADO", pagoEm: linha.data, contaId: conta.id, valorPagoCentavos: valorLinha,
            jurosCentavos: juros, multaCentavos: multa, descontoCentavos: desconto, atualizadoEm: new Date(),
          }).where(and(eq(finLancamentos.id, lanc.id), eq(finLancamentos.situacao, "ABERTO"))).returning({ id: finLancamentos.id });
          if (r.length === 0) throw new ErroHttp(409, "LANCAMENTO_MUDOU", "O lançamento foi alterado por outra pessoa. Atualize a tela.");
        }
        const l = await tx.update(finExtratoLinhas).set({ status: "CONCILIADO", lancamentoId: lanc.id, baixaDaConciliacao: lanc.situacao === "ABERTO", decididoPor: u.id, decididoEm: new Date() })
          .where(and(eq(finExtratoLinhas.id, id), eq(finExtratoLinhas.status, "PENDENTE"))).returning({ id: finExtratoLinhas.id });
        if (l.length === 0) throw new ErroHttp(409, "LINHA_JA_DECIDIDA", "Esta linha já foi decidida por outra pessoa. Atualize a tela.");
      });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErroHttp(409, "LANCAMENTO_JA_CONCILIADO", "Este lançamento já está conciliado com outra linha.");
      throw e;
    }
    await auditar(db, req, "FIN_CONCILIADO", { tipo: "fin_extrato_linha", id }, { lancamentoId: lanc.id, valorCentavos: valorLinha, jurosCentavos: juros, multaCentavos: multa, descontoCentavos: desconto });
    return { ok: true, jurosCentavos: juros, multaCentavos: multa, descontoCentavos: desconto };
  });

  app.post("/api/financeiro/extrato/linhas/:id/recusar", gerenciar, async (req) => {
    const u = req.usuario!;
    const { id } = idLinha.parse(req.params);
    const { lancamentoId } = z.object({ lancamentoId: uuid }).parse(req.body);
    const { linha } = await garantirLinha(db, u, id);
    if (linha.status !== "PENDENTE") throw new ErroHttp(409, "LINHA_JA_DECIDIDA", "Esta linha já foi decidida.");
    await garantirLancamento(db, u, lancamentoId);
    await db.insert(finRecusas).values({ linhaId: id, lancamentoId, recusadoPor: u.id }).onConflictDoNothing();
    await auditar(db, req, "FIN_SUGESTAO_RECUSADA", { tipo: "fin_extrato_linha", id }, { lancamentoId });
    return { ok: true };
  });

  app.post("/api/financeiro/extrato/linhas/:id/lancar", gerenciar, async (req) => {
    const u = req.usuario!;
    const { id } = idLinha.parse(req.params);
    const corpo = z.object({
      categoriaId: uuid, descricao: z.string().trim().max(200).nullish(), contraparte: z.string().trim().max(150).nullish(),
      unidadeId: uuid.nullish(), linha: z.enum(LINHAS_FINANCEIRO).nullish(), veiculo: veiculoOpcional,
      canal: z.enum(CANAIS).nullish(), forma: z.enum(FORMAS_PAGAMENTO).nullish(), competencia: dataIso.nullish(),
    }).parse(req.body);
    const { linha, conta } = await garantirLinha(db, u, id);
    if (linha.status !== "PENDENTE") throw new ErroHttp(409, "LINHA_JA_DECIDIDA", "Esta linha já foi decidida.");
    const tipo = linha.valorCentavos < 0 ? "PAGAR" : "RECEBER";
    await validarCategoria(db, corpo.categoriaId, tipo);
    const unidadeId = await validarPracaDoRegistro(db, u, corpo.unidadeId === undefined ? conta.unidadeId : corpo.unidadeId);
    const valor = Math.abs(linha.valorCentavos);
    const novoId = await db.transaction(async (tx) => {
      const [l] = await tx.insert(finLancamentos).values({
        tipo, descricao: (corpo.descricao || linha.descricao || "Lançamento do extrato").slice(0, 200), contraparte: corpo.contraparte ?? null, categoriaId: corpo.categoriaId,
        contaId: conta.id, unidadeId, linha: corpo.linha ?? null, veiculo: corpo.veiculo || null, canal: corpo.canal ?? null,
        forma: corpo.forma ?? (conta.tipo === "CARTAO" ? "CARTAO" : null), valorCentavos: valor, competencia: corpo.competencia ?? linha.data, vencimento: linha.data,
        situacao: "REALIZADO", pagoEm: linha.data, valorPagoCentavos: valor, origem: "EXTRATO", criadoPor: u.id,
      }).returning({ id: finLancamentos.id });
      const r = await tx.update(finExtratoLinhas).set({ status: "CONCILIADO", lancamentoId: l!.id, decididoPor: u.id, decididoEm: new Date() })
        .where(and(eq(finExtratoLinhas.id, id), eq(finExtratoLinhas.status, "PENDENTE"))).returning({ id: finExtratoLinhas.id });
      if (r.length === 0) throw new ErroHttp(409, "LINHA_JA_DECIDIDA", "Esta linha já foi decidida por outra pessoa. Atualize a tela.");
      return l!.id;
    });
    await auditar(db, req, "FIN_LANCADO_DO_EXTRATO", { tipo: "fin_extrato_linha", id }, { lancamentoId: novoId, tipo, valorCentavos: valor });
    return { lancamentoId: novoId };
  });

  app.post("/api/financeiro/extrato/linhas/:id/ignorar", gerenciar, async (req) => {
    const u = req.usuario!;
    const { id } = idLinha.parse(req.params);
    const { observacao } = z.object({ observacao: z.string().trim().max(300).nullish() }).parse(req.body ?? {});
    await garantirLinha(db, u, id);
    const r = await db.update(finExtratoLinhas).set({ status: "IGNORADO", observacao: observacao ?? null, decididoPor: u.id, decididoEm: new Date() })
      .where(and(eq(finExtratoLinhas.id, id), eq(finExtratoLinhas.status, "PENDENTE"))).returning({ id: finExtratoLinhas.id });
    if (r.length === 0) throw new ErroHttp(409, "LINHA_JA_DECIDIDA", "Esta linha já foi decidida.");
    await auditar(db, req, "FIN_LINHA_IGNORADA", { tipo: "fin_extrato_linha", id });
    return { ok: true };
  });

  /** Desfaz a decisão de uma linha (conciliação, transferência ou "ignorar"). */
  app.post("/api/financeiro/extrato/linhas/:id/desfazer", gerenciar, async (req) => {
    const u = req.usuario!;
    const { id } = idLinha.parse(req.params);
    const { linha } = await garantirLinha(db, u, id);
    if (linha.status === "PENDENTE") throw new ErroHttp(409, "LINHA_PENDENTE", "Esta linha ainda não foi decidida.");
    await db.transaction(async (tx) => {
      if (linha.status === "CONCILIADO" && linha.lancamentoId) {
        const [lanc] = await tx.select().from(finLancamentos).where(eq(finLancamentos.id, linha.lancamentoId));
        await tx.update(finExtratoLinhas).set({ status: "PENDENTE", lancamentoId: null, baixaDaConciliacao: false, decididoPor: u.id, decididoEm: new Date() }).where(eq(finExtratoLinhas.id, id));
        if (lanc?.origem === "EXTRATO") await tx.delete(finLancamentos).where(eq(finLancamentos.id, lanc.id));
        else if (lanc && linha.baixaDaConciliacao) {
          // Só quando foi ESTA conciliação que baixou o lançamento ele volta a ficar em aberto; baixa manual anterior fica como está.
          await tx.update(finLancamentos).set({ situacao: "ABERTO", pagoEm: null, valorPagoCentavos: null, jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0, atualizadoEm: new Date() }).where(eq(finLancamentos.id, lanc.id));
        }
      } else if (linha.status === "TRANSFERENCIA") {
        const par = linha.parLinhaId ? (await tx.select().from(finExtratoLinhas).where(eq(finExtratoLinhas.id, linha.parLinhaId)))[0] : undefined;
        const todas = par ? [linha, par] : [linha];
        for (const l of todas) {
          if (l.manual) await tx.delete(finExtratoLinhas).where(eq(finExtratoLinhas.id, l.id));
          else await tx.update(finExtratoLinhas).set({ status: "PENDENTE", parLinhaId: null, decididoPor: u.id, decididoEm: new Date() }).where(eq(finExtratoLinhas.id, l.id));
        }
      } else {
        await tx.update(finExtratoLinhas).set({ status: "PENDENTE", observacao: null, decididoPor: u.id, decididoEm: new Date() }).where(eq(finExtratoLinhas.id, id));
      }
    });
    await auditar(db, req, "FIN_DECISAO_DESFEITA", { tipo: "fin_extrato_linha", id }, { statusAnterior: linha.status });
    return { ok: true };
  });

  // ------------------------------------------------------------------ transferências entre contas
  app.post("/api/financeiro/extrato/linhas/:id/transferencia", gerenciar, async (req) => {
    const u = req.usuario!;
    const { id } = idLinha.parse(req.params);
    const { parLinhaId } = z.object({ parLinhaId: uuid }).parse(req.body);
    if (parLinhaId === id) throw new ErroHttp(400, "PAR_INVALIDO", "Escolha outra linha.");
    const { linha: a } = await garantirLinha(db, u, id);
    const { linha: b } = await garantirLinha(db, u, parLinhaId);
    if (a.contaId === b.contaId) throw new ErroHttp(400, "MESMA_CONTA", "Transferência liga linhas de contas diferentes.");
    if (a.valorCentavos !== -b.valorCentavos) throw new ErroHttp(400, "VALORES_DIFERENTES", "As duas linhas precisam ter o mesmo valor, uma de entrada e outra de saída.");
    await db.transaction(async (tx) => {
      for (const [x, y] of [[a, b], [b, a]] as const) {
        const r = await tx.update(finExtratoLinhas).set({ status: "TRANSFERENCIA", parLinhaId: y.id, decididoPor: u.id, decididoEm: new Date() })
          .where(and(eq(finExtratoLinhas.id, x.id), eq(finExtratoLinhas.status, "PENDENTE"))).returning({ id: finExtratoLinhas.id });
        if (r.length === 0) throw new ErroHttp(409, "LINHA_JA_DECIDIDA", "Uma das linhas já foi decidida. Atualize a tela.");
      }
    });
    await auditar(db, req, "FIN_TRANSFERENCIA_PAREADA", { tipo: "fin_extrato_linha", id }, { parLinhaId, valorCentavos: Math.abs(a.valorCentavos) });
    return { ok: true };
  });

  /** Transferência lançada à mão (ex.: pagamento da fatura do cartão, sangria do caixa): cria as duas pontas já pareadas. */
  app.post("/api/financeiro/transferencias", gerenciar, async (req) => {
    const u = req.usuario!;
    const corpo = z.object({
      contaOrigemId: uuid, contaDestinoId: uuid, valorCentavos: z.number().int().positive().max(100_000_000_00), data: dataIso, descricao: z.string().trim().max(200).nullish(),
    }).parse(req.body);
    if (corpo.contaOrigemId === corpo.contaDestinoId) throw new ErroHttp(400, "MESMA_CONTA", "Escolha contas diferentes.");
    if (corpo.data > hojeSP()) throw new ErroHttp(400, "DATA_FUTURA", "A data da transferência não pode ser futura.");
    const origem = await garantirConta(db, u, corpo.contaOrigemId);
    const destino = await garantirConta(db, u, corpo.contaDestinoId);
    if (!origem.ativa || !destino.ativa) throw new ErroHttp(400, "CONTA_INATIVA", "Uma das contas está desativada.");
    const idA = randomUUID();
    const idB = randomUUID();
    const texto = corpo.descricao || `Transferência ${origem.nome} → ${destino.nome}`;
    await db.insert(finExtratoLinhas).values([
      { id: idA, contaId: origem.id, idUnico: `manual:${idA}`, data: corpo.data, valorCentavos: -corpo.valorCentavos, descricao: texto, status: "TRANSFERENCIA", parLinhaId: idB, manual: true, decididoPor: u.id, decididoEm: new Date() },
      { id: idB, contaId: destino.id, idUnico: `manual:${idB}`, data: corpo.data, valorCentavos: corpo.valorCentavos, descricao: texto, status: "TRANSFERENCIA", parLinhaId: idA, manual: true, decididoPor: u.id, decididoEm: new Date() },
    ]);
    await auditar(db, req, "FIN_TRANSFERENCIA_CRIADA", { tipo: "fin_extrato_linha", id: idA }, { origem: origem.id, destino: destino.id, valorCentavos: corpo.valorCentavos });
    return { linhaOrigemId: idA, linhaDestinoId: idB };
  });
}
