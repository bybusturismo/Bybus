import { useState } from "react";

export interface Ordem<C extends string> {
  campo: C;
  asc: boolean;
}

/** Estado de ordenação + paginação de uma tabela em memória. */
export function useTabela<C extends string>(campoInicial: C, porPagina = 25) {
  const [ordem, setOrdem] = useState<Ordem<C>>({ campo: campoInicial, asc: true });
  const [pagina, setPagina] = useState(0);
  return {
    ordem,
    ordenar: (campo: C) => {
      setOrdem((o) => ({ campo, asc: o.campo === campo ? !o.asc : true }));
      setPagina(0);
    },
    pagina,
    setPagina,
    porPagina,
    /** Recorta a lista ordenada na página atual. */
    paginar<T>(lista: T[]) {
      const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
      const atual = Math.min(pagina, paginas - 1);
      return { visiveis: lista.slice(atual * porPagina, (atual + 1) * porPagina), atual, paginas, total: lista.length };
    },
  };
}

export function CabecalhoOrdenavel<C extends string>({ campo, rotulo, ordem, ordenar }: { campo: C; rotulo: string; ordem: Ordem<C>; ordenar: (c: C) => void }) {
  return (
    <th scope="col" aria-sort={ordem.campo === campo ? (ordem.asc ? "ascending" : "descending") : "none"}>
      <button type="button" className="botao-ordenar" onClick={() => ordenar(campo)}>
        {rotulo} <span aria-hidden="true">{ordem.campo === campo ? (ordem.asc ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

export function Paginacao({ atual, paginas, total, setPagina }: { atual: number; paginas: number; total: number; setPagina: (n: number) => void }) {
  if (paginas <= 1) return null;
  return (
    <nav className="paginacao" aria-label="Paginação">
      <button type="button" className="botao botao--secundario botao--pequeno" disabled={atual === 0} onClick={() => setPagina(atual - 1)}>
        ← Anterior
      </button>
      <span>
        Página {atual + 1} de {paginas} · {total} registros
      </span>
      <button type="button" className="botao botao--secundario botao--pequeno" disabled={atual >= paginas - 1} onClick={() => setPagina(atual + 1)}>
        Próxima →
      </button>
    </nav>
  );
}

/** Compara textos em pt-BR (acentos e maiúsculas ignorados) — para ordenar colunas. */
export function compararTexto(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", "pt-BR", { sensitivity: "base" });
}

/** Normaliza para busca: minúsculas e sem acento. */
export function normalizarBusca(t: string | null | undefined): string {
  return (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
