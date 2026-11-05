import { useEffect, useMemo, useRef, useState } from "react";
import { Link, matchPath, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { Permissao } from "../api/tipos";
import { useSessao } from "../sessao/Sessao";
import logoHorizontal from "../marca/bybus-horizontal.png";
import { Icone, type NomeIcone } from "./Icone";
import { Modal } from "./Modal";
import { PainelTuristinha } from "./PainelTuristinha";
import { MenuUsuario } from "./MenuUsuario";
import { MenuTopo } from "./MenuTopo";
import { TuristinhaFlutuante } from "./TuristinhaFlutuante";
import { BotaoTema } from "./Tema";

// Menu organizado pela rotina (pedido do dono, 04/11/2026): operação do dia primeiro, depois reservas, cadastros e gestão.
export const AREAS = ["Operação", "Reservas", "Cadastros", "Financeiro", "Frota", "Marketing", "Gestão", "Configurações"] as const;
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
  // Operação do dia
  { para: "/listas", rotulo: "Listas de passageiros", icone: "lista", area: "Operação", permissao: "manifesto:ver", atalho: "m" },
  { para: "/saidas", rotulo: "Saídas", icone: "onibus", area: "Operação", permissao: "manifesto:ver", atalho: "s" },
  { para: "/conferencia", rotulo: "Conferência de embarque", icone: "check", area: "Operação", permissao: "reservas:editar", atalho: "k" },
  { para: "/rastreamento", rotulo: "Rastreamento", icone: "mapa", area: "Operação", permissao: "manifesto:ver", atalho: "w" },
  { para: "/transfer", rotulo: "Transfer", icone: "onibus", area: "Operação", permissao: "manifesto:ver", atalho: "g" },
  { para: "/transfer/motorista", rotulo: "Meu transfer", icone: "pino", area: "Operação", permissao: "transfer:operar" },
  { para: "/escala", rotulo: "Escala de guias", icone: "calendario", area: "Operação", permissao: "pessoas:ver", atalho: "l" },
  { para: "/motorista", rotulo: "Rastreio do motorista", icone: "pino", area: "Operação", permissao: "rastreio:transmitir", atalho: "y" },
  // Reservas
  { para: "/reservas", rotulo: "Listagem de reservas", icone: "lista", area: "Reservas", permissao: "manifesto:ver" },
  { para: "/whatsapp", rotulo: "WhatsApp", icone: "mensagem", area: "Reservas", permissao: "whatsapp:ver", atalho: "x" },
  { para: "/importar", rotulo: "Importar reservas", icone: "importar", area: "Reservas", permissao: "importacoes:executar", atalho: "i" },
  // Cadastros
  { para: "/passeios", rotulo: "Passeios e pontos", icone: "bilhete", area: "Cadastros", permissao: "produtos:gerenciar", atalho: "p" },
  { para: "/equipe", rotulo: "Guias e equipe", icone: "cracha", area: "Cadastros", permissao: "pessoas:ver", atalho: "e" },
  { para: "/em-breve/passageiros", rotulo: "Passageiros e clientes", icone: "pessoas", area: "Cadastros", planejado: true },
  { para: "/em-breve/empresas", rotulo: "Empresas parceiras", icone: "predio", area: "Cadastros", planejado: true },
  // Financeiro
  { para: "/financeiro", rotulo: "Resumo financeiro", icone: "grafico", area: "Financeiro", permissao: "financeiro:ver", atalho: "q" },
  { para: "/financeiro/pagar", rotulo: "Contas a pagar", icone: "dinheiro", area: "Financeiro", permissao: "financeiro:ver" },
  { para: "/financeiro/receber", rotulo: "Contas a receber", icone: "dinheiro", area: "Financeiro", permissao: "financeiro:ver" },
  { para: "/financeiro/extrato", rotulo: "Extrato e conciliação", icone: "importar", area: "Financeiro", permissao: "financeiro:ver" },
  { para: "/financeiro/cartoes", rotulo: "Cartões de crédito", icone: "cartao", area: "Financeiro", permissao: "financeiro:ver" },
  { para: "/financeiro/contas", rotulo: "Contas e categorias", icone: "predio", area: "Financeiro", permissao: "financeiro:ver" },
  // Frota
  { para: "/frota", rotulo: "Frota e manutenção", icone: "onibus", area: "Frota", permissao: "frota:ver" },
  { para: "/frota/checklist", rotulo: "Checklist do veículo", icone: "check", area: "Frota", permissao: "frota:checklist" },
  // Marketing
  { para: "/marketing/canais", rotulo: "Vendas por canal", icone: "grafico", area: "Marketing", permissao: "marketing:ver", atalho: "v" },
  { para: "/marketing/origem", rotulo: "Origem dos clientes", icone: "mapa", area: "Marketing", permissao: "marketing:ver", atalho: "o" },
  { para: "/marketing/campanhas", rotulo: "Campanhas", icone: "megafone", area: "Marketing", permissao: "marketing:ver", atalho: "j" },
  { para: "/marketing/conteudo", rotulo: "Calendário de conteúdo", icone: "calendario", area: "Marketing", permissao: "marketing:ver", atalho: "t" },
  { para: "/marketing/avaliacoes", rotulo: "Avaliações", icone: "estrela", area: "Marketing", permissao: "marketing:ver", atalho: "z" },
  { para: "/marketing/afiliados", rotulo: "Afiliados e QR codes", icone: "pessoas", area: "Marketing", permissao: "marketing:ver", atalho: "h" },
  // Gestão
  { para: "/gestores", rotulo: "Gestores de IA", icone: "faisca", area: "Gestão", permissao: "ia:gestores", atalho: "d" },
  { para: "/biblioteca", rotulo: "Biblioteca", icone: "lista", area: "Gestão", permissao: "biblioteca:ver", atalho: "b" },
  // Configurações (página própria, aberta pela engrenagem do topo)
  { para: "/integracoes", rotulo: "Integrações", icone: "conexao", area: "Configurações", permissao: "importacoes:executar", atalho: "n" },
  { para: "/pracas", rotulo: "Praças", icone: "pino", area: "Configurações", permissao: "unidades:gerenciar", atalho: "r" },
  { para: "/usuarios", rotulo: "Usuários", icone: "usuarios", area: "Configurações", permissao: "usuarios:gerenciar", atalho: "u" },
  { para: "/perfis", rotulo: "Perfis de acesso", icone: "escudo", area: "Configurações", permissao: "usuarios:gerenciar", atalho: "f" },
  { para: "/auditoria", rotulo: "Auditoria", icone: "auditoria", area: "Configurações", permissao: "auditoria:ver", atalho: "a" },
  { para: "/conta", rotulo: "Meu perfil", icone: "conta", area: "Configurações", atalho: "c" },
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
  const { pode, unidades, praca, escolherPraca } = useSessao();
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

  // "Configurações" saiu do menu lateral (pedido do dono, 04/11): fica num botão discreto no rodapé do menu e no menu do usuário.
  const areas = AREAS.filter((a) => a !== "Configurações").map((a) => ({ area: a, itens: itens.filter((i) => i.area === a) })).filter((g) => g.itens.length > 0);
  const temConfiguracoes = itens.some((i) => i.area === "Configurações" && i.para !== "/conta");
  const poucosItens = areas.reduce((n, g) => n + g.itens.length, 0) <= 4;
  // Item ativo = o de caminho mais específico que casa com a URL (ex.: /financeiro/extrato não acende "Resumo financeiro").
  const ativo = useMemo(
    () => itens.filter((i) => matchPath({ path: i.para, end: false }, local.pathname)).sort((a, b) => b.para.length - a.para.length)[0]?.para,
    [itens, local.pathname],
  );
  const emConfiguracoes = local.pathname === "/configuracoes" || itens.some((i) => i.area === "Configurações" && i.para === ativo);

  return (
    <div className={`app${menuAberto ? " app--menu-aberto" : ""}${turistinha && pode("ia:usar") ? " app--turistinha" : ""}`}>
      <a className="pular-conteudo" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="topo nao-imprimir">
        <button type="button" className="botao botao--fantasma botao--icone topo__menu" aria-label={menuAberto ? "Fechar menu" : "Abrir menu"} aria-expanded={menuAberto} aria-controls="menu-principal" onClick={() => setMenuAberto((v) => !v)}>
          <Icone nome={menuAberto ? "x" : "menu"} />
        </button>
        <Link to="/" className="topo__marca" aria-label="By Bus Gestão — início">
          <img className="topo__logo-img" src={logoHorizontal} alt="By Bus Turismo" width={60} height={34} />
          <span className="topo__nome">Gestão</span>
        </Link>
        <MenuTopo areas={areas} ativo={ativo} />
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
          {temConfiguracoes && (
            <Link to="/configuracoes" className={`botao botao--fantasma botao--icone botao--topo topo__config${emConfiguracoes ? " botao--topo-atual" : ""}`} aria-label="Configurações" title="Configurações">
              <Icone nome="engrenagem" />
            </Link>
          )}
          <BotaoTema />
          <MenuUsuario temConfiguracoes={temConfiguracoes} aoAtalhos={() => setAjuda(true)} />
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
        <div className="menu__rodape">
          {temConfiguracoes && (
            <Link to="/configuracoes" className={`menu__config${emConfiguracoes ? " menu__config--atual" : ""}`} aria-current={emConfiguracoes ? "page" : undefined}>
              <Icone nome="engrenagem" tamanho={16} />
              <span>Configurações</span>
            </Link>
          )}
          <button type="button" className="menu__ajuda" onClick={() => setAjuda(true)}>
            Atalhos <kbd>?</kbd>
          </button>
        </div>
      </nav>
      <div className="menu__fundo nao-imprimir" aria-hidden="true" onClick={() => setMenuAberto(false)} />

      <main id="conteudo" className="conteudo" tabIndex={-1}>
        <Outlet />
      </main>
      {turistinha && pode("ia:usar") && <PainelTuristinha aoFechar={() => setTuristinha(false)} />}
      {pode("ia:usar") && <TuristinhaFlutuante aberto={turistinha} aoAlternar={() => setTuristinha((v) => !v)} />}

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
