/** Posição do GPS do celular, no formato que a API de rastreio recebe. */
export interface PosicaoGps {
  lat: number;
  lng: number;
  precisaoM: number | null;
  /** m/s. */
  velocidade: number | null;
  direcao: number | null;
  /** ISO em UTC (horário do aparelho). */
  registradaEm: string;
}

export type ErroGps = "NEGADO" | "INDISPONIVEL" | "TEMPO_ESGOTADO" | "NAO_SUPORTADO";

/** Mensagens para o motorista (português simples, sem jargão). */
export const MENSAGEM_ERRO_GPS: Record<ErroGps, string> = {
  NEGADO: "A localização está bloqueada neste navegador. Permita o acesso à localização nas configurações do site e tente de novo.",
  INDISPONIVEL: "Não foi possível obter a localização. Verifique se o GPS do celular está ligado.",
  TEMPO_ESGOTADO: "O GPS demorou para responder. Procure um local aberto; o rastreio continua tentando.",
  NAO_SUPORTADO: "Este aparelho ou navegador não tem localização por GPS.",
};

/**
 * Acompanha a posição do aparelho (alta precisão). Devolve a função que para o acompanhamento.
 * Na demonstração publicada não há GPS: um ônibus fictício é simulado.
 */
export function observarPosicao(aoPosicao: (p: PosicaoGps) => void, aoErro: (e: ErroGps) => void): () => void {
  if (import.meta.env.VITE_DEMO === "1") {
    let parar = () => {};
    let cancelado = false;
    void import("../demo/rastreioDemo").then((m) => {
      if (!cancelado) parar = m.iniciarGpsSimulado(aoPosicao);
    });
    return () => {
      cancelado = true;
      parar();
    };
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    aoErro("NAO_SUPORTADO");
    return () => {};
  }
  const geo = navigator.geolocation;
  const id = geo.watchPosition(
    (g) =>
      aoPosicao({
        lat: g.coords.latitude,
        lng: g.coords.longitude,
        precisaoM: Number.isFinite(g.coords.accuracy) ? g.coords.accuracy : null,
        velocidade: g.coords.speed != null && Number.isFinite(g.coords.speed) && g.coords.speed >= 0 ? g.coords.speed : null,
        direcao: g.coords.heading != null && Number.isFinite(g.coords.heading) && g.coords.heading >= 0 ? g.coords.heading : null,
        registradaEm: new Date(g.timestamp).toISOString(),
      }),
    (e) => aoErro(e.code === 1 ? "NEGADO" : e.code === 3 ? "TEMPO_ESGOTADO" : "INDISPONIVEL"),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
  );
  return () => geo.clearWatch(id);
}

/** Lê "lat, lng" (como o Google Maps copia) ou um número só; aceita vírgula decimal. */
export function lerCoordenada(texto: string): number | null {
  const t = texto.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Separa um par colado do Google Maps ("-27.5954, -48.5480"). Devolve null se não for um par. */
export function lerParCoordenadas(texto: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(texto) ?? /^\s*(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)\s*$/.exec(texto);
  if (!m) return null;
  return { lat: Number(m[1]!.replace(",", ".")), lng: Number(m[2]!.replace(",", ".")) };
}
