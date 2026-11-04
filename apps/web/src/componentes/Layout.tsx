import { useEffect, useMemo, useRef, useState } from "react";
import { Link, matchPath, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { Permissao } from "../api/tipos";
import { useSessao } from "../sessao/Sessao";
import logoHorizontal from "../marca/bybus-horizontal.png";
import { Icone, type NomeIcone } from "./Icone";
import { Mascote } from "./Mascote";
import { Modal } from "./Modal";
import { PainelTuristinha } from "./PainelTuristinha";
import { BotaoTema } from "./Tema";

export const AREAS = ["Passeios", "Cadastros", "Administrativo", "Marketing", "Biblioteca", "Gestão", "Configurações"] as const;
export type Area = (typeof AREAS)[number];

export interface ItemMenu {
  para: string;
  rotulo: string;
  icone: NomeIcone;
  area: Area;
  permissao?: Permissao;
  /** Letra do atalho "g + letra". */
  atalho?: string;
  /** Módulo planejado (tela com o escopo; visível só para administradores). */
  planejado?: boolean;
}

export const ITENS_MENU: ItemMenu[] = [
  { para: "/saidas", rotulo: "Saídas", icone: "onibus", area: "Passeios", permissao: "manifesto:ver", atalho: "s" },
  { para: "/conferencia", rotulo: "Conferência de embarque", icone: "check", area: "Passeios", permissao: "reservas:editar", atalho: "k" },
  { para: "/escala", rotulo: "Escala de guias", icone: "calendario", area: "Passeios", permissao: "pessoas:ver", atalho: "l" },
  { para: "/fechamento", rotulo: "Fechamento e mensagens", icone: "mensagem", area: "Passeios", permissao: "saidas:decidir", atalho: "m" },
  { para: "/importar", rotulo: "Importar reservas", icone: "importar", area: "Passeios", permissao: "importacoes:executar", atalho: "i" },
  { para: "/integracoes", rotulo: "Integrações", icone: "conexao", area: "Passeios", permissao: "importacoes:executar", atalho: "n" },
  { para: "/em-breve/rastreamento", rotulo: "Rastreamento", icone: "mapa", area: "Passeios", planejado: true },
  { para: "/passeios", rotulo: "Passeios e pontos", icone: "bilhete", area: "Cadastros", permissao: "produtos:gerenciar", atalho: "p" },
  { para: "/equipe", rotulo: "Guias e equipe", icone: "cracha", area: "Cadastros", permissao: "pessoas:ver", atalho: "e" },
  { para: "/em-breve/passageiros", rotulo: "Passageiros e clientes", icone: "pessoas", area: "Cadastros", planejado: true },
  { para: "/em-breve/empresas", rotulo: "Empresas parceiras", icone: "predio", area: "Cadastros", planejado: true },
  { para: "/financeiro", rotulo: "Resumo financeiro", icone: "grafico", area: "Administrativo", permissao: "financeiro:ver", atalho: "q" },
  { para: "/financeiro/pagar", rotulo: "Contas a pagar", icone: "dinheiro", area: "Administrativo", permissao: "financeiro:ver" },
  { para: "/financeiro/receber", rotulo: "Contas a receber", icone: "dinheiro", area: "Administrativo", permissao: "financeiro:ver" },
  { para: "/financeiro/extrato", rotulo: "Extrato e conciliação", icone: "importar", area: "Administrativo", permissao: "financeiro:ver" },
  { para: "/financeiro/cartoes", rotulo: "Cartões de crédito", icone: "cartao", area: "Administrativo", permissao: "financeiro:ver" },
  { para: "/financeiro/contas", rotulo: "Contas e categorias", icone: "predio", area: "Administrativo", permissao: "financeiro:ver" },
  { para: "/frota", rotulo: "Frota e manutenção", icone: "onibus", area: "Administrativo", permissao: "frota:ver" },
  { para: "/frota/checklist", rotulo: "Checklist do veículo", icone: "check", area: "Administrativo", permissao: "frota:checklist" },
  { para: "/marketing/canais", rotulo: "Vendas por canal", icone: "grafico", area: "Marketing", permissao: "marketing:ver", atalho: "v" },
  { para: "/marketing/origem", rotulo: "Origem dos clientes", icone: "mapa", area: "Marketing", permissao: "marketing:ver", atalho: "o" },
  { para: "/marketing/campanhas", rotulo: "Campanhas", icone: "megafone", area: "Marketing", permissao: "marketing:ver", atalho: "j" },
  { para: "/marketing/conteudo", rotulo: "Calendário de conteúdo", icone: "calendario", area: "Marketing", permissao: "marketing:ver", atalho: "t" },
  { para: "/marketing/avaliacoes", rotulo: "Avaliações", icone: "estrela", area: "Marketing", permissao: "marketing:ver", atalho: "z" },
  { para: "/marketing/afiliados", rotulo: "Afiliados e QR codes", icone: "pessoas", area: "Marketing", permissao: "marketing:ver", atalho: "h" },
  { para: "/biblioteca", rotulo: "Biblioteca", icone: "lista", area: "Biblioteca", permissao: "biblioteca:ver", atalho: "b" },
  { para: "/gestores", rotulo: "Gestores de IA", icone: "faisca", area: "Gestão", permissao: "ia:gestores", atalho: "d" },
  { para: "/pracas", rotulo: "Praças", icone: "pino", area: "Configurações", permissao: "unidades:gerenciar", atalho: "r" },
  { para: "/usuarios", rotulo: "Usuários", icone: "usuarios", area: "Configurações", permissao: "usuarios:gerenciar", atalho: "u" },
  { para: "/perfis", rotulo: "Perfis de acesso", icone: "escudo", area: "Configurações", permissao: "usuarios:gerenciar", atalho: "f" },
  { para: "/auditoria", rotulo: "Auditoria", icone: "auditoria", area: "Configurações", permissao: "auditoria:ver", atalho: "a" },
  { para: "/conta", rotulo: "Minha conta", icone: "conta", area: "Configurações", atalho: "c" },
];

/** Itens visíveis para o perfil (apenas conveniência: o servidor sempre confere a permissão). */
export function itensPermitidos(pode: (p: Permissao) => boolean): ItemMenu[] {
  return ITENS_MENU.filter((i) => (i.planejado ? pode("usuarios:gerenciar") : !i.permissao || pode(i.permissao)));
}

const CHAVE_AREAS = "bybus.menu.fechadas";

function lerFechadas(): Area[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_AREAS) ?? "[]");
    return Array.isArray(v) ? v.filter((a): a is Area => (AREAS as readonly string[]).includes(a)) : [];
  } catch {
    return [];
  }
}

