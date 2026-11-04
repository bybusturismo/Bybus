import { useState, type FormEvent } from "react";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Indicador, Indicadores } from "../../componentes/Indicador";
import { Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { formatarData, formatarNumero } from "../../util/formato";
import { ROTULO_CANAL } from "../../util/rotulos";
import { useCarregar } from "../../util/useCarregar";
import { FiltroPeriodo, ROTULO_STATUS_PEDIDO, usePeriodo } from "./comum";

interface Resumo {
  notas: { quantidade: number; media: number | null; distribuicao: Array<{ nota: number; quantidade: number }>; porGuia: Array<{ chave: string; quantidade: number; media: number | null }>; porCanal: Array<{ chave: string; quantidade: number; media: number | null }> };
  pedidos: Record<string, number>;
  tripadvisor: { reservasViator: number; passageirosViator: number; link: string | null };
}
interface Pedido { id: string; reservaId: string; status: string; texto: string; data: string; passeio: string; canal: string }
interface Config { modeloAvaliacao: string; linkTripadvisor: string | null; urlLoja: string; envioWhatsapp: { ligado: boolean; nota: string } }

const estrelas = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
const rotuloCanal = (c: string) => (ROTULO_CANAL as Record<string, string>)[c] ?? c;

function NotaForm({ pedido, aoSalvar, aoCancelar }: { pedido: Pedido; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const [nota, setNota] = useState(5);
  const [comentario, setComentario] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      await api.post("/api/marketing/avaliacoes/notas", { reservaId: pedido.reservaId, nota, comentario: comentario.trim() || null });
      await aoSalvar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p className="texto-fraco">{pedido.passeio} em {formatarData(pedido.data)} ({rotuloCanal(pedido.canal)})</p>
      <div className="campo"><label htmlFor="nt-nota">Nota</label>
        <select id="nt-nota" value={nota} onChange={(e) => setNota(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} — {estrelas(n)}</option>)}</select>
      </div>
      <div className="campo"><label htmlFor="nt-com">Comentário (opcional, sem dados pessoais)</label><textarea id="nt-com" rows={3} maxLength={500} value={comentario} onChange={(e) => setComentario(e.target.value)} /></div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : "Registrar nota"}</button>
      </div>
    </form>
  );
}

