import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { montarArvore, type NoArvore } from "@bybus/core";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { Confirmar } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { formatarDataHora } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { Markdown } from "./Markdown";

type Acesso = "EQUIPE" | "RESTRITO";
interface Meta { id: string; paiId: string | null; titulo: string; acesso: Acesso; acessoEfetivo: Acesso; ordem: number; atualizadoEm: string }
interface Lista { podeEditar: boolean; paginas: Meta[] }
interface Pagina {
  id: string; paiId: string | null; titulo: string; conteudo: string; acesso: Acesso; ordem: number; acessoEfetivo: Acesso; atualizadoEm: string; podeEditar: boolean;
  caminho: Array<{ id: string; titulo: string }>; subpaginas: Array<{ id: string; titulo: string }>;
}
interface Achado { id: string; titulo: string; noTitulo: boolean; trecho: string; caminho: string[] }

function Arvore({ nos, ativo }: { nos: NoArvore<Meta>[]; ativo?: string }) {
  return (
    <ul className="arvore">
      {nos.map((n) => (
        <li key={n.pagina.id}>
          <Link to={`/biblioteca/${n.pagina.id}`} className={`arvore__item${n.pagina.id === ativo ? " arvore__item--ativo" : ""}`} aria-current={n.pagina.id === ativo ? "page" : undefined}>
            <span>{n.pagina.titulo}</span>
            {n.pagina.acessoEfetivo === "RESTRITO" && <span className="etiqueta etiqueta--atencao" title="Só quem edita a Biblioteca vê esta página">restrita</span>}
          </Link>
          {n.filhos.length > 0 && <Arvore nos={n.filhos} ativo={ativo} />}
        </li>
      ))}
    </ul>
  );
}

