import { sincronizarAfiliadosPaytour } from "./afiliadosComissao.js";
import { pedidoPaytourParaReservas, type PedidoPaytour } from "@bybus/core";
import { auditar } from "../auditoria.js";
import { deveAnonimizar, type Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { sql } from "drizzle-orm";
import { paytourProdutos } from "../db/schema.js";
import type { Cofre } from "../seguranca/cripto.js";
import { ErroHttp } from "../seguranca/sessao.js";
import { gravarEstadoIntegracao, lerEstadoIntegracao } from "./estadoIntegracao.js";
import { importarReservas, USUARIO_INTEGRACAO, type Acao, type ItemPrevia } from "./importacao.js";

/**
 * Cliente da API v2 da Paytour (documentação: https://api-ha.paytour.com.br/apiv2doc).
 * Login com as credenciais do aplicativo (Basic base64(app_key:app_secret)) → token Bearer.
 * Quando o token vence (ou a API responde 401), faz login de novo.
 */
export class ClientePaytour {
  private token: string | null = null;
  private expiraEm = 0;

  constructor(private readonly cfg: { url: string; appKey: string; appSecret: string }, private readonly buscar: typeof fetch = fetch) {}

  private async login(): Promise<void> {
    const basic = Buffer.from(`${this.cfg.appKey}:${this.cfg.appSecret}`).toString("base64");
    const r = await this.buscar(`${this.cfg.url}/lojas/login?grant_type=application`, { method: "POST", headers: { Authorization: `Basic ${basic}`, Accept: "application/json" } });
    if (!r.ok) throw new ErroPaytour(r.status === 401 ? "Credenciais da Paytour recusadas (App Key/Secret)." : `Login na Paytour falhou (HTTP ${r.status}).`);
    const corpo = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!corpo.access_token) throw new ErroPaytour("Login na Paytour sem token na resposta.");
    this.token = corpo.access_token;
    // A documentação mostra expires_in como data/hora em segundos desde 1970; se vier como duração, também funciona.
    const exp = Number(corpo.expires_in ?? 0);
    this.expiraEm = exp > 1_000_000_000 ? exp * 1000 : Date.now() + Math.max(exp, 60) * 1000;
  }

  async get<T>(caminho: string, parametros: Record<string, string | number>): Promise<T> {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      if (!this.token || Date.now() > this.expiraEm - 60_000) await this.login();
      const qs = new URLSearchParams(Object.entries(parametros).map(([k, v]) => [k, String(v)]));
      const r = await this.buscar(`${this.cfg.url}${caminho}?${qs}`, { headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" } });
      if (r.status === 401 && tentativa === 0) {
        this.token = null;
        continue;
      }
      if (!r.ok) throw new ErroPaytour(`Paytour respondeu HTTP ${r.status} em ${caminho}.`);
      return (await r.json()) as T;
    }
    throw new ErroPaytour("Paytour recusou o token após novo login.");
  }
}

export class ErroPaytour extends Error {}

/** Date → "AAAA-MM-DD HH:MM:SS" no horário de Brasília (formato dos filtros da Paytour). [A CONFIRMAR] fuso usado pela API. */
export function dataHoraPaytour(d: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${v("year")}-${v("month")}-${v("day")} ${v("hour")}:${v("minute")}:${v("second")}`;
}

const CHAVE = "paytour";
/** Margem de segurança: relê os últimos minutos (a importação é idempotente, então não duplica). */
const MARGEM_MS = 10 * 60_000;
const MAX_PAGINAS = 200;
let sincronizando = false;

interface PaginaPedidos {
  info?: { total?: number; pagina?: number; total_paginas?: number };
  itens?: PedidoPaytour[];
}

export interface ResultadoSincronizacao {
  de: string;
  ate: string;
  pedidos: number;
  resumo: Record<Acao, number>;
  previa: ItemPrevia[];
}

export function paytourConfigurada(config: Config): config is Config & { PAYTOUR_APP_KEY: string; PAYTOUR_APP_SECRET: string } {
  return !!config.PAYTOUR_APP_KEY && !!config.PAYTOUR_APP_SECRET;
}

/**
 * Busca na Paytour os pedidos criados/alterados desde a última execução e importa os passageiros
 * nas saídas. `desde` (AAAA-MM-DD) força reler a partir de uma data (ex.: depois de cadastrar um passeio).
 */
export async function sincronizarPaytour(
  db: Db, cofre: Cofre, config: Config, cliente: ClientePaytour, opcoes: { desde?: string; agora?: Date } = {},
): Promise<ResultadoSincronizacao> {
  const agora = opcoes.agora ?? new Date();
  const estado = await lerEstadoIntegracao(db, CHAVE);
  const inicio = opcoes.desde
    ? new Date(`${opcoes.desde}T03:00:00Z`) // 00:00 em Brasília
    : estado?.cursor
      ? new Date(new Date(estado.cursor).getTime() - MARGEM_MS)
      : new Date(agora.getTime() - config.PAYTOUR_DIAS_INICIAIS * 86_400_000);
  const de = dataHoraPaytour(inicio);
  const ate = dataHoraPaytour(agora);
  // Uma sincronização por vez (agendada e manual disputariam as mesmas reservas e o cursor).
  if (sincronizando) throw new ErroHttp(409, "SINCRONIZACAO_EM_ANDAMENTO", "Já há uma sincronização com a Paytour em andamento. Tente de novo em instantes.");
  sincronizando = true;

  try {
    const pedidos: PedidoPaytour[] = [];
    let completo = false;
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const r = await cliente.get<PaginaPedidos>("/pedidos", {
        page: pagina, perPage: 100, includeItems: 1, includeObs: 1, includeLogsStatus: 0,
        // A documentação marca os filtros de criação como obrigatórios: janela larga para não restringir.
        createdAtMin: dataHoraPaytour(new Date(agora.getTime() - 3 * 365 * 86_400_000)), createdAtMax: ate,
        updatedAtMin: de, updatedAtMax: ate,
      });
      pedidos.push(...(r.itens ?? []));
      if (!r.itens?.length || pagina >= (r.info?.total_paginas ?? 1)) {
        completo = true;
        break;
      }
    }

    const afiliados = await carregarAfiliados(cliente);
    const reservas = pedidos.flatMap((p) => pedidoPaytourParaReservas(p, afiliados));
    const { previa, resumo } = reservas.length
      ? await importarReservas(db, cofre, reservas, { confirmar: true, origem: "PAYTOUR_API", usuario: USUARIO_INTEGRACAO, anonimizar: deveAnonimizar(config) })
      : { previa: [], resumo: { CRIAR: 0, ATUALIZAR: 0, CANCELAR: 0, IGNORAR: 0 } };

    await anotarProdutosDesconhecidos(db, previa);
    // Afiliados que aparecem nas vendas ganham cadastro no sistema (comissões e pagamento quinzenal, 13/11/2026).
    await sincronizarAfiliadosPaytour(db, afiliados);
    const resultado = { de, ate, pedidos: pedidos.length, resumo, completo };
    // Janela maior que o limite de páginas: o cursor não avança (a próxima rodada relê a janela; a importação é idempotente).
    await gravarEstado(db, completo
      ? { cursor: agora.toISOString(), ultimoResultado: resultado, ultimoErro: null }
      : { cursor: estado?.cursor ?? null, ultimoResultado: resultado, ultimoErro: `Mais de ${MAX_PAGINAS * 100} pedidos na janela: sincronização parcial, o cursor não avançou.` });
    await auditar(db, null, "SINCRONIZACAO_PAYTOUR", { tipo: "importacao" }, resultado);
    return { ...resultado, previa };
  } catch (e) {
    await gravarEstado(db, { cursor: estado?.cursor ?? null, ultimoResultado: estado?.ultimoResultado ?? null, ultimoErro: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    sincronizando = false;
  }
}

/**
 * Nome de cada afiliado (id → "nome empresa"): o afiliado "TripAdvisor interno" marca as cópias da Viator
 * lançadas à mão na Paytour. Só o nome é usado (para reconhecer o canal); nada é gravado.
 */
const cacheAfiliados = new WeakMap<ClientePaytour, { em: number; mapa: Record<string, string> }>();
const VALIDADE_AFILIADOS_MS = 60 * 60_000;

async function carregarAfiliados(cliente: ClientePaytour): Promise<Record<string, string>> {
  // A lista muda pouco e tem centenas de afiliados: recarrega no máximo uma vez por hora.
  const guardado = cacheAfiliados.get(cliente);
  if (guardado && Date.now() - guardado.em < VALIDADE_AFILIADOS_MS) return guardado.mapa;
  const mapa: Record<string, string> = {};
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const r = await cliente.get<{ info?: { total_paginas?: number }; itens?: Array<{ id: string | number; nome?: string | null; empresa?: string | null }> }>("/afiliados", { page: pagina, perPage: 100 });
    for (const a of r.itens ?? []) mapa[String(a.id)] = `${a.nome ?? ""} ${a.empresa ?? ""}`.trim();
    if (!r.itens?.length || pagina >= (r.info?.total_paginas ?? 1)) break;
  }
  cacheAfiliados.set(cliente, { em: Date.now(), mapa });
  return mapa;
}

const gravarEstado = (db: Db, v: { cursor: string | null; ultimoResultado: unknown; ultimoErro: string | null }) => gravarEstadoIntegracao(db, CHAVE, v);

export const estadoPaytour = (db: Db) => lerEstadoIntegracao(db, CHAVE);

/** Rotina automática: roda a cada N minutos, uma execução por vez. Devolve a função que a desliga. */
export function agendarPaytour(db: Db, cofre: Cofre, config: Config, log: { error: (o: unknown, m: string) => void; info: (o: unknown, m: string) => void }): () => void {
  if (!paytourConfigurada(config) || config.PAYTOUR_SINCRONIZAR_MINUTOS === 0) return () => {};
  const cliente = new ClientePaytour({ url: config.PAYTOUR_URL, appKey: config.PAYTOUR_APP_KEY, appSecret: config.PAYTOUR_APP_SECRET });
  let rodando = false;
  const rodar = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const r = await sincronizarPaytour(db, cofre, config, cliente);
      log.info({ pedidos: r.pedidos, resumo: r.resumo }, "Paytour sincronizada");
    } catch (e) {
      log.error({ erro: e instanceof Error ? e.message : e }, "Falha ao sincronizar a Paytour");
    } finally {
      rodando = false;
    }
  };
  const primeira = setTimeout(rodar, 10_000);
  const intervalo = setInterval(rodar, config.PAYTOUR_SINCRONIZAR_MINUTOS * 60_000);
  return () => {
    clearTimeout(primeira);
    clearInterval(intervalo);
  };
}

/** Guarda os produtos que nenhum passeio reconheceu (para a equipe classificar em Integrações). Já decididos não voltam à lista. */
export async function anotarProdutosDesconhecidos(db: Db, previa: Array<{ avisos: string[] }>) {
  const contagem = new Map<string, number>();
  for (const p of previa) for (const a of p.avisos) {
    const m = /^Produto não reconhecido: "(.*)"\.$/.exec(a);
    if (m && m[1]!.trim()) contagem.set(m[1]!.trim().slice(0, 300), (contagem.get(m[1]!.trim().slice(0, 300)) ?? 0) + 1);
  }
  for (const [produto, n] of contagem) {
    await db.insert(paytourProdutos).values({ produto, pedidos: n }).onConflictDoUpdate({
      target: paytourProdutos.produto, set: { pedidos: sql`${paytourProdutos.pedidos} + ${n}`, ultimaVezEm: new Date() },
    });
  }
}
