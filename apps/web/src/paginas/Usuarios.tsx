import { useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import { PERMISSOES, type PerfilAcesso, type Unidade, type UsuarioAdmin } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Icone } from "../componentes/Icone";
import { Confirmar, Modal } from "../componentes/Modal";
import { useNotificar } from "../componentes/Notificacoes";
import { useSessao } from "../sessao/Sessao";
import { formatarData } from "../util/formato";
import { CabecalhoOrdenavel, compararTexto, normalizarBusca, Paginacao, useTabela } from "../componentes/Tabela";
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

export interface Acesso {
  perfil: string;
  todasUnidades: boolean;
  unidadeIds: string[];
}

/** Perfis que este usuário pode conceder (o servidor confere de novo: anti-escalonamento). */
export function perfisConcediveis(perfis: PerfilAcesso[], souAdmin: boolean, minhas: readonly string[]): PerfilAcesso[] {
  if (souAdmin) return perfis;
  return perfis.filter((p) => p.codigo !== "ADMIN" && p.permissoes.every((x) => minhas.includes(x)));
}

export function validarAcesso(a: Acesso): string | null {
  if (!a.perfil) return "Escolha o perfil.";
  if (!a.todasUnidades && a.unidadeIds.length === 0) return "Escolha ao menos uma praça ou “Todas as praças”.";
  return null;
}

