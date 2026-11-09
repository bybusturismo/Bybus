import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { gerarSenhaForte, lerColado, montarImportacaoCofre, type ItemImportadoCofre } from "@bybus/core";
import { api, ErroApi, mensagemDeErro } from "../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Modal } from "../componentes/Modal";
import { useNotificar } from "../componentes/Notificacoes";
import { CabecalhoPagina } from "../componentes/Pagina";
import { formatarDataHora } from "../util/formato";

/**
 * Cofre de senhas (09/11/2026, formato do APP TOMA). A senha nunca vem na lista: só ao clicar em mostrar ou copiar (some em 30 s
 * e a área de transferência é limpa). Entrar pede a senha do sistema (vale 15 min). O gestor cria os setores, indica quem vê e quem
 * edita cada um e confere o registro de acessos.
 */
const SEGUNDOS = 30;
interface Estado { configurado: boolean; aberto: boolean; ate: string | null; gestor: boolean; temSetor: boolean }
interface Setor { id: string; nome: string; podeEditar: boolean }
interface Item { id: string; setorId: string; titulo: string; categoria: string | null; url: string | null; usuario: string; temSenha: boolean; temNotas: boolean; atualizadoEm: string; atualizadoPorNome: string | null }

const trancado = (e: unknown) => e instanceof ErroApi && e.status === 423;

export function Cofre() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => api.get<Estado>("/api/cofre/estado").then(setEstado).catch((e) => setErro(mensagemDeErro(e))), []);
  useEffect(() => { void carregar(); }, [carregar]);
  // Passou dos 15 minutos: tranca sozinho.
  useEffect(() => {
    if (!estado?.ate) return undefined;
    const t = setTimeout(() => void carregar(), Math.max(1000, new Date(estado.ate).getTime() - Date.now() + 500));
    return () => clearTimeout(t);
  }, [estado?.ate, carregar]);

  const cab = <CabecalhoPagina titulo="Cofre de senhas" descricao="Senhas da empresa por setor, criptografadas. Cada vez que alguém mostra ou copia uma senha, fica registrado." />;
  if (erro) return <div className="pagina">{cab}<ErroCarga mensagem={erro} tentarDeNovo={() => { setErro(null); void carregar(); }} /></div>;
  if (!estado) return <div className="pagina">{cab}<Carregando /></div>;
  if (!estado.configurado) return <div className="pagina">{cab}<Vazio titulo="Cofre ainda não configurado">Falta a chave do Cofre no servidor (COFRE_CHAVE).</Vazio></div>;
  if (!estado.gestor && !estado.temSetor) return <div className="pagina">{cab}<Vazio titulo="Você ainda não está em nenhum setor">O gestor do Cofre indica quem vê as senhas de cada setor.</Vazio></div>;
  if (!estado.aberto) return <div className="pagina">{cab}<Entrar aoAbrir={() => void carregar()} /></div>;
  return <div className="pagina">{cab}<CofreAberto gestor={estado.gestor} aoTrancar={() => void api.post("/api/cofre/fechar").finally(() => void carregar())} aoTrancado={() => void carregar()} /></div>;
}

function Entrar({ aoAbrir }: { aoAbrir: () => void }) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    setIndo(true);
    setErro(null);
    try { await api.post("/api/cofre/abrir", { senha }); setSenha(""); aoAbrir(); } catch (x) { setErro(mensagemDeErro(x)); } finally { setIndo(false); }
  }
  return (
    <form className="cartao cofre__entrar" onSubmit={enviar}>
      <h2>Confirme sua senha</h2>
      <p className="texto-fraco">A mesma do sistema. O Cofre fica aberto por 15 minutos e tranca sozinho.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="campo"><label htmlFor="cofre-senha">Sua senha</label><input id="cofre-senha" type="password" autoComplete="current-password" autoFocus value={senha} onChange={(e) => setSenha(e.target.value)} /></div>
      <button type="submit" className="botao botao--primario" disabled={indo || !senha}>Abrir o Cofre</button>
    </form>
  );
}

async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    setTimeout(() => { void navigator.clipboard.writeText("").catch(() => {}); }, SEGUNDOS * 1000);
    return true;
  } catch { return false; }
}

