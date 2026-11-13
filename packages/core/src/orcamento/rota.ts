import { dataPorExtenso, dataBr, type BlocoContrato } from "../grupos/contrato.js";
import { valorPorExtenso } from "../grupos/grupos.js";

/**
 * Orçamento de grupos com rota (dono, 13/11/2026): pontos de visitação, rota calculada (OpenRouteService), veículo
 * (van ou ônibus), carga horária e valor pela tabela por veículo (por km e por hora, com mínimo), ajustável à mão.
 */
export const VEICULOS_ORCAMENTO = ["VAN", "MICRO", "ONIBUS"] as const;
export type VeiculoOrcamento = (typeof VEICULOS_ORCAMENTO)[number];
export const ROTULO_VEICULO_ORCAMENTO: Record<VeiculoOrcamento, string> = { VAN: "Van", MICRO: "Micro-ônibus", ONIBUS: "Ônibus" };

export interface TabelaVeiculo { valorKmCentavos: number; valorHoraCentavos: number; horasMinimas: number; minimoCentavos: number }
export type TabelaPrecos = Record<VeiculoOrcamento, TabelaVeiculo>;
export const TABELA_VAZIA: TabelaPrecos = {
  VAN: { valorKmCentavos: 0, valorHoraCentavos: 0, horasMinimas: 0, minimoCentavos: 0 },
  MICRO: { valorKmCentavos: 0, valorHoraCentavos: 0, horasMinimas: 0, minimoCentavos: 0 },
  ONIBUS: { valorKmCentavos: 0, valorHoraCentavos: 0, horasMinimas: 0, minimoCentavos: 0 },
};

export interface PontoOrcamento { nome: string; lat: number; lng: number; permanenciaMin: number }

/** Carga horária = tempo de deslocamento da rota + permanência nas paradas + folga (embarque, trânsito). */
export function cargaHorariaMin(duracaoRotaMin: number, pontos: readonly PontoOrcamento[], folgaMin = 0): number {
  return Math.round(duracaoRotaMin + pontos.reduce((t, p) => t + Math.max(0, p.permanenciaMin), 0) + Math.max(0, folgaMin));
}

/** Valor pela tabela: km × valor/km + horas (respeitando as horas mínimas) × valor/hora, nunca abaixo do mínimo. */
export function precoPelaTabela(km: number, cargaMin: number, t: TabelaVeiculo) {
  const horas = Math.max(cargaMin / 60, t.horasMinimas);
  const porKm = Math.round(km * t.valorKmCentavos);
  const porHora = Math.round(horas * t.valorHoraCentavos);
  const calculado = porKm + porHora;
  return { porKmCentavos: porKm, porHoraCentavos: porHora, horasCobradas: Math.round(horas * 100) / 100, totalCentavos: Math.max(calculado, t.minimoCentavos), aplicouMinimo: calculado < t.minimoCentavos };
}

/** Resposta do OpenRouteService (directions, formato JSON): distância total, duração e trechos entre os pontos. */
export function resumoRotaOrs(json: unknown): { distanciaKm: number; duracaoMin: number; trechos: Array<{ km: number; min: number }> } | null {
  const r = (json as { routes?: Array<{ summary?: { distance?: number; duration?: number }; segments?: Array<{ distance?: number; duration?: number }> }> })?.routes?.[0];
  if (!r?.summary || typeof r.summary.distance !== "number") return null;
  return {
    distanciaKm: Math.round(r.summary.distance / 100) / 10,
    duracaoMin: Math.round((r.summary.duration ?? 0) / 60),
    trechos: (r.segments ?? []).map((s) => ({ km: Math.round((s.distance ?? 0) / 100) / 10, min: Math.round((s.duration ?? 0) / 60) })),
  };
}

const reais = (c: number) => `R$ ${Math.floor(c / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${String(c % 100).padStart(2, "0")}`;
export const horasTexto = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h${m ? String(m).padStart(2, "0") : ""}` : `${m} min`; };

/** Documento do orçamento (PDF no papel timbrado). */
export function montarOrcamentoPdf(o: {
  numero: string; cliente: string; contato: string | null; dataPasseio: string | null; horarioInicio: string | null; veiculo: VeiculoOrcamento; pessoas: number | null;
  pontos: PontoOrcamento[]; distanciaKm: number; duracaoRotaMin: number; cargaHorariaMin: number; valorCentavos: number; validadeDias: number;
  observacoes: string | null; emitidoEm: string; cidade: string; sinalPercentual: number;
}): BlocoContrato[] {
  const b: BlocoContrato[] = [
    { tipo: "titulo", texto: `ORÇAMENTO Nº ${o.numero}` },
    { tipo: "paragrafo", texto: `**Para:** ${o.cliente}${o.contato ? ` — ${o.contato}` : ""}` },
    { tipo: "paragrafo", texto: `**Data do passeio:** ${o.dataPasseio ? dataBr(o.dataPasseio) : "a definir"}${o.horarioInicio ? `, saída às ${o.horarioInicio.replace(":", "h")}` : ""}` },
    { tipo: "paragrafo", texto: `**Veículo:** ${ROTULO_VEICULO_ORCAMENTO[o.veiculo]}${o.pessoas ? ` · **Pessoas:** ${o.pessoas}` : ""}` },
    { tipo: "clausula", texto: "ROTEIRO" },
  ];
  o.pontos.forEach((p, i) => b.push({ tipo: "paragrafo", texto: `${String.fromCharCode(97 + (i % 26))}) ${p.nome}${p.permanenciaMin > 0 ? ` — permanência de aproximadamente ${horasTexto(p.permanenciaMin)}` : ""}` }));
  b.push(
    { tipo: "paragrafo", texto: `**Percurso estimado:** ${String(o.distanciaKm).replace(".", ",")} km · **deslocamento:** ${horasTexto(o.duracaoRotaMin)} · **carga horária estimada:** ${horasTexto(o.cargaHorariaMin)}.` },
    { tipo: "clausula", texto: "INVESTIMENTO" },
    { tipo: "paragrafo", texto: `**${reais(o.valorCentavos)} (${valorPorExtenso(o.valorCentavos)})**${o.pessoas ? `, equivalente a ${reais(Math.round(o.valorCentavos / o.pessoas))} por pessoa (${o.pessoas} pessoas)` : ""}.` },
    { tipo: "paragrafo", texto: "Inclui veículo com motorista habilitado, combustível, pedágios e guia de turismo para acompanhamento do grupo, conforme o roteiro acima. Não inclui ingressos, alimentação e despesas pessoais, salvo indicação em contrário." },
    { tipo: "clausula", texto: "CONDIÇÕES" },
    { tipo: "paragrafo", texto: `Reserva da data mediante ${o.sinalPercentual}% de sinal; saldo até o dia do passeio. Em caso de cancelamento pelo contratante, o valor antecipado não é devolvido (remarcação ou crédito em até 12 meses, a critério da By Bus). Horários e percurso são estimativas e podem variar com trânsito e condições dos locais visitados.` },
    { tipo: "paragrafo", texto: `Orçamento válido por ${o.validadeDias} dias.` },
  );
  if (o.observacoes) b.push({ tipo: "clausula", texto: "OBSERVAÇÕES" }, ...o.observacoes.split(/\r?\n/).filter((l) => l.trim()).map((l) => ({ tipo: "paragrafo" as const, texto: l.trim() })));
  b.push({ tipo: "paragrafo", texto: `**${o.cidade}, ${dataPorExtenso(o.emitidoEm)}.**` });
  return b;
}
