import { createContext, useContext, useMemo, type ReactNode } from "react";
import { descreverTempo, type IconeTempo, type TempoDia } from "@bybus/core";
import { api, qs } from "../api/cliente";
import { useCarregar } from "../util/useCarregar";

/**
 * Ícone discreto da previsão do tempo (13/11/2026): sol, sol entre nuvens, nuvem, neblina, chuva fraca, chuva, trovoada.
 * Média histórica (datas além da previsão) aparece mais clara e com a dica "média histórica".
 */
const DESENHOS: Record<IconeTempo, ReactNode> = {
  SOL: (<><circle cx="12" cy="12" r="4.2" className="tempo__sol" /><g className="tempo__raio">{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1="12" y1="2.6" x2="12" y2="5" transform={`rotate(${a} 12 12)`} />)}</g></>),
  SOL_NUVENS: (<><circle cx="9" cy="9" r="3.6" className="tempo__sol" /><path className="tempo__nuvem" d="M8 19h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.5 1.4A2.9 2.9 0 0 0 8 19z" /></>),
  NUBLADO: (<path className="tempo__nuvem" d="M6.5 18.5h11a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.6A3.2 3.2 0 0 0 6.5 18.5z" />),
  NEBLINA: (<><path className="tempo__nuvem" d="M7 13h10a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.7 1.5A2.9 2.9 0 0 0 7 13z" /><g className="tempo__linha"><line x1="4" y1="16.5" x2="20" y2="16.5" /><line x1="6" y1="20" x2="18" y2="20" /></g></>),
  CHUVA_FRACA: (<><path className="tempo__nuvem" d="M6.5 14h11a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.3 1.5A3 3 0 0 0 6.5 14z" /><g className="tempo__gota"><line x1="10" y1="17" x2="9.2" y2="19.5" /><line x1="15" y1="17" x2="14.2" y2="19.5" /></g></>),
  CHUVA: (<><path className="tempo__nuvem" d="M6.5 13.5h11a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.3 1.5A3 3 0 0 0 6.5 13.5z" /><g className="tempo__gota"><line x1="8" y1="16" x2="6.8" y2="20" /><line x1="12" y1="16" x2="10.8" y2="20" /><line x1="16" y1="16" x2="14.8" y2="20" /></g></>),
  TEMPESTADE: (<><path className="tempo__nuvem" d="M6.5 13h11a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.3 1.5A3 3 0 0 0 6.5 13z" /><path className="tempo__raio-tempestade" d="M12.5 13.5l-2.5 4h2.4l-1.4 4 4-5.2h-2.6l1.6-2.8z" /></>),
};

export function IconeDoTempo({ tempo, tamanho = 18 }: { tempo: TempoDia | null | undefined; tamanho?: number }) {
  if (!tempo) return null;
  const dica = descreverTempo(tempo);
  return (
    <span className={`tempo${tempo.fonte === "HISTORICO" ? " tempo--historico" : ""}`} title={dica} role="img" aria-label={dica}>
      <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{DESENHOS[tempo.icone]}</svg>
      {tempo.tempMax !== null && tempo.fonte === "PREVISAO" && <span className="tempo__temp" aria-hidden="true">{tempo.tempMax}°</span>}
    </span>
  );
}

type PorPraca = Record<string, TempoDia[]>;
const Ctx = createContext<PorPraca | null>(null);

/** Carrega o tempo do período uma vez; os ícones de cada dia leem daqui. Falha na previsão não atrapalha a tela. */
export function useTempo(de: string, ate: string, unidadeId?: string | null) {
  const r = useCarregar((s) => api.get<{ porPraca: PorPraca }>(`/api/tempo${qs({ de, ate, unidadeId: unidadeId || undefined })}`, s).catch(() => ({ porPraca: {} })), [de, ate, unidadeId]);
  return r.dados?.porPraca ?? null;
}

export function ProvedorTempo({ valor, children }: { valor: PorPraca | null; children: ReactNode }) {
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/** Ícone do dia de uma praça, lido do provedor (ou de um mapa passado direto). */
export function TempoDoDia({ unidadeId, data, porPraca, tamanho }: { unidadeId: string | null | undefined; data: string; porPraca?: PorPraca | null; tamanho?: number }) {
  const ctx = useContext(Ctx);
  const mapa = porPraca ?? ctx;
  const t = useMemo(() => (unidadeId && mapa ? mapa[unidadeId]?.find((x) => x.data === data) : undefined), [mapa, unidadeId, data]);
  return <IconeDoTempo tempo={t} tamanho={tamanho} />;
}
