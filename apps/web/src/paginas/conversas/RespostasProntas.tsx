import { useMemo, useState, type FormEvent } from "react";
import { IDIOMAS_RESPOSTA, VARIAVEIS_RESPOSTA, type IdiomaResposta } from "@bybus/core";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Confirmar, Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { useCarregar } from "../../util/useCarregar";

export interface Resposta { id: string; atalho: string; titulo: string; idioma: IdiomaResposta; texto: string; revisada: boolean }
const ROTULO_IDIOMA: Record<IdiomaResposta, string> = { PT: "Português", EN: "English", ES: "Español" };

export function useRespostasProntas() {
  return useCarregar((s) => api.get<Resposta[]>("/api/whatsapp/respostas-rapidas", s), []);
}

/** Respostas que combinam com o que foi digitado depois da "/" (atalho ou título), atalho exato primeiro. */
export function filtrarRespostas(respostas: Resposta[], consulta: string, idioma: IdiomaResposta | "" = ""): Resposta[] {
  const q = consulta.replace(/^\/+/, "").trim().toLowerCase();
  return respostas
    .filter((r) => (!idioma || r.idioma === idioma) && (!q || r.atalho.startsWith(q) || r.titulo.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.atalho === q) - Number(a.atalho === q) || a.atalho.localeCompare(b.atalho) || a.idioma.localeCompare(b.idioma));
}

