import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { analisarMarkdown, type Bloco, type Inline } from "@bybus/core";
import "../../estilos/marketing.css";

/**
 * Renderiza Markdown montando elementos React a partir da árvore do analisador do núcleo.
 * Nunca usa innerHTML: HTML digitado aparece como texto e links perigosos já foram descartados na análise.
 */
function Linha({ itens }: { itens: Inline[] }): ReactNode {
  return (
    <>
      {itens.map((n, i) => {
        switch (n.t) {
          case "texto":
            return <Fragment key={i}>{n.v}</Fragment>;
          case "negrito":
            return <strong key={i}><Linha itens={n.c} /></strong>;
          case "italico":
            return <em key={i}><Linha itens={n.c} /></em>;
          case "codigo":
            return <code key={i}>{n.v}</code>;
          case "link":
            return n.href.startsWith("/") ? (
              <Link key={i} to={n.href}><Linha itens={n.c} /></Link>
            ) : (
              <a key={i} href={n.href} target="_blank" rel="noopener noreferrer"><Linha itens={n.c} /></a>
            );
        }
      })}
    </>
  );
}

function Bloquinho({ b }: { b: Bloco }): ReactNode {
  switch (b.t) {
    case "titulo": {
      const Tag = `h${Math.min(4, b.nivel)}` as "h1" | "h2" | "h3" | "h4";
      return <Tag><Linha itens={b.c} /></Tag>;
    }
    case "paragrafo":
      return <p><Linha itens={b.c} /></p>;
    case "lista": {
      const Tag = b.ordenada ? "ol" : "ul";
      return <Tag>{b.itens.map((it, i) => <li key={i}><Linha itens={it} /></li>)}</Tag>;
    }
    case "citacao":
      return <blockquote><Linha itens={b.c} /></blockquote>;
    case "codigo":
      return <pre><code>{b.v}</code></pre>;
    case "regua":
      return <hr />;
    case "tabela":
      return (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr>{b.cabecalho.map((c, i) => <th key={i}><Linha itens={c} /></th>)}</tr></thead>
            <tbody>{b.linhas.map((l, i) => <tr key={i}>{l.map((c, j) => <td key={j}><Linha itens={c} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
  }
}

export function Markdown({ texto }: { texto: string }) {
  const blocos = analisarMarkdown(texto);
  if (blocos.length === 0) return <p className="texto-fraco">Página sem conteúdo.</p>;
  return <div className="md">{blocos.map((b, i) => <Bloquinho key={i} b={b} />)}</div>;
}
