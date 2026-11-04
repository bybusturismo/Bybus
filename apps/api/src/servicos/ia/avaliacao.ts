import { dataSaoPaulo, GESTORES, type IdGestor } from "@bybus/core";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { ZodType } from "zod";
import type { Config } from "../../config.js";
import type { Db } from "../../db/cliente.js";
import { iaAcoes, iaAvaliacoes, iaPareceres } from "../../db/schema.js";
import { ErroIA, obterClienteIA, type BlocoIA, type ClienteIA, type FerramentaIA, type MensagemIA } from "./cliente.js";
import { garantirOrcamento, registrarUso, type DadosUso } from "./orcamento.js";
import { mensagemAvaliacao, mensagemDebate, mensagemSintese, sistemaGestor, sistemaSintese } from "./prompts.js";
import { montarRetratos } from "./retratos.js";
import {
  FERRAMENTA_AVALIACAO, FERRAMENTA_DEBATE, FERRAMENTA_SINTESE, zAvaliacao, zDebate, zSintese,
  type Avaliacao, type Debate, type Sintese,
} from "./saidas.js";

export interface Log {
  error: (o: unknown, m: string) => void;
  info: (o: unknown, m: string) => void;
}

const SEM_LOG: Log = { error: () => {}, info: () => {} };
const MINUTOS_TRAVADA = 45;

interface ChamadaEstruturada<T> {
  db: Db;
  cliente: ClienteIA;
  config: Config;
  modelo: string;
  esforco: "low" | "medium" | "high";
  sistema: string;
  ferramenta: FerramentaIA;
  parser: ZodType<T>;
  usuario: string;
  uso: DadosUso;
  maxTokens: number;
}

/**
 * Chama o modelo e exige a saída pela ferramenta de registro. Confere o limite mensal antes de cada chamada,
 * registra o uso e, se o modelo não chamar a ferramenta ou mandar algo inválido, tenta mais uma vez avisando o erro.
 */
export async function chamarEstruturado<T>(p: ChamadaEstruturada<T>): Promise<{ resultado: T; custo: number }> {
  const mensagens: MensagemIA[] = [{ role: "user", content: p.usuario }];
  let custo = 0;
  let ultimoErro = "o modelo não chamou a ferramenta de registro";
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    await garantirOrcamento(p.db, p.config);
    const r = await p.cliente.enviar({ modelo: p.modelo, esforco: p.esforco, sistema: p.sistema, ferramentas: [p.ferramenta], mensagens, maxTokens: p.maxTokens });
    custo += await registrarUso(p.db, p.modelo, r, { ...p.uso, ferramentas: [p.ferramenta.name] });
    if (r.stop_reason === "max_tokens") ultimoErro = "resposta cortada por limite de tamanho";
    const uso = r.content.find((b) => b.type === "tool_use" && b.name === p.ferramenta.name);
    if (uso) {
      const v = p.parser.safeParse(uso.input);
      if (v.success) return { resultado: v.data, custo };
      ultimoErro = v.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      mensagens.push({ role: "assistant", content: r.content });
      mensagens.push({ role: "user", content: [{ type: "tool_result", tool_use_id: uso.id, is_error: true, content: `Entrada inválida (${ultimoErro}). Chame a ferramenta de novo, corrigindo.` } as BlocoIA] });
    } else if (r.stop_reason !== "max_tokens") {
      mensagens.push({ role: "assistant", content: r.content });
      mensagens.push({ role: "user", content: `Registre o resultado chamando a ferramenta ${p.ferramenta.name}.` });
    }
  }
  throw new ErroIA("IA_RESPOSTA_INVALIDA", `A IA não entregou a saída estruturada (${ultimoErro}).`);
}

async function emLotes<T>(itens: T[], limite: number, fn: (x: T) => Promise<void>) {
  const fila = [...itens];
  await Promise.all(Array.from({ length: Math.min(limite, fila.length) }, async () => {
    for (let x = fila.shift(); x !== undefined; x = fila.shift()) await fn(x);
  }));
}

