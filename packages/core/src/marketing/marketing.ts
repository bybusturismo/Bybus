import type { Canal } from "../tipos.js";

/** Canal real de uma reserva: o de origem quando ela é espelho (ex.: Paytour com documento 1111 → Viator). */
export function canalReal(canal: Canal, canalOrigem: Canal | null | undefined): Canal {
  return canalOrigem ?? canal;
}

export const MIDIAS_CAMPANHA = ["GOOGLE_ADS", "META_ADS", "INSTAGRAM", "TRIPADVISOR", "PARCEIRO", "OFFLINE", "OUTRA"] as const;
export type MidiaCampanha = (typeof MIDIAS_CAMPANHA)[number];

export const REDES_CONTEUDO = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE", "GOOGLE_NEGOCIOS", "BLOG", "OUTRA"] as const;
export type RedeConteudo = (typeof REDES_CONTEUDO)[number];

/** Fluxo: ideia → rascunho (PRODUCAO) → em aprovação → aprovado → agendado → publicado. Aprovado, agendado e publicado só mudam por ação própria (aprovar, agendar, publicar). */
export const STATUS_CONTEUDO = ["IDEIA", "PRODUCAO", "EM_APROVACAO", "APROVADO", "AGENDADO", "PUBLICADO"] as const;
export type StatusConteudo = (typeof STATUS_CONTEUDO)[number];
/** Situações que a edição comum pode escolher (as demais só por ação: aprovar, agendar ou publicar). */
export const STATUS_CONTEUDO_EDITAVEIS = ["IDEIA", "PRODUCAO", "EM_APROVACAO"] as const;

export const TIPOS_AFILIADO = ["HOTEL", "POUSADA", "AGENCIA", "PARCEIRO", "OUTRO"] as const;
export type TipoAfiliado = (typeof TIPOS_AFILIADO)[number];

/**
 * Situação do pedido de avaliação. Fluxo: PENDENTE (a enviar) → pedido feito (ENVIADA_MANUAL, SIMULADA ou ENVIADA)
 * → LEMBRADA → AVALIADA (marcação manual). SEM_TELEFONE e IGNORADA ficam fora do fluxo.
 */
export const STATUS_PEDIDO_AVALIACAO = ["PENDENTE", "ENVIADA_MANUAL", "SIMULADA", "ENVIADA", "LEMBRADA", "AVALIADA", "SEM_TELEFONE", "IGNORADA"] as const;
export type StatusPedidoAvaliacao = (typeof STATUS_PEDIDO_AVALIACAO)[number];

/** Resultado de uma campanha com atribuição lançada (a fonte da atribuição ainda é "a confirmar"). */
export interface IndicadoresCampanha {
  /** Sem nenhum resultado lançado não há como calcular retorno. */
  temAtribuicao: boolean;
  custoPorReservaCentavos: number | null;
  custoPorPassageiroCentavos: number | null;
  /** Receita atribuída ÷ investimento (ex.: 3,5 = R$ 3,50 de receita para cada R$ 1,00). Nulo sem receita ou sem investimento. */
  retorno: number | null;
  /** Reservas atribuídas ÷ meta (0–1+). Nulo sem meta. */
  atingimentoMeta: number | null;
}

export function indicadoresCampanha(c: {
  investimentoCentavos: number;
  metaReservas?: number | null;
  resultados: Array<{ reservas: number; passageiros: number; receitaCentavos: number | null }>;
}): IndicadoresCampanha {
  const reservas = c.resultados.reduce((s, r) => s + r.reservas, 0);
  const passageiros = c.resultados.reduce((s, r) => s + r.passageiros, 0);
  const temReceita = c.resultados.some((r) => r.receitaCentavos != null);
  const receita = c.resultados.reduce((s, r) => s + (r.receitaCentavos ?? 0), 0);
  const temAtribuicao = c.resultados.length > 0;
  return {
    temAtribuicao,
    custoPorReservaCentavos: temAtribuicao && reservas > 0 ? Math.round(c.investimentoCentavos / reservas) : null,
    custoPorPassageiroCentavos: temAtribuicao && passageiros > 0 ? Math.round(c.investimentoCentavos / passageiros) : null,
    retorno: temAtribuicao && temReceita && c.investimentoCentavos > 0 ? Math.round((receita / c.investimentoCentavos) * 100) / 100 : null,
    atingimentoMeta: temAtribuicao && c.metaReservas ? Math.round((reservas / c.metaReservas) * 100) / 100 : null,
  };
}

/** Percentuais inteiros que somam exatamente 100 (método do maior resto); lista vazia ou total zero → zeros. */
export function percentuais(valores: number[]): number[] {
  const total = valores.reduce((s, v) => s + v, 0);
  if (total <= 0) return valores.map(() => 0);
  const bruto = valores.map((v) => (v / total) * 100);
  const base = bruto.map(Math.floor);
  let falta = 100 - base.reduce((s, v) => s + v, 0);
  const ordem = bruto.map((b, i) => ({ i, resto: b - Math.floor(b) })).sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (const o of ordem) {
    if (falta <= 0) break;
    base[o.i]! += 1;
    falta -= 1;
  }
  return base;
}

export function nomeCurto(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

/** Código de afiliado: maiúsculas, números e hífen, de 3 a 24 caracteres. */
export function normalizarCodigoAfiliado(codigo: string): string {
  return codigo.trim().toUpperCase().replace(/\s+/g, "-");
}
export function codigoAfiliadoValido(codigo: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]{1,22}[A-Z0-9]$/.test(codigo);
}

/** Link de divulgação do afiliado (o parâmetro `ref` ainda precisa ser confirmado com a Paytour). */
export function linkAfiliado(base: string, codigo: string): string {
  const url = new URL(base);
  url.searchParams.set("ref", codigo);
  return url.toString();
}

export const MODELO_AVALIACAO_PADRAO =
  "Olá, {nome}! Obrigado por passear com a By Bus no {passeio} em {data}. Sua opinião ajuda muito: pode nos avaliar no Tripadvisor? {linkTripadvisor}";

export const VARIAVEIS_MODELO_AVALIACAO = ["nome", "passeio", "data", "linkTripadvisor"] as const;

/** Preenche as variáveis {nome}, {passeio}, {data} e {linkTripadvisor}; variável desconhecida fica como está. */
export function renderizarModeloAvaliacao(modelo: string, v: { nome: string; passeio: string; data: string; linkTripadvisor?: string | null }): string {
  const valores: Record<string, string> = { nome: nomeCurto(v.nome) || "tudo bem", passeio: v.passeio, data: v.data, linkTripadvisor: v.linkTripadvisor ?? "" };
  return modelo.replace(/\{(\w+)\}/g, (inteiro, k: string) => (k in valores ? valores[k]! : inteiro)).replace(/ {2,}/g, " ").trim();
}

export function mediaNotas(notas: number[]): number | null {
  if (notas.length === 0) return null;
  return Math.round((notas.reduce((s, n) => s + n, 0) / notas.length) * 100) / 100;
}
