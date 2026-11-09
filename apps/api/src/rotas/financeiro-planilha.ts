import { ALVO_APLICACAO, ALVO_IGNORAR, ALVO_TRANSFERENCIA, GRUPOS_CANONICOS, ROTULO_COLUNA, normalizarTexto, type ColunaValor } from "@bybus/core";
import { asc, eq, ilike, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { finCategorias, finFornecedores, finSinonimos } from "../db/schema.js";
import { ErroHttp } from "../seguranca/sessao.js";
import { garantirPlano, garantirSinonimos } from "../servicos/financeiro.js";
import { criarContasPadrao, executarPlanilha, listarPendencias, planejarPlanilha, registrarPendencias, resolverPendencias, type PlanoPlanilha } from "../servicos/financeiro-planilha.js";
import { uuid } from "./financeiro-comum.js";

interface Guardas {
  ver: { preHandler: (req: FastifyRequest) => Promise<void> };
  gerenciar: { preHandler: (req: FastifyRequest) => Promise<void> };
}

/** Resposta da prévia: contagens e exemplos. Nunca inclui o OBS nem dados de contato dos favorecidos. */
function resumoDoPlano(p: PlanoPlanilha) {
  const novosL = p.lancamentos.filter((i) => !p.existentes.has(i.chave));
  const porConta = (["APAGAR", "SICREDI", "UNILOS", "QUIOSQUE", "CARTAO"] as ColunaValor[]).map((coluna) => {
    const itens = novosL.filter((i) => i.coluna === coluna);
    const info = p.contas.find((c) => c.coluna === coluna);
    return {
      coluna, rotulo: coluna === "APAGAR" ? "A pagar (em aberto)" : ROTULO_COLUNA[coluna], conta: info?.nome ?? null, criar: info?.criar ?? false,
      qtd: itens.length, entradasCentavos: itens.filter((i) => i.tipo === "RECEBER").reduce((s, i) => s + i.valorCentavos, 0), saidasCentavos: itens.filter((i) => i.tipo === "PAGAR").reduce((s, i) => s + i.valorCentavos, 0),
    };
  }).filter((x) => x.qtd > 0 || (x.coluna !== "APAGAR" && p.contas.some((c) => c.coluna === x.coluna)));
  return {
    layout: p.layout,
    cabecalhoLinha: p.cabecalhoLinha,
    lidos: p.lancamentos.length + p.transferencias.length,
    novos: p.novos, jaExistentes: p.jaExistentes,
    abertos: novosL.filter((i) => i.aberto).length, realizados: novosL.filter((i) => !i.aberto).length,
    porConta,
    saldos: p.saldos.map((s) => ({ coluna: s.coluna, rotulo: ROTULO_COLUNA[s.coluna], valorCentavos: s.valorCentavos, data: s.data, aplicar: s.aplicar, motivo: s.motivo, calculadoCentavos: s.calculadoCentavos, divergenciaCentavos: s.divergenciaCentavos })),
    transferencias: p.transferencias.length,
    contasACriar: p.contas.filter((c) => c.criar).map((c) => c.nome),
    qualidade: {
      dataInvalida: { total: p.qualidade.dataInvalida.length, linhas: p.qualidade.dataInvalida.slice(0, 20) },
      mesDiferente: { total: p.qualidade.mesDiferente.length, linhas: p.qualidade.mesDiferente.slice(0, 20) },
      anoFora: { total: p.qualidade.anoFora.length, linhas: p.qualidade.anoFora.slice(0, 20) },
      grupoVazio: { total: p.qualidade.grupoVazio.length, linhas: p.qualidade.grupoVazio.slice(0, 20) },
      grafias: p.qualidade.grafias.slice(0, 20),
      duplicadas: { total: p.qualidade.duplicadas.length, grupos: p.qualidade.duplicadas.slice(0, 20) },
      pessoaFisica: { total: p.qualidade.pessoaFisica.length, linhas: p.qualidade.pessoaFisica.slice(0, 20) },
      previstas: p.qualidade.previstas, apagarSemConta: p.qualidade.apagarSemConta, apagarDiferente: p.qualidade.apagarDiferente,
    },
    naoReconhecidos: p.naoReconhecidos,
    avisos: p.avisos.slice(0, 30), ignoradas: p.ignoradas, erros: p.erros.slice(0, 20), totalErros: p.erros.length,
    amostra: novosL.slice(0, 10).map((i) => ({ data: i.data, tipo: i.tipo, aberto: i.aberto, descricao: i.descricao, categoria: i.categoriaNome, fornecedor: i.fornecedor || null, valorCentavos: i.valorCentavos, conta: i.aberto ? null : p.contas.find((c) => c.coluna === i.coluna)?.nome ?? null })),
  };
}

export async function rotasFinanceiroPlanilha(app: FastifyInstance, { db, cofre }: Contexto, { ver, gerenciar }: Guardas) {
  const corpoImportacao = z.object({
    conteudo: z.string().min(1).max(5_500_000),
    arquivo: z.string().trim().max(200).nullish(),
    unidadeId: uuid.nullish(),
    mapeamentos: z.record(z.string().max(200), z.union([z.string().uuid(), z.enum(["IGNORAR", "TRANSFERENCIA"])])).default({}),
    salvarSinonimos: z.boolean().default(false),
    confirmar: z.boolean().default(false),
  });

  /** Importa uma aba da planilha de controle (CSV exportado do Google Sheets). Duas etapas: prévia e confirmação. */
  app.post("/api/financeiro/planilha/importar", { ...gerenciar, bodyLimit: 6 * 1024 * 1024 }, async (req) => {
    const u = req.usuario!;
    const corpo = corpoImportacao.parse(req.body);
    const plano = await planejarPlanilha(db, u, { conteudo: corpo.conteudo, unidadeId: corpo.unidadeId ?? null, mapeamentos: corpo.mapeamentos });
    if (!corpo.confirmar) return { previa: true as const, ...resumoDoPlano(plano) };
    if (plano.erros.length) throw new ErroHttp(400, "PLANILHA_COM_ERROS", `Há ${plano.erros.length} linha(s) com valor inválido (ex.: linha ${plano.erros[0]!.linha}). Corrija a planilha e importe de novo.`);
    const r = await executarPlanilha(db, cofre, u, plano, { salvarSinonimos: corpo.salvarSinonimos });
    // "Não importar ainda" fica guardado em Financeiro › Pendências (sem precisar importar de novo).
    const pendentes = await registrarPendencias(db, cofre, u, { conteudo: corpo.conteudo, unidadeId: corpo.unidadeId ?? null, arquivo: corpo.arquivo ?? null }, plano);
    // Auditoria só com contagens: nenhum dado do OBS ou de contato.
    await auditar(db, req, "FIN_PLANILHA_IMPORTADA", { tipo: "fin_planilha" }, { arquivo: corpo.arquivo ?? null, lancamentos: r.lancamentos, transferencias: r.transferencias, jaExistentes: r.jaExistentes, contasCriadas: r.contasCriadas.length, saldosAplicados: r.saldosAplicados });
    return { previa: false as const, ...resumoDoPlano(plano), resultado: { ...r, pendentes } };
  });

  /** Pendências de categoria guardadas das importações ("não importar ainda"). */
  app.get("/api/financeiro/planilha/pendencias", ver, async (req) => listarPendencias(db, req.usuario!));

  /** Classifica as pendências: aplica às abas guardadas, sem importar de novo. */
  app.post("/api/financeiro/planilha/pendencias/resolver", { ...gerenciar, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const corpo = z.object({
      mapeamentos: z.record(z.string().max(200), z.union([z.string().uuid(), z.enum(["IGNORAR", "TRANSFERENCIA"])])),
      salvarSinonimos: z.boolean().default(true),
    }).parse(req.body);
    if (!Object.keys(corpo.mapeamentos).length) throw new ErroHttp(400, "SEM_ESCOLHAS", "Escolha a categoria de pelo menos uma pendência.");
    const r = await resolverPendencias(db, cofre, req.usuario!, corpo.mapeamentos, corpo.salvarSinonimos);
    await auditar(db, req, "FIN_PENDENCIAS_RESOLVIDAS", { tipo: "fin_planilha" }, { escolhas: Object.keys(corpo.mapeamentos).length, ...r });
    return r;
  });

  // ---------------------------------------------------------------- contas padrão
  app.post("/api/financeiro/contas/padrao", gerenciar, async (req) => {
    const { unidadeId } = z.object({ unidadeId: uuid.nullish() }).parse(req.body ?? {});
    const criadas = await criarContasPadrao(db, req.usuario!, unidadeId ?? null);
    await auditar(db, req, "FIN_CONTAS_PADRAO", { tipo: "fin_conta" }, { criadas: criadas.length });
    return { criadas };
  });

  // ---------------------------------------------------------------- dicionário de sinônimos
  async function alvoValido(tipo: "GRUPO" | "CATEGORIA", alvo: string) {
    if (tipo === "GRUPO") {
      if (!(GRUPOS_CANONICOS as readonly string[]).includes(alvo)) throw new ErroHttp(400, "ALVO_INVALIDO", `Grupo desconhecido. Use um de: ${GRUPOS_CANONICOS.join(", ")}.`);
      return;
    }
    if (alvo === ALVO_TRANSFERENCIA || alvo === ALVO_IGNORAR || alvo === ALVO_APLICACAO) return;
    const [c] = await db.select({ id: finCategorias.id }).from(finCategorias).where(eq(finCategorias.codigo, alvo));
    if (!c) throw new ErroHttp(400, "ALVO_INVALIDO", "Categoria inexistente.");
  }
  const esquemaSinonimo = z.object({
    tipo: z.enum(["GRUPO", "CATEGORIA"]),
    texto: z.string().trim().min(1).max(120),
    alvo: z.string().trim().min(1).max(60),
  });

  app.get("/api/financeiro/sinonimos", ver, async () => {
    await garantirPlano(db);
    await garantirSinonimos(db);
    const nomes = new Map((await db.select({ codigo: finCategorias.codigo, nome: finCategorias.nome }).from(finCategorias)).map((c) => [c.codigo, c.nome]));
    const lista = await db.select().from(finSinonimos).orderBy(asc(finSinonimos.tipo), asc(finSinonimos.texto));
    return lista.map((s) => ({ ...s, alvoNome: s.tipo === "GRUPO" ? s.alvo : s.alvo === ALVO_TRANSFERENCIA ? "Transferência entre contas" : s.alvo === ALVO_APLICACAO ? "Aplicação ou resgate" : s.alvo === ALVO_IGNORAR ? "Ignorar a linha" : nomes.get(s.alvo) ?? s.alvo }));
  });

  app.post("/api/financeiro/sinonimos", gerenciar, async (req) => {
    const corpo = esquemaSinonimo.parse(req.body);
    const texto = normalizarTexto(corpo.texto);
    if (corpo.tipo === "CATEGORIA" && !/^[^|]+\|.+$/.test(texto)) throw new ErroHttp(400, "TEXTO_INVALIDO", 'Use o formato "GRUPO|CATEGORIA" (ex.: FROTA|MANUTENCAO). "*" vale para qualquer grupo ou categoria.');
    await alvoValido(corpo.tipo, corpo.alvo);
    try {
      const [s] = await db.insert(finSinonimos).values({ tipo: corpo.tipo, texto, alvo: corpo.alvo }).returning();
      await auditar(db, req, "FIN_SINONIMO_CRIADO", { tipo: "fin_sinonimo", id: s!.id }, { texto, alvo: corpo.alvo });
      return s;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErroHttp(409, "SINONIMO_EXISTE", "Este texto já está no dicionário. Edite o existente.");
      throw e;
    }
  });

  app.patch("/api/financeiro/sinonimos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { alvo } = z.object({ alvo: z.string().trim().min(1).max(60) }).parse(req.body);
    const [atual] = await db.select().from(finSinonimos).where(eq(finSinonimos.id, id));
    if (!atual) throw new ErroHttp(404, "NAO_ENCONTRADO", "Sinônimo não encontrado.");
    await alvoValido(atual.tipo as "GRUPO" | "CATEGORIA", alvo);
    const [s] = await db.update(finSinonimos).set({ alvo }).where(eq(finSinonimos.id, id)).returning();
    await auditar(db, req, "FIN_SINONIMO_ALTERADO", { tipo: "fin_sinonimo", id }, { texto: atual.texto, alvo });
    return s;
  });

  app.delete("/api/financeiro/sinonimos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const r = await db.delete(finSinonimos).where(eq(finSinonimos.id, id)).returning({ id: finSinonimos.id });
    if (r.length === 0) throw new ErroHttp(404, "NAO_ENCONTRADO", "Sinônimo não encontrado.");
    await auditar(db, req, "FIN_SINONIMO_EXCLUIDO", { tipo: "fin_sinonimo", id });
    return { ok: true };
  });

  // ---------------------------------------------------------------- favorecidos (dados de contato só para quem vê o financeiro)
  app.get("/api/financeiro/fornecedores", ver, async (req) => {
    const { q } = z.object({ q: z.string().trim().max(100).optional() }).parse(req.query);
    const busca = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const lista = await db.select({ id: finFornecedores.id, nome: finFornecedores.nome, temContato: sql<boolean>`${finFornecedores.contatoCifrado} is not null` })
      .from(finFornecedores).where(busca ? ilike(finFornecedores.nome, busca) : undefined).orderBy(asc(finFornecedores.nome)).limit(200);
    return lista;
  });

  app.get("/api/financeiro/fornecedores/:id", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [f] = await db.select().from(finFornecedores).where(eq(finFornecedores.id, id));
    if (!f) throw new ErroHttp(404, "NAO_ENCONTRADO", "Favorecido não encontrado.");
    const contato = f.contatoCifrado ? (JSON.parse(cofre.decifrar(f.contatoCifrado)) as { documentos: string[]; emails: string[]; telefones: string[] }) : { documentos: [], emails: [], telefones: [] };
    return { id: f.id, nome: f.nome, contato };
  });
}