/** Páginas que podem ser pai: nunca a própria página nem as que estão dentro dela. */
function opcoesDePai(paginas: Meta[], idAtual: string | null): Array<{ id: string; rotulo: string }> {
  const proibidos = new Set<string>();
  if (idAtual) {
    proibidos.add(idAtual);
    let achou = true;
    while (achou) {
      achou = false;
      for (const p of paginas) if (p.paiId && proibidos.has(p.paiId) && !proibidos.has(p.id)) { proibidos.add(p.id); achou = true; }
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

function Editor({ pagina, paiInicial, paginas, aoSalvar, aoCancelar }: { pagina: Pagina | null; paiInicial: string | null; paginas: Meta[]; aoSalvar: (id: string) => Promise<void>; aoCancelar: () => void }) {
  const [titulo, setTitulo] = useState(pagina?.titulo ?? "");
  const [conteudo, setConteudo] = useState(pagina?.conteudo ?? "");
  const [acesso, setAcesso] = useState<Acesso>(pagina?.acesso ?? "EQUIPE");
  const [paiId, setPaiId] = useState(pagina ? (pagina.paiId ?? "") : (paiInicial ?? ""));
  const [ordem, setOrdem] = useState(String(pagina?.ordem ?? 0));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const opcoes = useMemo(() => opcoesDePai(paginas, pagina?.id ?? null), [paginas, pagina?.id]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (titulo.trim().length < 2) return setErro("Dê um título à página.");
    const o = Number(ordem);
    if (!Number.isInteger(o) || o < 0) return setErro("Ordem: número inteiro, 0 ou maior.");
    setSalvando(true);
    try {
      const corpo = { titulo: titulo.trim(), conteudo, acesso, paiId: paiId || null, ordem: o };
      if (pagina) {
        await api.patch(`/api/biblioteca/paginas/${pagina.id}`, corpo);
        await aoSalvar(pagina.id);
      } else {
        const r = await api.post<{ id: string }>("/api/biblioteca/paginas", corpo);
        await aoSalvar(r.id);
      }
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} noValidate aria-label={pagina ? "Editar página" : "Nova página"}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade-campos">
        <div className="campo campo--largo"><label htmlFor="bp-titulo">Título</label><input id="bp-titulo" value={titulo} maxLength={160} onChange={(e) => setTitulo(e.target.value)} /></div>
        <div className="campo"><label htmlFor="bp-pai">Dentro de</label>
          <select id="bp-pai" value={paiId} onChange={(e) => setPaiId(e.target.value)}><option value="">(raiz da Biblioteca)</option>{opcoes.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}</select></div>
        <div className="campo"><label htmlFor="bp-acesso">Quem pode ler</label>
          <select id="bp-acesso" value={acesso} onChange={(e) => setAcesso(e.target.value as Acesso)}><option value="EQUIPE">Toda a equipe com acesso à Biblioteca</option><option value="RESTRITO">Só quem edita a Biblioteca</option></select></div>
        <div className="campo"><label htmlFor="bp-ordem">Ordem no menu</label><input id="bp-ordem" inputMode="numeric" value={ordem} onChange={(e) => setOrdem(e.target.value)} /></div>
      </div>
      {acesso === "RESTRITO" && <Aviso tipo="atencao">Páginas restritas (e todas as subpáginas delas) ficam escondidas de quem só lê, inclusive na busca.</Aviso>}
      <div className="biblioteca__editor">
        <div className="campo">
          <label htmlFor="bp-conteudo">Conteúdo (Markdown)</label>
          <textarea id="bp-conteudo" value={conteudo} maxLength={100000} onChange={(e) => setConteudo(e.target.value)} aria-describedby="bp-ajuda" />
          <p id="bp-ajuda" className="campo__ajuda"># Título, **negrito**, *itálico*, listas com “-”, tabelas com “|”, links [texto](https://…). HTML não é aceito.</p>
        </div>
        <div className="campo"><span>Pré-visualização</span><div className="cartao"><Markdown texto={conteudo} /></div></div>
      </div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : "Salvar página"}</button>
      </div>
    </form>
  );
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

type Modo = { tipo: "ler" } | { tipo: "editar" } | { tipo: "nova"; paiId: string | null };

export function Biblioteca() {
  const { id } = useParams();
  const navegar = useNavigate();
  const notificar = useNotificar();
  const lista = useCarregar((s) => api.get<Lista>("/api/biblioteca/paginas", s), []);
  const [modo, setModo] = useState<Modo>({ tipo: "ler" });
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [excluir, setExcluir] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  const paginas = lista.dados?.paginas ?? [];
  const arvore = useMemo(() => montarArvore(paginas), [paginas]);
  // Sem página escolhida, abre a primeira da árvore.
  const idAtual = id ?? arvore[0]?.pagina.id;
  const pagina = useCarregar((s) => (idAtual ? api.get<Pagina>(`/api/biblioteca/paginas/${idAtual}`, s) : Promise.resolve(null)), [idAtual]);
  const podeEditar = lista.dados?.podeEditar ?? false;
  useEffect(() => setModo({ tipo: "ler" }), [idAtual]);

  function buscar(e: FormEvent) {
    e.preventDefault();
    setTermo(busca.trim().length >= 2 ? busca.trim() : "");
  }
  async function aposSalvar(novoId: string) {
    setModo({ tipo: "ler" });
    notificar("Página salva.");
    await lista.recarregar();
    if (novoId === idAtual) await pagina.recarregar();
    else navegar(`/biblioteca/${novoId}`);
  }
  async function confirmarExclusao() {
    if (!pagina.dados) return;
    setExcluindo(true);
    try {
      await api.delete(`/api/biblioteca/paginas/${pagina.dados.id}`);
      notificar("Página excluída.");
      setExcluir(false);
      await lista.recarregar();
      navegar(pagina.dados.paiId ? `/biblioteca/${pagina.dados.paiId}` : "/biblioteca");
    } catch (x) {
      notificar(mensagemDeErro(x), "erro");
      setExcluir(false);
    } finally {
      setExcluindo(false);
    }
  }

  const p = pagina.dados;
  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Biblioteca</h1>
          <p className="pagina__descricao">Manuais e procedimentos da operação, em páginas com subpáginas.</p>
        </div>
        {podeEditar && <button type="button" className="botao botao--primario" onClick={() => setModo({ tipo: "nova", paiId: null })}><Icone nome="mais" /> Nova página</button>}
      </div>
      <div className="biblioteca">
        <aside className="biblioteca__lateral cartao" aria-label="Páginas">
          <form onSubmit={buscar} role="search" className="campo">
            <label htmlFor="bib-busca">Buscar na Biblioteca</label>
            <input id="bib-busca" type="search" value={busca} placeholder="Título ou texto" onChange={(e) => { setBusca(e.target.value); if (!e.target.value.trim()) setTermo(""); }} />
          </form>
          {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : arvore.length === 0 ? <p className="texto-fraco">Nenhuma página ainda.</p> : <nav aria-label="Árvore de páginas"><Arvore nos={arvore} ativo={idAtual} /></nav>}
        </aside>
        <section className="cartao" aria-live="polite">
          {termo ? (
            <>
              <h2>Resultados para “{termo}”</h2>
              <Resultados termo={termo} />
            </>
          ) : modo.tipo === "nova" ? (
            <Editor pagina={null} paiInicial={modo.paiId} paginas={paginas} aoSalvar={aposSalvar} aoCancelar={() => setModo({ tipo: "ler" })} />
          ) : pagina.carregando && !p ? (
            <Carregando />
          ) : pagina.erro ? (
            <ErroCarga mensagem={pagina.erro} tentarDeNovo={pagina.recarregar} />
          ) : !p ? (
            <Vazio titulo="Nenhuma página para mostrar.">{podeEditar ? "Use “Nova página” para começar." : "Peça a quem edita a Biblioteca para criar as primeiras páginas."}</Vazio>
          ) : modo.tipo === "editar" ? (
            <Editor pagina={p} paiInicial={null} paginas={paginas} aoSalvar={aposSalvar} aoCancelar={() => setModo({ tipo: "ler" })} />
          ) : (
            <article>
              {p.caminho.length > 1 && (
                <nav className="biblioteca__trilha" aria-label="Você está em">
                  {p.caminho.slice(0, -1).map((c) => <span key={c.id}><Link to={`/biblioteca/${c.id}`}>{c.titulo}</Link> › </span>)}
                </nav>
              )}
              <div className="pagina__cabecalho">
                <div>
                  <h2>{p.titulo}</h2>
                  <p className="texto-fraco">
                    Atualizada em {formatarDataHora(p.atualizadoEm)}
                    {p.acessoEfetivo === "RESTRITO" && <span className="etiqueta etiqueta--atencao">restrita</span>}
                  </p>
                </div>
                {p.podeEditar && (
                  <div className="barra-acoes">
                    <button type="button" className="botao botao--secundario" onClick={() => setModo({ tipo: "editar" })}>Editar</button>
                    <button type="button" className="botao botao--secundario" onClick={() => setModo({ tipo: "nova", paiId: p.id })}>Nova subpágina</button>
                    <button type="button" className="botao botao--fantasma" onClick={() => setExcluir(true)}>Excluir</button>
                  </div>
                )}
              </div>
              <Markdown texto={p.conteudo} />
              {p.subpaginas.length > 0 && (
                <>
                  <h3>Subpáginas</h3>
                  <ul>{p.subpaginas.map((s) => <li key={s.id}><Link to={`/biblioteca/${s.id}`}>{s.titulo}</Link></li>)}</ul>
                </>
              )}
            </article>
          )}
        </section>
      </div>
      <Confirmar aberto={excluir} titulo="Excluir página" perigo ocupado={excluindo} textoConfirmar="Excluir página" aoFechar={() => setExcluir(false)} aoConfirmar={() => void confirmarExclusao()}
        mensagem={<>A página <strong>{p?.titulo}</strong> será apagada. Se ela tiver subpáginas, mova ou exclua as subpáginas antes. A ação fica registrada na auditoria.</>} />
    </div>
  );
}
