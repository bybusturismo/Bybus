import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSessao } from "../sessao/Sessao";
import { Icone } from "./Icone";

/** Iniciais do nome ("Ana Paula Souza" → "AS"). */
export function iniciais(nome: string | undefined): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  return (partes[0]![0]! + (partes.length > 1 ? partes.at(-1)![0]! : "")).toUpperCase();
}

/** Foto de perfil (ou as iniciais, sem foto). */
export function Avatar({ nome, fotoVersao, tamanho = 32, usuarioId }: { nome?: string; fotoVersao?: number | null; tamanho?: number; /** Foto de outra pessoa (tela de usuários). */ usuarioId?: string }) {
  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [fotoVersao]);
  const estilo = { width: tamanho, height: tamanho, fontSize: Math.round(tamanho * 0.4) };
  if (fotoVersao && !falhou) {
    return <img className="avatar" src={usuarioId ? `/api/usuarios/${usuarioId}/foto?v=${fotoVersao}` : `/api/auth/foto?v=${fotoVersao}`} alt="" style={estilo} onError={() => setFalhou(true)} />;
  }
  return <span className="avatar avatar--iniciais" aria-hidden="true" style={estilo}>{iniciais(nome)}</span>;
}

/** Acesso do usuário no canto superior direito: foto, perfil, configurações e sair (como na maioria dos sistemas). */
export function MenuUsuario({ temConfiguracoes, aoAtalhos }: { temConfiguracoes: boolean; aoAtalhos: () => void }) {
  const { usuario, sair } = useSessao();
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const local = useLocation();

  useEffect(() => setAberto(false), [local.pathname]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const foto = usuario?.fotoVersao ?? null;
  return (
    <div className="menu-usuario" ref={caixa}>
      <button type="button" className="menu-usuario__botao" aria-haspopup="menu" aria-expanded={aberto} aria-controls="menu-usuario-lista" onClick={() => setAberto((v) => !v)}
        aria-label={`Conta de ${usuario?.nome ?? ""}`}>
        <Avatar nome={usuario?.nome} fotoVersao={foto} />
        <span className="menu-usuario__quem">
          <span className="menu-usuario__nome">{usuario?.nome}</span>
          <span className="menu-usuario__perfil">{usuario?.perfilNome ?? usuario?.perfil ?? ""}</span>
        </span>
        <Icone nome="seta" tamanho={14} />
      </button>
      {aberto && (
        <div id="menu-usuario-lista" className="menu-usuario__lista" role="menu">
          <div className="menu-usuario__cabecalho">
            <Avatar nome={usuario?.nome} fotoVersao={foto} tamanho={40} />
            <span>
              <strong>{usuario?.nome}</strong>
              <span className="texto-fraco">{usuario?.email}</span>
            </span>
          </div>
          <Link role="menuitem" className="menu-usuario__item" to="/conta"><Icone nome="conta" tamanho={16} /> Meu perfil</Link>
          <Link role="menuitem" className="menu-usuario__item" to="/cofre"><Icone nome="escudo" tamanho={16} /> Cofre de senhas</Link>
          {temConfiguracoes && <Link role="menuitem" className="menu-usuario__item" to="/configuracoes"><Icone nome="engrenagem" tamanho={16} /> Configurações</Link>}
          <button type="button" role="menuitem" className="menu-usuario__item" onClick={() => { setAberto(false); aoAtalhos(); }}><Icone nome="lista" tamanho={16} /> Atalhos do teclado</button>
          <button type="button" role="menuitem" className="menu-usuario__item menu-usuario__item--sair" onClick={() => void sair()}><Icone nome="sair" tamanho={16} /> Sair</button>
        </div>
      )}
    </div>
  );
}
