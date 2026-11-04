/**
 * Valores das vendas (dinheiro sempre em centavos, inteiro, moeda BRL).
 * Funções puras: leitura tolerante dos números que vêm dos canais, rateio do pedido entre as reservas
 * e a regra do canal de venda (de onde veio a compra, para a Visão Geral).
 */

/** Canal de venda: de onde veio a compra. OTA = Viator, Decolar ou Civitatis (qual delas está na reserva). */
export const CANAIS_VENDA = ["SITE", "ADMIN", "AFILIADO", "PARCEIRO", "OTA", "BALCAO"] as const;
export type CanalVenda = (typeof CANAIS_VENDA)[number];

/** Dados do pedido (a venda inteira), comuns a todas as reservas que ele gerou. */
export interface VendaImportada {
  /** Chave do pedido no canal: "PAYTOUR-<id>" ou o código da reserva (ex.: "VIA-107216084"). Idempotência. */
  pedidoCodigo: string;
  fonte: "PAYTOUR_API" | "BOKUN_EMAIL";
  canalVenda: CanalVenda;
  /** Valor total do pedido (já com desconto), em centavos. */
  valorCentavos: number;
  subtotalCentavos: number | null;
  descontoCentavos: number;
  cupomExternoId: string | null;
  metodoPagamento: string | null;
  metodoPagamentoExterno: string | null;
  tipoPagamento: string | null;
  parcelas: number | null;
  /** Instante da compra em UTC (ISO). */
  dataHoraCompra: string | null;
  operadorId: string | null;
  afiliadoId: string | null;
  afiliadoComissaoCentavos: number | null;
  parceiroId: string | null;
  parceiroComissaoCentavos: number | null;
  /** Saldo ainda a pagar (pagamento_pendente_valor) enquanto o pagamento pendente não foi quitado. */
  pagamentoPendenteCentavos: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  /** Cidade do cliente (só para o ranking de maiores emissores; sem endereço). */
  clienteCidade: string | null;
}

/**
 * "170.00" → 17000; "1.234,50" → 123450; "R$ 40,00" → 4000; número → arredondado. Inválido/vazio → null.
 * Nunca usa ponto flutuante na conversão do texto (evita 0,1 + 0,2).
 */
export function reaisParaCentavos(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? Math.round(valor * 100) : null;
  let t = String(valor).replace(/[^\d.,-]/g, "");
  if (!t || t === "-" || /null/i.test(String(valor))) return null;
  const virgula = t.lastIndexOf(",");
  const ponto = t.lastIndexOf(".");
  // Com os dois separadores, o último é o decimal. Só vírgula: decimal. Só ponto: decimal, salvo vários pontos (milhar).
  if (virgula >= 0 && ponto >= 0) t = virgula > ponto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (virgula >= 0) t = t.replace(",", ".");
  else if (t.split(".").length > 2) t = t.replace(/\./g, "");
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (!m[2] && !m[3])) return null;
  const inteiro = Number(m[2] || "0");
  const frac = (m[3] ?? "").padEnd(3, "0");
  let centavos = inteiro * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) centavos += 1;
  return m[1] ? -centavos : centavos;
}

/** "2026-11-04 09:47:39" (horário de Brasília, UTC−3 fixo desde 2019) → "2026-11-04T12:47:39.000Z". Inválido → null. */
export function dataHoraBrasiliaParaUtc(texto: string | null | undefined): string | null {
  const m = texto ? /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(texto.trim()) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) + 3, Number(m[5]), Number(m[6] ?? 0)));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Divide `total` (centavos) proporcionalmente aos `pesos`, sem perder nem criar centavo
 * (maiores restos). Todos os pesos zero → divide igualmente (o chamador usa passageiros como peso de reserva).
 */
export function ratearCentavos(total: number, pesos: number[]): number[] {
  if (pesos.length === 0) return [];
  const soma = pesos.reduce((t, p) => t + Math.max(0, p), 0);
  const base = soma > 0 ? pesos.map((p) => Math.max(0, p)) : pesos.map(() => 1);
  const denom = soma > 0 ? soma : pesos.length;
  const sinal = total < 0 ? -1 : 1;
  const alvo = Math.abs(total);
  const partes = base.map((p, i) => ({ i, exato: (alvo * p) / denom }));
  const pisos = partes.map((x) => Math.floor(x.exato));
  let resto = alvo - pisos.reduce((t, n) => t + n, 0);
  for (const x of [...partes].sort((a, b) => (b.exato - Math.floor(b.exato)) - (a.exato - Math.floor(a.exato)) || a.i - b.i)) {
    if (resto <= 0) break;
    pisos[x.i]! += 1;
    resto -= 1;
  }
  return pisos.map((n) => n * sinal);
}

/**
 * Regra do canal de venda de um pedido da Paytour (documentada em docs/produto/visao-geral.md):
 * 1. reserva espelho/integração de Viator, Decolar ou Civitatis → OTA;
 * 2. tem parceiro_id → PARCEIRO;
 * 3. tem afiliado_id → AFILIADO;
 * 4. pago na maquininha (método de pagamento com "maquinin") → BALCAO;
 * 5. tem operador_id (vendido pelo admin) → ADMIN;
 * 6. senão → SITE.
 */
export function canalVendaPaytour(p: {
  canalReserva: string; afiliadoId?: unknown; parceiroId?: unknown; operadorId?: unknown; metodoPagamento?: unknown; metodoPagamentoExterno?: unknown;
}): CanalVenda {
  const tem = (v: unknown) => v !== null && v !== undefined && !["", "null", "0"].includes(String(v).trim().toLowerCase());
  if (["VIATOR", "DECOLAR", "CIVITATIS"].includes(p.canalReserva)) return "OTA";
  if (tem(p.parceiroId)) return "PARCEIRO";
  if (tem(p.afiliadoId)) return "AFILIADO";
  if (/maquinin/i.test(`${p.metodoPagamento ?? ""} ${p.metodoPagamentoExterno ?? ""}`)) return "BALCAO";
  if (tem(p.operadorId)) return "ADMIN";
  return "SITE";
}

/**
 * Valor no e-mail da Bókun: "BRL 480.00", "R$ 480,00", "480.00 BRL". Só reais são gravados;
 * outra moeda não é convertida (devolve a moeda para o aviso).
 */
export function lerValorBokun(texto: string | null | undefined): { centavos: number | null; moeda: string | null } {
  if (!texto) return { centavos: null, moeda: null };
  const t = texto.trim();
  const moeda = /R\$/.test(t) ? "BRL" : (/\b([A-Z]{3})\b/.exec(t)?.[1] ?? null);
  const numero = /-?\d[\d.,]*/.exec(t)?.[0];
  if (!numero) return { centavos: null, moeda };
  return { centavos: moeda === null || moeda === "BRL" ? reaisParaCentavos(numero) : null, moeda };
}
