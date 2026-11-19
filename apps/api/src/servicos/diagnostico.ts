import { mesSaoPaulo } from "@bybus/core";
import { sql } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { ultimaSincronia, googleConectado, googleConfigurado, tripadvisorConfigurado } from "./avaliacoesOnline.js";
import { gastoDoMesMicro } from "./ia/retratos.js";

/**
 * Diagnóstico só de leitura (dono, 19/11/2026): para o assistente acompanhar a produção sem acesso ao servidor. Mostra versão,
 * atualização, banco, integrações (só ligada/desligada, nunca chaves), rotinas, contagem de requisições e os últimos erros do
 * servidor — sem dados de clientes: as mensagens de erro passam por uma máscara (e-mails, números longos, textos entre aspas).
 */

const INICIO = new Date();
const MAX_ERROS = 50;
const erros: Array<{ em: string; origem: "requisicao" | "rotina"; rota: string | null; status: number | null; tipo: string; codigo: string | null; mensagem: string }> = [];
/** Requisições por hora (últimas 24 h): total, 4xx e 5xx. */
const porHora = new Map<string, { total: number; e4xx: number; e5xx: number }>();

/** Tira da mensagem o que pode ser dado pessoal ou segredo: e-mails, sequências de dígitos, textos entre aspas/parênteses de valores. */
export function mascarar(texto: unknown, max = 200): string {
  let t = typeof texto === "string" ? texto : texto instanceof Error ? texto.message : String(texto ?? "");
  t = t.replace(/\)=\((?:[^()]|\([^()]*\))*\)/g, ")=([valor])") // detalhe do PostgreSQL: Key (email)=(fulano@…)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[e-mail]")
    .replace(/\b(sk-ant-|sk_|ghp_|AIza|ya29\.|EAA)[\w.-]+/g, "[chave]")
    .replace(/Bearer\s+[\w.-]+/gi, "Bearer [chave]")
    .replace(/"[^"]{3,}"/g, '"[texto]"')
    .replace(/\d[\d.\-/ ]{5,}\d/g, "[número]");
  return t.slice(0, max);
}

export function registrarRequisicao(status: number, agora = new Date()) {
  const hora = agora.toISOString().slice(0, 13);
  const c = porHora.get(hora) ?? { total: 0, e4xx: 0, e5xx: 0 };
  c.total++;
  if (status >= 500) c.e5xx++; else if (status >= 400) c.e4xx++;
  porHora.set(hora, c);
  if (porHora.size > 26) for (const k of [...porHora.keys()].sort().slice(0, porHora.size - 24)) porHora.delete(k);
}

export function registrarErro(e: { origem: "requisicao" | "rotina"; rota?: string | null; status?: number | null; erro: unknown }) {
  const x = e.erro as { name?: string; code?: unknown; codigo?: unknown } | null;
  erros.push({
    em: new Date().toISOString(), origem: e.origem, rota: e.rota ?? null, status: e.status ?? null,
    tipo: typeof x?.name === "string" ? x.name.slice(0, 60) : typeof e.erro === "string" ? "log" : "Erro",
    codigo: typeof x?.codigo === "string" ? x.codigo.slice(0, 40) : typeof x?.code === "string" ? x.code.slice(0, 40) : null,
    mensagem: mascarar(e.erro),
  });
  if (erros.length > MAX_ERROS) erros.splice(0, erros.length - MAX_ERROS);
}

/** Gancho do logger (pino): todo log de nível erro (50+) das rotinas também entra na lista, mascarado. */
export const ganchoLogErro = {
  logMethod(this: unknown, args: unknown[], metodo: (...a: unknown[]) => void, nivel: number) {
    if (nivel >= 50) {
      try {
        const msg = typeof args[1] === "string" ? args[1] : typeof args[0] === "string" ? args[0] : "";
        const obj = args[0] && typeof args[0] === "object" ? (args[0] as Record<string, unknown>) : {};
        const detalhe = obj.err ?? obj.erro ?? "";
        // erro de requisição (logger com reqId) já é registrado pelo tratador de erros (com a rota): aqui só os de rotinas
        const ligado = (this as { bindings?: () => Record<string, unknown> }).bindings?.() ?? {};
        if (!ligado.reqId && !obj.req && !obj.res) registrarErro({ origem: "rotina", erro: [msg, detalhe ? mascarar(detalhe, 120) : ""].filter(Boolean).join(": ") });
      } catch { /* nunca atrapalhar o log */ }
    }
    metodo.apply(this, args);
  },
};

