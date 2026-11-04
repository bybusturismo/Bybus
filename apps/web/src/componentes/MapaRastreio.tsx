import { lazy, Suspense } from "react";

export interface PropsMapa {
  /** Posição do ônibus (nulo = ainda sem sinal). */
  onibus?: { lat: number; lng: number } | null;
  /** Pontos da rota, na ordem; `destaque` marca o ponto do cliente. */
  pontos?: Array<{ lat: number; lng: number; nome: string; passou?: boolean; destaque?: boolean }>;
  /** Trajeto percorrido (lat, lng). */
  trajeto?: Array<[number, number]>;
  /** Descrição para leitores de tela. */
  rotulo: string;
  altura?: string;
}

// O Leaflet só é baixado quando um mapa aparece na tela.
const Leaflet = lazy(() => import("./Mapa"));

export function MapaRastreio(props: PropsMapa) {
  return (
    <Suspense fallback={<div className="mapa-rastreio mapa-rastreio--carregando" role="status">Carregando o mapa…</div>}>
      <Leaflet {...props} />
    </Suspense>
  );
}