/** Lista que abre quando a mensagem começa com "/": escolha o idioma e clique na resposta (ou Enter para a primeira). */
export function SugestoesRespostas({ respostas, consulta, aoEscolher }: { respostas: Resposta[]; consulta: string; aoEscolher: (r: Resposta) => void }) {
  const [idioma, setIdioma] = useState<IdiomaResposta | "">("");
  const itens = filtrarRespostas(respostas, consulta, idioma).slice(0, 8);
  return (
    <div className="wa-sugestoes" role="region" aria-label="Respostas prontas">
      <div className="wa-sugestoes__idiomas" role="group" aria-label="Idioma da resposta">
        {(["", ...IDIOMAS_RESPOSTA] as const).map((i) => (
          <button key={i || "todos"} type="button" className={`wa-filtro${idioma === i ? " wa-filtro--ativo" : ""}`} aria-pressed={idioma === i} onClick={() => setIdioma(i)}>{i || "Todos"}</button>
        ))}
      </div>
      {itens.length === 0 ? <p className="texto-fraco wa-sugestoes__vazio">Nenhuma resposta pronta com esse atalho.</p> : (
        <ul role="listbox" aria-label="Respostas encontradas">
          {itens.map((r) => (
            <li key={r.id} role="option" aria-selected="false">
              <button type="button" className="wa-sugestao" onClick={() => aoEscolher(r)}>
                <span className="wa-sugestao__topo"><strong>/{r.atalho}</strong> <span>{r.titulo}</span> <span className="etiqueta etiqueta--neutra">{r.idioma}</span>{!r.revisada && <span className="etiqueta etiqueta--atencao">a revisar</span>}</span>
                <span className="wa-sugestao__texto">{r.texto}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Formulario({ resposta, aoSalvar, aoCancelar }: { resposta: Resposta | null; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const [atalho, setAtalho] = useState(resposta?.atalho ?? "");
  const [titulo, setTitulo] = useState(resposta?.titulo ?? "");
  const [idioma, setIdioma] = useState<IdiomaResposta>(resposta?.idioma ?? "PT");
  const [texto, setTexto] = useState(resposta?.texto ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const corpo = { atalho: atalho.trim(), titulo: titulo.trim(), idioma, texto: texto.trim() };
      if (resposta) await api.patch(`/api/whatsapp/respostas-rapidas/${resposta.id}`, corpo);
      else await api.post("/api/whatsapp/respostas-rapidas", corpo);
      await aoSalvar();
    } catch (x) { setErro(mensagemDeErro(x)); } finally { setSalvando(false); }
  }
  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade-campos">
        <div className="campo"><label htmlFor="rp-atalho">Atalho (digite / e o atalho)</label><input id="rp-atalho" value={atalho} maxLength={40} onChange={(e) => setAtalho(e.target.value)} placeholder="ponto" /></div>
        <div className="campo"><label htmlFor="rp-idioma">Idioma</label><select id="rp-idioma" value={idioma} onChange={(e) => setIdioma(e.target.value as IdiomaResposta)}>{IDIOMAS_RESPOSTA.map((i) => <option key={i} value={i}>{ROTULO_IDIOMA[i]}</option>)}</select></div>
        <div className="campo campo--largo"><label htmlFor="rp-titulo">Título</label><input id="rp-titulo" value={titulo} maxLength={80} onChange={(e) => setTitulo(e.target.value)} /></div>
        <div className="campo campo--largo">
          <label htmlFor="rp-texto">Texto</label>
          <textarea id="rp-texto" rows={5} maxLength={2000} value={texto} onChange={(e) => setTexto(e.target.value)} />
          <p className="campo__ajuda">Variáveis: {VARIAVEIS_RESPOSTA.map((v) => `{${v}}`).join(" ")}. São preenchidas com a reserva do cliente; o que não houver fica para você completar.</p>
        </div>
      </div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
      </div>
    </form>
  );
}

/** Biblioteca de respostas prontas: criar, editar, excluir, marcar como revisada e carregar as sugestões iniciais. */
export function BibliotecaRespostas({ aoFechar, aoMudar }: { aoFechar: () => void; aoMudar: () => void }) {
  const notificar = useNotificar();
  const lista = useCarregar((s) => api.get<Resposta[]>("/api/whatsapp/respostas-rapidas", s), []);
  const [idioma, setIdioma] = useState<IdiomaResposta | "">("");
  const [form, setForm] = useState<{ resposta: Resposta | null } | null>(null);
  const [excluir, setExcluir] = useState<Resposta | null>(null);
  const itens = useMemo(() => (lista.dados ?? []).filter((r) => !idioma || r.idioma === idioma), [lista.dados, idioma]);
  const aRevisar = (lista.dados ?? []).filter((r) => !r.revisada).length;

  async function recarregar() { await lista.recarregar(); aoMudar(); }
  async function executar(fn: () => Promise<unknown>, ok?: string) {
    try { await fn(); if (ok) notificar(ok); await recarregar(); } catch (x) { notificar(mensagemDeErro(x), "erro"); }
  }
  return (
    <Modal aberto titulo="Respostas prontas" aoFechar={aoFechar} largura="larga">
      <p className="texto-fraco">Na caixa de resposta, digite <strong>/</strong> e o atalho para usar. Vale para WhatsApp e Instagram.</p>
      {aRevisar > 0 && <Aviso tipo="atencao" titulo={`${aRevisar} resposta(s) a revisar`}>As sugestões iniciais são só um ponto de partida: confira cada texto (preços, regras de chuva, criança e cancelamento são decisões da empresa) e marque como revisada.</Aviso>}
      <div className="barra-acoes">
        <select aria-label="Idioma" value={idioma} onChange={(e) => setIdioma(e.target.value as IdiomaResposta | "")}><option value="">Todos os idiomas</option>{IDIOMAS_RESPOSTA.map((i) => <option key={i} value={i}>{ROTULO_IDIOMA[i]}</option>)}</select>
        <button type="button" className="botao botao--secundario" onClick={() => void executar(async () => { const r = await api.post<{ criadas: number }>("/api/whatsapp/respostas-rapidas/sugestoes"); notificar(r.criadas ? `${r.criadas} sugestões carregadas. Revise os textos.` : "As sugestões iniciais já estão carregadas."); })}>Carregar sugestões iniciais</button>
        <button type="button" className="botao botao--primario" onClick={() => setForm({ resposta: null })}>Nova resposta</button>
      </div>
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : itens.length === 0 ? (
        <Vazio titulo="Nenhuma resposta pronta ainda.">Use “Carregar sugestões iniciais” para começar com as perguntas de todo dia (ponto, horário, chuva, criança, cancelamento e voucher).</Vazio>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela tabela--compacta">
            <thead><tr><th>Atalho</th><th>Idioma</th><th>Texto</th><th><span className="visualmente-oculto">Ações</span></th></tr></thead>
            <tbody>
              {itens.map((r) => (
                <tr key={r.id}>
                  <td className="sem-quebra">/{r.atalho}{!r.revisada && <> <span className="etiqueta etiqueta--atencao">a revisar</span></>}</td>
                  <td>{r.idioma}</td>
                  <td><strong>{r.titulo}</strong><br /><span className="texto-fraco">{r.texto}</span></td>
                  <td className="sem-quebra">
                    {!r.revisada && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void executar(() => api.patch(`/api/whatsapp/respostas-rapidas/${r.id}`, { revisada: true }))}>Marcar revisada</button>}
                    <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setForm({ resposta: r })}>Editar</button>
                    <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setExcluir(r)}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal aberto={!!form} titulo={form?.resposta ? "Editar resposta" : "Nova resposta"} aoFechar={() => setForm(null)}>
        {form && <Formulario resposta={form.resposta} aoCancelar={() => setForm(null)} aoSalvar={async () => { setForm(null); notificar("Resposta salva."); await recarregar(); }} />}
      </Modal>
      <Confirmar aberto={!!excluir} titulo="Excluir resposta" perigo textoConfirmar="Excluir" aoFechar={() => setExcluir(null)} aoConfirmar={() => { const r = excluir; setExcluir(null); if (r) void executar(() => api.delete(`/api/whatsapp/respostas-rapidas/${r.id}`), "Resposta excluída."); }} mensagem={<>Excluir a resposta <strong>/{excluir?.atalho}</strong> ({excluir?.idioma})?</>} />
    </Modal>
  );
}
