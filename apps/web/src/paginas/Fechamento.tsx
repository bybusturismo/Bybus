import { useState } from "react";
import { useSessao } from "../sessao/Sessao";
import { Link } from "react-router-dom";
import { api, mensagemDeErro, qs } from "../api/cliente";
import type { MensagemFila, SituacaoFechamento } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Modal } from "../componentes/Modal";
import { useNotificar } from "../componentes/Notificacoes";
import { formatarDataCurta, formatarDataHora, hojeIso, somarDias } from "../util/formato";
import { useCarregar } from "../util/useCarregar";

const ROTULO_STATUS: Record<string, string> = { ENVIADA: "Enviadas", SIMULADA: "Simuladas", PENDENTE: "Na fila", SEM_TELEFONE: "Sem telefone", FALHA: "Falharam" };
const ROTULO_TIPO = (t: string) => (t.startsWith("LISTA_GRUPO") ? "Lista no grupo" : ({ CONFIRMACAO: "Confirmação da véspera", VOUCHER: "Voucher", RASTREIO: "Rastreamento" } as Record<string, string>)[t] ?? t);

function TextoLista({ titulo, texto, aoFechar }: { titulo: string; texto: string; aoFechar: () => void }) {
  const notificar = useNotificar();
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      notificar("Texto copiado. Cole no grupo do WhatsApp.");
    } catch {
      notificar("Não consegui copiar: selecione o texto e copie.");
    }
  }
  return (
    <Modal aberto titulo={titulo} aoFechar={aoFechar} largura="larga">
      <p className="texto-fraco">Em ordem de embarque. Sem documentos nem telefones (LGPD).</p>
      <textarea className="fechamento__texto" readOnly value={texto} rows={18} aria-label="Texto da lista" />
      <div className="modal__acoes">
        <a className="botao botao--secundario" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">Abrir no WhatsApp</a>
        <button type="button" className="botao botao--primario" onClick={() => void copiar()}>Copiar texto</button>
      </div>
    </Modal>
  );
}