function CofreAberto({ gestor, aoTrancar, aoTrancado }: { gestor: boolean; aoTrancar: () => void; aoTrancado: () => void }) {
  const notificar = useNotificar();
  const [dados, setDados] = useState<{ setores: Setor[]; itens: Item[] } | null>(null);
  const [busca, setBusca] = useState("");
  const [setor, setSetor] = useState("");
  const [editando, setEditando] = useState<Partial<Item> | null>(null);
  const [setoresAberto, setSetoresAberto] = useState(false);
  const [registroAberto, setRegistroAberto] = useState(false);
  const [importar, setImportar] = useState(false);
  const [revelados, setRevelados] = useState<Record<string, string>>({});
  const falhou = useCallback((e: unknown) => { if (trancado(e)) aoTrancado(); else notificar(mensagemDeErro(e)); }, [aoTrancado, notificar]);
  const carregar = useCallback(() => api.get<{ setores: Setor[]; itens: Item[] }>("/api/cofre/itens").then(setDados).catch(falhou), [falhou]);
  useEffect(() => { void carregar(); }, [carregar]);

  const editaveis = useMemo(() => (dados?.setores ?? []).filter((s) => s.podeEditar), [dados]);
  const categorias = useMemo(() => [...new Set((dados?.itens ?? []).map((i) => i.categoria).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "pt-BR")), [dados]);
  const vistos = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (dados?.itens ?? []).filter((i) => (!setor || i.setorId === setor) && (!t || [i.titulo, i.categoria, i.usuario, i.url].some((x) => (x ?? "").toLowerCase().includes(t))));
  }, [dados, busca, setor]);

  async function revelar(i: Item, acao: "ver" | "copiar", campo: "senha" | "notas" = "senha") {
    try {
      const { valor } = await api.post<{ valor: string }>(`/api/cofre/itens/${i.id}/revelar`, { campo, acao });
      if (acao === "copiar") { notificar((await copiarTexto(valor)) ? "Copiado. A área de transferência é limpa em 30 s." : "Não consegui copiar: use “Mostrar”."); return; }
      const chave = `${i.id}:${campo}`;
      setRevelados((r) => ({ ...r, [chave]: valor }));
      setTimeout(() => setRevelados((r) => { const { [chave]: _, ...resto } = r; return resto; }), SEGUNDOS * 1000);
    } catch (e) { falhou(e); }
  }
  async function excluir(i: Item) {
    try { await api.post("/api/cofre/itens/excluir", { ids: [i.id] }); notificar("Senha excluída."); await carregar(); } catch (e) { falhou(e); }
  }

  if (!dados) return <Carregando />;
  const grupos = dados.setores.filter((s) => !setor || s.id === setor).map((s) => ({ ...s, itens: vistos.filter((i) => i.setorId === s.id) })).filter((g) => g.itens.length || !busca);
  return (
    <>
      <div className="cofre__barra">
        <input className="cofre__busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, categoria, usuário ou site" aria-label="Buscar no Cofre" />
        <select value={setor} onChange={(e) => setSetor(e.target.value)} aria-label="Setor"><option value="">Todos os setores</option>{dados.setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>
        {gestor && <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setRegistroAberto(true)}>Registro</button>}
        {gestor && <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setSetoresAberto(true)}>Setores e pessoas</button>}
        {editaveis.length > 0 && <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setImportar(true)}>Importar</button>}
        <button type="button" className="botao botao--secundario botao--pequeno" onClick={aoTrancar}>Trancar</button>
        {editaveis.length > 0 && <button type="button" className="botao botao--primario botao--pequeno" onClick={() => setEditando({ setorId: setor || editaveis[0]!.id })}>Nova senha</button>}
      </div>
      {!dados.setores.length ? (
        <Vazio titulo="Nenhum setor para você">{gestor ? "Crie os setores (Marketing, Financeiro…) em “Setores e pessoas” e indique quem vê cada um. Você só vê os setores em que se incluir." : "O gestor ainda não te incluiu em nenhum setor."}</Vazio>
      ) : grupos.map((g) => (
        <section key={g.id} className="cartao cofre__setor" aria-label={g.nome}>
          <h2>{g.nome} <span className="texto-fraco">· {g.itens.length} senha(s){g.podeEditar ? "" : " · só ver"}</span></h2>
          {!g.itens.length && <p className="texto-fraco">Nenhuma senha neste setor ainda.</p>}
          {[...new Set(g.itens.map((i) => i.categoria ?? ""))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "pt-BR"))).map((cat) => (
            <div key={cat || "_"}>
              <h3 className="cofre__categoria">{cat || "Sem categoria"}</h3>
              <ul className="cofre__lista">
                {g.itens.filter((i) => (i.categoria ?? "") === cat).map((i) => (
                  <li key={i.id} className="cofre__item">
                    <div className="cofre__nome">
                      <strong>{i.titulo}</strong>
                      {i.url && <a href={i.url.startsWith("http") ? i.url : `https://${i.url}`} target="_blank" rel="noreferrer noopener" className="texto-fraco"> {i.url}</a>}
                      {i.usuario && <div className="texto-fraco">Usuário: {i.usuario}</div>}
                      {revelados[`${i.id}:senha`] !== undefined && <div><code>{revelados[`${i.id}:senha`]}</code></div>}
                      {revelados[`${i.id}:notas`] !== undefined && <pre className="cofre__notas">{revelados[`${i.id}:notas`]}</pre>}
                    </div>
                    <div className="celula-acoes">
                      {i.temSenha && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void revelar(i, "ver")} aria-label={`Mostrar a senha de ${i.titulo}`}>Mostrar</button>}
                      {i.temSenha && <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void revelar(i, "copiar")} aria-label={`Copiar a senha de ${i.titulo}`}>Copiar</button>}
                      {i.temNotas && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void revelar(i, "ver", "notas")}>Observações</button>}
                      {g.podeEditar && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setEditando(i)} aria-label={`Editar ${i.titulo}`}>Editar</button>}
                      {g.podeEditar && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void excluir(i)} aria-label={`Excluir ${i.titulo}`}>Excluir</button>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {editando && <EditarSenha item={editando} setores={editaveis} categorias={categorias} aoFechar={() => setEditando(null)} aoSalvo={() => { setEditando(null); void carregar(); }} falhou={falhou} />}
      {setoresAberto && <SetoresPessoas aoFechar={() => { setSetoresAberto(false); void carregar(); }} falhou={falhou} />}
      {registroAberto && <Registro aoFechar={() => setRegistroAberto(false)} falhou={falhou} />}
      {importar && <Importar setores={editaveis} setorInicial={setor || editaveis[0]?.id || ""} aoFechar={() => setImportar(false)} aoFeito={() => { setImportar(false); void carregar(); }} falhou={falhou} />}
    </>
  );
}

function EditarSenha({ item, setores, categorias, aoFechar, aoSalvo, falhou }: { item: Partial<Item>; setores: Setor[]; categorias: string[]; aoFechar: () => void; aoSalvo: () => void; falhou: (e: unknown) => void }) {
  const novo = !item.id;
  const [f, setF] = useState({ setorId: item.setorId ?? "", titulo: item.titulo ?? "", categoria: item.categoria ?? "", url: item.url ?? "", usuario: item.usuario ?? "", senha: "", notas: "" });
  const [trocarSenha, setTrocarSenha] = useState(novo);
  const [salvando, setSalvando] = useState(false);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      const corpo: Record<string, string> = { setorId: f.setorId, titulo: f.titulo, categoria: f.categoria, url: f.url, usuario: f.usuario };
      if (trocarSenha) corpo.senha = f.senha;
      if (novo || f.notas) corpo.notas = f.notas;
      if (novo) await api.post("/api/cofre/itens", corpo); else await api.patch(`/api/cofre/itens/${item.id}`, corpo);
      aoSalvo();
    } catch (x) { falhou(x); } finally { setSalvando(false); }
  }
  return (
    <Modal aberto titulo={novo ? "Nova senha" : `Editar ${item.titulo}`} aoFechar={aoFechar}>
      <form onSubmit={salvar} noValidate>
        <div className="grade-campos">
          <div className="campo"><label htmlFor="cs-setor">Setor</label><select id="cs-setor" value={f.setorId} onChange={(e) => setF({ ...f, setorId: e.target.value })}>{setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></div>
          <div className="campo"><label htmlFor="cs-nome">Nome</label><input id="cs-nome" value={f.titulo} maxLength={200} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ex.: Instagram da By Bus" /></div>
          <div className="campo"><label htmlFor="cs-cat">Categoria</label><input id="cs-cat" list="cs-cats" value={f.categoria} maxLength={80} onChange={(e) => setF({ ...f, categoria: e.target.value })} placeholder="Bancos, Fiscal, Redes…" /><datalist id="cs-cats">{categorias.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div className="campo"><label htmlFor="cs-url">Site</label><input id="cs-url" value={f.url} maxLength={500} onChange={(e) => setF({ ...f, url: e.target.value })} /></div>
          <div className="campo"><label htmlFor="cs-usuario">Usuário / login</label><input id="cs-usuario" value={f.usuario} maxLength={300} autoComplete="off" onChange={(e) => setF({ ...f, usuario: e.target.value })} /></div>
          {trocarSenha ? (
            <div className="campo"><label htmlFor="cs-senha">Senha</label>
              <input id="cs-senha" type="text" autoComplete="off" value={f.senha} maxLength={1000} onChange={(e) => setF({ ...f, senha: e.target.value })} />
              <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setF({ ...f, senha: gerarSenhaForte() })}>Gerar senha forte</button>
            </div>
          ) : <div className="campo"><span>Senha</span><button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setTrocarSenha(true)}>Trocar a senha</button></div>}
        </div>
        <div className="campo"><label htmlFor="cs-notas">{novo ? "Observações" : "Observações (deixe em branco para manter as atuais)"}</label><textarea id="cs-notas" rows={3} maxLength={5000} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} placeholder="Agência, conta, Pix, código de recuperação…" /></div>
        <div className="modal__acoes"><button type="button" className="botao botao--secundario" onClick={aoFechar}>Cancelar</button><button type="submit" className="botao botao--primario" disabled={salvando || !f.titulo.trim() || !f.setorId}>Salvar</button></div>
      </form>
    </Modal>
  );
}

