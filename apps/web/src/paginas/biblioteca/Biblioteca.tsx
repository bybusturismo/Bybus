import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as PE } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { montarArvore, type NoArvore } from "@bybus/core";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { Confirmar, Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { useCarregar } from "../../util/useCarregar";
import { AcessoPessoas } from "./AcessoPessoas";
import { ArvorePaginas, type AcaoPagina } from "./ArvorePaginas";
import { CabecalhoPagina } from "./CabecalhoPagina";
import { EditorRico, type EditorRicoRef } from "./EditorRico";
import { Markdown } from "./Markdown";
import { ACEITA_ARQUIVO, enviarAnexo, LIMITES_MB, tamanhoLegivel } from "./anexos";
import { htmlDaPagina } from "./htmlSeguro";
import type { Achado, ItemLixeira, Lista, Meta, Pagina } from "./tipos";
import { podeGravarTela, useGravarTela } from "./useGravarTela";
import "../../estilos/marketing.css";

const EMOJIS = ["📄", "📘", "📗", "📙", "📕", "📋", "📝", "📌", "📎", "🗂️", "📅", "⏰", "🚌", "🧭", "🗺️", "📍", "🏖️", "🏝️", "🎫", "👥", "🧾", "💳", "🛡️", "⚠️", "✅", "❓", "💡", "⭐", "📞", "🔧"];
const CHAVE_LARGURA = "bybus.biblioteca.largura";
const LARG_MIN = 200;
const LARG_MAX = 520;

function larguraGuardada(): number {
  try {
    const n = Number(localStorage.getItem(CHAVE_LARGURA));
    return n >= LARG_MIN && n <= LARG_MAX ? n : 288;
  } catch {
    return 288;
  }
}

/** Páginas que podem ser destino: nunca a própria página nem as que estão dentro dela. */
export function opcoesDePai(paginas: Meta[], idAtual: string | null): Array<{ id: string; rotulo: string }> {
  const proibidos = new Set<string>();
  if (idAtual) {
    proibidos.add(idAtual);
    for (let mudou = true; mudou; ) {
      mudou = false;
      for (const p of paginas) if (p.paiId && proibidos.has(p.paiId) && !proibidos.has(p.id)) { proibidos.add(p.id); mudou = true; }
    }
  }
  const saida: Array<{ id: string; rotulo: string }> = [];
  const andar = (nos: NoArvore<Meta>[], nivel: number) => {
    for (const n of nos) {
      if (proibidos.has(n.pagina.id)) continue;
      saida.push({ id: n.pagina.id, rotulo: `${"— ".repeat(nivel)}${n.pagina.titulo}` });
      andar(n.filhos, nivel + 1);
    }
  };
  andar(montarArvore(paginas), 0);
  return saida;
}

function Resultados({ termo }: { termo: string }) {
  const r = useCarregar((s) => api.get<Achado[]>(`/api/biblioteca/busca${qs({ q: termo })}`, s), [termo]);
  if (r.carregando && !r.dados) return <Carregando texto="Buscando…" />;
  if (r.erro) return <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} />;
  if (!r.dados?.length) return <Vazio titulo={`Nada encontrado para “${termo}”.`} />;
  return (
    <ul className="lista-simples" aria-label="Resultados da busca">
      {r.dados.map((a) => (
        <li key={a.id}>
          <Link to={`/biblioteca/${a.id}`}><strong>{a.titulo}</strong></Link>
          {a.caminho.length > 0 && <span className="texto-fraco"> — em {a.caminho.join(" › ")}</span>}
          <div className="texto-fraco">{a.trecho}</div>
        </li>
      ))}
    </ul>
  );
}

type Dialogo =
  | { tipo: "renomear"; pagina: Meta }
  | { tipo: "icone"; pagina: Meta }
  | { tipo: "mover"; pagina: Meta }
  | { tipo: "pessoas"; pagina: Meta }
  | { tipo: "excluir"; pagina: Meta }
  | { tipo: "lixeira" };