function Mensagens({ saidaId, aoFechar }: { saidaId: string; aoFechar: () => void }) {
  const lista = useCarregar((s) => api.get<MensagemFila[]>(`/api/mensagens${qs({ saidaId })}`, s), [saidaId]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  async function reenviar(id: string) {
    if (enviando) return;
    setEnviando(id);
    try {
      await api.post(`/api/mensagens/${id}/reenviar`);
      await lista.recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(null);
    }
  }
  return (
    <Modal aberto titulo="Mensagens desta saída" aoFechar={aoFechar} largura="larga">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} /> : lista.dados?.length === 0 ? <Vazio titulo="Nenhuma mensagem ainda." /> : (
        <div className="tabela-rolagem">
          <table className="tabela tabela--compacta">
            <thead><tr><th>Tipo</th><th>Para</th><th>Situação</th><th>Quando</th><th /></tr></thead>
            <tbody>
              {lista.dados?.map((m) => (
                <tr key={m.id}>
                  <td>{ROTULO_TIPO(m.tipo)}</td>
                  <td>{m.titular ?? "—"}<span className="texto-fraco"> {m.destino ?? ""}</span></td>
                  <td><span className={`etiqueta ${m.status === "ENVIADA" ? "etiqueta--sucesso" : m.status === "FALHA" || m.status === "SEM_TELEFONE" ? "etiqueta--perigo" : "etiqueta--neutra"}`}>{ROTULO_STATUS[m.status] ?? m.status}</span>{m.erro ? <span className="texto-fraco"> {m.erro}</span> : null}</td>
                  <td className="sem-quebra">{formatarDataHora(m.enviadaEm ?? m.criadoEm)}</td>
                  <td>{(m.status === "FALHA" || m.status === "SIMULADA") && <button type="button" className="botao botao--fantasma botao--pequeno" disabled={!!enviando} onClick={() => void reenviar(m.id)}>{enviando === m.id ? "Enviando…" : "Reenviar"}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** Prévia da lista (mesmo texto que vai para o grupo, em ordem de embarque). */
function PreviaLista({ saidaId }: { saidaId: string }) {
  const r = useCarregar((s) => api.get<{ texto: string }>(`/api/saidas/${saidaId}/texto-lista`, s), [saidaId]);
  if (r.carregando && !r.dados) return <Carregando />;
  if (r.erro) return <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} />;
  return <pre className="listas__previa">{r.dados?.texto}</pre>;
}

/** Central das listas de passageiros (pedido do dono, 04/11: o campo principal para a automação). */
export function Fechamento() {
  const notificar = useNotificar();
  const { pode } = useSessao();
  const podeDecidir = pode("saidas:decidir");
  const [aberta, setAberta] = useState<string | null>(null);
  const [data, setData] = useState(() => somarDias(hojeIso(), 1));
  const sit = useCarregar((s) => api.get<SituacaoFechamento>(`/api/fechamento${qs({ data })}`, s), [data]);
  const [texto, setTexto] = useState<{ titulo: string; texto: string } | null>(null);
  const [mensagensDe, setMensagensDe] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<{ saidaId: string; passeio: string; adendo: boolean; titulares: number } | null>(null);

  async function fechar(saidaId: string, passeio: string) {
    setConfirmar(null);
    setOcupado(saidaId);
    setErro(null);
    try {
      const r = await api.post<{ versao: number; texto: string }>(`/api/saidas/${saidaId}/fechar`);
      notificar(r.versao > 1 ? `Adendo ${r.versao - 1} gerado.` : "Lista fechada.");
      setTexto({ titulo: `${passeio} — lista ${r.versao > 1 ? `(adendo ${r.versao - 1})` : "fechada"}`, texto: r.texto });
      await sit.recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(null);
    }
  }
  async function verTexto(saidaId: string, passeio: string) {
    try {
      const r = await api.get<{ texto: string }>(`/api/saidas/${saidaId}/texto-lista`);
      setTexto({ titulo: `${passeio} — prévia da lista`, texto: r.texto });
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  const s = sit.dados;
  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Listas de passageiros</h1>
          <p className="pagina__descricao">
            A lista da véspera fecha {s?.automatico ? `sozinha às ${s.horaFechamento}` : "pelo botão (fechamento automático desligado)"}, em ordem de embarque, e cada titular recebe a confirmação. Venda depois disso gera um adendo.
          </p>
        </div>
        <div className="campo campo--linha"><label htmlFor="fech-data">Data do passeio</label><input id="fech-data" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
      </div>
      {s && (
        <section className="cartao listas__automacao" aria-label="Automação da lista">
          <h2>Automação</h2>
          <ul>
            <li><strong>Fechamento:</strong> {s.automatico ? `automático às ${s.horaFechamento} da véspera` : "manual (automático desligado)"}</li>
            <li><strong>Grupo do WhatsApp:</strong> {s.whatsapp.grupoConfigurado ? "a lista vai sozinha para o grupo" : "não configurado — use “Copiar texto”"}</li>
            <li><strong>Confirmação para cada titular:</strong> enviada ao fechar</li>
            <li><strong>WhatsApp:</strong> {s.whatsapp.envioReal ? "envio real ligado" : <span className="texto-atencao">modo simulado — nada sai de verdade até contratar o provedor</span>}</li>
            <li><strong>Listas desta data:</strong> {s.saidas.filter((x) => x.listaFechadaEm).length} fechada(s) de {s.saidas.length}</li>
          </ul>
        </section>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sit.carregando && !s ? <Carregando /> : sit.erro ? <ErroCarga mensagem={sit.erro} tentarDeNovo={sit.recarregar} /> : s?.saidas.length === 0 ? (
        <Vazio titulo={`Nenhuma saída em ${formatarDataCurta(data)}.`} />
      ) : (
        <ul className="lista-fechamento">
          {s?.saidas.map((x) => {
            const fechada = !!x.listaFechadaEm;
            return (
              <li key={x.saidaId} className={`cartao fechamento${fechada ? " fechamento--fechada" : ""}`}>
                <div className="fechamento__topo">
                  <div>
                    <h2><Link to={`/saidas/${x.saidaId}`}>{x.passeio}</Link></h2>
                    <p className="texto-fraco">Guia: {x.guia ?? "a definir"} · Motorista: {x.motorista ?? "a definir"}{x.veiculo ? ` · ${x.veiculo}` : ""}</p>
                  </div>
                  <span className={`etiqueta ${fechada ? "etiqueta--sucesso" : "etiqueta--atencao"}`}>
                    {fechada ? `Fechada${x.versao > 1 ? ` · adendo ${x.versao - 1}` : ""} · ${formatarDataHora(x.listaFechadaEm)}` : "Aberta"}
                  </span>
                </div>
                <div className="fechamento__numeros">
                  <span><strong>{x.reservas}</strong> reservas</span>
                  <span className={x.naoConferidas ? "texto-atencao" : ""}><strong>{x.naoConferidas}</strong> a conferir</span>
                  <span className={x.semPonto ? "texto-perigo" : ""}><strong>{x.semPonto}</strong> sem ponto</span>
                  {fechada && x.depoisDoFechamento > 0 && <span className="texto-atencao"><strong>{x.depoisDoFechamento}</strong> depois do fechamento</span>}
                  {Object.entries(x.mensagens).map(([k, n]) => <span key={k}>{n} {ROTULO_STATUS[k]?.toLowerCase() ?? k}</span>)}
                </div>
                <div className="barra-acoes">
                  <button type="button" className="botao botao--secundario botao--pequeno" aria-expanded={aberta === x.saidaId} onClick={() => setAberta((a) => (a === x.saidaId ? null : x.saidaId))}>
                    {aberta === x.saidaId ? "Esconder lista" : "Ver lista"}
                  </button>
                  <Link className="botao botao--secundario botao--pequeno" to={`/saidas/${x.saidaId}`}>Abrir / imprimir</Link>
                  <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void verTexto(x.saidaId, x.passeio)}>Texto para o WhatsApp</button>
                  {x.naoConferidas > 0 && <Link className="botao botao--secundario botao--pequeno" to="/conferencia">Conferir pendências</Link>}
                  {podeDecidir && (!fechada || x.depoisDoFechamento > 0) && (
                    <button type="button" className="botao botao--primario botao--pequeno" disabled={ocupado === x.saidaId}
                      onClick={() => setConfirmar({ saidaId: x.saidaId, passeio: x.passeio, adendo: fechada, titulares: fechada ? x.depoisDoFechamento : x.reservas })}>
                      {fechada ? "Gerar adendo" : "Fechar lista agora"}
                    </button>
                  )}
                  {podeDecidir && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setMensagensDe(x.saidaId)}>Mensagens</button>}
                </div>
                {aberta === x.saidaId && <PreviaLista saidaId={x.saidaId} />}
              </li>
            );
          })}
        </ul>
      )}
      {confirmar && (
        <Modal aberto titulo={confirmar.adendo ? "Gerar adendo da lista?" : "Fechar a lista agora?"} aoFechar={() => setConfirmar(null)}>
          <p>
            {confirmar.passeio}: {confirmar.adendo ? `${confirmar.titulares} reserva(s) nova(s) ou alterada(s) entram no adendo` : "a lista fecha em ordem de embarque"}
            {s?.whatsapp.envioReal ? " e a confirmação sai pelo WhatsApp para quem ainda não recebeu." : " (WhatsApp em modo simulado: nada é enviado)."}
          </p>
          <div className="modal__acoes">
            <button type="button" className="botao botao--secundario" onClick={() => setConfirmar(null)}>Cancelar</button>
            <button type="button" className="botao botao--primario" onClick={() => void fechar(confirmar.saidaId, confirmar.passeio)}>{confirmar.adendo ? "Gerar adendo" : "Fechar lista"}</button>
          </div>
        </Modal>
      )}
      {texto && <TextoLista titulo={texto.titulo} texto={texto.texto} aoFechar={() => setTexto(null)} />}
      {mensagensDe && <Mensagens saidaId={mensagensDe} aoFechar={() => setMensagensDe(null)} />}
    </div>
  );
}
