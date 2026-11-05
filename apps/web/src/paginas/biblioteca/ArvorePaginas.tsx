import { DndContext, MouseSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent } from "@dnd-kit/core";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { destinoDoArraste, zonaDeSoltura, type NoArvore, type ZonaSoltura } from "@bybus/core";
import type { Meta } from "./tipos";

export type AcaoPagina = "subpagina" | "duplicar" | "mover" | "link" | "renomear" | "icone" | "restringir" | "pessoas" | "pdf" | "excluir";

interface Props {
  nos: NoArvore<Meta>[];
  paginas: Meta[];
  ativo?: string;
  /** Quem edita a Biblioteca (restringir e acesso por pessoa). */
  editorGeral: boolean;
  aoAcao: (acao: AcaoPagina, pagina: Meta) => void;
  aoMover: (id: string, paiId: string | null, antesDe: string | null) => void;
}

interface Alvo {
  id: string;
  zona: ZonaSoltura;
}

function MenuDaPagina({ pagina, editorGeral, aoAcao }: { pagina: Meta; editorGeral: boolean; aoAcao: Props["aoAcao"] }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", tecla); };
  }, [aberto]);

  const itens: Array<[AcaoPagina, string, boolean]> = [
    ["subpagina", "Nova subpágina", pagina.podeEditar],
    ["duplicar", "Duplicar", pagina.podeEditar],
    ["mover", "Mover para…", pagina.podeEditar],
    ["link", "Copiar link", true],
    ["renomear", "Renomear", pagina.podeEditar],
    ["icone", "Ícone", pagina.podeEditar],
    ["restringir", pagina.acesso === "RESTRITO" ? "Liberar para a equipe" : "Restringir", editorGeral],
    ["pessoas", "Acesso por pessoa…", editorGeral],
    ["pdf", "Baixar PDF", true],
    ["excluir", "Excluir", pagina.podeEditar],
  ];
  return (
    <div className="arvore__menu" ref={caixa}>
      <button type="button" className="arvore__mais" aria-label={`Ações de ${pagina.titulo}`} aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>⋯</button>
      {aberto && (
        <div className="menu-pop" role="menu" aria-label={`Ações de ${pagina.titulo}`}>
          {itens.filter(([, , ok]) => ok).map(([k, r]) => (
            <button key={k} type="button" role="menuitem" className={`menu-pop__item${k === "excluir" ? " menu-pop__item--perigo" : ""}`} onClick={() => { setAberto(false); aoAcao(k, pagina); }}>{r}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Item({ no, nivel, alvo, pai }: { no: NoArvore<Meta>; nivel: number; alvo: Alvo | null; pai: Props & { ativo?: string } }) {
  const p = no.pagina;
  const arrastar = useDraggable({ id: p.id, disabled: !p.podeEditar });
  const soltar = useDroppable({ id: p.id });
  const zona = alvo?.id === p.id ? alvo.zona : null;
  return (
    <li>
      <div
        ref={(el) => { arrastar.setNodeRef(el); soltar.setNodeRef(el); }}
        {...arrastar.listeners}
        data-pagina={p.id}
        className={`arvore__linha${arrastar.isDragging ? " arvore__linha--arrastando" : ""}${zona === "dentro" ? " arvore__linha--dentro" : ""}${zona === "antes" ? " arvore__linha--antes" : ""}${zona === "depois" ? " arvore__linha--depois" : ""}`}
      >
        <Link to={`/biblioteca/${p.id}`} className={`arvore__item${p.id === pai.ativo ? " arvore__item--ativo" : ""}`} aria-current={p.id === pai.ativo ? "page" : undefined} draggable={false}>
          <span className="arvore__icone" aria-hidden="true">{p.icone ?? "📄"}</span>
          <span className="arvore__titulo">{p.titulo}</span>
          {p.acessoEfetivo === "RESTRITO" && <span className="etiqueta etiqueta--atencao" title="Só quem edita a Biblioteca ou está na lista de pessoas vê esta página">restrita</span>}
        </Link>
        <MenuDaPagina pagina={p} editorGeral={pai.editorGeral} aoAcao={pai.aoAcao} />
      </div>
      {no.filhos.length > 0 && (
        <ul>
          {no.filhos.map((f) => <Item key={f.pagina.id} no={f} nivel={nivel + 1} alvo={alvo} pai={pai} />)}
        </ul>
      )}
    </li>
  );
}

/** Árvore de páginas. Arrastar: terço de cima/baixo de outra página muda a ordem; o meio coloca dentro dela (vira subpágina). */
export function ArvorePaginas(props: Props) {
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const sensores = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }));

  const ponteiroY = (e: DragMoveEvent | DragEndEvent): number | null => {
    const a = e.activatorEvent as MouseEvent | TouchEvent;
    const y = "touches" in a ? a.touches[0]?.clientY : (a as MouseEvent).clientY;
    return y === undefined ? null : y + e.delta.y;
  };
  const sobre = (e: DragMoveEvent | DragEndEvent): Alvo | null => {
    if (!e.over) return null;
    const y = ponteiroY(e);
    if (y === null) return null;
    return { id: String(e.over.id), zona: zonaDeSoltura(y, e.over.rect.top, e.over.rect.height) };
  };
  const aoMexer = (e: DragMoveEvent) => {
    const novo = sobre(e);
    const permitido = novo && destinoDoArraste(props.paginas, String(e.active.id), novo.id, novo.zona);
    setAlvo(permitido ? novo : null);
  };
  const aoSoltar = (e: DragEndEvent) => {
    const novo = sobre(e);
    setAlvo(null);
    if (!novo) return;
    const d = destinoDoArraste(props.paginas, String(e.active.id), novo.id, novo.zona);
    if (d) props.aoMover(String(e.active.id), d.paiId, d.antesDe);
  };

  return (
    <DndContext sensors={sensores} collisionDetection={pointerWithin} onDragMove={aoMexer} onDragEnd={aoSoltar} onDragCancel={() => setAlvo(null)}>
      <ul className="arvore">
        {props.nos.map((n) => <Item key={n.pagina.id} no={n} nivel={0} alvo={alvo} pai={props} />)}
      </ul>
    </DndContext>
  );
}
