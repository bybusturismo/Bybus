import type { LinhaNegocio } from "../api/tipos";
import { formatarData, situacaoValidade } from "../util/formato";
import { ROTULO_LINHA } from "../util/rotulos";

/** Linha de negócio (City tour, Fretamento…) com cor própria e texto sempre visível. */
export function EtiquetaLinha({ linha }: { linha: LinhaNegocio | undefined | null }) {
  if (!linha) return null;
  return <span className={`etiqueta etiqueta--linha etiqueta--linha-${linha.toLowerCase()}`}>{ROTULO_LINHA[linha]}</span>;
}

/** Validade de CNH/Cadastur: vencido (vermelho) ou vencendo em 30 dias (amarelo). O texto diz o estado, não só a cor. */
export function EtiquetaValidade({ rotulo, validade, hoje }: { rotulo: string; validade: string | null | undefined; hoje: string }) {
  const s = situacaoValidade(validade, hoje);
  if (!s || !validade) return null;
  if (s === "vencido") return <span className="etiqueta etiqueta--perigo">{rotulo} vencida em {formatarData(validade)}</span>;
  if (s === "vencendo") return <span className="etiqueta etiqueta--atencao">{rotulo} vence em {formatarData(validade)}</span>;
  return <span className="texto-fraco">{rotulo} até {formatarData(validade)}</span>;
}
