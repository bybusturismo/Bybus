import { useEffect, useId, useMemo, useRef, useState } from "react";
import { compararTexto, normalizarBusca } from "./Tabela";

/**
 * Filtro de coluna "como no Excel" (pedido do dono, 13/11/2026): no cabeçalho, classificar de A a Z / Z a A e marcar só os
 * valores que interessam (ex.: só uma placa, só o trem). Trabalha sobre as linhas já carregadas na tela.
 */
export type Direcao = "asc" | "desc";
export interface EstadoColunas<C extends string> {
  ordem: { coluna: C; direcao: Direcao } | null;
  /** Valores escolhidos por coluna (ausente = todos). */
  selecionados: Partial<Record<C, string[]>>;
}

export interface DefinicaoColuna<T> {
  /** Texto usado para filtrar e mostrar na lista de valores. */
  valor: (linha: T) => string;
  /** Chave para ordenar (padrão: o próprio texto). Números e datas ISO ordenam certo. */
  ordenar?: (linha: T) => string | number;
}

export function aplicarColunas<T, C extends string>(linhas: readonly T[], colunas: Record<C, DefinicaoColuna<T>>, estado: EstadoColunas<C>): T[] {
  let saida = linhas.filter((l) =>
    (Object.keys(estado.selecionados) as C[]).every((c) => {
      const sel = estado.selecionados[c];
      return !sel || sel.includes(colunas[c].valor(l));
    }),
  );
  if (estado.ordem) {
    const { coluna, direcao } = estado.ordem;
    const def = colunas[coluna];
    const chave = def.ordenar ?? def.valor;
    saida = [...saida].sort((a, b) => {
      const x = chave(a);
      const y = chave(b);
      const r = typeof x === "number" && typeof y === "number" ? x - y : compararTexto(String(x), String(y));
      return direcao === "asc" ? r : -r;
    });
  }
  return saida;
}

export const VAZIO = "(vazio)";

export function CabecalhoFiltro<T, C extends string>(p: {
  coluna: C;
  rotulo: string;
  linhas: readonly T[];
  definicao: DefinicaoColuna<T>;
  estado: EstadoColunas<C>;
  mudar: (e: EstadoColunas<C>) => void;
  className?: string;
  /** Rótulos do classificar (datas e valores: "do menor para o maior"). */
  textos?: { asc: string; desc: string };
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const id = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const valores = useMemo(
    () => [...new Set(p.linhas.map((l) => p.definicao.valor(l)))].sort((a, b) => compararTexto(a, b)),
    [p.linhas, p.definicao],
  );
  const atuais = p.estado.selecionados[p.coluna];
  const [marcados, setMarcados] = useState<Set<string>>(new Set(atuais ?? valores));
  useEffect(() => { if (aberto) { setMarcados(new Set(atuais ?? valores)); setBusca(""); } }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);

  const visiveis = valores.filter((v) => normalizarBusca(v).includes(normalizarBusca(busca)));
  const ativo = !!atuais || p.estado.ordem?.coluna === p.coluna;
  const seta = p.estado.ordem?.coluna === p.coluna ? (p.estado.ordem.direcao === "asc" ? " ▲" : " ▼") : "";
  const textos = p.textos ?? { asc: "Classificar de A a Z", desc: "Classificar de Z a A" };

  function ordenar(direcao: Direcao) {
    p.mudar({ ...p.estado, ordem: { coluna: p.coluna, direcao } });
    setAberto(false);
  }
  function aplicar() {
    const sel = { ...p.estado.selecionados };
    if (marcados.size === valores.length) delete sel[p.coluna];
    else sel[p.coluna] = valores.filter((v) => marcados.has(v));
    p.mudar({ ...p.estado, selecionados: sel });
    setAberto(false);
  }
  function limpar() {
    const sel = { ...p.estado.selecionados };
    delete sel[p.coluna];
    p.mudar({ ordem: p.estado.ordem?.coluna === p.coluna ? null : p.estado.ordem, selecionados: sel });
    setAberto(false);
  }

  return (
    <th scope="col" className={p.className} aria-sort={p.estado.ordem?.coluna === p.coluna ? (p.estado.ordem.direcao === "asc" ? "ascending" : "descending") : undefined}>
      <div className="filtro-coluna" ref={caixa}>
        <button type="button" className={`filtro-coluna__botao${ativo ? " filtro-coluna__botao--ativo" : ""}`} aria-expanded={aberto} aria-controls={id} onClick={() => setAberto(!aberto)}>
          {p.rotulo}{seta}{atuais ? ` (${atuais.length})` : ""} <span aria-hidden="true">▾</span>
          <span className="visualmente-oculto"> — classificar e filtrar</span>
        </button>
        {aberto && (
          <div id={id} className="filtro-coluna__menu" role="dialog" aria-label={`Filtrar ${p.rotulo}`}>
            <button type="button" className="filtro-coluna__opcao" onClick={() => ordenar("asc")}>{textos.asc}</button>
            <button type="button" className="filtro-coluna__opcao" onClick={() => ordenar("desc")}>{textos.desc}</button>
            <hr />
            <input type="search" aria-label={`Buscar em ${p.rotulo}`} placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <label className="filtro-coluna__item">
              <input
                type="checkbox"
                checked={visiveis.every((v) => marcados.has(v))}
                onChange={(e) => {
                  const n = new Set(marcados);
                  for (const v of visiveis) if (e.target.checked) n.add(v); else n.delete(v);
                  setMarcados(n);
                }}
              />
              (Selecionar tudo)
            </label>
            <div className="filtro-coluna__lista">
              {visiveis.map((v) => (
                <label key={v} className="filtro-coluna__item">
                  <input
                    type="checkbox"
                    checked={marcados.has(v)}
                    onChange={(e) => {
                      const n = new Set(marcados);
                      if (e.target.checked) n.add(v); else n.delete(v);
                      setMarcados(n);
                    }}
                  />
                  {v}
                </label>
              ))}
            </div>
            <div className="filtro-coluna__acoes">
              <button type="button" className="botao botao--pequeno botao--fantasma" onClick={limpar}>Limpar</button>
              <button type="button" className="botao botao--pequeno botao--primario" onClick={aplicar} disabled={marcados.size === 0}>Aplicar</button>
            </div>
          </div>
        )}
      </div>
    </th>
  );
}