function ModeloForm({ config, aoSalvar }: { config: Config; aoSalvar: () => Promise<void> }) {
  const notificar = useNotificar();
  const [modelo, setModelo] = useState(config.modeloAvaliacao);
  const [link, setLink] = useState(config.linkTripadvisor ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (link.trim() && !/^https:\/\//i.test(link.trim())) return setErro("O link do Tripadvisor deve começar com https://");
    setSalvando(true);
    try {
      await api.patch("/api/marketing/config", { modeloAvaliacao: modelo.trim(), linkTripadvisor: link.trim() || null });
      notificar("Modelo salvo.");
      await aoSalvar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="campo"><label htmlFor="md-link">Link da página no Tripadvisor (a confirmar com o dono)</label><input id="md-link" type="url" value={link} maxLength={500} placeholder="https://" onChange={(e) => setLink(e.target.value)} /></div>
      <div className="campo">
        <label htmlFor="md-texto">Mensagem pós-passeio</label>
        <textarea id="md-texto" rows={4} value={modelo} maxLength={1000} onChange={(e) => setModelo(e.target.value)} aria-describedby="md-ajuda" />
        <p id="md-ajuda" className="campo__ajuda">Variáveis: {"{nome}"} (só o primeiro nome), {"{passeio}"}, {"{data}"} e {"{linkTripadvisor}"}.</p>
      </div>
      <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : "Salvar modelo"}</button>
    </form>
  );
}

export function Avaliacoes() {
  const { praca, pode } = useSessao();
  const notificar = useNotificar();
  const podeGerenciar = pode("marketing:gerenciar");
  const [periodo, setPeriodo] = usePeriodo(30);
  const consulta = qs({ de: periodo.de, ate: periodo.ate, unidadeId: praca });
  const resumo = useCarregar((s) => api.get<Resumo>(`/api/marketing/avaliacoes/resumo${consulta}`, s), [consulta]);
  const pedidos = useCarregar((s) => api.get<Pedido[]>(`/api/marketing/avaliacoes/pedidos${consulta}`, s), [consulta]);
  const config = useCarregar((s) => api.get<Config>("/api/marketing/config", s), []);
  const [notaDe, setNotaDe] = useState<Pedido | null>(null);
  const [gerando, setGerando] = useState(false);

  async function recarregarTudo() {
    await Promise.all([resumo.recarregar(), pedidos.recarregar()]);
  }
  async function gerar() {
    setGerando(true);
    try {
      const r = await api.post<{ criados: number }>("/api/marketing/avaliacoes/pedidos/gerar", { de: periodo.de, ate: periodo.ate, unidadeId: praca || undefined });
      notificar(r.criados ? `${r.criados} pedido(s) criado(s). Nada foi enviado.` : "Nenhum pedido novo no período.");
      await recarregarTudo();
    } catch (x) {
      notificar(mensagemDeErro(x), "erro");
    } finally {
      setGerando(false);
    }
  }
  async function marcar(p: Pedido, status: string) {
    try {
      await api.patch(`/api/marketing/avaliacoes/pedidos/${p.id}`, { status });
      await recarregarTudo();
    } catch (x) {
      notificar(mensagemDeErro(x), "erro");
    }
  }
  async function copiar(p: Pedido) {
    try {
      await navigator.clipboard.writeText(p.texto);
      notificar("Mensagem copiada.");
    } catch {
      notificar("Não foi possível copiar. Selecione o texto e copie à mão.", "erro");
    }
  }

  const r = resumo.dados;
  const ta = r?.tripadvisor;

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Avaliações</h1>
          <p className="pagina__descricao">Pedidos de avaliação depois do passeio e notas internas (a coluna “Pesquisa” da lista em papel). O Tripadvisor é o destaque.</p>
        </div>
        {podeGerenciar && <button type="button" className="botao botao--primario" disabled={gerando} onClick={() => void gerar()}>{gerando ? "Gerando…" : "Gerar pedidos do período"}</button>}
      </div>
      <FiltroPeriodo periodo={periodo} aoMudar={setPeriodo} />
      {config.dados && !config.dados.envioWhatsapp.ligado && <Aviso tipo="info">{config.dados.envioWhatsapp.nota}</Aviso>}
      {resumo.carregando && !r ? <Carregando /> : resumo.erro ? <ErroCarga mensagem={resumo.erro} tentarDeNovo={resumo.recarregar} /> : r && ta ? (
        <>
          <Indicadores rotulo="Resumo das avaliações">
            <Indicador tinta="ambar" icone="estrela" rotulo="Nota média interna" valor={r.notas.media == null ? "—" : r.notas.media.toLocaleString("pt-BR")} detalhe={`${formatarNumero(r.notas.quantidade)} nota(s)`} />
            <Indicador tinta="azul" icone="mensagem" rotulo="Pedidos a enviar" valor={formatarNumero(r.pedidos.PENDENTE ?? 0)} detalhe={`${formatarNumero(r.pedidos.ENVIADA_MANUAL ?? 0)} enviada(s) à mão`} />
            <Indicador tinta="verde" icone="pessoas" rotulo="Passageiros Viator (Tripadvisor)" valor={formatarNumero(ta.passageirosViator)} detalhe={`${formatarNumero(ta.reservasViator)} reserva(s)`} />
          </Indicadores>
          <div className="secao-cartoes">
            <section className="cartao destaque-tripadvisor" aria-labelledby="t-ta">
              <h2 id="t-ta">Destaque: Tripadvisor</h2>
              <p>Quem comprou pela Viator vê o passeio no Tripadvisor: peça a avaliação lá, com o link abaixo, antes de qualquer outra rede.</p>
              {ta.link ? <p><a href={ta.link} target="_blank" rel="noopener noreferrer">Abrir a página no Tripadvisor</a></p> : <Aviso tipo="atencao">Link do Tripadvisor ainda não cadastrado (a confirmar com o dono). {podeGerenciar ? "Preencha em “Modelo da mensagem”, abaixo." : ""}</Aviso>}
            </section>
            <section className="cartao" aria-labelledby="t-notas">
              <h2 id="t-notas">Notas internas</h2>
              {r.notas.quantidade === 0 ? <p className="texto-fraco">Nenhuma nota registrada no período.</p> : (
                <>
                  <ul className="lista-simples">{r.notas.distribuicao.slice().reverse().map((d) => <li key={d.nota}><span className="estrelas" aria-hidden="true">{estrelas(d.nota)}</span> <span className="visualmente-oculto">{d.nota} estrelas</span> {d.quantidade}</li>)}</ul>
                  {r.notas.porGuia.length > 0 && <p className="texto-fraco">Por guia: {r.notas.porGuia.map((g) => `${g.chave} ${g.media?.toLocaleString("pt-BR")} (${g.quantidade})`).join(" · ")}</p>}
                  {r.notas.porCanal.length > 0 && <p className="texto-fraco">Por canal: {r.notas.porCanal.map((g) => `${rotuloCanal(g.chave)} ${g.media?.toLocaleString("pt-BR")} (${g.quantidade})`).join(" · ")}</p>}
                </>
              )}
            </section>
          </div>
        </>
      ) : null}

      <section className="cartao" aria-labelledby="t-pedidos">
        <h2 id="t-pedidos">Pedidos de avaliação</h2>
        {pedidos.carregando && !pedidos.dados ? <Carregando /> : pedidos.erro ? <ErroCarga mensagem={pedidos.erro} tentarDeNovo={pedidos.recarregar} /> : pedidos.dados && pedidos.dados.length === 0 ? (
          <Vazio titulo="Nenhum pedido no período.">{podeGerenciar ? "Use “Gerar pedidos do período” para criar os pedidos das reservas já realizadas." : undefined}</Vazio>
        ) : pedidos.dados ? (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th>Passeio</th><th>Canal</th><th>Situação</th><th>Mensagem</th><th><span className="visualmente-oculto">Ações</span></th></tr></thead>
              <tbody>
                {pedidos.dados.map((p) => (
                  <tr key={p.id}>
                    <td className="sem-quebra">{formatarData(p.data)}<div className="texto-fraco">{p.passeio}</div></td>
                    <td>{rotuloCanal(p.canal)}{p.canal === "VIATOR" && <span className="etiqueta etiqueta--sucesso">Tripadvisor</span>}</td>
                    <td><span className={`etiqueta ${p.status === "PENDENTE" ? "etiqueta--atencao" : "etiqueta--neutra"}`}>{ROTULO_STATUS_PEDIDO[p.status] ?? p.status}</span></td>
                    <td><pre className="texto-copiavel">{p.texto}</pre></td>
                    <td className="sem-quebra">
                      <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void copiar(p)}>Copiar</button>
                      {podeGerenciar && p.status === "PENDENTE" && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void marcar(p, "ENVIADA_MANUAL")}>Marcar como enviada</button>}
                      {podeGerenciar && p.status === "PENDENTE" && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void marcar(p, "IGNORADA")}>Ignorar</button>}
                      {podeGerenciar && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setNotaDe(p)}>Registrar nota</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {podeGerenciar && config.dados && (
        <section className="cartao" aria-labelledby="t-modelo">
          <h2 id="t-modelo">Modelo da mensagem</h2>
          <ModeloForm key={config.dados.modeloAvaliacao + (config.dados.linkTripadvisor ?? "")} config={config.dados} aoSalvar={config.recarregar} />
        </section>
      )}

      <Modal aberto={!!notaDe} titulo="Registrar nota interna" aoFechar={() => setNotaDe(null)}>
        {notaDe && <NotaForm pedido={notaDe} aoCancelar={() => setNotaDe(null)} aoSalvar={async () => { setNotaDe(null); notificar("Nota registrada."); await recarregarTudo(); }} />}
      </Modal>
    </div>
  );
}
