import { useState } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import type { SessaoAtiva } from "../api/tipos";
import { Aviso, Carregando, ErroCarga } from "../componentes/Estados";
import { useNotificar } from "../componentes/Notificacoes";
import { useSessao } from "../sessao/Sessao";
import { formatarDataHora } from "../util/formato";
import { ROTULO_PERFIL } from "../util/rotulos";
import { useCarregar } from "../util/useCarregar";
import { ConfigurarMfa, FormTrocarSenha } from "./Pendencias";

/** Descrição curta do navegador a partir do user-agent (sem mostrar a string inteira). */
export function descreverNavegador(ua: string | null): string {
  if (!ua) return "Navegador desconhecido";
  const nav = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const so = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return so ? `${nav} no ${so}` : nav;
}

function MinhasSessoes() {
  const notificar = useNotificar();
  const carga = useCarregar((s) => api.get<SessaoAtiva[]>("/api/auth/sessoes", s), []);
  const [erro, setErro] = useState<string | null>(null);

  async function encerrar(id: string) {
    setErro(null);
    try {
      await api.delete(`/api/auth/sessoes/${id}`);
      notificar("Sessão encerrada.");
      await carga.recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  if (carga.carregando && !carga.dados) return <Carregando />;
  if (carga.erro) return <ErroCarga mensagem={carga.erro} tentarDeNovo={carga.recarregar} />;
  const lista = [...(carga.dados ?? [])].sort((a, b) => Number(b.atual) - Number(a.atual) || b.ultimoUso.localeCompare(a.ultimoUso));
  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <ul className="lista-sessoes">
        {lista.map((s) => (
          <li key={s.id}>
            <div>
              <strong>{descreverNavegador(s.userAgent)}</strong>
              {s.atual && <span className="etiqueta etiqueta--sucesso">esta sessão</span>}
              <p className="texto-fraco">
                Entrou em {formatarDataHora(s.criadaEm)} · último uso {formatarDataHora(s.ultimoUso)}
                {s.ip ? ` · IP ${s.ip}` : ""}
              </p>
            </div>
            {!s.atual && (
              <button type="button" className="botao botao--perigo-contorno botao--pequeno" onClick={() => void encerrar(s.id)}>
                Encerrar
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export function Conta() {
  const { usuario, recarregar } = useSessao();
  const [configurandoMfa, setConfigurandoMfa] = useState(false);
  if (!usuario) return null;
  return (
    <div className="pagina pagina--estreita">
      <div className="pagina__cabecalho">
        <div>
          <h1>Minha conta</h1>
          <p className="pagina__descricao">
            {usuario.nome} · {usuario.email} · {ROTULO_PERFIL[usuario.perfil]}
          </p>
        </div>
      </div>

      <section className="cartao" aria-labelledby="titulo-senha">
        <h2 id="titulo-senha">Trocar senha</h2>
        <FormTrocarSenha aoConcluir={() => undefined} />
      </section>

      <section className="cartao" aria-labelledby="titulo-mfa">
        <h2 id="titulo-mfa">Verificação em duas etapas</h2>
        {usuario.totpAtivo ? (
          <Aviso tipo="sucesso">Ativa. Para trocar de celular, peça ao administrador para redefinir.</Aviso>
        ) : configurandoMfa ? (
          <ConfigurarMfa
            aoConcluir={async () => {
              setConfigurandoMfa(false);
              await recarregar();
            }}
          />
        ) : (
          <>
            <p>Proteja sua conta exigindo um código do celular além da senha.</p>
            <button type="button" className="botao botao--secundario" onClick={() => setConfigurandoMfa(true)}>
              Configurar agora
            </button>
          </>
        )}
      </section>

      <section className="cartao" aria-labelledby="titulo-sessoes">
        <h2 id="titulo-sessoes">Sessões abertas</h2>
        <p className="texto-fraco">Encerre sessões em computadores ou celulares que você não usa mais.</p>
        <MinhasSessoes />
      </section>
    </div>
  );
}
