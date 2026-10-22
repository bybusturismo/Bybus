import { useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import { PERFIS, type Perfil, type UsuarioAdmin } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Icone } from "../componentes/Icone";
import { Confirmar, Modal } from "../componentes/Modal";
import { useNotificar } from "../componentes/Notificacoes";
import { useSessao } from "../sessao/Sessao";
import { formatarData } from "../util/formato";
import { ROTULO_PERFIL } from "../util/rotulos";
import { useCarregar } from "../util/useCarregar";

/** Mostra a senha temporária uma única vez, com botão copiar. */
export function SenhaTemporaria({ email, senha, aoFechar }: { email: string; senha: string; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(senha);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }
  return (
    <Modal
      aberto
      titulo="Senha temporária"
      aoFechar={aoFechar}
      rodape={
        <button type="button" className="botao botao--primario" onClick={aoFechar}>
          Já anotei, fechar
        </button>
      }
    >
      <Aviso tipo="atencao">
        Esta senha aparece <strong>só agora</strong>. Entregue-a pessoalmente ou por canal seguro a <strong>{email}</strong>. No primeiro acesso, a pessoa será obrigada a trocá-la.
      </Aviso>
      <div className="senha-temporaria">
        <code aria-label="Senha temporária">{senha}</code>
        <button type="button" className="botao botao--secundario" onClick={() => void copiar()}>
          {copiado ? "Copiada!" : "Copiar"}
        </button>
      </div>
      <p className="visualmente-oculto" aria-live="polite">
        {copiado ? "Senha copiada para a área de transferência." : ""}
      </p>
    </Modal>
  );
}

function FormNovoUsuario({ aoCriar, aoCancelar }: { aoCriar: (email: string, senha: string) => Promise<void>; aoCancelar: () => void }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [perfil, setPerfil] = useState<Perfil>("ATENDENTE");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nome.trim().length < 2) return setErro("Informe o nome.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErro("E-mail inválido.");
    setSalvando(true);
    try {
      const r = await api.post<{ usuario: UsuarioAdmin; senhaTemporaria: string }>("/api/usuarios", { nome: nome.trim(), email: email.trim(), perfil });
      await aoCriar(r.usuario.email, r.senhaTemporaria);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="campo">
        <label htmlFor="nu-nome">Nome</label>
        <input id="nu-nome" maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>
      <div className="campo">
        <label htmlFor="nu-email">E-mail</label>
        <input id="nu-email" type="email" maxLength={200} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="campo">
        <label htmlFor="nu-perfil">Perfil</label>
        <select id="nu-perfil" value={perfil} onChange={(e) => setPerfil(e.target.value as Perfil)}>
          {PERFIS.map((p) => (
            <option key={p} value={p}>
              {ROTULO_PERFIL[p]}
            </option>
          ))}
        </select>
      </div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>
          {salvando ? "Criando…" : "Criar usuário"}
        </button>
      </div>
    </form>
  );
}

type Acao = { tipo: "ativo"; u: UsuarioAdmin } | { tipo: "senha"; u: UsuarioAdmin } | { tipo: "mfa"; u: UsuarioAdmin } | { tipo: "perfil"; u: UsuarioAdmin; perfil: Perfil };

