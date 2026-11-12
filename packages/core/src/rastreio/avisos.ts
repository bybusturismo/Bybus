import { preverChegada, type Coordenada } from "./previsao.js";

/**
 * Avisos de chegada pelo WhatsApp (pedido do dono, 11/11/2026): "chega em ~5 minutos" e "chegou", para a van do transfer
 * (paradas = hotéis, na ordem de busca) e para o ônibus (paradas = pontos de embarque). Cada parada recebe cada aviso uma vez
 * (quem garante é a fila de mensagens: uma por reserva e tipo).
 */
export const MINUTOS_AVISO_CHEGANDO = 5;
export type TipoRastreio = "ONIBUS" | "TRANSFER";

export function avisosDeChegada(p: {
  paradas: ReadonlyArray<Coordenada | null>;
  /** Último índice alcançado antes destas posições e depois delas (-1 = nenhum). */
  visitadoAntes: number;
  visitadoAgora: number;
  posicao: Coordenada;
  velocidadeKmh?: number;
  minutosAviso?: number;
  /** Traçado real (importado do mapa), se houver: distância pelo caminho. */
  rota?: { tracado: readonly Coordenada[]; indices: ReadonlyArray<number | null> } | null;
}): { chegando: number[]; chegou: number[] } {
  const limite = p.minutosAviso ?? MINUTOS_AVISO_CHEGANDO;
  // "Chegou" só para as paradas alcançadas agora (não manda "chegou" de uma parada de horas atrás).
  const chegou: number[] = [];
  for (let i = Math.max(0, p.visitadoAntes + 1); i <= p.visitadoAgora && i < p.paradas.length; i++) if (p.paradas[i]) chegou.push(i);
  const chegando: number[] = [];
  for (let i = p.visitadoAgora + 1; i < p.paradas.length; i++) {
    const prev = preverChegada({ posicao: p.posicao, pontos: p.paradas, visitado: p.visitadoAgora, alvo: i, velocidadeKmh: p.velocidadeKmh, rota: p.rota });
    if (prev.situacao === "NO_PONTO") { chegou.push(i); continue; }
    if (prev.situacao !== "A_CAMINHO" || prev.minutos === null) break; // sem coordenadas no caminho: não dá para prever as seguintes
    if (prev.minutos <= limite) chegando.push(i);
    else break; // as paradas seguintes estão ainda mais longe
  }
  return { chegando, chegou };
}
