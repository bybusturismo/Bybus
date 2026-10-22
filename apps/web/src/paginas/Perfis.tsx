import { useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import type { PerfilAcesso, Permissao, PermissaoCatalogo, UsuarioAdmin } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Icone } from "../componentes/Icone";
import { Modal } from "../componentes/Modal";
import { useNotificar } from "../componentes/Notificacoes";
import { useSessao } from "../sessao/Sessao";
import { AREAS_PERMISSAO, areaDaPermissao } from "../util/rotulos";
import { useCarregar } from "../util/useCarregar";

/** Catálogo agrupado por área, na ordem de AREAS_PERMISSAO. */
export function agruparCatalogo(catalogo: PermissaoCatalogo[]): Array<{ area: string; itens: PermissaoCatalogo[] }> {
  const ordem = [...AREAS_PERMISSAO.map((a) => a.area), "Outras"];
  const grupos = new Map<string, PermissaoCatalogo[]>();
  for (const p of catalogo) {
    const a = areaDaPermissao(p.codigo);
    grupos.set(a, [...(grupos.get(a) ?? []), p]);
  }
  return ordem.filter((a) => grupos.has(a)).map((area) => ({ area, itens: grupos.get(area)! }));
}

/**
 * O que a tela deixa editar (só conveniência; o servidor decide):
 * ADMIN nunca; perfis do sistema só o Administrador; quem não é Administrador só concede permissões que já tem.
 */
export function perfilSomenteLeitura(perfil: PerfilAcesso | null, souAdmin: boolean, minhas: readonly string[]): string | null {
  if (!perfil) return null;
  if (perfil.codigo === "ADMIN") return "O perfil Administrador tem todas as permissões e não pode ser alterado (evita que a empresa fique sem acesso).";
  if (!souAdmin && perfil.sistema) return "Perfis padrão do sistema só podem ser alterados pelo Administrador.";
  if (!souAdmin && perfil.permissoes.some((p) => !minhas.includes(p))) return "Este perfil tem permissões que você não tem; só o Administrador pode alterá-lo.";
  return null;
}

