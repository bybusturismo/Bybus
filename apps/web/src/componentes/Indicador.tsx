import type { ReactNode } from "react";
import { Icone, type NomeIcone } from "./Icone";
import type { Tinta } from "./Layout";

/** Cartão de indicador (número grande + rótulo), com ícone na cor da marca. */
export function Indicador({ tinta, icone, rotulo, valor, detalhe }: { tinta: Tinta; icone: NomeIcone; rotulo: string; valor: ReactNode; detalhe?: ReactNode }) {
  return (
    <div className={`indicador tinta--${tinta}`}>
      <span className="indicador__icone">
        <Icone nome={icone} tamanho={22} />
      </span>
      <div className="indicador__texto">
        <span className="indicador__rotulo">{rotulo}</span>
        <span className="indicador__valor">{valor}</span>
        {detalhe && <span className="indicador__detalhe">{detalhe}</span>}
      </div>
    </div>
  );
}

export function Indicadores({ children, rotulo }: { children: ReactNode; rotulo: string }) {
  return (
    <section className="indicadores" aria-label={rotulo}>
      {children}
    </section>
  );
}
