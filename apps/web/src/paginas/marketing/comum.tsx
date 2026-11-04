import { useState } from "react";
import "../../estilos/marketing.css";
import { somarDias, hojeIso } from "../../util/formato";

export interface Periodo {
  de: string;
  ate: string;
}

/** Período do painel (padrão: últimos 90 dias e os próximos 60, pois reserva de passeio futuro também é venda). */
export function usePeriodo(dias = 90, adiante = 60) {
  const [periodo, setPeriodo] = useState<Periodo>(() => ({ de: somarDias(hojeIso(), -(dias - 1)), ate: somarDias(hojeIso(), adiante) }));
  return [periodo, setPeriodo] as const;
}

export function FiltroPeriodo({ periodo, aoMudar }: { periodo: Periodo; aoMudar: (p: Periodo) => void }) {
  return (
    <div className="filtros" role="group" aria-label="Período">
      <div className="campo campo--linha">
        <label htmlFor="filtro-de">De</label>
        <input id="filtro-de" type="date" value={periodo.de} max={periodo.ate} onChange={(e) => e.target.value && aoMudar({ ...periodo, de: e.target.value })} />
      </div>
      <div className="campo campo--linha">
        <label htmlFor="filtro-ate">Até</label>
        <input id="filtro-ate" type="date" value={periodo.ate} min={periodo.de} onChange={(e) => e.target.value && aoMudar({ ...periodo, ate: e.target.value })} />
      </div>
    </div>
  );
}

/** Barra de proporção com o número ao lado (o valor também está em texto, para leitores de tela). */
export function BarraProporcao({ percentual, rotulo }: { percentual: number; rotulo?: string }) {
  const p = Math.max(0, Math.min(100, percentual));
  return (
    <span className="barra-prop">
      <span className="barra-prop__trilho" aria-hidden="true">
        <span className="barra-prop__preenchimento" style={{ width: `${p}%` }} />
      </span>
      <span className="barra-prop__valor">{rotulo ?? `${p}%`}</span>
    </span>
  );
}

export const ROTULO_MIDIA: Record<string, string> = {
  GOOGLE_ADS: "Google Ads", META_ADS: "Meta Ads", INSTAGRAM: "Instagram", TRIPADVISOR: "Tripadvisor", PARCEIRO: "Parceiro", OFFLINE: "Offline (cartaz, quiosque…)", OUTRA: "Outra",
};
export const ROTULO_REDE: Record<string, string> = {
  INSTAGRAM: "Instagram", FACEBOOK: "Facebook", TIKTOK: "TikTok", YOUTUBE: "YouTube", GOOGLE_NEGOCIOS: "Google Meu Negócio", BLOG: "Blog", OUTRA: "Outra",
};
export const ROTULO_STATUS_CONTEUDO: Record<string, string> = { IDEIA: "Ideia", PRODUCAO: "Em produção", AGENDADO: "Agendado", PUBLICADO: "Publicado" };
export const ROTULO_TIPO_AFILIADO: Record<string, string> = { HOTEL: "Hotel", POUSADA: "Pousada", AGENCIA: "Agência", PARCEIRO: "Parceiro", OUTRO: "Outro" };
export const ROTULO_STATUS_PEDIDO: Record<string, string> = {
  PENDENTE: "A enviar", ENVIADA_MANUAL: "Enviada à mão", SIMULADA: "Simulada", SEM_TELEFONE: "Sem telefone", IGNORADA: "Ignorada",
};