export function FormPerfil({
  perfil,
  modelo,
  catalogo,
  usuariosNoPerfil,
  aoSalvar,
  aoCancelar,
}: {
  perfil: PerfilAcesso | null;
  /** Ao duplicar: permissões de partida para um perfil novo. */
  modelo?: PerfilAcesso | null;
  catalogo: PermissaoCatalogo[];
  usuariosNoPerfil: number;
  aoSalvar: (p: PerfilAcesso) => Promise<void>;
  aoCancelar: () => void;
}) {
  const { usuario, pode } = useSessao();
  const souAdmin = usuario?.perfil === "ADMIN";
  const minhas = catalogo.map((c) => c.codigo).filter((c) => pode(c));
  const bloqueio = perfilSomenteLeitura(perfil, souAdmin, minhas);
  const ehAdmin = perfil?.codigo === "ADMIN";
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState(perfil?.nome ?? (modelo ? `${modelo.nome} (cópia)` : ""));
  const [descricao, setDescricao] = useState(perfil?.descricao ?? modelo?.descricao ?? "");
  const [marcadas, setMarcadas] = useState<Permissao[]>(ehAdmin ? catalogo.map((c) => c.codigo) : [...(perfil?.permissoes ?? modelo?.permissoes ?? [])]);
  const [erro, setErro] = useState<string | null>(null);
  const [erroCodigo, setErroCodigo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const grupos = agruparCatalogo(catalogo);
  const exigeMfa = catalogo.some((c) => c.exigeMfa && marcadas.includes(c.codigo));
  const mudouPermissoes = !!perfil && (perfil.permissoes.length !== marcadas.length || perfil.permissoes.some((p) => !marcadas.includes(p)));

  function alternar(p: Permissao, marcado: boolean) {
    setMarcadas((m) => (marcado ? [...m, p] : m.filter((x) => x !== p)));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (bloqueio) return;
    setErro(null);
    setErroCodigo(null);
    if (!perfil && !/^[A-Za-z0-9_]{2,40}$/.test(codigo.trim())) {
      setErroCodigo("Use de 2 a 40 letras sem acento, números ou _ (ex.: FINANCEIRO).");
      return;
    }
    if (nome.trim().length < 2) return setErro("Informe o nome do perfil.");
    setSalvando(true);
    try {
      const corpo = { nome: nome.trim(), descricao: descricao.trim() || null, permissoes: marcadas };
      const r = perfil ? await api.patch<PerfilAcesso>(`/api/perfis/${perfil.id}`, corpo) : await api.post<PerfilAcesso>("/api/perfis", { ...corpo, codigo: codigo.trim().toUpperCase() });
      await aoSalvar(r);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} noValidate>
      {bloqueio && (
        <Aviso tipo="info" titulo="Somente leitura">
          {bloqueio}
        </Aviso>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade-campos">
        {!perfil && (
          <div className="campo">
            <label htmlFor="pf-codigo">Código</label>
            <input
              id="pf-codigo"
              maxLength={40}
              autoComplete="off"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/\s/g, "_"))}
              aria-invalid={!!erroCodigo}
              aria-describedby="pf-codigo-ajuda"
            />
            <p id="pf-codigo-ajuda" className={erroCodigo ? "campo__erro" : "campo__ajuda"}>
              {erroCodigo ?? "Identificador fixo, sem espaços. Ex.: FINANCEIRO"}
            </p>
          </div>
        )}
        <div className="campo">
          <label htmlFor="pf-nome">Nome do perfil</label>
          <input id="pf-nome" maxLength={80} value={nome} disabled={!!bloqueio} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div className="campo campo--largo">
          <label htmlFor="pf-descricao">Descrição</label>
          <input id="pf-descricao" maxLength={300} value={descricao} disabled={!!bloqueio} onChange={(e) => setDescricao(e.target.value)} />
        </div>
      </div>

      {grupos.map((g) => (
        <fieldset key={g.area} className="grupo-campos grupo-permissoes">
          <legend>{g.area}</legend>
          <ul className="lista-permissoes">
            {g.itens.map((c) => {
              const naoConcede = !souAdmin && !minhas.includes(c.codigo);
              return (
                <li key={c.codigo}>
                  <label className="caixa">
                    <input type="checkbox" checked={marcadas.includes(c.codigo)} disabled={!!bloqueio || naoConcede} onChange={(e) => alternar(c.codigo, e.target.checked)} />
                    <span>
                      {c.descricao}
                      {c.exigeMfa && <span className="etiqueta etiqueta--atencao">exige MFA</span>}
                      <span className="lista-permissoes__codigo">{c.codigo}</span>
                      {naoConcede && !bloqueio && <span className="texto-fraco"> · você não tem esta permissão</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      {!bloqueio && exigeMfa && (
        <Aviso tipo="info">Este perfil inclui permissões sensíveis: quem o usar será obrigado a ativar a verificação em duas etapas (MFA).</Aviso>
      )}
      {!bloqueio && perfil && (
        <Aviso tipo="atencao" titulo="Atenção ao salvar">
          {mudouPermissoes
            ? `Alterar as permissões encerra imediatamente as sessões de quem usa este perfil (${usuariosNoPerfil} usuário(s) visíveis para você). Essas pessoas precisarão entrar de novo.`
            : "Se você alterar as permissões, quem usa este perfil será desconectado e precisará entrar de novo."}
        </Aviso>
      )}
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>
          {bloqueio ? "Fechar" : "Cancelar"}
        </button>
        {!bloqueio && (
          <button type="submit" className="botao botao--primario" disabled={salvando}>
            {salvando ? "Salvando…" : perfil ? "Salvar perfil" : "Criar perfil"}
          </button>
        )}
      </div>
    </form>
  );
}

export function Perfis() {
  const { usuario, pode } = useSessao();
  const notificar = useNotificar();
  const perfis = useCarregar((s) => api.get<PerfilAcesso[]>("/api/perfis", s), []);
  const catalogo = useCarregar((s) => api.get<PermissaoCatalogo[]>("/api/permissoes", s), []);
  const usuarios = useCarregar((s) => api.get<UsuarioAdmin[]>("/api/usuarios", s), []);
  const [form, setForm] = useState<{ perfil: PerfilAcesso | null; modelo?: PerfilAcesso } | null>(null);
  const souAdmin = usuario?.perfil === "ADMIN";
  const minhas = (catalogo.dados ?? []).map((c) => c.codigo).filter((c) => pode(c));
  const sensiveis = new Set((catalogo.dados ?? []).filter((c) => c.exigeMfa).map((c) => c.codigo));
  const total = catalogo.dados?.length ?? 0;
  const contagem = (codigo: string) => (usuarios.dados ?? []).filter((u) => u.perfil === codigo).length;

  const carregando = (perfis.carregando && !perfis.dados) || (catalogo.carregando && !catalogo.dados);
  const erro = perfis.erro ?? catalogo.erro;

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Perfis de acesso</h1>
          <p className="pagina__descricao">Cada perfil é um conjunto de permissões. As praças de cada pessoa são escolhidas no cadastro do usuário.</p>
        </div>
        <button type="button" className="botao botao--primario" onClick={() => setForm({ perfil: null })} disabled={!catalogo.dados}>
          <Icone nome="mais" /> Novo perfil
        </button>
      </div>
      {carregando ? (
        <Carregando />
      ) : erro ? (
        <ErroCarga
          mensagem={erro}
          tentarDeNovo={() => {
            void perfis.recarregar();
            void catalogo.recarregar();
          }}
        />
      ) : !perfis.dados?.length ? (
        <Vazio titulo="Nenhum perfil cadastrado." />
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <caption className="visualmente-oculto">Perfis de acesso</caption>
            <thead>
              <tr>
                <th scope="col">Perfil</th>
                <th scope="col">Descrição</th>
                <th scope="col" className="num">
                  Permissões
                </th>
                <th scope="col">MFA</th>
                <th scope="col" className="num">
                  Usuários
                </th>
                <th scope="col">
                  <span className="visualmente-oculto">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {perfis.dados.map((p) => {
                const ehAdmin = p.codigo === "ADMIN";
                const bloqueio = perfilSomenteLeitura(p, souAdmin, minhas);
                const n = ehAdmin ? total : p.permissoes.length;
                const mfa = ehAdmin || p.permissoes.some((x) => sensiveis.has(x));
                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.nome}</strong>
                      {p.sistema && <span className="etiqueta etiqueta--neutra">padrão</span>}
                      {ehAdmin && <span className="etiqueta etiqueta--neutra">bloqueado</span>}
                      <div className="texto-fraco mono">{p.codigo}</div>
                    </td>
                    <td>{p.descricao || <span className="texto-fraco">—</span>}</td>
                    <td className="num">
                      {n} de {total}
                    </td>
                    <td>{mfa ? <span className="etiqueta etiqueta--atencao">obrigatório</span> : <span className="texto-fraco">opcional</span>}</td>
                    <td className="num">{usuarios.dados ? contagem(p.codigo) : "…"}</td>
                    <td className="celula-acoes">
                      <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setForm({ perfil: p })} aria-label={`${bloqueio ? "Ver" : "Editar"} perfil ${p.nome}`}>
                        {bloqueio ? "Ver" : "Editar"}
                      </button>
                      {!ehAdmin && (
                        <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setForm({ perfil: null, modelo: p })} aria-label={`Duplicar perfil ${p.nome}`}>
                          Duplicar
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

      <Modal
        aberto={!!form}
        titulo={form?.perfil ? `Perfil: ${form.perfil.nome}` : form?.modelo ? `Novo perfil a partir de ${form.modelo.nome}` : "Novo perfil"}
        aoFechar={() => setForm(null)}
        largura="larga"
      >
        {form && catalogo.dados && (
          <FormPerfil
            perfil={form.perfil}
            modelo={form.modelo}
            catalogo={catalogo.dados}
            usuariosNoPerfil={form.perfil ? contagem(form.perfil.codigo) : 0}
            aoCancelar={() => setForm(null)}
            aoSalvar={async (p) => {
              setForm(null);
              notificar(form.perfil ? `Perfil “${p.nome}” atualizado.` : `Perfil “${p.nome}” criado.`);
              await perfis.recarregar();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