/** Perfil + praças (usado ao criar e ao editar o acesso). */
export function CamposAcesso({
  valor,
  aoMudar,
  perfis,
  unidades,
  prefixo,
}: {
  valor: Acesso;
  aoMudar: (a: Acesso) => void;
  perfis: PerfilAcesso[];
  unidades: Unidade[];
  prefixo: string;
}) {
  const { usuario } = useSessao();
  const podeTodas = !!usuario?.todasUnidades;
  const perfilAtual = perfis.find((p) => p.codigo === valor.perfil);
  return (
    <>
      <div className="campo">
        <label htmlFor={`${prefixo}-perfil`}>Perfil</label>
        <select id={`${prefixo}-perfil`} value={valor.perfil} onChange={(e) => aoMudar({ ...valor, perfil: e.target.value })} aria-describedby={`${prefixo}-perfil-ajuda`}>
          {!perfilAtual && <option value="">Escolha…</option>}
          {perfis.map((p) => (
            <option key={p.id} value={p.codigo}>
              {p.nome}
            </option>
          ))}
        </select>
        <p id={`${prefixo}-perfil-ajuda`} className="campo__ajuda">
          {perfilAtual?.descricao ?? "Os perfis e suas permissões ficam em “Perfis de acesso”."}
        </p>
      </div>
      <fieldset className="campo grupo-opcoes">
        <legend>Praças</legend>
        {podeTodas && (
          <label className="caixa">
            <input type="radio" name={`${prefixo}-escopo`} checked={valor.todasUnidades} onChange={() => aoMudar({ ...valor, todasUnidades: true })} />
            Todas as praças (diretoria/franqueadora)
          </label>
        )}
        <label className="caixa">
          <input type="radio" name={`${prefixo}-escopo`} checked={!valor.todasUnidades} onChange={() => aoMudar({ ...valor, todasUnidades: false })} />
          Praças específicas
        </label>
        {!valor.todasUnidades && (
          <ul className="lista-opcoes" aria-label="Praças específicas">
            {unidades.map((u) => (
              <li key={u.id}>
                <label className="caixa">
                  <input
                    type="checkbox"
                    checked={valor.unidadeIds.includes(u.id)}
                    onChange={(e) => aoMudar({ ...valor, unidadeIds: e.target.checked ? [...valor.unidadeIds, u.id] : valor.unidadeIds.filter((x) => x !== u.id) })}
                  />
                  {u.nome}
                  {!u.ativa && <span className="etiqueta etiqueta--neutra">inativa</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </>
  );
}

function FormNovoUsuario({
  perfis,
  unidades,
  aoCriar,
  aoCancelar,
}: {
  perfis: PerfilAcesso[];
  unidades: Unidade[];
  aoCriar: (email: string, senha: string) => Promise<void>;
  aoCancelar: () => void;
}) {
  const { praca } = useSessao();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [acesso, setAcesso] = useState<Acesso>({
    perfil: perfis.find((p) => p.codigo === "ATENDENTE")?.codigo ?? "",
    todasUnidades: false,
    unidadeIds: praca ? [praca] : unidades.length === 1 ? [unidades[0]!.id] : [],
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nome.trim().length < 2) return setErro("Informe o nome.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErro("E-mail inválido.");
    const erroAcesso = validarAcesso(acesso);
    if (erroAcesso) return setErro(erroAcesso);
    setSalvando(true);
    try {
      const r = await api.post<{ usuario: UsuarioAdmin; senhaTemporaria: string }>("/api/usuarios", {
        nome: nome.trim(),
        email: email.trim(),
        perfil: acesso.perfil,
        todasUnidades: acesso.todasUnidades,
        unidadeIds: acesso.todasUnidades ? [] : acesso.unidadeIds,
      });
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
      <CamposAcesso valor={acesso} aoMudar={setAcesso} perfis={perfis} unidades={unidades} prefixo="nu" />
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

function FormAcesso({
  u,
  perfis,
  unidades,
  aoSalvar,
  aoCancelar,
}: {
  u: UsuarioAdmin;
  perfis: PerfilAcesso[];
  unidades: Unidade[];
  aoSalvar: () => Promise<void>;
  aoCancelar: () => void;
}) {
  const [acesso, setAcesso] = useState<Acesso>({ perfil: u.perfil, todasUnidades: u.todasUnidades, unidadeIds: u.unidadeIds });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // O perfil atual aparece mesmo que o editor não possa concedê-lo (para não trocar sem querer).
  const opcoes = perfis.some((p) => p.codigo === u.perfil) ? perfis : [{ id: "atual", codigo: u.perfil, nome: u.perfilNome, descricao: null, permissoes: [], sistema: false, criadoEm: "" }, ...perfis];

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const erroAcesso = validarAcesso(acesso);
    if (erroAcesso) return setErro(erroAcesso);
    const corpo: Record<string, unknown> = {};
    if (acesso.perfil !== u.perfil) corpo.perfil = acesso.perfil;
    if (acesso.todasUnidades !== u.todasUnidades) corpo.todasUnidades = acesso.todasUnidades;
    const ids = acesso.todasUnidades ? [] : acesso.unidadeIds;
    if (ids.length !== u.unidadeIds.length || ids.some((x) => !u.unidadeIds.includes(x))) corpo.unidadeIds = ids;
    if (Object.keys(corpo).length === 0) return aoCancelar();
    setSalvando(true);
    setErro(null);
    try {
      await api.patch(`/api/usuarios/${u.id}`, corpo);
      await aoSalvar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <CamposAcesso valor={acesso} aoMudar={setAcesso} perfis={opcoes} unidades={unidades} prefixo="ac" />
      <Aviso tipo="atencao">Ao salvar, as sessões abertas de {u.nome} serão encerradas e a pessoa precisará entrar de novo.</Aviso>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar acesso"}
        </button>
      </div>
    </form>
  );
}

type Acao = { tipo: "ativo"; u: UsuarioAdmin } | { tipo: "senha"; u: UsuarioAdmin } | { tipo: "mfa"; u: UsuarioAdmin };
type Campo = "nome" | "perfil" | "criadoEm";

export function Usuarios() {
  const { usuario: eu, pode } = useSessao();
  const notificar = useNotificar();
  const lista = useCarregar((s) => api.get<UsuarioAdmin[]>("/api/usuarios", s), []);
  const perfis = useCarregar((s) => api.get<PerfilAcesso[]>("/api/perfis", s), []);
  const unidades = useCarregar((s) => api.get<Unidade[]>("/api/unidades", s), []);
  const [novo, setNovo] = useState(false);
  const [editarAcesso, setEditarAcesso] = useState<UsuarioAdmin | null>(null);
  const [senha, setSenha] = useState<{ email: string; senha: string } | null>(null);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const tabela = useTabela<Campo>("nome");
  const concediveis = perfisConcediveis(perfis.dados ?? [], eu?.perfil === "ADMIN", PERMISSOES.filter((p) => pode(p)));
  const listaUnidades = unidades.dados ?? [];
  const pronto = !!perfis.dados && !!unidades.dados;

  async function aplicar() {
    if (!acao) return;
    setOcupado(true);
    setErro(null);
    const corpo = acao.tipo === "ativo" ? { ativo: !acao.u.ativo } : acao.tipo === "senha" ? { redefinirSenha: true } : { redefinirMfa: true };
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

  const pracas = (u: UsuarioAdmin) =>
    u.todasUnidades ? "Todas" : u.unidadeIds.map((id) => listaUnidades.find((x) => x.id === id)?.codigo ?? "?").join(", ") || "Nenhuma";

  const termo = normalizarBusca(busca.trim());
  const filtrados = (lista.dados ?? [])
    .filter((u) => !termo || normalizarBusca(u.nome).includes(termo) || u.email.toLowerCase().includes(termo) || normalizarBusca(u.perfilNome).includes(termo))
    .sort((a, b) => {
      const r = tabela.ordem.campo === "perfil" ? compararTexto(a.perfilNome, b.perfilNome) : compararTexto(String(a[tabela.ordem.campo]), String(b[tabela.ordem.campo]));
      return tabela.ordem.asc ? r : -r;
    });
  const { visiveis, atual, paginas, total } = tabela.paginar(filtrados);

  const textoAcao = (a: Acao) => {
    switch (a.tipo) {
      case "ativo":
        return a.u.ativo
          ? { titulo: "Desativar usuário?", botao: "Desativar", msg: `${a.u.nome} não conseguirá mais entrar. As sessões abertas serão encerradas.`, perigo: true }
          : { titulo: "Reativar usuário?", botao: "Reativar", msg: `${a.u.nome} voltará a ter acesso com o perfil ${a.u.perfilNome}.` };
      case "senha":
        return { titulo: "Redefinir senha?", botao: "Gerar senha temporária", msg: `Uma nova senha temporária será gerada para ${a.u.nome}. A senha atual deixa de funcionar e o desbloqueio é imediato.` };
      case "mfa":
        return { titulo: "Redefinir verificação em duas etapas?", botao: "Redefinir MFA", msg: `${a.u.nome} precisará configurar o aplicativo autenticador de novo (ex.: trocou de celular).`, perigo: true };
    }
  };

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Usuários</h1>
          <p className="pagina__descricao">Contas pessoais e intransferíveis. Desative quem sair da empresa. Permissões de cada perfil ficam em “Perfis de acesso”.</p>
        </div>
        <button type="button" className="botao botao--primario" onClick={() => setNovo(true)} disabled={!pronto}>
          <Icone nome="mais" /> Novo usuário
        </button>
      </div>
      <div className="barra-ferramentas">
        <div className="campo campo--busca">
          <label htmlFor="busca-usuarios" className="visualmente-oculto">
            Buscar usuário
          </label>
          <input
            id="busca-usuarios"
            type="search"
            placeholder="Buscar por nome, e-mail ou perfil"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              tabela.setPagina(0);
            }}
          />
        </div>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {(perfis.erro || unidades.erro) && <ErroCarga mensagem={(perfis.erro ?? unidades.erro)!} tentarDeNovo={() => void Promise.all([perfis.recarregar(), unidades.recarregar()])} />}
      {lista.carregando && !lista.dados ? (
        <Carregando />
      ) : lista.erro ? (
        <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} />
      ) : filtrados.length === 0 ? (
        <Vazio titulo="Nenhum usuário encontrado." />
      ) : (
        <>
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <CabecalhoOrdenavel campo="nome" rotulo="Nome" ordem={tabela.ordem} ordenar={tabela.ordenar} />
                  <th scope="col">E-mail</th>
                  <CabecalhoOrdenavel campo="perfil" rotulo="Perfil" ordem={tabela.ordem} ordenar={tabela.ordenar} />
                  <th scope="col">Praças</th>
                  <th scope="col">Situação</th>
                  <th scope="col">MFA</th>
                  <CabecalhoOrdenavel campo="criadoEm" rotulo="Criado em" ordem={tabela.ordem} ordenar={tabela.ordenar} />
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
                      <td>{u.perfilNome}</td>
                      <td>{pracas(u)}</td>
                      <td>
                        {u.ativo ? <span className="etiqueta etiqueta--sucesso">Ativo</span> : <span className="etiqueta etiqueta--perigo">Inativo</span>}
                        {u.trocarSenha && <span className="etiqueta etiqueta--neutra">troca de senha pendente</span>}
                      </td>
                      <td>{u.totpAtivo ? "Ativo" : <span className="texto-fraco">Não configurado</span>}</td>
                      <td>{formatarData(u.criadoEm)}</td>
                      <td className="celula-acoes">
                        {!souEu && (
                          <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setEditarAcesso(u)} disabled={!pronto} aria-label={`Perfil e praças de ${u.nome}`}>
                            Perfil e praças
                          </button>
                        )}
                        {!souEu && (
                          <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setAcao({ tipo: "ativo", u })}>
                            {u.ativo ? "Desativar" : "Reativar"}
                          </button>
                        )}
                        <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setAcao({ tipo: "senha", u })}>
                          Redefinir senha
                        </button>
                        {u.totpAtivo && !souEu && (
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
          <Paginacao atual={atual} paginas={paginas} total={total} setPagina={tabela.setPagina} />
        </>
      )}

      <Modal aberto={novo} titulo="Novo usuário" aoFechar={() => setNovo(false)}>
        {novo && pronto && (
          <FormNovoUsuario
            perfis={concediveis}
            unidades={listaUnidades}
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
      <Modal aberto={!!editarAcesso} titulo={editarAcesso ? `Perfil e praças de ${editarAcesso.nome}` : ""} aoFechar={() => setEditarAcesso(null)}>
        {editarAcesso && pronto && (
          <FormAcesso
            u={editarAcesso}
            perfis={concediveis}
            unidades={listaUnidades}
            aoCancelar={() => setEditarAcesso(null)}
            aoSalvar={async () => {
              setEditarAcesso(null);
              notificar("Acesso atualizado. As sessões abertas da pessoa foram encerradas.");
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