function emCampoDeTexto(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function Layout() {
  const { usuario, pode, sair, unidades, praca, escolherPraca } = useSessao();
  const navegar = useNavigate();
  const local = useLocation();
  const itens = useMemo(() => itensPermitidos(pode), [pode]);
  const [ajuda, setAjuda] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [turistinha, setTuristinha] = useState(false);
  const [fechadas, setFechadas] = useState<Area[]>(lerFechadas);
  const prefixo = useRef<number>(0);

  // No celular, o menu é uma gaveta: fecha ao trocar de tela.
  useEffect(() => setMenuAberto(false), [local.pathname]);

  function alternarArea(a: Area) {
    const nova = fechadas.includes(a) ? fechadas.filter((x) => x !== a) : [...fechadas, a];
    setFechadas(nova);
    try {
      localStorage.setItem(CHAVE_AREAS, JSON.stringify(nova));
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  }

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

  const areas = AREAS.map((a) => ({ area: a, itens: itens.filter((i) => i.area === a) })).filter((g) => g.itens.length > 0);
  const poucosItens = itens.length <= 4;
  // Item ativo = o de caminho mais específico que casa com a URL (ex.: /financeiro/extrato não acende "Resumo financeiro").
  const ativo = useMemo(
    () => itens.filter((i) => matchPath({ path: i.para, end: false }, local.pathname)).sort((a, b) => b.para.length - a.para.length)[0]?.para,
    [itens, local.pathname],
  );

  return (
    <div className={`app${menuAberto ? " app--menu-aberto" : ""}${turistinha && pode("ia:usar") ? " app--turistinha" : ""}`}>
      <a className="pular-conteudo" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="topo nao-imprimir">
        <button type="button" className="botao botao--fantasma botao--icone topo__menu" aria-label={menuAberto ? "Fechar menu" : "Abrir menu"} aria-expanded={menuAberto} aria-controls="menu-principal" onClick={() => setMenuAberto((v) => !v)}>
          <Icone nome={menuAberto ? "x" : "menu"} />
        </button>
        <div className="topo__marca">
          <img className="topo__logo-img" src={logoHorizontal} alt="By Bus Turismo" width={60} height={34} />
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
          {pode("ia:usar") && (
            <button type="button" className={`botao botao--fantasma botao--topo botao--turistinha${turistinha ? " botao--turistinha-ativo" : ""}`} aria-expanded={turistinha} aria-controls="painel-turistinha" onClick={() => setTuristinha((v) => !v)}>
              <Mascote tamanho={22} titulo="" />
              <span>Turistinha</span>
            </button>
          )}
          <BotaoTema />
          <button type="button" className="botao botao--fantasma botao--topo" onClick={() => void sair()} aria-label="Sair">
            <Icone nome="sair" />
            <span>Sair</span>
          </button>
        </div>
      </header>

      <nav id="menu-principal" className="menu nao-imprimir" aria-label="Menu principal">
        {areas.map(({ area, itens: doGrupo }) => {
          // A área da tela atual fica sempre aberta, mesmo que o usuário a tenha recolhido.
          const aberta = poucosItens || !fechadas.includes(area) || doGrupo.some((i) => i.para === ativo);
          const idLista = `menu-area-${area.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()}`;
          return (
            <section key={area} className="menu__area">
              {!poucosItens && (
                <button type="button" className="menu__area-titulo" aria-expanded={aberta} aria-controls={idLista} onClick={() => alternarArea(area)}>
                  <span>{area}</span>
                  <Icone nome="seta" tamanho={14} />
                </button>
              )}
              <ul id={idLista} hidden={!aberta}>
                {doGrupo.map((i) => (
                  <li key={i.para}>
                    <Link to={i.para} aria-current={ativo === i.para ? "page" : undefined} className={`menu__item${ativo === i.para ? " menu__item--ativo" : ""}${i.planejado ? " menu__item--planejado" : ""}`}>
                      <Icone nome={i.icone} tamanho={18} />
                      <span>{i.rotulo}</span>
                      {i.planejado && <span className="menu__breve">em breve</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <button type="button" className="menu__ajuda" onClick={() => setAjuda(true)}>
          Atalhos do teclado <kbd>?</kbd>
        </button>
      </nav>
      <div className="menu__fundo nao-imprimir" aria-hidden="true" onClick={() => setMenuAberto(false)} />

      <main id="conteudo" className="conteudo" tabIndex={-1}>
        <Outlet />
      </main>
      {turistinha && pode("ia:usar") && <PainelTuristinha aoFechar={() => setTuristinha(false)} />}

      <Modal aberto={ajuda} titulo="Atalhos do teclado" aoFechar={() => setAjuda(false)}>
        <dl className="atalhos">
          {itens.filter((i) => i.atalho).map((i) => (
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
