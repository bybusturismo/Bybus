import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/cliente";
import { useAtraso } from "../util/useAtraso";
import { Icone } from "./Icone";

export interface ResultadoBusca { grupo: string; titulo: string; detalhe: string | null; para: string }
export interface TelaBusca { para: string; rotulo: string; area?: string }

const sem = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Busca geral no topo (dono, 16/11/2026): telas do menu e cadastros (reservas, grupos, orçamentos, equipe, veículos,
 * afiliados) num só lugar. Atalho: "/" ou Ctrl+K. Setas escolhem, Enter abre, Esc fecha. No celular vira um botão (lupa).
 */
export function BuscaGeral({ telas }: { telas: TelaBusca[] }) {
  const navegar = useNavigate();
  const id = useId();
  const campo = useRef<HTMLInputElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [texto, setTexto] = useState("");
  const [aberta, setAberta] = useState(false);
  const [expandida, setExpandida] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const [servidor, setServidor] = useState<{ q: string; itens: ResultadoBusca[] } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const termo = useAtraso(texto.trim(), 250);

  useEffect(() => {
    if (termo.length < 2) { setServidor(null); return; }
    const ctl = new AbortController();
    setCarregando(true);
    api.get<{ resultados: ResultadoBusca[] }>(`/api/busca?q=${encodeURIComponent(termo)}`, ctl.signal)
      .then((r) => setServidor({ q: termo, itens: r.resultados }))
      .catch(() => { if (!ctl.signal.aborted) setServidor({ q: termo, itens: [] }); })
      .finally(() => { if (!ctl.signal.aborted) setCarregando(false); });
    return () => ctl.abort();
  }, [termo]);

  const resultados = useMemo(() => {
    const t = sem(texto.trim());
    if (!t) return [];
    const deTelas: ResultadoBusca[] = telas.filter((x) => sem(x.rotulo).includes(t) || sem(x.area ?? "").includes(t)).slice(0, 6)
      .map((x) => ({ grupo: "Telas", titulo: x.rotulo, detalhe: x.area ?? null, para: x.para }));
    return [...deTelas, ...(servidor && servidor.q === termo ? servidor.itens : [])];
  }, [texto, telas, servidor, termo]);

  useEffect(() => setMarcado(0), [resultados.length, texto]);

  // Atalhos: "/" ou Ctrl+K levam à busca (fora de campos de texto).
  useEffect(() => {
    const aoTeclar = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const digitando = !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !digitando && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        setExpandida(true);
        setAberta(true);
        setTimeout(() => campo.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  // Clique fora fecha.
  useEffect(() => {
    if (!aberta && !expandida) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) { setAberta(false); setExpandida(false); }
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberta, expandida]);

  function abrir(r: ResultadoBusca) {
    setTexto("");
    setAberta(false);
    setExpandida(false);
    campo.current?.blur();
    navegar(r.para);
  }

  function teclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setAberta(true); setMarcado((m) => Math.min(m + 1, resultados.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setMarcado((m) => Math.max(m - 1, 0)); }
    else if (e.key === "Enter") { const r = resultados[marcado]; if (r) { e.preventDefault(); abrir(r); } }
    else if (e.key === "Escape") { setAberta(false); setExpandida(false); campo.current?.blur(); }
  }

  const mostrar = aberta && texto.trim().length > 0;
  const grupos = [...new Set(resultados.map((r) => r.grupo))];
  const listaId = `${id}-lista`;

  return (
    <div ref={caixa} className={`busca-geral${expandida ? " busca-geral--expandida" : ""}`} role="search">
      <button type="button" className="botao botao--fantasma botao--icone botao--topo busca-geral__lupa" aria-label="Buscar" title="Buscar (/)"
        onClick={() => { setExpandida(true); setAberta(true); setTimeout(() => campo.current?.focus(), 0); }}>
        <Icone nome="lupa" />
      </button>
      <div className="busca-geral__campo">
        <Icone nome="lupa" />
        <label htmlFor={`${id}-campo`} className="visualmente-oculto">Buscar no sistema</label>
        <input
          ref={campo} id={`${id}-campo`} type="search" autoComplete="off" spellCheck={false}
          placeholder="Buscar no sistema"
          role="combobox" aria-expanded={mostrar} aria-controls={listaId} aria-autocomplete="list"
          aria-activedescendant={mostrar && resultados[marcado] ? `${id}-r${marcado}` : undefined}
          value={texto} onChange={(e) => { setTexto(e.target.value); setAberta(true); }} onFocus={() => setAberta(true)} onKeyDown={teclar}
        />
      </div>
      {mostrar && (
        <div className="busca-geral__painel">
          <ul id={listaId} role="listbox" aria-label="Resultados da busca" className="busca-geral__lista">
            {grupos.map((g) => (
              <li key={g} role="presentation">
                <div className="busca-geral__grupo" role="presentation">{g}</div>
                <ul role="group" aria-label={g}>
                  {resultados.map((r, i) => r.grupo !== g ? null : (
                    <li key={`${i}-${r.para}`} id={`${id}-r${i}`} role="option" aria-selected={i === marcado}
                      className={`busca-geral__item${i === marcado ? " busca-geral__item--marcado" : ""}`}
                      onMouseEnter={() => setMarcado(i)} onMouseDown={(e) => { e.preventDefault(); abrir(r); }}>
                      <span className="busca-geral__titulo">{r.titulo}</span>
                      {r.detalhe && <span className="busca-geral__detalhe">{r.detalhe}</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {!resultados.length && (
            <p className="busca-geral__vazio">{carregando || termo !== texto.trim() ? "Buscando…" : texto.trim().length < 2 ? "Digite pelo menos 2 letras." : "Nada encontrado."}</p>
          )}
          {resultados.length > 0 && carregando && <p className="busca-geral__vazio">Buscando mais…</p>}
        </div>
      )}
    </div>
  );
}
