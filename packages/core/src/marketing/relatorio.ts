import { variacaoPercentual } from "./engajamento.js";

/** Conteúdo do relatório de marketing. Só números agregados (LGPD): nada de nome, telefone ou e-mail de cliente. */
export interface DadosRelatorio {
  periodo: { de: string; ate: string; anteriorDe: string; anteriorAte: string; rotulo: string };
  /** Reservas confirmadas com passeio no período (mesma base do painel Vendas por canal). Receita em centavos; nula se nenhuma reserva informa valor. */
  vendas: {
    atual: { reservas: number; passageiros: number; receitaCentavos: number | null };
    anterior: { reservas: number; passageiros: number; receitaCentavos: number | null };
    variacao: { reservas: number | null; passageiros: number | null; receita: number | null };
    porCanal: Array<{ canal: string; reservas: number; passageiros: number; receitaCentavos: number | null; reservasAnterior: number; variacaoReservas: number | null }>;
  };
  origem: Array<{ origem: string; passageiros: number }>;
  /** Campanhas com pedido atribuído (UTM/cupom) comprado no período. */
  campanhas: Array<{ nome: string; midia: string; reservas: number; receitaCentavos: number | null; investimentoCentavos: number; custoOrigem: "CSV" | "TOTAL_DA_CAMPANHA"; custoPorReservaCentavos: number | null; retorno: number | null }>;
  avaliacoes: {
    pedidosFeitos: number; avaliados: number; pedidosFeitosAnterior: number; avaliadosAnterior: number;
    notaInterna: number | null; notaInternaAnterior: number | null;
    notasCanais: Array<{ canal: string; nota: number; quantidade: number }>;
  };
  nps: { respostas: number; nps: number | null; npsAnterior: number | null; detratores: number };
  /** Presentes só no consolidado (a página pública e o formulário não têm praça). */
  orcamentos: { recebidos: number; recebidosAnterior: number; fechados: number } | null;
  bio: { visitas: number; cliques: number; visitasAnterior: number; cliquesAnterior: number } | null;
}

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number | null) => (v == null ? "sem base de comparação" : `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR")}%`);
const num = (n: number) => n.toLocaleString("pt-BR");
export const ROTULO_CANAL_RELATORIO: Record<string, string> = { PAYTOUR: "Paytour", VIATOR: "Viator", DECOLAR: "Decolar", CIVITATIS: "Civitatis", BALCAO: "Balcão" };

/** Resumo em texto só com os números (existe sempre; a IA, quando ligada, escreve outro por cima). */
export function resumoNumeros(d: DadosRelatorio): string {
  const v = d.vendas;
  const linhas: string[] = [`${d.periodo.rotulo}.`];
  linhas.push(`Reservas: ${num(v.atual.reservas)} (${pct(v.variacao.reservas)} sobre o período anterior), com ${num(v.atual.passageiros)} passageiros (${pct(v.variacao.passageiros)}).`);
  if (v.atual.receitaCentavos != null) linhas.push(`Receita das reservas: ${reais(v.atual.receitaCentavos)} (${pct(v.variacao.receita)}).`);
  if (v.porCanal.length) linhas.push(`Por canal: ${v.porCanal.map((c) => `${ROTULO_CANAL_RELATORIO[c.canal] ?? c.canal} ${num(c.reservas)}`).join(", ")}.`);
  if (d.origem.length) linhas.push(`Origem dos clientes (passageiros): ${d.origem.map((o) => `${o.origem} ${num(o.passageiros)}`).join(", ")}.`);
  if (d.campanhas.length) linhas.push(`Campanhas com venda atribuída: ${d.campanhas.map((c) => `${c.nome} ${num(c.reservas)} reserva(s)${c.custoPorReservaCentavos != null ? `, ${reais(c.custoPorReservaCentavos)} por reserva` : ""}`).join("; ")}.`);
  else linhas.push("Nenhuma venda atribuída a campanha no período.");
  const a = d.avaliacoes;
  linhas.push(`Avaliações: ${num(a.pedidosFeitos)} pedido(s) feito(s) (${num(a.pedidosFeitosAnterior)} antes) e ${num(a.avaliados)} avaliado(s) (${num(a.avaliadosAnterior)} antes).${a.notaInterna != null ? ` Nota interna média ${a.notaInterna.toLocaleString("pt-BR")}.` : ""}`);
  if (a.notasCanais.length) linhas.push(`Notas lançadas: ${a.notasCanais.map((n) => `${n.canal} ${n.nota.toLocaleString("pt-BR")} (${num(n.quantidade)} avaliações)`).join(", ")}.`);
  if (d.nps.respostas) linhas.push(`NPS: ${d.nps.nps} com ${num(d.nps.respostas)} resposta(s)${d.nps.npsAnterior != null ? ` (antes ${d.nps.npsAnterior})` : ""}; ${num(d.nps.detratores)} detrator(es).`);
  if (d.orcamentos) linhas.push(`Orçamentos de grupos: ${num(d.orcamentos.recebidos)} recebido(s) (${pct(variacaoPercentual(d.orcamentos.recebidos, d.orcamentos.recebidosAnterior))}), ${num(d.orcamentos.fechados)} fechado(s).`);
  if (d.bio) linhas.push(`Link na bio: ${num(d.bio.visitas)} visita(s) e ${num(d.bio.cliques)} clique(s) (${pct(variacaoPercentual(d.bio.cliques, d.bio.cliquesAnterior))}).`);
  return linhas.join("\n");
}
