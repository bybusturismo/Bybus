import { useMemo, useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Icone } from "../componentes/Icone";
import { Confirmar, Modal } from "../componentes/Modal";
import { useNotificar } from "../componentes/Notificacoes";
import { formatarData } from "../util/formato";
import { lerBase64 } from "../util/foto";
import { useCarregar } from "../util/useCarregar";

interface Pasta { id: string; nome: string; descricao: string | null; acesso: "TODOS" | "RESTRITO"; perfis?: string[]; usuarios?: string[]; arquivos: number }
interface Arquivo {
  id: string; pastaId: string; titulo: string; descricao: string | null; nomeArquivo: string; mime: string; tamanho: number;
  vencimento: string | null; situacao: "VENCIDO" | "A_VENCER" | "EM_DIA" | null; enviadoPor: string | null; criadoEm: string;
}
interface Resposta { podeGerenciar: boolean; podeDefinirAcesso: boolean; pastas: Pasta[]; arquivos: Arquivo[]; alertas: Arquivo[] }

const MAX_MB = 15;
const tamanho = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const conteudo = (id: string, baixar = false) => `/api/documentos/arquivos/${id}/conteudo${baixar ? "?baixar=1" : ""}`;

function SituacaoVenc({ a }: { a: Arquivo }) {
  if (!a.vencimento) return <span className="texto-fraco">—</span>;
  const cls = a.situacao === "VENCIDO" ? "etiqueta--perigo" : a.situacao === "A_VENCER" ? "etiqueta--atencao" : "etiqueta--sucesso";
  const txt = a.situacao === "VENCIDO" ? "Vencido" : a.situacao === "A_VENCER" ? "Vence em breve" : "Em dia";
  return <span className={`etiqueta ${cls}`}>{txt} · {formatarData(a.vencimento)}</span>;
}