function Lixeira({ aoMudar }: { aoMudar: () => Promise<void> }) {
  const notificar = useNotificar();
  const l = useCarregar((s) => api.get<ItemLixeira[]>("/api/biblioteca/lixeira", s), []);
  async function agir(i: ItemLixeira, acao: "restaurar" | "apagar") {
    try {
      if (acao === "restaurar") await api.post(`/api/biblioteca/lixeira/${i.id}/restaurar`);
      else await api.delete(`/api/biblioteca/lixeira/${i.id}`);
      notificar(acao === "restaurar" ? "Página restaurada." : "Página apagada de vez.");
      await Promise.all([l.recarregar(), aoMudar()]);
    } catch (x) {
      notificar(mensagemDeErro(x), "erro");
    }
  }
  if (l.carregando && !l.dados) return <Carregando />;
  if (l.erro) return <ErroCarga mensagem={l.erro} tentarDeNovo={l.recarregar} />;
  if (!l.dados?.length) return <p className="texto-fraco">A lixeira está vazia.</p>;
  return (
    <ul className="lista-simples">
      {l.dados.map((i) => (
        <li key={i.id} className="lixeira__item">
          <span>{i.icone ?? "📄"} <strong>{i.titulo}</strong>{i.paginas > 1 ? ` e mais ${i.paginas - 1} subpágina(s)` : ""}</span>
          <span className="barra-acoes">
            <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void agir(i, "restaurar")}>Restaurar</button>
            <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void agir(i, "apagar")}>Apagar de vez</button>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Biblioteca() {
  const { id } = useParams();
  const navegar = useNavigate();
  const notificar = useNotificar();
  const { pode } = useSessao();
  const lista = useCarregar((s) => api.get<Lista>("/api/biblioteca/paginas", s), []);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [largura, setLargura] = useState(larguraGuardada);
  const [desfazer, setDesfazer] = useState<{ id: string; titulo: string } | null>(null);
  const [abrirEditando, setAbrirEditando] = useState<string | null>(null);
  const [subindo, setSubindo] = useState(false);
  const editor = useRef<EditorRicoRef>(null);
  const emDemo = import.meta.env.VITE_DEMO === "1";

  const paginas = useMemo(() => lista.dados?.paginas ?? [], [lista.dados]);
  const arvore = useMemo(() => montarArvore(paginas), [paginas]);
  const idAtual = id ?? arvore[0]?.pagina.id;
  const pagina = useCarregar((s) => (idAtual ? api.get<Pagina>(`/api/biblioteca/paginas/${idAtual}`, s) : Promise.resolve(null)), [idAtual]);
  const editorGeral = lista.dados?.podeEditar ?? pode("biblioteca:editar");
  // enquanto a página nova carrega, `pagina.dados` ainda é a anterior: não a mostre nem a edite
  const p = pagina.dados && pagina.dados.id === idAtual ? pagina.dados : null;

  // trocar de página sai da edição; uma página recém-criada abre já em edição
  useEffect(() => {
    setEditando(abrirEditando !== null && abrirEditando === idAtual);
    if (abrirEditando === idAtual) setAbrirEditando(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idAtual]);
  // avisa antes de fechar a aba no meio da edição
  useEffect(() => {
    if (!editando) return undefined;
    const sair = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", sair);
    return () => window.removeEventListener("beforeunload", sair);
  }, [editando]);
  useEffect(() => {
    if (!desfazer) return undefined;
    const t = setTimeout(() => setDesfazer(null), 12000);
    return () => clearTimeout(t);
  }, [desfazer]);

  async function recarregarTudo() {
    await Promise.all([lista.recarregar(), pagina.recarregar()]);
  }
  const erro = (x: unknown) => notificar(mensagemDeErro(x), "erro");

  function buscar(e: FormEvent) {
    e.preventDefault();
    setTermo(busca.trim().length >= 2 ? busca.trim() : "");
  }

  async function patch(paginaId: string, corpo: Record<string, unknown>, msg?: string) {
    try {
      await api.patch(`/api/biblioteca/paginas/${paginaId}`, corpo);
      if (msg) notificar(msg);
      await recarregarTudo();
      return true;
    } catch (x) {
      erro(x);
      return false;
    }
  }

  async function novaPagina(paiId: string | null) {
    try {
      const r = await api.post<{ id: string }>("/api/biblioteca/paginas", { titulo: "Nova página", paiId });
      setAbrirEditando(r.id);
      await lista.recarregar();
      navegar(`/biblioteca/${r.id}`);
    } catch (x) {
      erro(x);
    }
  }

  async function acao(a: AcaoPagina, pg: Meta) {
    switch (a) {
      case "subpagina": return novaPagina(pg.id);
      case "duplicar":
        try {
          const r = await api.post<{ id: string; paginas: number }>(`/api/biblioteca/paginas/${pg.id}/duplicar`);
          notificar(r.paginas > 1 ? `Página duplicada com ${r.paginas - 1} subpágina(s).` : "Página duplicada.");
          await lista.recarregar();
          navegar(`/biblioteca/${r.id}`);
        } catch (x) { erro(x); }
        return;
      case "link":
        try {
          await navigator.clipboard.writeText(`${window.location.origin}/biblioteca/${pg.id}`);
          notificar("Link copiado.");
        } catch { notificar("Não foi possível copiar o link.", "erro"); }
        return;
      case "restringir": return void patch(pg.id, { acesso: pg.acesso === "RESTRITO" ? "EQUIPE" : "RESTRITO" }, pg.acesso === "RESTRITO" ? "Página liberada para a equipe." : "Página restrita.");
      case "pdf":
        if (emDemo) return notificar("Na demonstração o PDF não é gerado.", "erro");
        { const a2 = document.createElement("a"); a2.href = `/api/biblioteca/paginas/${pg.id}/pdf`; a2.download = ""; document.body.appendChild(a2); a2.click(); a2.remove(); }
        return;
      default: setDialogo({ tipo: a, pagina: pg });
    }
  }

  async function moverArrastando(idMovido: string, paiId: string | null, antesDe: string | null) {
    await patch(idMovido, { paiId, antesDe });
  }

  async function excluir(pg: Meta) {
    setOcupado(true);
    try {
      await api.delete(`/api/biblioteca/paginas/${pg.id}`);
      setDialogo(null);
      setDesfazer({ id: pg.id, titulo: pg.titulo });
      await lista.recarregar();
      if (pg.id === idAtual) navegar(pg.paiId ? `/biblioteca/${pg.paiId}` : "/biblioteca");
    } catch (x) { erro(x); } finally { setOcupado(false); }
  }
  async function desfazerExclusao() {
    if (!desfazer) return;
    try {
      await api.post(`/api/biblioteca/lixeira/${desfazer.id}/restaurar`);
      setDesfazer(null);
      notificar("Página restaurada.");
      await lista.recarregar();
      navegar(`/biblioteca/${desfazer.id}`);
    } catch (x) { erro(x); }
  }

  async function salvarConteudo(conteudo: string) {
    if (!p) return;
    setSalvando(true);
    try {
      await api.patch(`/api/biblioteca/paginas/${p.id}`, { conteudo, formato: "html" });
      setEditando(false);
      notificar("Página salva.");
      await recarregarTudo();
    } catch (x) { erro(x); } finally { setSalvando(false); }
  }

  async function enviarImagem(arquivo: File): Promise<string | null> {
    if (!p) return null;
    try {
      const r = await enviarAnexo(p.id, arquivo, arquivo.name);
      return r.url;
    } catch (x) { erro(x); return null; }
  }

  async function anexar(arquivo: File) {
    if (!p) return;
    setSubindo(true);
    try {
      await enviarAnexo(p.id, arquivo, arquivo.name);
      notificar("Arquivo anexado.");
      await pagina.recarregar();
    } catch (x) { erro(x); } finally { setSubindo(false); }
  }
  async function removerAnexo(anexoId: string) {
    try {
      await api.delete(`/api/biblioteca/anexos/${anexoId}`);
      await pagina.recarregar();
    } catch (x) { erro(x); }
  }

  const gravacao = useGravarTela(async (video) => {
    if (!p) return;
    const r = await enviarAnexo(p.id, video, `Gravação de tela ${new Date().toLocaleString("pt-BR").replace(/[/:]/g, "-")}.webm`);
    if (editor.current) {
      editor.current.inserir(`<video controls src="${r.url}"></video><p><br></p>`);
      notificar("Vídeo gravado e colocado no texto. Salve a página.");
    } else notificar("Vídeo gravado e anexado à página.");
    await pagina.recarregar();
  }, (t) => notificar(t, "erro"));

  function gravarTela() {
    if (emDemo || !podeGravarTela()) return notificar(emDemo ? "Na demonstração não é possível gravar a tela." : "Este navegador não grava a tela. Use o Chrome ou o Edge no computador.", "erro");
    setEditando(true);
    // o editor monta no próximo ciclo; a gravação só termina depois, quando ele já existe
    void gravacao.iniciar(window.confirm("Gravar também a sua voz (microfone)?"));
  }

  // largura da coluna da árvore (ajustável, guardada no navegador)
  const arrasto = useRef<{ x: number; l: number } | null>(null);
  const guardarLargura = (l: number) => { try { localStorage.setItem(CHAVE_LARGURA, String(l)); } catch { /* sem armazenamento: vale só nesta visita */ } };
  const limita = (l: number) => Math.max(LARG_MIN, Math.min(LARG_MAX, l));
  function comecarRedimensionar(e: PE<HTMLDivElement>) {
    arrasto.current = { x: e.clientX, l: largura };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function redimensionando(e: PE<HTMLDivElement>) {
    if (arrasto.current) setLargura(limita(arrasto.current.l + e.clientX - arrasto.current.x));
  }
  function terminarRedimensionar() {
    if (arrasto.current) { arrasto.current = null; guardarLargura(largura); }
  }

  const acoesPagina = p && (
    <>
      {p.podeEditar && !editando && <button type="button" className="botao botao--secundario" onClick={() => setEditando(true)}>Editar</button>}
      {p.podeEditar && !editando && <button type="button" className="botao botao--secundario" onClick={gravarTela}>Gravar a tela</button>}
      <button type="button" className="botao botao--secundario" onClick={() => void acao("pdf", { ...paginas.find((x) => x.id === p.id)! })}>PDF</button>
    </>
  );

  return (
    <div className="pagina pagina--larga">
      <div className="pagina__cabecalho">
        <div>
          <h1>Biblioteca</h1>
          <p className="pagina__descricao">Manuais e procedimentos da operação, em páginas com subpáginas.</p>
        </div>
        <div className="barra-acoes">
          {editorGeral && <button type="button" className="botao botao--secundario" onClick={() => setDialogo({ tipo: "lixeira" })}>Lixeira</button>}
          {editorGeral && <button type="button" className="botao botao--primario" onClick={() => void novaPagina(null)}><Icone nome="mais" /> Nova página</button>}
        </div>
      </div>
      {desfazer && (
        <Aviso tipo="info">
          A página “{desfazer.titulo}” foi para a lixeira.{" "}
          <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void desfazerExclusao()}>Desfazer</button>
        </Aviso>
      )}
      <div className="biblioteca" style={{ ["--larg-arvore" as string]: `${largura}px` }}>
        <aside className="biblioteca__lateral cartao" aria-label="Páginas">
          <form onSubmit={buscar} role="search" className="campo">
            <label htmlFor="bib-busca">Buscar na Biblioteca</label>
            <input id="bib-busca" type="search" value={busca} placeholder="Título ou texto" onChange={(e) => { setBusca(e.target.value); if (!e.target.value.trim()) setTermo(""); }} />
          </form>
          {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : arvore.length === 0 ? <p className="texto-fraco">Nenhuma página ainda.</p> : (
            <nav aria-label="Árvore de páginas">
              <ArvorePaginas nos={arvore} paginas={paginas} ativo={idAtual} editorGeral={editorGeral} aoAcao={(a, pg) => void acao(a, pg)} aoMover={(a, b, c) => void moverArrastando(a, b, c)} />
            </nav>
          )}
        </aside>
        <div
          className="biblioteca__divisor"
          role="separator"
          aria-orientation="vertical"
          aria-label="Largura da lista de páginas"
          aria-valuemin={LARG_MIN}
          aria-valuemax={LARG_MAX}
          aria-valuenow={largura}
          tabIndex={0}
          onPointerDown={comecarRedimensionar}
          onPointerMove={redimensionando}
          onPointerUp={terminarRedimensionar}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const l = limita(largura + (e.key === "ArrowRight" ? 16 : -16));
            setLargura(l);
            guardarLargura(l);
          }}
        />
        <section className="cartao biblioteca__pagina" aria-live="polite">
          {termo ? (
            <>
              <h2>Resultados para “{termo}”</h2>
              <Resultados termo={termo} />
            </>
          ) : pagina.carregando && !p ? (
            <Carregando />
          ) : pagina.erro ? (
            <ErroCarga mensagem={pagina.erro} tentarDeNovo={pagina.recarregar} />
          ) : !p ? (
            <Vazio titulo="Nenhuma página para mostrar.">{editorGeral ? "Use “Nova página” para começar." : "Peça a quem edita a Biblioteca para criar as primeiras páginas."}</Vazio>
          ) : (
            <article>
              {p.caminho.length > 1 && (
                <nav className="biblioteca__trilha" aria-label="Você está em">
                  {p.caminho.slice(0, -1).map((c) => <span key={c.id}><Link to={`/biblioteca/${c.id}`}>{c.titulo}</Link> › </span>)}
                </nav>
              )}
              <CabecalhoPagina pagina={p} aoRenomear={(t) => void patch(p.id, { titulo: t }, "Nome alterado.")} aoIcone={() => setDialogo({ tipo: "icone", pagina: { ...paginas.find((x) => x.id === p.id)! } })} acoes={acoesPagina} />
              {editando ? (
                <EditorRico ref={editor} conteudo={p.conteudo} salvando={salvando} aoSalvar={(c) => void salvarConteudo(c)} aoCancelar={() => setEditando(false)} aoEnviarImagem={enviarImagem} />
              ) : p.formato === "markdown" ? (
                <Markdown texto={p.conteudo} />
              ) : (
                // HTML já limpo no servidor e limpo de novo aqui (DOMPurify, mesmas listas)
                // eslint-disable-next-line react/no-danger
                <div className="md" dangerouslySetInnerHTML={{ __html: htmlDaPagina(p.conteudo) || '<p class="texto-fraco">Página sem conteúdo.</p>' }} />
              )}
              {p.subpaginas.length > 0 && (
                <section aria-labelledby="t-subpaginas">
                  <h3 id="t-subpaginas">Subpáginas</h3>
                  <div className="tabela-rolagem">
                    <table className="tabela">
                      <thead><tr><th>Nome</th><th>Proprietário</th><th>Colaboradores</th></tr></thead>
                      <tbody>
                        {p.subpaginas.map((s) => (
                          <tr key={s.id}>
                            <td><Link to={`/biblioteca/${s.id}`}>{s.icone ?? "📄"} {s.titulo}</Link></td>
                            <td>{s.proprietario ?? <span className="texto-fraco">—</span>}</td>
                            <td>{s.colaboradores.length ? s.colaboradores.join(", ") : <span className="texto-fraco">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {(p.anexos.length > 0 || p.podeEditar) && (
                <section aria-labelledby="t-anexos" className="anexos">
                  <h3 id="t-anexos">Arquivos da página</h3>
                  {p.anexos.length === 0 ? <p className="texto-fraco">Nenhum arquivo anexado.</p> : (
                    <ul className="lista-simples">
                      {p.anexos.map((a) => (
                        <li key={a.id} className="lixeira__item">
                          <span><a href={`/api/biblioteca/anexos/${a.id}`} target="_blank" rel="noopener noreferrer">{a.nome}</a> <span className="texto-fraco">({a.uso === "IMAGEM" ? "imagem" : a.uso === "VIDEO" ? "vídeo" : "arquivo"}, {tamanhoLegivel(a.tamanho)})</span></span>
                          {p.podeEditar && <button type="button" className="botao botao--fantasma botao--pequeno" aria-label={`Excluir ${a.nome}`} onClick={() => void removerAnexo(a.id)}>Excluir</button>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {p.podeEditar && (
                    <label className="botao botao--secundario">
                      {subindo ? "Enviando…" : "Anexar arquivo"}
                      <input type="file" className="visualmente-oculto" accept={ACEITA_ARQUIVO} aria-label="Anexar arquivo" disabled={subindo || emDemo} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void anexar(f); }} />
                    </label>
                  )}
                  {p.podeEditar && <p className="texto-fraco">PDF, TXT, CSV, DOCX, XLSX, imagens e vídeos. Limites: imagem {LIMITES_MB.IMAGEM} MB, arquivo {LIMITES_MB.ARQUIVO} MB, vídeo {LIMITES_MB.VIDEO} MB.{emDemo ? " Na demonstração o envio de arquivos não funciona." : ""}</p>}
                </section>
              )}
            </article>
          )}
        </section>
      </div>
      {gravacao.pilula}

      <Modal aberto={dialogo?.tipo === "renomear"} titulo="Renomear página" aoFechar={() => setDialogo(null)}>
        {dialogo?.tipo === "renomear" && <FormNome pagina={dialogo.pagina} aoSalvar={async (t) => { setDialogo(null); await patch(dialogo.pagina.id, { titulo: t }, "Nome alterado."); }} aoCancelar={() => setDialogo(null)} />}
      </Modal>
      <Modal aberto={dialogo?.tipo === "icone"} titulo="Ícone da página" aoFechar={() => setDialogo(null)}>
        {dialogo?.tipo === "icone" && <FormIcone pagina={dialogo.pagina} aoEscolher={async (e) => { setDialogo(null); await patch(dialogo.pagina.id, { icone: e }, "Ícone alterado."); }} aoCancelar={() => setDialogo(null)} />}
      </Modal>
      <Modal aberto={dialogo?.tipo === "mover"} titulo="Mover página" aoFechar={() => setDialogo(null)}>
        {dialogo?.tipo === "mover" && <FormMover pagina={dialogo.pagina} paginas={paginas} editorGeral={editorGeral} aoMover={async (pai) => { setDialogo(null); await patch(dialogo.pagina.id, { paiId: pai }, "Página movida."); }} aoCancelar={() => setDialogo(null)} />}
      </Modal>
      <Modal aberto={dialogo?.tipo === "pessoas"} titulo={dialogo?.tipo === "pessoas" ? `Acesso por pessoa — ${dialogo.pagina.titulo}` : "Acesso por pessoa"} aoFechar={() => setDialogo(null)} largura="larga">
        {dialogo?.tipo === "pessoas" && <AcessoPessoas paginaId={dialogo.pagina.id} aoCancelar={() => setDialogo(null)} aoSalvar={async () => { setDialogo(null); notificar("Acesso salvo."); }} />}
      </Modal>
      <Modal aberto={dialogo?.tipo === "lixeira"} titulo="Lixeira" aoFechar={() => setDialogo(null)}>
        {dialogo?.tipo === "lixeira" && <Lixeira aoMudar={recarregarTudo} />}
      </Modal>
      <Confirmar aberto={dialogo?.tipo === "excluir"} titulo="Excluir página" perigo ocupado={ocupado} textoConfirmar="Excluir página" aoFechar={() => setDialogo(null)} aoConfirmar={() => dialogo?.tipo === "excluir" && void excluir(dialogo.pagina)}
        mensagem={<>A página <strong>{dialogo?.tipo === "excluir" ? dialogo.pagina.titulo : ""}</strong> e as subpáginas dela vão para a lixeira, de onde podem ser restauradas. A ação fica registrada na auditoria.</>} />
    </div>
  );
}

function FormNome({ pagina, aoSalvar, aoCancelar }: { pagina: Meta; aoSalvar: (t: string) => Promise<void>; aoCancelar: () => void }) {
  const [t, setT] = useState(pagina.titulo);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (t.trim().length >= 2) void aoSalvar(t.trim()); }} noValidate>
      <div className="campo"><label htmlFor="bp-nome">Nome da página</label><input id="bp-nome" value={t} maxLength={160} onChange={(e) => setT(e.target.value)} autoFocus /></div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={t.trim().length < 2}>Renomear</button>
      </div>
    </form>
  );
}

function FormIcone({ pagina, aoEscolher, aoCancelar }: { pagina: Meta; aoEscolher: (e: string | null) => Promise<void>; aoCancelar: () => void }) {
  const [livre, setLivre] = useState("");
  return (
    <div>
      <div className="emojis" role="group" aria-label="Escolha um ícone">
        {EMOJIS.map((e) => <button key={e} type="button" className={`emojis__item${pagina.icone === e ? " emojis__item--ativo" : ""}`} aria-label={`Ícone ${e}`} onClick={() => void aoEscolher(e)}>{e}</button>)}
      </div>
      <div className="campo"><label htmlFor="bp-emoji">Ou digite um emoji</label><input id="bp-emoji" value={livre} maxLength={8} onChange={(e) => setLivre(e.target.value)} /></div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--fantasma" onClick={() => void aoEscolher(null)}>Sem ícone</button>
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="button" className="botao botao--primario" disabled={!livre.trim() || /[<>&"']/.test(livre)} onClick={() => void aoEscolher(livre.trim())}>Usar</button>
      </div>
    </div>
  );
}

function FormMover({ pagina, paginas, editorGeral, aoMover, aoCancelar }: { pagina: Meta; paginas: Meta[]; editorGeral: boolean; aoMover: (pai: string | null) => Promise<void>; aoCancelar: () => void }) {
  const [pai, setPai] = useState(pagina.paiId ?? "");
  const opcoes = useMemo(() => opcoesDePai(paginas, pagina.id), [paginas, pagina.id]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); void aoMover(pai || null); }}>
      <div className="campo">
        <label htmlFor="bp-mover">Mover “{pagina.titulo}” para dentro de</label>
        <select id="bp-mover" value={pai} onChange={(e) => setPai(e.target.value)}>
          {editorGeral && <option value="">(raiz da Biblioteca)</option>}
          {opcoes.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
        </select>
        <p className="campo__ajuda">A página e as subpáginas dela vão para o fim da lista do destino. Para mudar só a ordem, arraste na árvore.</p>
      </div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario">Mover</button>
      </div>
    </form>
  );
}
