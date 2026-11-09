import { Fragment, useState } from "react";
import { useSessao } from "../sessao/Sessao";
import { Link } from "react-router-dom";
import { api, mensagemDeErro, qs } from "../api/cliente";
import type { MensagemFila, RegrasConfirmacao, SituacaoConfirmacao, SituacaoFechamento, ViatorSemResposta } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Modal } from "../componentes/Modal";
import { CabecalhoPagina } from "../componentes/Pagina";
import { useNotificar } from "../componentes/Notificacoes";
import { formatarDataCurta, formatarDataHora, hojeIso, somarDias } from "../util/formato";
import { useCarregar } from "../util/useCarregar";

const ROTULO_STATUS: Record<string, string> = { AGRUPADA: "Juntadas (mesmo telefone)", ENVIADA: "Enviadas", SIMULADA: "Simuladas", PENDENTE: "Na fila", SEM_TELEFONE: "Sem telefone", FALHA: "Falharam" };
const ROTULO_TIPO = (t: string) => (t.startsWith("LISTA_GRUPO") ? "Lista no grupo" : t.startsWith("LISTA_GUIA") ? "Lista para a guia" : t.startsWith("LISTA_MOTORISTA") ? "Lista para o motorista" : ({ CONFIRMACAO: "Confirmação da véspera", PREVIA: "Prévia (montando a lista)", VOUCHER: "Voucher", RASTREIO: "Rastreamento" } as Record<string, string>)[t] ?? t);

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

/** Clientes da Viator/Tripadvisor sem resposta no WhatsApp: texto pronto para colar no chat da Viator (nada sai sozinho). */
function MensagensViator({ saidaId, aoFechar }: { saidaId: string; aoFechar: () => void }) {
  const notificar = useNotificar();
  const lista = useCarregar((s) => api.get<ViatorSemResposta[]>(`/api/saidas/${saidaId}/viator-sem-resposta`, s), [saidaId]);
  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      notificar("Texto copiado. Cole no chat da reserva na Viator.");
    } catch {
      notificar("Não consegui copiar: selecione o texto e copie.");
    }
  }
  return (
    <Modal aberto titulo="Viator sem resposta no WhatsApp" aoFechar={aoFechar} largura="larga">
      <p className="texto-fraco">Clientes da Viator/Tripadvisor ainda sem ponto de embarque horas depois da mensagem. Abra a reserva no painel da Viator (pela referência), cole o texto no chat e, quando o cliente responder, cadastre o hotel na reserva.</p>
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} /> : lista.dados?.length === 0 ? <Vazio titulo="Ninguém pendente." /> : lista.dados?.map((x) => (
        <section key={x.reservaId} className="cartao" aria-label={x.titular}>
          <p><strong>{x.titular}</strong> · referência {x.referencia ?? "—"} · <span className="texto-fraco">mensagem desde {formatarDataHora(x.desde)} · {x.idioma.toUpperCase()}</span></p>
          <textarea className="fechamento__texto" readOnly value={x.texto} rows={4} aria-label={`Texto para ${x.titular}`} />
          <div className="modal__acoes"><button type="button" className="botao botao--primario botao--pequeno" onClick={() => void copiar(x.texto)}>Copiar texto</button></div>
        </section>
      ))}
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

const ROTULO_DECISAO: Record<SituacaoConfirmacao["decisao"], { texto: string; classe: string }> = {
  CONFIRMADA: { texto: "Confirmada", classe: "etiqueta--sucesso" },
  CONFIRMAR: { texto: "Atingiu o corte", classe: "etiqueta--sucesso" },
  AGUARDAR: { texto: "Aguardando", classe: "etiqueta--neutra" },
  DECIDIR: { texto: "Equipe decide", classe: "etiqueta--perigo" },
};

