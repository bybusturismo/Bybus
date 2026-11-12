import { distanciaKm, type Coordenada } from "./previsao.js";

/**
 * Rota do Google My Maps (arquivo .kml exportado pelo dono, 11/11/2026): pontos marcados (nome + coordenada) e o traçado
 * do ônibus. Lido sem biblioteca: só os elementos Placemark/name/Point/LineString/coordinates.
 */
export interface KmlLido {
  pontos: Array<{ nome: string; pasta: string; lat: number; lng: number }>;
  linhas: Array<{ nome: string; coordenadas: Coordenada[] }>;
}

const texto = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const nomeDe = (bloco: string) => texto(/<name>([\s\S]*?)<\/name>/.exec(bloco)?.[1] ?? "");
function coordenadas(bruto: string): Coordenada[] {
  return bruto.trim().split(/\s+/).map((t) => t.split(",").map(Number)).filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(([lng, lat]) => ({ lat: lat!, lng: lng! })).filter((c) => Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180);
}

export function lerKml(kml: string): KmlLido {
  const r: KmlLido = { pontos: [], linhas: [] };
  // Pasta de cada Placemark: o último <Folder><name> aberto antes dele.
  const re = /<Folder>\s*<name>([\s\S]*?)<\/name>|<Placemark>([\s\S]*?)<\/Placemark>/g;
  let pasta = "";
  for (let m = re.exec(kml); m; m = re.exec(kml)) {
    if (m[1] !== undefined) { pasta = texto(m[1]); continue; }
    const bloco = m[2]!;
    const nome = nomeDe(bloco);
    const ponto = /<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(bloco);
    const linha = /<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(bloco);
    if (ponto) { const [c] = coordenadas(ponto[1]!); if (c) r.pontos.push({ nome, pasta, ...c }); }
    else if (linha) { const cs = coordenadas(linha[1]!); if (cs.length >= 2) r.linhas.push({ nome, coordenadas: cs }); }
  }
  return r;
}

/** Junta as linhas da rota e tira pontos repetidos/colados (< 5 m), para guardar um traçado leve. */
export function tracadoDaRota(linhas: KmlLido["linhas"]): Coordenada[] {
  const todos = linhas.flatMap((l) => l.coordenadas);
  const saida: Coordenada[] = [];
  for (const c of todos) if (!saida.length || distanciaKm(saida[saida.length - 1]!, c) * 1000 >= 5) saida.push({ lat: Math.round(c.lat * 1e6) / 1e6, lng: Math.round(c.lng * 1e6) / 1e6 });
  return saida;
}

export const comprimentoKm = (t: readonly Coordenada[]) => t.slice(1).reduce((s, c, i) => s + distanciaKm(t[i]!, c), 0);

/** Distância máxima (m) entre um ponto/ônibus e o traçado para usar o caminho real. */
export const DISTANCIA_MAXIMA_DO_TRACADO_M = 300;

/**
 * Posição de cada parada no traçado (índice do vértice mais próximo), em ordem: cada parada é procurada depois da anterior
 * (a rota pode passar duas vezes perto do mesmo lugar, ex.: começa e termina no Villa Romana). null = longe do traçado.
 */
export function indicesNoTracado(tracado: readonly Coordenada[], paradas: ReadonlyArray<Coordenada | null>): Array<number | null> {
  let desde = 0;
  return paradas.map((p) => {
    if (!p) return null;
    let melhor = -1;
    let dist = Infinity;
    for (let i = desde; i < tracado.length; i++) {
      const d = distanciaKm(p, tracado[i]!);
      if (d < dist) { dist = d; melhor = i; }
    }
    if (melhor < 0 || dist * 1000 > DISTANCIA_MAXIMA_DO_TRACADO_M) return null;
    desde = melhor;
    return melhor;
  });
}

/** Km pelo traçado da posição (procurada entre os vértices `de` e `ate`) até o vértice `ate`; null se o ônibus está fora do traçado. */
export function kmPeloTracado(tracado: readonly Coordenada[], posicao: Coordenada, de: number, ate: number): number | null {
  let melhor = -1;
  let dist = Infinity;
  for (let i = Math.max(0, de); i <= ate && i < tracado.length; i++) {
    const d = distanciaKm(posicao, tracado[i]!);
    if (d < dist) { dist = d; melhor = i; }
  }
  if (melhor < 0 || dist * 1000 > DISTANCIA_MAXIMA_DO_TRACADO_M) return null;
  let km = 0;
  for (let i = melhor; i < ate; i++) km += distanciaKm(tracado[i]!, tracado[i + 1]!);
  return km;
}

/**
 * Análise do trajeto feito (gestão, 11/11/2026): horário em que passou em cada parada (a primeira posição a até 150 m, em ordem),
 * paradas puladas (não passou, mas passou numa seguinte), duração, km percorridos e velocidades.
 */
export function analisarTrajeto(paradas: ReadonlyArray<Coordenada | null>, posicoes: ReadonlyArray<{ lat: number; lng: number; em: Date; velocidade: number | null }>, raioM = 150) {
  const passagens: Array<Date | null> = paradas.map(() => null);
  let desde = 0;
  for (const [i, p] of paradas.entries()) {
    if (!p) continue;
    for (let j = desde; j < posicoes.length; j++) {
      if (distanciaKm(p, posicoes[j]!) * 1000 <= raioM) { passagens[i] = posicoes[j]!.em; desde = j; break; }
    }
  }
  const ultimaPassada = passagens.reduce((u, x, i) => (x ? i : u), -1);
  const pulados = passagens.map((x, i) => !x && !!paradas[i] && i < ultimaPassada);
  let km = 0;
  for (let j = 1; j < posicoes.length; j++) km += distanciaKm(posicoes[j - 1]!, posicoes[j]!);
  const inicio = posicoes[0]?.em ?? null;
  const fim = posicoes.at(-1)?.em ?? null;
  const horas = inicio && fim ? (fim.getTime() - inicio.getTime()) / 3_600_000 : 0;
  const velocidades = posicoes.map((p) => p.velocidade).filter((v): v is number => v !== null && Number.isFinite(v)).map((v) => v * 3.6);
  return {
    passagens, pulados,
    resumo: {
      inicio, fim, duracaoMin: Math.round(horas * 60), km: Math.round(km * 10) / 10,
      velocidadeMediaKmh: horas > 0 ? Math.round(km / horas) : null,
      velocidadeMaximaKmh: velocidades.length ? Math.round(Math.max(...velocidades)) : null,
    },
  };
}
