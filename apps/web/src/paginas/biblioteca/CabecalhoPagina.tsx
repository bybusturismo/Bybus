import { useEffect, useRef, useState } from "react";
import { formatarDataHora } from "../../util/formato";
import type { Pagina } from "./tipos";

/** Título editável no lugar: clicar edita; Enter ou sair do campo salva; Esc desiste. */
export function TituloPagina({ titulo, podeEditar, aoSalvar }: { titulo: string; podeEditar: boolean; aoSalvar: (novo: string) => void }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(titulo);
  const campo = useRef<HTMLInputElement>(null);
  const desistiu = useRef(false);
  useEffect(() => setValor(titulo), [titulo]);
  useEffect(() => { if (editando) campo.current?.select(); }, [editando]);

  function concluir() {
    setEditando(false);
    const novo = valor.trim();
    if (desistiu.current) { desistiu.current = false; setValor(titulo); return; }
    if (novo.length >= 2 && novo !== titulo) aoSalvar(novo);
    else setValor(titulo);
  }
  if (!podeEditar) return <h2 className="cabecalho-pagina__titulo">{titulo}</h2>;
  return editando ? (
    <input
      ref={campo}
      className="cabecalho-pagina__campo"
      aria-label="Nome da página"
      value={valor}
      maxLength={160}
      onChange={(e) => setValor(e.target.value)}
      onBlur={concluir}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); campo.current?.blur(); }
        if (e.key === "Escape") { desistiu.current = true; campo.current?.blur(); }
      }}
    />
  ) : (
    <h2 className="cabecalho-pagina__titulo">
      <button type="button" className="cabecalho-pagina__editar" title="Clique para renomear" onClick={() => setEditando(true)}>{titulo}</button>
    </h2>
  );
}

/** Ícone (emoji), título editável, autor, "Atualizado por último" e a tabela de subpáginas com proprietário e colaboradores. */
export function CabecalhoPagina({ pagina, aoRenomear, aoIcone, acoes }: { pagina: Pagina; aoRenomear: (t: string) => void; aoIcone: () => void; acoes?: React.ReactNode }) {
  return (
    <header className="cabecalho-pagina">
      <div className="cabecalho-pagina__linha">
        {pagina.podeEditar ? (
          <button type="button" className="cabecalho-pagina__icone" aria-label="Trocar o ícone da página" title="Trocar o ícone" onClick={aoIcone}>{pagina.icone ?? "📄"}</button>
        ) : (
          <span className="cabecalho-pagina__icone" aria-hidden="true">{pagina.icone ?? "📄"}</span>
        )}
        <TituloPagina titulo={pagina.titulo} podeEditar={pagina.podeEditar} aoSalvar={aoRenomear} />
        {pagina.acessoEfetivo === "RESTRITO" && <span className="etiqueta etiqueta--atencao">restrita</span>}
        {acoes && <div className="barra-acoes cabecalho-pagina__acoes">{acoes}</div>}
      </div>
      <p className="texto-fraco cabecalho-pagina__meta">
        {pagina.autor ? <>Criada por <strong>{pagina.autor}</strong> em {formatarDataHora(pagina.criadoEm)} · </> : null}
        Atualizado por último: {formatarDataHora(pagina.atualizadoEm)}{pagina.atualizadoPor ? <> por <strong>{pagina.atualizadoPor}</strong></> : null}
      </p>
    </header>
  );
}
