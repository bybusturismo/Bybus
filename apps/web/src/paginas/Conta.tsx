import { useState } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import type { SessaoAtiva } from "../api/tipos";
import { Aviso, Carregando, ErroCarga } from "../componentes/Estados";
import { useNotificar } from "../componentes/Notificacoes";
import { useSessao } from "../sessao/Sessao";
import { formatarDataHora } from "../util/formato";
import { useCarregar } from "../util/useCarregar";
import { ConfigurarMfa, FormTrocarSenha } from "./Pendencias";
import { Avatar } from "../componentes/MenuUsuario";

/** Reduz a foto no navegador (quadrado de 256 px, JPEG) antes de enviar: arquivo pequeno e sem metadados (GPS etc.). */
async function reduzirFoto(arquivo: File): Promise<string> {
  const bitmap = await createImageBitmap(arquivo);
  const lado = Math.min(bitmap.width, bitmap.height);
  const tela = document.createElement("canvas");
  tela.width = tela.height = 256;
  tela.getContext("2d")!.drawImage(bitmap, (bitmap.width - lado) / 2, (bitmap.height - lado) / 2, lado, lado, 0, 0, 256, 256);
  return tela.toDataURL("image/jpeg", 0.85);
}

function FotoPerfil() {
  const { usuario, recarregar } = useSessao();
  const notificar = useNotificar();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [chave, setChave] = useState(0);
  async function escolher(f: File | undefined) {
    if (!f) return;
    setErro(null);
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return setErro("Escolha uma foto JPG, PNG ou WebP.");
    setOcupado(true);
    try {
      await api.put("/api/auth/foto", { imagem: await reduzirFoto(f) });
      await recarregar();
      notificar("Foto atualizada.");
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
      setChave((k) => k + 1);
    }
  }
  async function remover() {
    setOcupado(true);
    try {
      await api.delete("/api/auth/foto");
      await recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <section className="cartao foto-perfil" aria-labelledby="titulo-foto">
      <Avatar nome={usuario?.nome} fotoVersao={usuario?.fotoVersao ?? null} tamanho={72} />
      <div>
        <h2 id="titulo-foto">Foto de perfil</h2>
        <p className="texto-fraco">Aparece no canto superior direito. Fica só no sistema da By Bus.</p>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="barra-acoes">
          <label className={`botao botao--secundario botao--pequeno${ocupado ? " botao--desabilitado" : ""}`}>
            {usuario?.fotoVersao ? "Trocar foto" : "Enviar foto"}
            <input key={chave} type="file" accept="image/jpeg,image/png,image/webp" className="visualmente-oculto" disabled={ocupado} onChange={(e) => void escolher(e.target.files?.[0])} />
          </label>
          {usuario?.fotoVersao ? <button type="button" className="botao botao--fantasma botao--pequeno" disabled={ocupado} onClick={() => void remover()}>Remover</button> : null}
        </div>
      </div>
    </section>
  );
}

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
          <h1>Meu perfil</h1>
          <p className="pagina__descricao">
            {usuario.nome} · {usuario.email} · {usuario.perfilNome ?? usuario.perfil}
          </p>
        </div>
      </div>

      <FotoPerfil />

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