/** Avaliações "EXECUTANDO" há muito tempo (processo caiu no meio) viram FALHA, liberando uma nova rodada. */
export async function limparTravadas(db: Db, agora = new Date()) {
  await db
    .update(iaAvaliacoes)
    .set({ status: "FALHA", erro: "Interrompida (o servidor reiniciou ou demorou demais).", concluidaEm: agora })
    .where(and(eq(iaAvaliacoes.status, "EXECUTANDO"), lt(iaAvaliacoes.iniciadaEm, new Date(agora.getTime() - MINUTOS_TRAVADA * 60_000))));
}

export async function avaliacaoEmAndamento(db: Db) {
  await limparTravadas(db);
  const [r] = await db.select({ id: iaAvaliacoes.id }).from(iaAvaliacoes).where(eq(iaAvaliacoes.status, "EXECUTANDO")).limit(1);
  return r?.id ?? null;
}

export async function automaticaDoDia(db: Db, hoje: string) {
  const [r] = await db
    .select({ id: iaAvaliacoes.id })
    .from(iaAvaliacoes)
    .where(and(eq(iaAvaliacoes.dataRef, hoje), eq(iaAvaliacoes.origem, "AUTOMATICA"), inArray(iaAvaliacoes.status, ["EXECUTANDO", "CONCLUIDA", "PARCIAL", "LIMITE"])))
    .limit(1);
  return !!r;
}

/** Cria o registro da avaliação (status EXECUTANDO). O processamento longo é feito por `processarAvaliacao`. */
export async function iniciarAvaliacao(db: Db, config: Config, origem: "AUTOMATICA" | "MANUAL", usuarioId: string | null): Promise<string> {
  const [a] = await db
    .insert(iaAvaliacoes)
    .values({ dataRef: dataSaoPaulo(new Date()), origem, modelo: config.IA_MODELO, modeloSintese: config.IA_MODELO_SINTESE ?? config.IA_MODELO, iniciadaPor: usuarioId })
    .returning({ id: iaAvaliacoes.id });
  return a!.id;
}

/**
 * Avaliação completa: retratos → rodada 1 (cada gestor avalia a sua área) → rodada 2 (debate: cada um lê os achados
 * dos outros) → síntese. Tolera falhas parciais (um gestor com erro não derruba o resto) e para ao atingir o limite mensal.
 * Nada vira tarefa aqui: as ações ficam como SUGERIDA até uma pessoa aprovar.
 */
