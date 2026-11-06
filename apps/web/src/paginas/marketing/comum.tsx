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
export const ROTULO_STATUS_CONTEUDO: Record<string, string> = { IDEIA: "Ideia", PRODUCAO: "Rascunho", EM_APROVACAO: "Em aprovação", APROVADO: "Aprovado", AGENDADO: "Agendado", PUBLICADO: "Publicado" };
export const ROTULO_TIPO_AFILIADO: Record<string, string> = { HOTEL: "Hotel", POUSADA: "Pousada", AGENCIA: "Agência", PARCEIRO: "Parceiro", OUTRO: "Outro" };
export const ROTULO_STATUS_PEDIDO: Record<string, string> = {
  PENDENTE: "A enviar", ENVIADA_MANUAL: "Pedido feito à mão", SIMULADA: "Simulada", ENVIADA: "Enviada", LEMBRADA: "Lembrada", AVALIADA: "Avaliada", SEM_TELEFONE: "Sem telefone", IGNORADA: "Ignorada",
};
export const ROTULO_IDIOMA: Record<string, string> = { pt: "Português", en: "English", es: "Español" };
export const ROTULO_CANAL_AVALIACAO: Record<string, string> = { GOOGLE: "Google", TRIPADVISOR: "Tripadvisor", VIATOR: "Viator (na própria Viator)", NENHUM: "Sem link cadastrado" };

/** Linhas de barras horizontais com o valor em texto (o número também está na tela, para leitores de tela). */
export function BarrasLista({ itens, formato }: { itens: Array<{ rotulo: string; valor: number }>; formato?: (v: number) => string }) {
  const max = Math.max(1, ...itens.map((i) => Math.abs(i.valor)));
  return (
    <ul className="m2-barras">
      {itens.map((i) => (
        <li key={i.rotulo}>
          <span>{i.rotulo}</span>
          <span className="m2-barras__trilho" aria-hidden="true"><span className={`m2-barras__valor${i.valor < 0 ? " m2-barras__valor--neg" : ""}`} style={{ width: `${Math.max(2, (Math.abs(i.valor) / max) * 100)}%` }} /></span>
          <span className="num">{formato ? formato(i.valor) : i.valor}</span>
        </li>
      ))}
    </ul>
  );
}

/** Linha de evolução simples (sem eixos): serve para ver a tendência; os valores exatos ficam na tabela ao lado. */
export function Evolucao({ pontos, rotulo }: { pontos: number[]; rotulo: string }) {
  if (pontos.length < 2) return <p className="texto-fraco">Lance ao menos duas semanas para ver a evolução.</p>;
  const min = Math.min(...pontos), max = Math.max(...pontos), faixa = max - min || 1;
  const xy = pontos.map((v, i) => [(i / (pontos.length - 1)) * 100, 34 - ((v - min) / faixa) * 30] as const);
  return (
    <svg className="m2-spark" viewBox="0 0 100 38" preserveAspectRatio="none" role="img" aria-label={rotulo}>
      <path d={xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")} />
    </svg>
  );
}

/** Variação percentual com cor (verde sobe, vermelho cai); nulo = sem base de comparação. */
export function Variacao({ v }: { v: number | null }) {
  if (v == null) return <span className="texto-fraco">—</span>;
  return <span className={v > 0 ? "m2-variacao--alta" : v < 0 ? "m2-variacao--baixa" : undefined}>{v > 0 ? "+" : ""}{v.toLocaleString("pt-BR")}%</span>;
}