export function Usuarios() {
  const { usuario: eu } = useSessao();
  const notificar = useNotificar();
  const lista = useCarregar((s) => api.get<UsuarioAdmin[]>("/api/usuarios", s), []);
  const [novo, setNovo] = useState(false);
  const [senha, setSenha] = useState<{ email: string; senha: string } | null>(null);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<{ campo: "nome" | "perfil" | "criadoEm"; asc: boolean }>({ campo: "nome", asc: true });

  async function aplicar() {
    if (!acao) return;
    setOcupado(true);
    setErro(null);
    const corpo =
      acao.tipo === "ativo" ? { ativo: !acao.u.ativo } : acao.tipo === "senha" ? { redefinirSenha: true } : acao.tipo === "mfa" ? { redefinirMfa: true } : { perfil: acao.perfil };
    try {
      const r = await api.patch<{ usuario: UsuarioAdmin; senhaTemporaria?: string }>(`/api/usuarios/${acao.u.id}`, corpo);
      if (r.senhaTemporaria) setSenha({ email: r.usuario.email, senha: r.senhaTemporaria });
      notificar("Usuário atualizado. As sessões abertas dele foram encerradas quando necessário.");
      setAcao(null);
      await lista.recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
      setAcao(null);
    } finally {
      setOcupado(false);
    }
  }

  const termo = busca.trim().toLowerCase();
  const visiveis = (lista.dados ?? [])
    .filter((u) => !termo || u.nome.toLowerCase().includes(termo) || u.email.toLowerCase().includes(termo))
    .sort((a, b) => {
      const r = ordem.campo === "perfil" ? PERFIS.indexOf(a.perfil) - PERFIS.indexOf(b.perfil) : String(a[ordem.campo]).localeCompare(String(b[ordem.campo]), "pt-BR");
      return ordem.asc ? r : -r;
    });

  const cabecalhoOrdenavel = (campo: typeof ordem.campo, rotulo: string) => (
    <th scope="col" aria-sort={ordem.campo === campo ? (ordem.asc ? "ascending" : "descending") : "none"}>
      <button type="button" className="botao-ordenar" onClick={() => setOrdem((o) => ({ campo, asc: o.campo === campo ? !o.asc : true }))}>
        {rotulo} <span aria-hidden="true">{ordem.campo === campo ? (ordem.asc ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  const textoAcao = (a: Acao) => {
    switch (a.tipo) {
      case "ativo":
        return a.u.ativo
          ? { titulo: "Desativar usuário?", botao: "Desativar", msg: `${a.u.nome} não conseguirá mais entrar. As sessões abertas serão encerradas.`, perigo: true }
          : { titulo: "Reativar usuário?", botao: "Reativar", msg: `${a.u.nome} voltará a ter acesso com o perfil ${ROTULO_PERFIL[a.u.perfil]}.` };
      case "senha":
        return { titulo: "Redefinir senha?", botao: "Gerar senha temporária", msg: `Uma nova senha temporária será gerada para ${a.u.nome}. A senha atual deixa de funcionar e o desbloqueio é imediato.` };
      case "mfa":
        return { titulo: "Redefinir verificação em duas etapas?", botao: "Redefinir MFA", msg: `${a.u.nome} precisará configurar o aplicativo autenticador de novo (ex.: trocou de celular).`, perigo: true };
      case "perfil":
        return { titulo: "Alterar perfil?", botao: "Alterar perfil", msg: `${a.u.nome}: ${ROTULO_PERFIL[a.u.perfil]} → ${ROTULO_PERFIL[a.perfil]}. As sessões abertas serão encerradas.` };
    }
  };

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Usuários</h1>
          <p className="pagina__descricao">Contas pessoais e intransferíveis. Desative quem sair da empresa.</p>
        </div>
        <button type="button" className="botao botao--primario" onClick={() => setNovo(true)}>
          <Icone nome="mais" /> Novo usuário
        </button>
      </div>
      <div className="barra-ferramentas">
        <div className="campo campo--busca">
          <label htmlFor="busca-usuarios" className="visualmente-oculto">
            Buscar usuário
          </label>
          <input id="busca-usuarios" type="search" placeholder="Buscar por nome ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {lista.carregando && !lista.dados ? (
        <Carregando />
      ) : lista.erro ? (
        <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} />
      ) : visiveis.length === 0 ? (
        <Vazio titulo="Nenhum usuário encontrado." />
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                {cabecalhoOrdenavel("nome", "Nome")}
                <th scope="col">E-mail</th>
                {cabecalhoOrdenavel("perfil", "Perfil")}
                <th scope="col">Situação</th>
                <th scope="col">MFA</th>
                {cabecalhoOrdenavel("criadoEm", "Criado em")}
                <th scope="col">
                  <span className="visualmente-oculto">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((u) => {
                const souEu = u.id === eu?.id;
                return (
                  <tr key={u.id} className={u.ativo ? "" : "linha--inativa"}>
                    <td>
                      {u.nome}
                      {souEu && <span className="etiqueta etiqueta--neutra">você</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <label className="visualmente-oculto" htmlFor={`perfil-${u.id}`}>
                        Perfil de {u.nome}
                      </label>
                      <select id={`perfil-${u.id}`} value={u.perfil} disabled={souEu} onChange={(e) => setAcao({ tipo: "perfil", u, perfil: e.target.value as Perfil })}>
                        {PERFIS.map((p) => (
                          <option key={p} value={p}>
                            {ROTULO_PERFIL[p]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {u.ativo ? <span className="etiqueta etiqueta--sucesso">Ativo</span> : <span className="etiqueta etiqueta--perigo">Inativo</span>}
                      {u.trocarSenha && <span className="etiqueta etiqueta--neutra">troca de senha pendente</span>}
                    </td>
                    <td>{u.totpAtivo ? "Ativo" : <span className="texto-fraco">Não configurado</span>}</td>
                    <td>{formatarData(u.criadoEm)}</td>
                    <td className="celula-acoes">
                      {!souEu && (
                        <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setAcao({ tipo: "ativo", u })}>
                          {u.ativo ? "Desativar" : "Reativar"}
                        </button>
                      )}
                      <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setAcao({ tipo: "senha", u })}>
                        Redefinir senha
                      </button>
                      {u.totpAtivo && (
                        <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setAcao({ tipo: "mfa", u })}>
                          Redefinir MFA
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal aberto={novo} titulo="Novo usuário" aoFechar={() => setNovo(false)}>
        {novo && (
          <FormNovoUsuario
            aoCancelar={() => setNovo(false)}
            aoCriar={async (email, s) => {
              setNovo(false);
              setSenha({ email, senha: s });
              notificar("Usuário criado.");
              await lista.recarregar();
            }}
          />
        )}
      </Modal>
      {acao && (
        <Confirmar
          aberto
          titulo={textoAcao(acao).titulo}
          textoConfirmar={textoAcao(acao).botao}
          perigo={textoAcao(acao).perigo}
          ocupado={ocupado}
          mensagem={<p>{textoAcao(acao).msg}</p>}
          aoFechar={() => setAcao(null)}
          aoConfirmar={() => void aplicar()}
        />
      )}
      {senha && <SenhaTemporaria email={senha.email} senha={senha.senha} aoFechar={() => setSenha(null)} />}
    </div>
  );
}