/** Pontos de corte da confirmação da véspera (gerente, 09/11/2026). */
function RegrasConfirmacaoModal({ atuais, horaFechamento, aoFechar, aoSalvar }: { atuais: RegrasConfirmacao; horaFechamento: string; aoFechar: () => void; aoSalvar: () => void }) {
  const notificar = useNotificar();
  const [f, setF] = useState<RegrasConfirmacao>(atuais);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const num = (k: keyof RegrasConfirmacao) => ({ type: "number", min: 0, max: 500, value: f[k] as number, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) || 0 }) });
  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await api.put("/api/confirmacao/regras", f);
      notificar("Regras de confirmação salvas.");
      aoSalvar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }
  const un = f.contarPor === "PASSAGEIROS" ? "passageiros" : "reservas";
  return (
    <Modal aberto titulo="Confirmação da véspera: pontos de corte" aoFechar={aoFechar}>
      <p className="texto-fraco">
        A partir da hora da prévia, o sistema confere as saídas de amanhã. Atingiu um corte: confirma sozinho e cada cliente recebe horário e ponto.
        Senão, o cliente recebe a prévia (“estamos montando a lista”) e o sistema reavalia ao longo do dia. Na hora limite, sem corte, a equipe decide: nada é cancelado sozinho.
      </p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade-campos">
        <label className="interruptor"><input type="checkbox" checked={f.ligado} onChange={(e) => setF({ ...f, ligado: e.target.checked })} /> Confirmação automática ligada</label>
        <div className="campo"><label htmlFor="rc-contar">Contar por</label>
          <select id="rc-contar" value={f.contarPor} onChange={(e) => setF({ ...f, contarPor: e.target.value as RegrasConfirmacao["contarPor"] })}>
            <option value="RESERVAS">Reservas</option><option value="PASSAGEIROS">Passageiros (colo não conta)</option>
          </select>
        </div>
        <div className="campo"><label htmlFor="rc-pagas">Corte 1: {un} pagas para confirmar</label><input id="rc-pagas" {...num("pagasParaConfirmar")} /></div>
        <div className="campo"><label htmlFor="rc-total">Corte 2: total de {un}…</label><input id="rc-total" {...num("totalParaConfirmar")} /></div>
        <div className="campo"><label htmlFor="rc-min">…com pelo menos estas pagas</label><input id="rc-min" {...num("pagasMinimasNoTotal")} /></div>
        <div className="campo"><label htmlFor="rc-previa">Hora da prévia</label><input id="rc-previa" type="time" value={f.horaPrevia} onChange={(e) => setF({ ...f, horaPrevia: e.target.value })} /></div>
        <div className="campo"><label htmlFor="rc-limite">Hora limite da decisão (até {horaFechamento})</label><input id="rc-limite" type="time" value={f.horaLimite} onChange={(e) => setF({ ...f, horaLimite: e.target.value })} /></div>
      </div>
      <p className="texto-fraco">Corte com zero fica desligado. Pendentes = reservas “pagar no embarque” ou com saldo a pagar.</p>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao--primario" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar regras"}</button>
      </div>
    </Modal>
  );
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
  const [editarRegras, setEditarRegras] = useState(false);
  const [viatorDe, setViatorDe] = useState<string | null>(null);
  const [confirmarSaida, setConfirmarSaida] = useState<{ saidaId: string; passeio: string; titulares: number } | null>(null);

  async function confirmarAgora(saidaId: string) {
    setConfirmarSaida(null);
    setOcupado(saidaId);
    setErro(null);
    try {
      const r = await api.post<{ jaEstava: boolean; enviadas: number }>(`/api/saidas/${saidaId}/confirmar`);
      notificar(r.jaEstava ? "A saída já estava confirmada." : `Saída confirmada. ${r.enviadas} confirmação(ões) na fila.`);
      await sit.recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(null);
    }
  }

  async function fechar(saidaId: string, passeio: string) {
    setConfirmar(null);
    setOcupado(saidaId);
    setErro(null);
    try {
      const r = await api.post<{ versao: number; texto: string }>(`/api/saidas/${saidaId}/fechar`);
      notificar(r.versao > 1 ? `Lista atualizada (versão ${r.versao}) gerada.` : "Lista fechada.");
      setTexto({ titulo: `${passeio} — lista ${r.versao > 1 ? `atualizada (versão ${r.versao})` : "fechada"}`, texto: r.texto });
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
      <CabecalhoPagina
        titulo="Listas de passageiros"
        descricao={`Na véspera, a saída é confirmada pelos pontos de corte (ou pela equipe) e cada titular recebe horário e ponto. A lista fecha ${s?.automatico ? `sozinha às ${s.horaFechamento}` : "pelo botão (fechamento automático desligado)"}, em ordem de embarque. Venda depois disso gera a lista atualizada, sempre completa.`}
        filtros={<div className="campo campo--linha"><label htmlFor="fech-data">Data do passeio</label><input id="fech-data" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>}
      />
      {s && (
        <section className="listas__automacao" aria-label="Automação da lista">
          <ul>
            <li><strong>Fechamento:</strong> {s.automatico ? `automático às ${s.horaFechamento} da véspera` : "manual (automático desligado)"}</li>
            <li><strong>Grupo do WhatsApp:</strong> {s.whatsapp.grupoConfigurado ? "a lista vai sozinha para o grupo" : "não configurado — use “Texto para o WhatsApp”"}</li>
            <li>
              <strong>Confirmação da véspera:</strong>{" "}
              {s.regrasConfirmacao.ligado
                ? `a partir das ${s.regrasConfirmacao.horaPrevia}, confirma com ${s.regrasConfirmacao.pagasParaConfirmar} pagas ou ${s.regrasConfirmacao.totalParaConfirmar} no total com ${s.regrasConfirmacao.pagasMinimasNoTotal} pagas (${s.regrasConfirmacao.contarPor === "PASSAGEIROS" ? "passageiros" : "reservas"}); decisão até as ${s.regrasConfirmacao.horaLimite}`
                : "automática desligada (confirma no fechamento)"}
              {podeDecidir && <>{" "}<button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setEditarRegras(true)}>Ajustar</button></>}
            </li>
            <li><strong>WhatsApp:</strong> {s.whatsapp.envioReal ? "envio real ligado" : <span className="texto-atencao">modo simulado — nada sai de verdade até contratar o provedor</span>}</li>
            <li><strong>Listas desta data:</strong> {s.saidas.filter((x) => x.listaFechadaEm).length} fechada(s) de {s.saidas.length}</li>
          </ul>
        </section>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sit.carregando && !s ? <Carregando /> : sit.erro ? <ErroCarga mensagem={sit.erro} tentarDeNovo={sit.recarregar} /> : s?.saidas.length === 0 ? (
        <Vazio titulo={`Nenhuma saída em ${formatarDataCurta(data)}.`} />
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela tabela--listas tabela--cartoes">
            <thead>
              <tr><th>Passeio e equipe</th><th>Confirmação</th><th>Lista</th><th className="num">Reservas</th><th className="num">A conferir</th><th className="num">Sem ponto</th><th>Mensagens</th><th>Ações</th></tr>
            </thead>
            <tbody>
              {s?.saidas.map((x) => {
                const fechada = !!x.listaFechadaEm;
                const msgs = Object.entries(x.mensagens).map(([k, n]) => `${n} ${ROTULO_STATUS[k]?.toLowerCase() ?? k}`).join(" · ");
                return (
                  <Fragment key={x.saidaId}>
                    <tr className={!fechada ? "linha--atencao" : x.depoisDoFechamento > 0 ? "linha--atencao" : undefined}>
                      <td>
                        <strong><Link to={`/saidas/${x.saidaId}`}>{x.passeio}</Link></strong>
                        <div className="texto-fraco">Guia: {x.guia ?? "a definir"} · Motorista: {x.motorista ?? "a definir"}{x.veiculo ? ` · ${x.veiculo}` : ""}</div>
                      </td>
                      <td data-rotulo="Confirmação">
                        {x.reservas === 0 && !x.confirmacao.confirmadaEm ? <span className="texto-fraco">Sem reservas</span> : <>
                          <span className={`etiqueta ${ROTULO_DECISAO[x.confirmacao.decisao].classe}`} title={x.confirmacao.motivo ?? undefined}>{ROTULO_DECISAO[x.confirmacao.decisao].texto}</span>
                          <div className="texto-fraco">{x.confirmacao.pagas} pagas · {x.confirmacao.pendentes} pendentes</div>
                          {x.confirmacao.confirmadaEm
                            ? <div className="texto-fraco">{x.confirmacao.automatica ? "pelos cortes" : "pela equipe"} · {formatarDataHora(x.confirmacao.confirmadaEm)}</div>
                            : <div className={x.confirmacao.decisao === "DECIDIR" ? "texto-perigo" : "texto-fraco"}>{
                              x.confirmacao.decisao === "DECIDIR" ? "Não atingiu os cortes: confirme ou cancele"
                                : x.confirmacao.decisao === "CONFIRMAR" ? "Confirma na próxima rodada"
                                  : `Reavalia até as ${s?.regrasConfirmacao.horaLimite ?? ""}`}</div>}
                        </>}
                        {x.previasEnviadas > 0 && !x.confirmacao.confirmadaEm && <div className="texto-fraco">{x.previasEnviadas} prévia(s) enviada(s)</div>}
                        {x.viatorSemResposta > 0 && <div className="texto-atencao"><strong>{x.viatorSemResposta}</strong> Viator sem resposta</div>}
                      </td>
                      <td data-rotulo="Lista">
                        <span className={`etiqueta ${fechada ? "etiqueta--sucesso" : "etiqueta--atencao"}`}>
                          {fechada ? `Fechada${x.versao > 1 ? ` · versão ${x.versao}` : ""}` : "Aberta"}
                        </span>
                        {fechada && <div className="texto-fraco">{formatarDataHora(x.listaFechadaEm)}</div>}
                        {fechada && x.depoisDoFechamento > 0 && <div className="texto-atencao"><strong>{x.depoisDoFechamento}</strong> depois do fechamento</div>}
                      </td>
                      <td className="num" data-rotulo="Reservas"><strong>{x.reservas}</strong></td>
                      <td data-rotulo="A conferir" className={`num${x.naoConferidas ? " texto-atencao" : ""}`}><strong>{x.naoConferidas}</strong></td>
                      <td data-rotulo="Sem ponto" className={`num${x.semPonto ? " texto-perigo" : ""}`}><strong>{x.semPonto}</strong></td>
                      <td className="texto-fraco" data-rotulo="Mensagens">{msgs || "—"}</td>
                      <td className="celula-acoes">
                        <button type="button" className="botao botao--secundario botao--pequeno" aria-expanded={aberta === x.saidaId} onClick={() => setAberta((a) => (a === x.saidaId ? null : x.saidaId))}>
                          {aberta === x.saidaId ? "Esconder lista" : "Ver lista"}
                        </button>{" "}
                        <Link className="botao botao--secundario botao--pequeno" to={`/saidas/${x.saidaId}`}>Abrir / imprimir</Link>{" "}
                        <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void verTexto(x.saidaId, x.passeio)}>Texto para o WhatsApp</button>{" "}
                        {x.naoConferidas > 0 && <><Link className="botao botao--secundario botao--pequeno" to="/listas/conferir">Conferir pendências</Link>{" "}</>}
                        {podeDecidir && !x.confirmacao.confirmadaEm && x.reservas > 0 && (
                          <><button type="button" className="botao botao--primario botao--pequeno" disabled={ocupado === x.saidaId}
                            onClick={() => setConfirmarSaida({ saidaId: x.saidaId, passeio: x.passeio, titulares: x.reservas })}>Confirmar saída</button>{" "}</>
                        )}
                        {podeDecidir && (!fechada || x.depoisDoFechamento > 0) && (
                          <button type="button" className="botao botao--primario botao--pequeno" disabled={ocupado === x.saidaId}
                            onClick={() => setConfirmar({ saidaId: x.saidaId, passeio: x.passeio, adendo: fechada, titulares: fechada ? x.depoisDoFechamento : x.reservas })}>
                            {fechada ? "Reenviar lista atualizada" : "Fechar lista agora"}
                          </button>
                        )}{" "}
                        {podeDecidir && x.viatorSemResposta > 0 && <><button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setViatorDe(x.saidaId)}>Mensagem para a Viator</button>{" "}</>}
                        {podeDecidir && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setMensagensDe(x.saidaId)}>Mensagens</button>}
                      </td>
                    </tr>
                    {aberta === x.saidaId && <tr><td colSpan={8}><PreviaLista saidaId={x.saidaId} /></td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirmar && (
        <Modal aberto titulo={confirmar.adendo ? "Reenviar a lista atualizada?" : "Fechar a lista agora?"} aoFechar={() => setConfirmar(null)}>
          <p>
            {confirmar.passeio}: {confirmar.adendo ? `a lista completa sai de novo, em ordem de embarque, com ${confirmar.titulares} reserva(s) nova(s) ou alterada(s)` : "a lista fecha em ordem de embarque"}
            {s?.whatsapp.envioReal ? " e a confirmação sai pelo WhatsApp para quem ainda não recebeu." : " (WhatsApp em modo simulado: nada é enviado)."}
          </p>
          <div className="modal__acoes">
            <button type="button" className="botao botao--secundario" onClick={() => setConfirmar(null)}>Cancelar</button>
            <button type="button" className="botao botao--primario" onClick={() => void fechar(confirmar.saidaId, confirmar.passeio)}>{confirmar.adendo ? "Reenviar lista" : "Fechar lista"}</button>
          </div>
        </Modal>
      )}
      {confirmarSaida && (
        <Modal aberto titulo="Confirmar a saída agora?" aoFechar={() => setConfirmarSaida(null)}>
          <p>
            {confirmarSaida.passeio}: a saída fica confirmada e os titulares que ainda não receberam ganham a confirmação com horário e ponto
            {s?.whatsapp.envioReal ? " pelo WhatsApp." : " (WhatsApp em modo simulado: nada é enviado)."}
          </p>
          <div className="modal__acoes">
            <button type="button" className="botao botao--secundario" onClick={() => setConfirmarSaida(null)}>Cancelar</button>
            <button type="button" className="botao botao--primario" onClick={() => void confirmarAgora(confirmarSaida.saidaId)}>Confirmar saída</button>
          </div>
        </Modal>
      )}
      {editarRegras && s && <RegrasConfirmacaoModal atuais={s.regrasConfirmacao} horaFechamento={s.horaFechamento} aoFechar={() => setEditarRegras(false)} aoSalvar={() => { setEditarRegras(false); void sit.recarregar(); }} />}
      {texto && <TextoLista titulo={texto.titulo} texto={texto.texto} aoFechar={() => setTexto(null)} />}
      {viatorDe && <MensagensViator saidaId={viatorDe} aoFechar={() => setViatorDe(null)} />}
      {mensagensDe && <Mensagens saidaId={mensagensDe} aoFechar={() => setMensagensDe(null)} />}
    </div>
  );
}
