import { useEffect, useRef, useState } from "react";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { useNotificar } from "../../componentes/Notificacoes";
import { formatarDataHora } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";

export interface ComentarioIg {
  id: string; autor: string | null; texto: string | null; escritoEm: string; ehResposta: boolean; oculto: boolean; lido: boolean;
  respostaTexto: string | null; respostaStatus: "ENVIADA" | "SIMULADA" | "FALHA" | null; respostaEm: string | null;
  post: { legenda: string | null; link: string | null } | null;
}
interface ListaComentarios { modo: { conectado: boolean; simulado: boolean }; naoLidos: number; comentarios: ComentarioIg[] }

function Item({ c, podeResponder, aoMudar }: { c: ComentarioIg; podeResponder: boolean; aoMudar: () => Promise<void> }) {
  const notificar = useNotificar();
  const [respondendo, setRespondendo] = useState(false);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const marcou = useRef(false);
  useEffect(() => {
    if (c.lido || marcou.current) return;
    marcou.current = true;
    void api.post(`/api/instagram/comentarios/${c.id}/lido`).catch(() => {});
  }, [c.id, c.lido]);

  async function enviar() {
    if (!texto.trim() || ocupado) return;
    setOcupado(true);
    try {
      const r = await api.post<{ status: string; erro: string | null }>(`/api/instagram/comentarios/${c.id}/responder`, { texto: texto.trim() });
      notificar(r.status === "FALHA" ? "O Instagram não aceitou a resposta. Tente de novo em instantes." : r.status === "SIMULADA" ? "Resposta registrada (modo simulado: nada foi ao Instagram)." : "Resposta publicada.", r.status === "FALHA" ? "erro" : undefined);
      setRespondendo(false);
      setTexto("");
      await aoMudar();
    } catch (x) { notificar(mensagemDeErro(x), "erro"); } finally { setOcupado(false); }
  }
  async function ocultar() {
    try { await api.post(`/api/instagram/comentarios/${c.id}/ocultar`, { oculto: !c.oculto }); notificar(c.oculto ? "Comentário visível de novo." : "Comentário ocultado."); await aoMudar(); }
    catch (x) { notificar(mensagemDeErro(x), "erro"); }
  }
  return (
    <li className={`ig-comentario${c.oculto ? " ig-comentario--oculto" : ""}`}>
      <div className="ig-comentario__topo">
        <strong>@{c.autor ?? "desconhecido"}</strong>
        <span className="texto-fraco">{formatarDataHora(c.escritoEm)}</span>
        {c.ehResposta && <span className="etiqueta etiqueta--neutra">resposta</span>}
        {c.oculto && <span className="etiqueta etiqueta--atencao">oculto</span>}
      </div>
      <p className="ig-comentario__texto">{c.texto ?? "(sem texto)"}</p>
      {c.post && <p className="texto-fraco ig-comentario__post">No post: {c.post.link ? <a href={c.post.link} target="_blank" rel="noopener noreferrer">{c.post.legenda ?? "ver publicação"}</a> : (c.post.legenda ?? "post da conta")}</p>}
      {c.respostaTexto && <p className="ig-comentario__resposta"><strong>Nossa resposta{c.respostaStatus === "SIMULADA" ? " (simulada)" : c.respostaStatus === "FALHA" ? " (falhou)" : ""}:</strong> {c.respostaTexto}</p>}
      {podeResponder && (
        <div className="ig-comentario__acoes">
          {!c.respostaTexto && !c.ehResposta && !respondendo && <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setRespondendo(true)}>Responder</button>}
          <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void ocultar()}>{c.oculto ? "Mostrar de novo" : "Ocultar"}</button>
        </div>
      )}
      {respondendo && (
        <form className="ig-comentario__form" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
          <label htmlFor={`ig-r-${c.id}`} className="visualmente-oculto">Resposta pública</label>
          <textarea id={`ig-r-${c.id}`} rows={2} maxLength={2200} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Resposta pública ao comentário" />
          <button type="submit" className="botao botao--primario botao--pequeno" disabled={ocupado || !texto.trim()}>Publicar resposta</button>
          <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setRespondendo(false)}>Cancelar</button>
        </form>
      )}
    </li>
  );
}

/** Comentários dos posts do Instagram: responder em público ou ocultar. A resposta é pública (aparece para todos). */
export function ComentariosInstagram({ podeResponder }: { podeResponder: boolean }) {
  const [situacao, setSituacao] = useState<"pendentes" | "todos">("pendentes");
  const lista = useCarregar((s) => api.get<ListaComentarios>(`/api/instagram/comentarios${qs({ situacao })}`, s), [situacao]);
  const l = lista.dados;
  return (
    <section className="ig-comentarios" aria-label="Comentários do Instagram">
      {l && !l.modo.conectado && <Aviso tipo="info" titulo="Instagram não conectado">Os comentários dos posts aparecem aqui depois que a conta for conectada.</Aviso>}
      {l?.modo.conectado && l.modo.simulado && <Aviso tipo="atencao" titulo="Instagram em modo simulado">Respostas e ocultações ficam só registradas aqui.</Aviso>}
      <div className="filtros" role="group" aria-label="Situação">
        <div className="campo campo--linha"><label htmlFor="ig-situacao">Mostrar</label><select id="ig-situacao" value={situacao} onChange={(e) => setSituacao(e.target.value as "pendentes" | "todos")}><option value="pendentes">Sem resposta</option><option value="todos">Todos</option></select></div>
      </div>
      {lista.carregando && !l ? <Carregando /> : lista.erro && !l ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : l && l.comentarios.length === 0 ? (
        <Vazio titulo={situacao === "pendentes" ? "Nenhum comentário esperando resposta." : "Nenhum comentário ainda."} />
      ) : (
        <ul className="ig-comentarios__lista">{l?.comentarios.map((c) => <Item key={c.id} c={c} podeResponder={podeResponder} aoMudar={lista.recarregar} />)}</ul>
      )}
    </section>
  );
}