export async function processarAvaliacao(db: Db, config: Config, id: string, log: Log = SEM_LOG): Promise<void> {
  const [av] = await db.select().from(iaAvaliacoes).where(eq(iaAvaliacoes.id, id));
  if (!av) return;
  const falhas: string[] = [];
  let custo = 0;
  let limite = false;
  const modeloSintese = av.modeloSintese;
  const encerrar = async (status: string, extra: Partial<typeof iaAvaliacoes.$inferInsert> = {}) => {
    await db
      .update(iaAvaliacoes)
      .set({ status, concluidaEm: new Date(), custoMicroUsd: custo, erro: falhas.length ? falhas.join(" | ").slice(0, 1500) : null, ...extra })
      .where(eq(iaAvaliacoes.id, id));
  };
  try {
    const cliente = obterClienteIA(config);
    const retratos = await montarRetratos(db, av.dataRef, { limiteMesUsd: config.IA_LIMITE_MES_USD });
    await db.update(iaAvaliacoes).set({ retratos }).where(eq(iaAvaliacoes.id, id));
    const base = { db, cliente, config, uso: { avaliacaoId: id } as Omit<DadosUso, "tipo"> };

    // Rodada 1 — cada gestor avalia a própria área (em paralelo, no máximo 4 por vez).
    const rodada1 = new Map<IdGestor, Avaliacao>();
    await emLotes([...GESTORES], 4, async (g) => {
      try {
        const { resultado, custo: c } = await chamarEstruturado<Avaliacao>({
          ...base, modelo: config.IA_MODELO, esforco: config.IA_ESFORCO, maxTokens: 8000,
          sistema: sistemaGestor(g, FERRAMENTA_AVALIACAO.name), ferramenta: FERRAMENTA_AVALIACAO, parser: zAvaliacao,
          usuario: mensagemAvaliacao(av.dataRef, retratos[g.id]), uso: { ...base.uso, tipo: "AVALIACAO", gestor: g.id },
        });
        custo += c;
        rodada1.set(g.id, resultado);
        await db.insert(iaPareceres).values({ avaliacaoId: id, gestor: g.id, rodada: 1, conteudo: resultado });
      } catch (e) {
        if (e instanceof ErroIA && e.codigo === "IA_LIMITE") limite = true;
        falhas.push(`${g.id}: ${e instanceof Error ? e.message : "erro"}`);
        log.error({ gestor: g.id, erro: e instanceof Error ? e.message : e }, "Falha na avaliação de um gestor");
      }
    });
    if (rodada1.size === 0) {
      await encerrar(limite ? "LIMITE" : "FALHA");
      return;
    }

    // Rodada 2 — debate: cada gestor lê os achados dos outros e complementa.
    const rodada2 = new Map<IdGestor, Debate>();
    if (!limite && rodada1.size >= 2) {
      await emLotes([...rodada1.keys()], 4, async (gid) => {
        const g = GESTORES.find((x) => x.id === gid)!;
        const outros = [...rodada1.entries()].filter(([k]) => k !== gid).map(([k, v]) => ({ gestor: k, avaliacao: v }));
        try {
          const { resultado, custo: c } = await chamarEstruturado<Debate>({
            ...base, modelo: config.IA_MODELO, esforco: config.IA_ESFORCO, maxTokens: 8000,
            sistema: sistemaGestor(g, FERRAMENTA_DEBATE.name), ferramenta: FERRAMENTA_DEBATE, parser: zDebate,
            usuario: mensagemDebate(av.dataRef, gid, retratos[gid], outros), uso: { ...base.uso, tipo: "DEBATE", gestor: gid },
          });
          custo += c;
          rodada2.set(gid, resultado);
          await db.insert(iaPareceres).values({ avaliacaoId: id, gestor: gid, rodada: 2, conteudo: resultado });
        } catch (e) {
          if (e instanceof ErroIA && e.codigo === "IA_LIMITE") limite = true;
          falhas.push(`debate ${gid}: ${e instanceof Error ? e.message : "erro"}`);
          log.error({ gestor: gid, erro: e instanceof Error ? e.message : e }, "Falha no debate de um gestor");
        }
      });
    }

    // Síntese — modelo mais forte (opcional), esforço alto.
    let sintese: Sintese;
    try {
      const r = await chamarEstruturado<Sintese>({
        ...base, modelo: modeloSintese, esforco: config.IA_ESFORCO_SINTESE, maxTokens: 12000,
        sistema: sistemaSintese(), ferramenta: FERRAMENTA_SINTESE, parser: zSintese,
        usuario: mensagemSintese(av.dataRef, Object.fromEntries(rodada1), Object.fromEntries(rodada2)), uso: { ...base.uso, tipo: "SINTESE" },
      });
      custo += r.custo;
      sintese = r.resultado;
    } catch (e) {
      falhas.push(`síntese: ${e instanceof Error ? e.message : "erro"}`);
      await encerrar(e instanceof ErroIA && e.codigo === "IA_LIMITE" ? "LIMITE" : "FALHA");
      return;
    }

    const vistos = new Set<string>();
    const acoes = sintese.acoes_sugeridas.filter((a) => {
      const k = a.titulo.trim().toLowerCase();
      return vistos.has(k) ? false : (vistos.add(k), true);
    });
    if (acoes.length) {
      await db.insert(iaAcoes).values(acoes.map((a) => ({ avaliacaoId: id, titulo: a.titulo, detalhe: a.detalhe, area: a.area, prioridade: a.prioridade, prazoDias: a.prazo_dias })));
    }
    await encerrar(falhas.length || limite ? (limite ? "LIMITE" : "PARCIAL") : "CONCLUIDA", { sintese });
    log.info({ id, gestores: rodada1.size, debates: rodada2.size, acoes: acoes.length, custoUsd: custo / 1_000_000 }, "Avaliação diária da IA concluída");
  } catch (e) {
    falhas.push(e instanceof Error ? e.message : "erro");
    await encerrar(e instanceof ErroIA && e.codigo === "IA_LIMITE" ? "LIMITE" : "FALHA");
    log.error({ id, erro: e instanceof Error ? e.message : e }, "Falha na avaliação diária da IA");
  }
}
