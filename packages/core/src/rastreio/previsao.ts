/**
 * Rastreio do ônibus: regras puras (sem banco, sem rede).
 *
 * A previsão de chegada é uma ESTIMATIVA SIMPLES, sem consulta a serviço de rotas:
 *   tempo = (distância em linha reta pelos pontos restantes × 1,3) ÷ velocidade média recente + 1 min por parada intermediária.
 * O fator 1,3 compensa o desvio das ruas em relação à linha reta; não considera trânsito, semáforo nem obras.
 */

export interface Coordenada { lat: number; lng: number }

export const FATOR_ROTA = 1.3;
export const VELOCIDADE_PADRAO_KMH = 25;
export const VELOCIDADE_MINIMA_KMH = 15;
export const MINUTOS_POR_PARADA = 1;
/** A posição só é aceita com precisão melhor que isto (GPS ruim gera saltos no mapa). */
export const PRECISAO_MAXIMA_M = 200;
/** Raio em que o ônibus conta como "chegou" ao ponto. */
export const RAIO_PONTO_M = 150;
/** Sem posição nova há mais que isto = "sem sinal". */
export const LIMITE_SEM_SINAL_MIN = 3;

const RAIO_TERRA_KM = 6371;
const rad = (g: number) => (g * Math.PI) / 180;

export const coordenadaValida = (c: { lat: number; lng: number }): boolean =>
  Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180;

/** Distância em linha reta (haversine), em km. */
export function distanciaKm(a: Coordenada, b: Coordenada): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Velocidade média recente em km/h a partir das velocidades do GPS (m/s). Ignora ausentes e negativas.
 * Sem nenhuma amostra: 25 km/h. Nunca abaixo de 15 km/h (parado no semáforo não pode zerar a previsão).
 */
export function velocidadeMediaKmh(velocidadesMs: ReadonlyArray<number | null | undefined>): number {
  const v = velocidadesMs.filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0);
  if (v.length === 0) return VELOCIDADE_PADRAO_KMH;
  const media = (v.reduce((a, n) => a + n, 0) / v.length) * 3.6;
  return Math.max(VELOCIDADE_MINIMA_KMH, media);
}

/**
 * Índice do último ponto (na ordem da rota) em que o ônibus já chegou. Passar por um ponto adiante conta os anteriores.
 * `visitado` = valor anterior (-1 = nenhum). Pontos sem coordenadas nunca são "visitados" por proximidade.
 */
export function atualizarVisitado(visitado: number, pontos: ReadonlyArray<Coordenada | null>, posicoes: readonly Coordenada[], raioM = RAIO_PONTO_M): number {
  let v = visitado;
  for (const pos of posicoes) {
    for (let i = v + 1; i < pontos.length; i++) {
      const p = pontos[i];
      if (p && distanciaKm(pos, p) * 1000 <= raioM) v = i;
    }
  }
  return v;
}

export type SituacaoPrevisao = "A_CAMINHO" | "NO_PONTO" | "JA_PASSOU" | "SEM_PREVISAO";
export interface Previsao {
  situacao: SituacaoPrevisao;
  minutos: number | null;
  distanciaKm: number | null;
  paradasIntermediarias: number;
  /** Só quando não há previsão. */
  motivo?: "SEM_PONTO" | "SEM_COORDENADAS";
}

/**
 * Previsão de chegada ao ponto de índice `alvo`.
 * `pontos` na ordem da rota; `visitado` = último índice já alcançado (-1 se nenhum).
 */
export function preverChegada(p: { posicao: Coordenada; pontos: ReadonlyArray<Coordenada | null>; visitado: number; alvo: number | null; velocidadeKmh?: number }): Previsao {
  const sem = (motivo: "SEM_PONTO" | "SEM_COORDENADAS"): Previsao => ({ situacao: "SEM_PREVISAO", minutos: null, distanciaKm: null, paradasIntermediarias: 0, motivo });
  if (p.alvo === null || p.alvo < 0 || p.alvo >= p.pontos.length) return sem("SEM_PONTO");
  if (p.alvo <= p.visitado) return { situacao: "JA_PASSOU", minutos: null, distanciaKm: null, paradasIntermediarias: 0 };
  const trecho = p.pontos.slice(p.visitado + 1, p.alvo + 1);
  if (trecho.some((c) => !c)) return sem("SEM_COORDENADAS");
  const pontos = trecho as Coordenada[];
  const alvo = pontos[pontos.length - 1]!;
  if (distanciaKm(p.posicao, alvo) * 1000 <= RAIO_PONTO_M) return { situacao: "NO_PONTO", minutos: 0, distanciaKm: 0, paradasIntermediarias: 0 };
  let retas = distanciaKm(p.posicao, pontos[0]!);
  for (let i = 1; i < pontos.length; i++) retas += distanciaKm(pontos[i - 1]!, pontos[i]!);
  const km = retas * FATOR_ROTA;
  const paradas = pontos.length - 1;
  const v = Math.max(VELOCIDADE_MINIMA_KMH, p.velocidadeKmh ?? VELOCIDADE_PADRAO_KMH);
  const minutos = Math.max(1, Math.ceil((km / v) * 60 + paradas * MINUTOS_POR_PARADA));
  return { situacao: "A_CAMINHO", minutos, distanciaKm: Math.round(km * 10) / 10, paradasIntermediarias: paradas };
}

export type SituacaoSinal = "NAO_INICIADO" | "AGUARDANDO_SINAL" | "TRANSMITINDO" | "SEM_SINAL" | "ENCERRADO";

/** Situação da transmissão da saída a partir da sessão mais recente. */
export function situacaoSinal(sessao: { iniciadaEm: Date; encerradaEm: Date | null; ultimaPosicaoEm: Date | null } | null, agora: Date): { situacao: SituacaoSinal; minutosSemSinal: number | null } {
  if (!sessao) return { situacao: "NAO_INICIADO", minutosSemSinal: null };
  if (sessao.encerradaEm) return { situacao: "ENCERRADO", minutosSemSinal: null };
  const ref = sessao.ultimaPosicaoEm ?? sessao.iniciadaEm;
  const min = Math.max(0, Math.floor((agora.getTime() - ref.getTime()) / 60_000));
  if (!sessao.ultimaPosicaoEm) return { situacao: min >= LIMITE_SEM_SINAL_MIN ? "SEM_SINAL" : "AGUARDANDO_SINAL", minutosSemSinal: min };
  return min >= LIMITE_SEM_SINAL_MIN ? { situacao: "SEM_SINAL", minutosSemSinal: min } : { situacao: "TRANSMITINDO", minutosSemSinal: min };
}
