import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Icone } from "./Icone";
import type { ItemMenu } from "./Layout";

/**
 * Menu horizontal no topo, com uma lista suspensa por área (modelo da Paytour, adaptado; pedido do dono, 04/11/2026).
 * Usa a largura toda da tela para o conteúdo. No celular e em telas estreitas continua a gaveta lateral.
 */
export function MenuTopo({ areas, ativo }: { areas: Array<{ area: string; itens: ItemMenu[] }>; ativo: string | undefined }) {
  const [aberta, setAberta] = useState<string | null>(null);
  const caixa = useRef<HTMLElement>(null);
  const local = useLocation();

  useEffect(() => setAberta(null), [local.pathname]);
  useEffect(() => {
    if (!aberta) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberta(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberta(null); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberta]);

  return (
    <nav ref={caixa} className="menu-topo" aria-label="Áreas do sistema">
      <ul className="menu-topo__areas">
        {areas.map(({ area, itens }) => {
          const atual = itens.some((i) => i.para === ativo);
          // Área com um item só vira link direto (ex.: Biblioteca).
          if (itens.length === 1) {
            const i = itens[0]!;
            return (
              <li key={area}>
                <Link to={i.para} className={`menu-topo__area${atual ? " menu-topo__area--atual" : ""}`} aria-current={atual ? "page" : undefined}>
                  <Icone nome={i.icone} tamanho={16} />
                  {area}
                </Link>
              </li>
            );
          }
          const id = `menu-topo-${area.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()}`;
          return (
            <li key={area} className="menu-topo__grupo">
              <button type="button" className={`menu-topo__area${atual ? " menu-topo__area--atual" : ""}`} aria-expanded={aberta === area} aria-controls={id}
                onClick={() => setAberta((a) => (a === area ? null : area))}>
                <Icone nome={itens[0]!.icone} tamanho={16} />
                {area}
                <Icone nome="seta" tamanho={12} />
              </button>
              {aberta === area && (
                <ul id={id} className="menu-topo__lista">
                  {itens.map((i) => (
                    <li key={i.para}>
                      <Link to={i.para} className={`menu-topo__item${i.para === ativo ? " menu-topo__item--atual" : ""}${i.planejado ? " menu-topo__item--planejado" : ""}`}
                        aria-current={i.para === ativo ? "page" : undefined}>
                        <Icone nome={i.icone} tamanho={16} />
                        <span>{i.rotulo}</span>
                        {i.planejado && <span className="menu__breve">em breve</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
