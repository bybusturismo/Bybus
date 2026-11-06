import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

/**
 * Cabeçalho único das páginas (revisão UX, 06/11/2026): título e subtítulo curto à esquerda,
 * filtros no meio (na mesma faixa, quando couber) e ações à direita. Só um botão primário por faixa.
 */
export function CabecalhoPagina({ titulo, descricao, filtros, acoes }: { titulo: ReactNode; descricao?: ReactNode; filtros?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="pagina__cabecalho">
      <div className="pagina__titulo">
        <h1>{titulo}</h1>
        {descricao && <p className="pagina__descricao">{descricao}</p>}
      </div>
      {filtros && <div className="pagina__filtros">{filtros}</div>}
      {acoes && <div className="barra-acoes">{acoes}</div>}
    </div>
  );
}

export type TomEtiqueta = "sucesso" | "atencao" | "perigo" | "info" | "neutra";

/** Etiqueta de status com as mesmas cores em todo o sistema: verde = ok, âmbar = atenção, vermelho = ação urgente, azul = informação, cinza = neutro. */
export function Etiqueta({ tom = "neutra", children, titulo }: { tom?: TomEtiqueta; children: ReactNode; titulo?: string }) {
  return (
    <span className={`etiqueta etiqueta--${tom}`} title={titulo}>
      {children}
    </span>
  );
}

export interface ItemAba {
  para: string;
  rotulo: ReactNode;
  /** Só é a aba ativa quando o caminho é exatamente este (aba de entrada do módulo). */
  fim?: boolean;
}

/** Abas de módulo (Financeiro, Frota…): cada aba é uma rota. Visual igual em todos os módulos. */
export function AbasModulo({ itens, rotulo }: { itens: ItemAba[]; rotulo: string }) {
  return (
    <nav className="abas abas--modulo nao-imprimir" aria-label={rotulo}>
      {itens.map((a) => (
        <NavLink key={a.para} to={a.para} end={a.fim} className={({ isActive }) => `aba${isActive ? " aba--ativa" : ""}`}>
          {a.rotulo}
        </NavLink>
      ))}
    </nav>
  );
}

/** Faixa de números do dia: indicadores pequenos em linha (número em destaque, rótulo pequeno). */
export function FaixaNumeros({ itens, rotulo }: { itens: Array<{ rotulo: string; valor: ReactNode; tom?: TomEtiqueta; detalhe?: ReactNode }>; rotulo: string }) {
  return (
    <dl className="faixa-numeros" aria-label={rotulo}>
      {itens.map((i) => (
        <div key={i.rotulo} className={`faixa-numeros__item${i.tom && i.tom !== "neutra" ? ` faixa-numeros__item--${i.tom}` : ""}`}>
          <dt>{i.rotulo}</dt>
          <dd>{i.valor}</dd>
          {i.detalhe && <span className="faixa-numeros__detalhe">{i.detalhe}</span>}
        </div>
      ))}
    </dl>
  );
}