function SetoresPessoas({ aoFechar, falhou }: { aoFechar: () => void; falhou: (e: unknown) => void }) {
  const notificar = useNotificar();
  type D = { setores: Array<{ id: string; nome: string; itens: number; membros: Array<{ usuarioId: string; podeEditar: boolean }> }>; pessoas: Array<{ id: string; nome: string }> };
  const [d, setD] = useState<D | null>(null);
  const [novo, setNovo] = useState("");
  const carregar = useCallback(() => api.get<D>("/api/cofre/setores").then(setD).catch(falhou), [falhou]);
  useEffect(() => { void carregar(); }, [carregar]);
  async function criar(e: FormEvent) {
    e.preventDefault();
    try { await api.post("/api/cofre/setores", { nome: novo }); setNovo(""); await carregar(); } catch (x) { falhou(x); }
  }
  async function nivel(setorId: string, usuarioId: string, valor: string) {
    const s = d!.setores.find((x) => x.id === setorId)!;
    const membros = s.membros.filter((m) => m.usuarioId !== usuarioId);
    if (valor) membros.push({ usuarioId, podeEditar: valor === "editar" });
    try { await api.patch(`/api/cofre/setores/${setorId}`, { membros }); await carregar(); } catch (x) { falhou(x); }
  }
  async function excluir(setorId: string) {
    try { await api.delete(`/api/cofre/setores/${setorId}`); notificar("Setor excluído."); await carregar(); } catch (x) { falhou(x); }
  }
  return (
    <Modal aberto titulo="Setores e pessoas" aoFechar={aoFechar} largura="larga">
      <p className="texto-fraco">Cada setor só aparece para quem você indicar aqui, inclusive administradores e você mesmo.</p>
      <form className="cofre__barra" onSubmit={criar}><input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Novo setor (ex.: Marketing)" aria-label="Nome do novo setor" maxLength={80} /><button type="submit" className="botao botao--primario botao--pequeno" disabled={!novo.trim()}>Criar setor</button></form>
      {!d ? <Carregando /> : d.setores.map((s) => (
        <section key={s.id} className="cofre__setor">
          <h3>{s.nome} <span className="texto-fraco">· {s.itens} senha(s)</span> <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void excluir(s.id)}>Excluir setor</button></h3>
          <div className="grade-campos">
            {d.pessoas.map((p) => {
              const m = s.membros.find((x) => x.usuarioId === p.id);
              return (
                <div key={p.id} className="campo campo--linha"><label htmlFor={`cm-${s.id}-${p.id}`}>{p.nome}</label>
                  <select id={`cm-${s.id}-${p.id}`} value={m ? (m.podeEditar ? "editar" : "ver") : ""} onChange={(e) => void nivel(s.id, p.id, e.target.value)}>
                    <option value="">Sem acesso</option><option value="ver">Vê</option><option value="editar">Vê e edita</option>
                  </select>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </Modal>
  );
}

const ACOES: Record<string, string> = { ver: "viu a senha", copiar: "copiou a senha", criar: "criou", editar: "editou", excluir: "excluiu", entrar: "abriu o Cofre", errou: "errou a senha de entrada", pessoas: "mudou quem vê o setor", importar: "importou da planilha" };
function Registro({ aoFechar, falhou }: { aoFechar: () => void; falhou: (e: unknown) => void }) {
  const [r, setR] = useState<Array<{ id: string; acao: string; em: string; detalhe: string | null; titulo: string | null; pessoa: string | null }> | null>(null);
  useEffect(() => { api.get<typeof r>("/api/cofre/registro").then(setR).catch(falhou); }, [falhou]);
  return (
    <Modal aberto titulo="Registro de acessos do Cofre" aoFechar={aoFechar} largura="larga">
      {!r ? <Carregando /> : (
        <div className="tabela-rolagem"><table className="tabela tabela--compacta"><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th></tr></thead>
          <tbody>{r.map((x) => <tr key={x.id}><td className="sem-quebra">{formatarDataHora(x.em)}</td><td>{x.pessoa ?? "—"}</td><td>{ACOES[x.acao] ?? x.acao}{x.titulo ? `: ${x.titulo}` : ""}{x.detalhe ? ` (${x.detalhe})` : ""}</td></tr>)}</tbody>
        </table></div>
      )}
    </Modal>
  );
}

function Importar({ setores, setorInicial, aoFechar, aoFeito, falhou }: { setores: Setor[]; setorInicial: string; aoFechar: () => void; aoFeito: () => void; falhou: (e: unknown) => void }) {
  const notificar = useNotificar();
  const [texto, setTexto] = useState("");
  const [cabecalho, setCabecalho] = useState(false);
  const [setorId, setSetorId] = useState(setorInicial);
  const [enviando, setEnviando] = useState(false);
  const itens: ItemImportadoCofre[] = useMemo(() => (texto.trim() ? montarImportacaoCofre(lerColado(texto), { cabecalho }) : []), [texto, cabecalho]);
  async function importar() {
    setEnviando(true);
    try {
      const r = await api.post<{ n: number }>("/api/cofre/itens/importar", { setorId, itens: itens.map((i) => ({ titulo: i.titulo, categoria: i.categoria, url: i.url, usuario: i.usuario, senha: i.senha, notas: i.notas })) });
      notificar(`${r.n} senha(s) importada(s).`);
      aoFeito();
    } catch (x) { falhou(x); } finally { setEnviando(false); }
  }
  return (
    <Modal aberto titulo="Importar da planilha de senhas" aoFechar={aoFechar} largura="larga">
      <p className="texto-fraco">Na planilha, selecione as colunas A (categoria), B (nome) e C (dados de acesso), copie e cole aqui. A leitura é feita no seu navegador: as senhas vão direto e criptografadas para o servidor. O texto inteiro de cada célula vai para as observações.</p>
      <div className="grade-campos">
        <div className="campo"><label htmlFor="ci-setor">Setor</label><select id="ci-setor" value={setorId} onChange={(e) => setSetorId(e.target.value)}>{setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></div>
        <label className="caixa"><input type="checkbox" checked={cabecalho} onChange={(e) => setCabecalho(e.target.checked)} /> A primeira linha é o cabeçalho</label>
      </div>
      <textarea rows={8} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Linhas coladas da planilha" placeholder="Cole aqui as linhas da planilha" />
      {itens.length > 0 && (
        <div className="tabela-rolagem"><table className="tabela tabela--compacta"><thead><tr><th>Categoria</th><th>Nome</th><th>Usuário</th><th>Senha</th></tr></thead>
          <tbody>{itens.map((i, k) => <tr key={k}><td>{i.categoria || "—"}</td><td>{i.titulo}</td><td>{i.usuario || "—"}</td><td>{i.senha ? "encontrada" : <span className="texto-atencao">não encontrada (vai nas observações)</span>}</td></tr>)}</tbody>
        </table></div>
      )}
      <div className="modal__acoes"><button type="button" className="botao botao--secundario" onClick={aoFechar}>Cancelar</button><button type="button" className="botao botao--primario" disabled={enviando || !itens.length || !setorId} onClick={() => void importar()}>Importar {itens.length} senha(s)</button></div>
    </Modal>
  );
}
