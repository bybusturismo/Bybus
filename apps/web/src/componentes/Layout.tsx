import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import type { Permissao } from "../api/tipos";
import { useSessao } from "../sessao/Sessao";
import logoHorizontal from "../marca/bybus-horizontal.png";
import { Icone, type NomeIcone } from "./Icone";
import { Modal } from "./Modal";
import { BotaoTema } from "./Tema";

export interface ItemMenu {
  para: string;
  rotulo: string;
  icone: NomeIcone;
  permissao?: Permissao;
  atalho: string;
  /** Cor da marca do ícone no menu (só visual). */
  tinta: Tinta;
  grupo: "Operação" | "Administração" | "Pessoal";
}

export type Tinta = "azul" | "rosa" | "violeta" | "verde" | "laranja" | "ambar";

export const ITENS_MENU: ItemMenu[] = [
  { para: "/saidas", rotulo: "Saídas", icone: "onibus", permissao: "manifesto:ver", atalho: "s", tinta: "azul", grupo: "Operação" },
  { para: "/importar", rotulo: "Importar", icone: "importar", permissao: "importacoes:executar", atalho: "i", tinta: "laranja", grupo: "Operação" },
  { para: "/equipe", rotulo: "Equipe", icone: "cracha", permissao: "pessoas:ver", atalho: "e", tinta: "verde", grupo: "Operação" },
  { para: "/passeios", rotulo: "Passeios", icone: "bilhete", permissao: "produtos:gerenciar", atalho: "p", tinta: "rosa", grupo: "Operação" },
  { para: "/pracas", rotulo: "Praças", icone: "pino", permissao: "unidades:gerenciar", atalho: "r", tinta: "violeta", grupo: "Administração" },
  { para: "/usuarios", rotulo: "Usuários", icone: "usuarios", permissao: "usuarios:gerenciar", atalho: "u", tinta: "ambar", grupo: "Administração" },
  { para: "/perfis", rotulo: "Perfis de acesso", icone: "escudo", permissao: "usuarios:gerenciar", atalho: "f", tinta: "verde", grupo: "Administração" },
  { para: "/auditoria", rotulo: "Auditoria", icone: "auditoria", permissao: "auditoria:ver", atalho: "a", tinta: "azul", grupo: "Administração" },
  { para: "/conta", rotulo: "Minha conta", icone: "conta", atalho: "c", tinta: "rosa", grupo: "Pessoal" },
];

/** Itens visíveis para o perfil (apenas conveniência: o servidor sempre confere a permissão). */
export function itensPermitidos(pode: (p: Permissao) => boolean): ItemMenu[] {
  return ITENS_MENU.filter((i) => !i.permissao || pode(i.permissao));
}

function emCampoDeTexto(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function Layout() {
  const { usuario, pode, sair, unidades, praca, escolherPraca } = useSessao();
  const navegar = useNavigate();
  const itens = itensPermitidos(pode);
  const [ajuda, setAjuda] = useState(false);
  const prefixo = useRef<number>(0);

  // Atalhos: "g" seguido da letra do menu; "?" abre a ajuda. Ignorados enquanto se digita.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || emCampoDeTexto(e.target)) return;
      if (e.key === "?") {
        setAjuda(true);
        return;
      }
      if (e.key === "g") {
        prefixo.current = Date.now();
        return;
      }
      if (Date.now() - prefixo.current < 1200) {
        const item = itens.find((i) => i.atalho === e.key.toLowerCase());
        prefixo.current = 0;
        if (item) {
          e.preventDefault();
          navegar(item.para);
        }
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [itens, navegar]);

  return (
    <div className="app">
      <a className="pular-conteudo" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="topo nao-imprimir">
        <div className="topo__marca">
          <img className="topo__logo-img" src={logoHorizontal} alt="By Bus Turismo" width={67} height={38} />
          <span className="topo__nome">Gestão</span>
        </div>
        {unidades.length > 1 && (
          <div className="topo__praca">
            <label htmlFor="seletor-praca">Praça</label>
            <select id="seletor-praca" value={praca} onChange={(e) => escolherPraca(e.target.value)}>
              <option value="">Todas as praças</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="topo__usuario">
          <span className="topo__quem">
            <span className="topo__nome-usuario">{usuario?.nome}</span>
            <span className="topo__perfil">{usuario?.perfilNome ?? usuario?.perfil ?? ""}</span>
          </span>
          <BotaoTema />
          <button type="button" className="botao botao--fantasma botao--topo" onClick={() => void sair()} aria-label="Sair">
            <Icone nome="sair" />
            <span>Sair</span>
          </button>
        </div>
      </header>

      <nav className="menu nao-imprimir" aria-label="Menu principal">
        <ul>
          {itens.map((i, n) => (
            <li key={i.para} className={n > 0 && itens[n - 1]!.grupo !== i.grupo ? "menu__novo-grupo" : undefined}>
              {(n === 0 || itens[n - 1]!.grupo !== i.grupo) && itens.length > 3 && (
                <span className="menu__grupo" aria-hidden="true">
                  {i.grupo}
                </span>
              )}
              <NavLink to={i.para} className={({ isActive }) => `menu__item tinta--${i.tinta}${isActive ? " menu__item--ativo" : ""}`}>
                <span className="menu__icone">
                  <Icone nome={i.icone} />
                </span>
                <span>{i.rotulo}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <button type="button" className="menu__ajuda" onClick={() => setAjuda(true)}>
          Atalhos do teclado <kbd>?</kbd>
        </button>
      </nav>

      <main id="conteudo" className="conteudo" tabIndex={-1}>
        <Outlet />
      </main>

      <Modal aberto={ajuda} titulo="Atalhos do teclado" aoFechar={() => setAjuda(false)}>
        <dl className="atalhos">
          {itens.map((i) => (
            <div key={i.para}>
              <dt>
                <kbd>g</kbd> <kbd>{i.atalho}</kbd>
              </dt>
              <dd>Ir para {i.rotulo}</dd>
            </div>
          ))}
          <div>
            <dt>
              <kbd>/</kbd>
            </dt>
            <dd>Buscar na lista (telas com busca)</dd>
          </div>
          <div>
            <dt>
              <kbd>?</kbd>
            </dt>
            <dd>Mostrar esta ajuda</dd>
          </div>
        </dl>
      </Modal>
    </div>
  );
}