/** Documentos da empresa (pedido do dono, 11/11/2026): contrato social, CNPJ, contratos, certidões, documentos dos sócios. */
export function DocumentosEmpresa() {
  const notificar = useNotificar();
  const r = useCarregar((s) => api.get<Resposta>("/api/documentos", s), []);
  const [pastaId, setPastaId] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [editando, setEditando] = useState<Arquivo | null>(null);
  const [excluindo, setExcluindo] = useState<Arquivo | null>(null);
  const [acessoDe, setAcessoDe] = useState<Pasta | "nova" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const d = r.dados;
  const pasta = d?.pastas.find((p) => p.id === pastaId) ?? d?.pastas[0] ?? null;
  const arquivos = useMemo(() => (d?.arquivos ?? []).filter((a) => a.pastaId === pasta?.id), [d, pasta]);

  async function excluir() {
    if (!excluindo) return;
    try {
      await api.delete(`/api/documentos/arquivos/${excluindo.id}`);
      notificar("Documento apagado.");
      setExcluindo(null);
      r.recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
      setExcluindo(null);
    }
  }

  return (
    <div className="pagina documentos-empresa">
      <div className="pagina__cabecalho">
        <div>
          <h1>Documentos da empresa</h1>
          <p className="pagina__descricao">Contrato social, cartão CNPJ, contratos, certidões e documentos dos sócios. Os arquivos ficam guardados com criptografia e cada abertura fica registrada.</p>
        </div>
        {d?.podeGerenciar && (
          <div className="barra-acoes">
            <button type="button" className="botao botao--secundario" onClick={() => setAcessoDe("nova")}><Icone nome="mais" /> Nova pasta</button>
            <button type="button" className="botao botao--primario" disabled={!pasta} onClick={() => setEnviando(true)}><Icone nome="importar" /> Enviar documento</button>
          </div>
        )}
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {r.carregando && !d ? <Carregando /> : r.erro ? <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} /> : d && (
        <>
          {d.alertas.length > 0 && (
            <Aviso tipo="atencao" titulo="Vencimentos">
              {d.alertas.map((a) => <div key={a.id}>{a.titulo}: {a.situacao === "VENCIDO" ? "vencido em" : "vence em"} {formatarData(a.vencimento)}</div>)}
            </Aviso>
          )}
          {d.pastas.length === 0 ? <Vazio titulo="Nenhuma pasta liberada para você." /> : (
            <div className="documentos-empresa__grade">
              <nav className="documentos-empresa__pastas" aria-label="Pastas">
                {d.pastas.map((p) => (
                  <button key={p.id} type="button" className={`documentos-empresa__pasta${p.id === pasta?.id ? " documentos-empresa__pasta--ativa" : ""}`} aria-current={p.id === pasta?.id} onClick={() => setPastaId(p.id)}>
                    <span>{p.acesso === "RESTRITO" && <Icone nome="escudo" tamanho={16} />} {p.nome}</span>
                    <span className="texto-fraco">{p.arquivos}</span>
                  </button>
                ))}
              </nav>
              {pasta && (
                <section className="cartao" aria-labelledby="titulo-pasta">
                  <div className="documentos-empresa__cab">
                    <div>
                      <h2 id="titulo-pasta">{pasta.nome}</h2>
                      {pasta.descricao && <p className="texto-fraco">{pasta.descricao}</p>}
                      <p className="texto-fraco">{pasta.acesso === "RESTRITO" ? "Pasta restrita: só o administrador e quem está na lista." : "Aberta para quem tem acesso aos documentos."}</p>
                    </div>
                    {d.podeDefinirAcesso && <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setAcessoDe(pasta)}><Icone nome="escudo" /> Quem vê</button>}
                  </div>
                  {arquivos.length === 0 ? <Vazio titulo="Nenhum documento nesta pasta." /> : (
                    <div className="tabela-rolagem">
                      <table className="tabela">
                        <thead><tr><th scope="col">Documento</th><th scope="col">Validade</th><th scope="col">Enviado</th><th scope="col"><span className="visualmente-oculto">Ações</span></th></tr></thead>
                        <tbody>
                          {arquivos.map((a) => (
                            <tr key={a.id}>
                              <td><strong>{a.titulo}</strong><div className="texto-fraco">{a.nomeArquivo} · {tamanho(a.tamanho)}</div>{a.descricao && <div className="texto-fraco">{a.descricao}</div>}</td>
                              <td><SituacaoVenc a={a} /></td>
                              <td className="texto-fraco">{formatarData(a.criadoEm.slice(0, 10))}{a.enviadoPor ? ` · ${a.enviadoPor}` : ""}</td>
                              <td>
                                <span className="documentos-empresa__acoes">
                                  <a className="botao botao--secundario botao--pequeno" href={conteudo(a.id)} target="_blank" rel="noopener noreferrer">Abrir</a>
                                  <a className="botao botao--secundario botao--pequeno" href={conteudo(a.id, true)} aria-label={`Baixar ${a.titulo}`}><Icone nome="baixar" /></a>
                                  {d.podeGerenciar && <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setEditando(a)}>Editar</button>}
                                  {d.podeGerenciar && <button type="button" className="botao botao--perigo-contorno botao--pequeno" onClick={() => setExcluindo(a)} aria-label={`Apagar ${a.titulo}`}>Apagar</button>}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
          {enviando && pasta && <FormDocumento pastas={d.pastas} pastaId={pasta.id} aoFechar={() => setEnviando(false)} aoSalvar={() => { setEnviando(false); notificar("Documento enviado."); r.recarregar(); }} />}
          {editando && <FormDocumento pastas={d.pastas} pastaId={editando.pastaId} arquivo={editando} aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); notificar("Documento atualizado."); r.recarregar(); }} />}
          {acessoDe && <FormPasta pasta={acessoDe === "nova" ? null : acessoDe} podeDefinirAcesso={d.podeDefinirAcesso} aoFechar={() => setAcessoDe(null)} aoSalvar={(id) => { setAcessoDe(null); if (id) setPastaId(id); notificar("Pasta salva."); r.recarregar(); }} />}
          <Confirmar aberto={excluindo !== null} titulo="Apagar documento" perigo textoConfirmar="Apagar" aoFechar={() => setExcluindo(null)} aoConfirmar={() => void excluir()}
            mensagem={<p>Apagar <strong>{excluindo?.titulo}</strong>? O arquivo sai do sistema e não dá para recuperar (a auditoria guarda o registro de quem apagou).</p>} />
        </>
      )}
    </div>
  );
}

function FormDocumento({ pastas, pastaId, arquivo, aoFechar, aoSalvar }: { pastas: Pasta[]; pastaId: string; arquivo?: Arquivo; aoFechar: () => void; aoSalvar: () => void }) {
  const [pasta, setPasta] = useState(pastaId);
  const [titulo, setTitulo] = useState(arquivo?.titulo ?? "");
  const [descricao, setDescricao] = useState(arquivo?.descricao ?? "");
  const [vencimento, setVencimento] = useState(arquivo?.vencimento ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (titulo.trim().length < 2) return setErro("Dê um nome ao documento (ex.: Contrato social – 3ª alteração).");
    if (!arquivo && !file) return setErro("Escolha o arquivo.");
    if (file && file.size > MAX_MB * 1024 * 1024) return setErro(`O arquivo pode ter até ${MAX_MB} MB.`);
    setOcupado(true);
    try {
      if (arquivo) await api.patch(`/api/documentos/arquivos/${arquivo.id}`, { titulo: titulo.trim(), descricao: descricao.trim() || null, vencimento: vencimento || null, pastaId: pasta });
      else await api.post("/api/documentos/arquivos", { pastaId: pasta, titulo: titulo.trim(), descricao: descricao.trim() || null, vencimento: vencimento || null, nome: file!.name, base64: await lerBase64(file!) });
      aoSalvar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal aberto titulo={arquivo ? "Editar documento" : "Enviar documento"} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="campo"><label htmlFor="doc-pasta">Pasta</label>
          <select id="doc-pasta" value={pasta} onChange={(e) => setPasta(e.target.value)}>{pastas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
        </div>
        <div className="campo"><label htmlFor="doc-titulo">Nome do documento</label><input id="doc-titulo" value={titulo} maxLength={160} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Cartão CNPJ" /></div>
        <div className="campo"><label htmlFor="doc-desc">Observação (opcional)</label><input id="doc-desc" value={descricao} maxLength={500} onChange={(e) => setDescricao(e.target.value)} /></div>
        <div className="campo"><label htmlFor="doc-venc">Validade (opcional)</label><input id="doc-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
          <span className="campo__ajuda">Para certidões, alvarás e licenças: o sistema avisa 30 dias antes.</span></div>
        {!arquivo && (
          <div className="campo"><label htmlFor="doc-arquivo">Arquivo</label><input id="doc-arquivo" type="file" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.pptx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className="campo__ajuda">PDF, foto (JPG/PNG) ou Word/Excel/PowerPoint, até {MAX_MB} MB.</span></div>
        )}
        <div className="modal__acoes">
          <button type="button" className="botao botao--secundario" onClick={aoFechar}>Cancelar</button>
          <button type="submit" className="botao botao--primario" disabled={ocupado}>{ocupado ? "Enviando…" : arquivo ? "Salvar" : "Enviar"}</button>
        </div>
      </form>
    </Modal>
  );
}

function FormPasta({ pasta, podeDefinirAcesso, aoFechar, aoSalvar }: { pasta: Pasta | null; podeDefinirAcesso: boolean; aoFechar: () => void; aoSalvar: (id?: string) => void }) {
  const opcoes = useCarregar((s) => (podeDefinirAcesso ? api.get<{ perfis: Array<{ codigo: string; nome: string }>; usuarios: Array<{ id: string; nome: string }> }>("/api/documentos/opcoes-acesso", s) : Promise.resolve(null)), [podeDefinirAcesso]);
  const [nome, setNome] = useState(pasta?.nome ?? "");
  const [descricao, setDescricao] = useState(pasta?.descricao ?? "");
  const [acesso, setAcesso] = useState<"TODOS" | "RESTRITO">(pasta?.acesso ?? "TODOS");
  const [perfis, setPerfis] = useState<string[]>(pasta?.perfis ?? []);
  const [usuarios, setUsuarios] = useState<string[]>(pasta?.usuarios ?? []);
  const [erro, setErro] = useState<string | null>(null);
  const alternar = (lista: string[], v: string) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nome.trim().length < 2) return setErro("Dê um nome à pasta.");
    const corpo = { nome: nome.trim(), descricao: descricao.trim() || null, ...(podeDefinirAcesso ? { acesso, perfis: acesso === "RESTRITO" ? perfis : [], usuarios: acesso === "RESTRITO" ? usuarios : [] } : {}) };
    try {
      if (pasta) { await api.patch(`/api/documentos/pastas/${pasta.id}`, corpo); aoSalvar(); }
      else aoSalvar((await api.post<{ id: string }>("/api/documentos/pastas", corpo)).id);
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  return (
    <Modal aberto titulo={pasta ? `Pasta ${pasta.nome}` : "Nova pasta"} aoFechar={aoFechar} largura="larga">
      <form onSubmit={salvar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="campo"><label htmlFor="pa-nome">Nome</label><input id="pa-nome" value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} /></div>
        <div className="campo"><label htmlFor="pa-desc">Descrição (opcional)</label><input id="pa-desc" value={descricao} maxLength={300} onChange={(e) => setDescricao(e.target.value)} /></div>
        {podeDefinirAcesso ? (
          <fieldset className="campo">
            <legend>Quem vê esta pasta</legend>
            <label className="caixa"><input type="radio" name="pa-acesso" checked={acesso === "TODOS"} onChange={() => setAcesso("TODOS")} /> Todos com acesso aos documentos</label>
            <label className="caixa"><input type="radio" name="pa-acesso" checked={acesso === "RESTRITO"} onChange={() => setAcesso("RESTRITO")} /> Restrita: só o administrador e quem eu marcar</label>
            {acesso === "RESTRITO" && (opcoes.carregando && !opcoes.dados ? <Carregando /> : opcoes.dados && (
              <div className="documentos-empresa__acesso">
                <div><strong>Perfis</strong>{opcoes.dados.perfis.filter((p) => p.codigo !== "ADMIN").map((p) => <label key={p.codigo} className="caixa"><input type="checkbox" checked={perfis.includes(p.codigo)} onChange={() => setPerfis(alternar(perfis, p.codigo))} /> {p.nome}</label>)}</div>
                <div><strong>Pessoas</strong>{opcoes.dados.usuarios.map((u) => <label key={u.id} className="caixa"><input type="checkbox" checked={usuarios.includes(u.id)} onChange={() => setUsuarios(alternar(usuarios, u.id))} /> {u.nome}</label>)}</div>
              </div>
            ))}
          </fieldset>
        ) : <p className="texto-fraco">A pasta nasce aberta para quem tem acesso aos documentos. Só o administrador restringe.</p>}
        <div className="modal__acoes">
          <button type="button" className="botao botao--secundario" onClick={aoFechar}>Cancelar</button>
          <button type="submit" className="botao botao--primario">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}