function ultimasLinhas(arquivo: string, n: number): string[] {
  try {
    if (!existsSync(arquivo)) return [];
    return readFileSync(arquivo, "utf8").split("\n").filter(Boolean).slice(-n).map((l) => mascarar(l, 240));
  } catch { return []; }
}

export async function montarDiagnostico(db: Db, config: Config) {
  const agora = new Date();
  // banco
  let banco: Record<string, unknown>;
  try {
    const t0 = Date.now();
    await db.execute(sql`select 1`);
    const latenciaMs = Date.now() - t0;
    const mig = await db.execute(sql`select count(*)::int as n, max(created_at)::text as ultima from drizzle.__drizzle_migrations`).catch(() => null);
    let esperadas: number | null = null;
    try { esperadas = (JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: unknown[] }).entries.length; } catch { /* sem o arquivo */ }
    const tamanho = await db.execute(sql`select pg_size_pretty(pg_database_size(current_database())) as tamanho`).catch(() => null);
    banco = { ok: true, latenciaMs, migracoesAplicadas: mig?.rows[0]?.n ?? null, migracoesEsperadas: esperadas, tamanho: tamanho?.rows[0]?.tamanho ?? null };
  } catch (e) {
    banco = { ok: false, erro: mascarar(e) };
  }
  const contar = async (consulta: ReturnType<typeof sql>) => (await db.execute(consulta).catch(() => null))?.rows[0] ?? null;
  const fila = await contar(sql`select
      count(*) filter (where status = 'PENDENTE')::int as pendentes,
      count(*) filter (where status = 'FALHA' and criado_em > now() - interval '24 hours')::int as falhas24h,
      count(*) filter (where status in ('ENVIADA','SIMULADA') and criado_em > now() - interval '24 hours')::int as enviadas24h
    from mensagens`);
  const avaliacoes = await ultimaSincronia(db).catch(() => null);
  const pendentesAbastecimento = await contar(sql`select count(*)::int as n from veiculos_abastecimentos where situacao = 'PENDENTE'`);
  let iaGasto: number | null = null;
  try { iaGasto = Math.round(await gastoDoMesMicro(db, mesSaoPaulo(agora))) / 1_000_000; } catch { iaGasto = null; }
  const horas = [...porHora.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([hora, c]) => ({ hora: `${hora}:00Z`, ...c }));
  return {
    versao: config.VERSAO,
    ambiente: config.AMBIENTE,
    iniciadoEm: INICIO.toISOString(),
    agora: agora.toISOString(),
    uptimeMinutos: Math.round((agora.getTime() - INICIO.getTime()) / 60_000),
    node: process.version,
    memoriaMb: Math.round(process.memoryUsage().rss / 1_048_576),
    atualizacao: ultimasLinhas("/app/estado/atualizacao.log", 15),
    banco,
    integracoes: {
      paytour: !!config.PAYTOUR_APP_KEY && !!config.PAYTOUR_APP_SECRET,
      googlePlanilhas: !!config.GOOGLE_CONTA_SERVICO,
      whatsapp: config.WHATSAPP_PROVEDOR,
      ia: { ligada: !!config.ANTHROPIC_API_KEY, gastoMesUsd: iaGasto, limiteMesUsd: config.IA_LIMITE_MES_USD, avaliacaoDiaria: config.IA_AVALIACAO_DIARIA },
      googleAvaliacoes: { configurado: googleConfigurado(config), conectado: await googleConectado(db).catch(() => false) },
      tripadvisor: tripadvisorConfigurado(config),
      email: !!config.EMAIL_SMTP_HOST,
      rotasOrs: !!config.ORS_CHAVE,
      urlPublica: !!config.URL_PUBLICA,
    },
    rotinas: {
      avaliacoesOnline: avaliacoes ? { em: avaliacoes.em, ok: avaliacoes.resultados.filter((r) => r.ok).length, erros: avaliacoes.resultados.filter((r) => !r.ok).map((r) => ({ canal: r.canal, erro: mascarar(r.erro ?? "", 160) })) } : null,
      filaMensagens: fila,
      abastecimentosPendentes: pendentesAbastecimento?.n ?? null,
    },
    requisicoesPorHora: horas,
    erros: [...erros].reverse(),
  };
}
