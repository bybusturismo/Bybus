import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { centavosDeTexto, formatarDataExtenso, formatarMoeda, hojeIso, somarDias, textoDeCentavos } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { CLASSE_SITUACAO, descricaoTaxa, ROTULO_SITUACAO, SITUACOES, type DiaTransfer, type ParadaTransfer, type PasseioTransfer, type RespostaTransfer, type SituacaoBusca } from "./tipos";
import "./transfer.css";

function EditarDia({ dia, resposta, aoFechar, aoSalvar }: { dia: DiaTransfer; resposta: RespostaTransfer; aoFechar: () => void; aoSalvar: (r: RespostaTransfer) => void }) {
  const [veiculoId, setVeiculoId] = useState(dia.veiculoId ?? "");
  const [veiculoTexto, setVeiculoTexto] = useState(dia.veiculoTexto ?? "");
  const [motoristaId, setMotoristaId] = useState(dia.motoristaId ?? "");
  const [lugares, setLugares] = useState(dia.lugares ? String(dia.lugares) : "");
  const [pontoId, setPontoId] = useState(dia.pontoEncontroId ?? resposta.encontro?.id ?? "");
  const [chegada, setChegada] = useState(dia.chegadaPrevista ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const n = lugares.trim() ? Number(lugares) : null;
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 100)) return setErro("Lugares: informe um número inteiro de 1 a 100.");
    setSalvando(true);
    try {
      aoSalvar(await api.patch<RespostaTransfer>(`/api/transfer/dias/${dia.id}`, {
        veiculoId: veiculoId || null, veiculoTexto: veiculoId ? null : veiculoTexto.trim() || null, motoristaId: motoristaId || null,
        lugares: n, pontoEncontroId: pontoId || null, chegadaPrevista: chegada || null,
      }));
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Modal aberto titulo="Van, motorista e encontro" aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="campo">
          <label htmlFor="tr-motorista">Motorista do transfer</label>
          <select id="tr-motorista" value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)}>
            <option value="">Sem motorista</option>
            {resposta.opcoes?.motoristas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="tr-veiculo">Veículo (frota)</label>
          <select id="tr-veiculo" value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
            <option value="">Outro (digitar placa)</option>
            {resposta.opcoes?.veiculos.map((v) => <option key={v.id} value={v.id}>{v.apelido ? `${v.apelido} (${v.placa})` : v.placa}</option>)}
          </select>
        </div>
        {!veiculoId && (
          <div className="campo">
            <label htmlFor="tr-veiculo-texto">Placa ou descrição da van</label>
            <input id="tr-veiculo-texto" maxLength={60} value={veiculoTexto} onChange={(e) => setVeiculoTexto(e.target.value)} />
          </div>
        )}
        <div className="campo">
          <label htmlFor="tr-lugares">Lugares na van</label>
          <input id="tr-lugares" inputMode="numeric" value={lugares} onChange={(e) => setLugares(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="tr-ponto">Ponto de encontro com o ônibus</label>
          <select id="tr-ponto" value={pontoId} onChange={(e) => setPontoId(e.target.value)}>
            <option value="">A definir</option>
            {resposta.pontosEncontro?.map((p) => <option key={p.id} value={p.id}>{p.horario} — {p.nome}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="tr-chegada">Chegada prevista da van ao ponto</label>
          <input id="tr-chegada" type="time" value={chegada} onChange={(e) => setChegada(e.target.value)} />
          <p className="campo__ajuda">Em branco: vale o horário do ponto de embarque do ônibus.</p>
        </div>
        <div className="modal__acoes">
          <button type="button" className="botao botao--secundario" onClick={aoFechar}>Cancelar</button>
          <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </Modal>
  );
}

function EditarParada({ parada, resposta, aoFechar, aoSalvar }: { parada: ParadaTransfer; resposta: RespostaTransfer; aoFechar: () => void; aoSalvar: (r: RespostaTransfer) => void }) {
  const [endereco, setEndereco] = useState(parada.endereco ?? "");
  const [horario, setHorario] = useState(parada.horarioManual ? parada.horario ?? "" : "");
  const [bairroId, setBairroId] = useState(parada.bairroId ?? "");
  const [taxa, setTaxa] = useState(textoDeCentavos(parada.taxaCentavos));
  const [incluido, setIncluido] = useState(parada.taxaForma === "INCLUIDO_NO_PASSEIO");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const recebida = parada.taxaSituacao === "RECEBIDO" && parada.taxaForma !== "INCLUIDO_NO_PASSEIO";

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const corpo: Record<string, unknown> = {};
    if (endereco.trim() !== (parada.endereco ?? "")) corpo.enderecoBusca = endereco.trim() || null;
    if (horario !== (parada.horarioManual ? parada.horario ?? "" : "")) corpo.horarioBusca = horario || null;
    if (bairroId !== (parada.bairroId ?? "")) corpo.bairroId = bairroId || null;
    if (!recebida) {
      const c = centavosDeTexto(taxa);
      if (taxa.trim() && (c === null || c < 0)) return setErro("Valor da taxa inválido. Use, por exemplo, 40,00.");
      if ((c ?? 0) !== parada.taxaCentavos) corpo.taxaCentavos = c ?? 0;
      if (incluido !== (parada.taxaForma === "INCLUIDO_NO_PASSEIO")) corpo.incluidoNoPasseio = incluido;
    }
    if (Object.keys(corpo).length === 0) return aoFechar();
    setSalvando(true);
    try {
      aoSalvar(await api.patch<RespostaTransfer>(`/api/transfer/reservas/${parada.id}`, corpo));
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Modal aberto titulo={`Parada — ${parada.titular}`} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="campo">
          <label htmlFor="pa-endereco">Hotel ou endereço de busca</label>
          <input id="pa-endereco" maxLength={300} value={endereco} onChange={(e) => setEndereco(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="pa-bairro">Bairro</label>
          <select id="pa-bairro" value={bairroId} onChange={(e) => setBairroId(e.target.value)}>
            <option value="">Definir automaticamente</option>
            {resposta.bairros?.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="pa-horario">Horário de busca</label>
          <input id="pa-horario" type="time" value={horario} onChange={(e) => setHorario(e.target.value)} />
          <p className="campo__ajuda">{parada.horarioManual ? "Horário ajustado à mão. Apague para voltar ao calculado." : `Calculado: ${parada.horario ?? "a confirmar"}. Digite para fixar um horário.`}</p>
        </div>
        <div className="campo">
          <label htmlFor="pa-taxa">Taxa do transfer desta reserva (R$)</label>
          <input id="pa-taxa" inputMode="decimal" value={taxa} disabled={recebida || incluido} onChange={(e) => setTaxa(e.target.value)} />
          {recebida && <p className="campo__ajuda">Já recebida: peça para desfazer o recebimento antes de alterar.</p>}
        </div>
        {!recebida && (
          <label className="campo--caixa">
            <input type="checkbox" checked={incluido} onChange={(e) => setIncluido(e.target.checked)} /> Taxa cobrada junto do passeio (nada a receber do motorista)
          </label>
        )}
        <div className="modal__acoes">
          <button type="button" className="botao botao--secundario" onClick={aoFechar}>Cancelar</button>
          <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
    </Modal>
  );
}

function TextoTransfer({ texto, aoFechar }: { texto: string; aoFechar: () => void }) {
  return (
    <Modal aberto titulo="Lista do transfer" aoFechar={aoFechar} largura="larga">
      <p className="texto-fraco">Selecione o texto e copie para colar no WhatsApp do motorista.</p>
      <textarea className="fechamento__texto" readOnly value={texto} rows={16} aria-label="Texto da lista do transfer" />
    </Modal>
  );
}

/** Controle do transfer do dia: van que busca no hotel e leva ao ônibus (pedido do dono, 05/11/2026). */
export function Transfer() {
  const { pode } = useSessao();
  const notificar = useNotificar();
  const gerenciar = pode("transfer:gerenciar");
  const verContatos = pode("manifesto:contatos");
  const [data, setData] = useState(() => somarDias(hojeIso(), 1));
  const passeios = useCarregar((s) => api.get<PasseioTransfer[]>("/api/transfer/passeios", s), []);
  const [passeioId, setPasseioId] = useState("");
  useEffect(() => {
    if (!passeioId && passeios.dados?.length) setPasseioId(passeios.dados[0]!.id);
  }, [passeios.dados, passeioId]);
  const carga = useCarregar((s) => (passeioId ? api.get<RespostaTransfer>(`/api/transfer${qs({ passeioId, data })}`, s) : Promise.resolve(null)), [passeioId, data]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [editandoDia, setEditandoDia] = useState(false);
  const [editando, setEditando] = useState<ParadaTransfer | null>(null);
  const [texto, setTexto] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const r = carga.dados;

  /** Executa uma ação da API e troca o quadro pela resposta. */
  async function agir(f: () => Promise<RespostaTransfer>, aviso?: string) {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      const nova = await f();
      carga.definir(() => ({ ...nova, data }));
      if (aviso) notificar(aviso);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }
  const lista = r?.reservas ?? [];
  const mover = (p: ParadaTransfer, posicao: number) => agir(() => api.post<RespostaTransfer>(`/api/transfer/reservas/${p.id}/mover`, { posicao }));
  async function copiar() {
    if (!r?.saida) return;
    try {
      const t = await api.get<{ texto: string }>(`/api/transfer/texto${qs({ saidaId: r.saida.id })}`);
      try {
        await navigator.clipboard.writeText(t.texto);
        notificar("Texto do transfer copiado. Cole no WhatsApp do motorista.");
      } catch {
        setTexto(t.texto);
      }
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  const t = r?.totais;
  const lugares = r?.dia?.lugares ?? null;
  return (
    <div className="pagina transfer">
      <div className="pagina__cabecalho">
        <div>
          <h1>Transfer</h1>
          <p className="pagina__descricao">
            Van que busca os passageiros na porta do hotel e leva até o ônibus do passeio. Ordem de busca: do bairro mais longe do centro para o mais perto.
          </p>
        </div>
        <div className="filtros transfer__filtros">
          <div className="campo campo--linha"><label htmlFor="tr-data">Data</label><input id="tr-data" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
          <div className="campo campo--linha">
            <label htmlFor="tr-passeio">Passeio</label>
            <select id="tr-passeio" value={passeioId} onChange={(e) => setPasseioId(e.target.value)}>
              {passeios.dados?.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
        </div>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {passeios.carregando && !passeios.dados ? <Carregando /> : passeios.erro ? <ErroCarga mensagem={passeios.erro} tentarDeNovo={passeios.recarregar} /> :
        passeios.dados?.length === 0 ? (
          <Vazio titulo="Nenhum passeio com transfer configurado nesta praça.">
            {pode("produtos:gerenciar") && <Link to="/passeios">Configurar bairros de transfer em Passeios e pontos</Link>}
          </Vazio>
        ) : carga.carregando && !r ? <Carregando /> : carga.erro ? <ErroCarga mensagem={carga.erro} tentarDeNovo={carga.recarregar} /> : !r ? null : !r.saida ? (
          <Vazio titulo={`Não há saída em ${formatarDataExtenso(data)}.`} />
        ) : !r.dia ? (
          <section className="cartao transfer__vazio">
            <p>O transfer de {formatarDataExtenso(data)} ainda não foi montado. {r.candidatas ? <strong>{r.candidatas} reserva(s) com transfer na lista.</strong> : "Nenhuma reserva com transfer até agora."}</p>
            {gerenciar ? (
              <button type="button" className="botao botao--primario" disabled={ocupado} onClick={() => void agir(() => api.post<RespostaTransfer>("/api/transfer/montar", { saidaId: r.saida!.id }), "Transfer montado.")}>
                <Icone nome="onibus" /> Montar transfer do dia
              </button>
            ) : <p className="texto-fraco">Peça à supervisão para montar. Ele também é montado sozinho no fechamento da lista.</p>}
          </section>
        ) : (
          <>
            <section className="cartao transfer__quadro" aria-label="Quadro do transfer">
              <dl>
                <div><dt>Motorista</dt><dd>{r.dia.motorista ?? <span className="texto-atencao">a definir</span>}</dd></div>
                <div><dt>Veículo</dt><dd>{r.dia.veiculo ?? <span className="texto-atencao">a definir</span>}</dd></div>
                <div><dt>Lugares</dt><dd className={lugares && t && t.assentos > lugares ? "texto-perigo" : ""}>{t?.assentos ?? 0} passageiro(s){lugares ? ` de ${lugares} lugares` : ""}</dd></div>
                <div><dt>Encontro com o ônibus</dt><dd>{r.encontro ? `${r.encontro.nome} às ${r.encontro.horario}` : <span className="texto-atencao">a definir</span>}</dd></div>
                <div><dt>Buscados</dt><dd>{t?.buscados ?? 0} de {t?.reservas ?? 0} reservas{t?.naoApareceram ? ` · ${t.naoApareceram} não apareceu` : ""}</dd></div>
              </dl>
              <div className="barra-acoes">
                {gerenciar && <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setEditandoDia(true)}>Editar van e encontro</button>}
                {gerenciar && <button type="button" className="botao botao--secundario botao--pequeno" disabled={ocupado} onClick={() => void agir(() => api.post<RespostaTransfer>("/api/transfer/montar", { saidaId: r.saida!.id }), "Transfer atualizado com as reservas.")}>Atualizar com as reservas{r.candidatas ? ` (${r.candidatas} nova${r.candidatas > 1 ? "s" : ""})` : ""}</button>}
                {gerenciar && <button type="button" className="botao botao--secundario botao--pequeno" disabled={ocupado} onClick={() => void agir(() => api.post<RespostaTransfer>(`/api/transfer/dias/${r.dia!.id}/recalcular-ordem`), "Ordem recalculada pelos bairros.")}><Icone nome="desfazer" tamanho={16} /> Recalcular ordem</button>}
                <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void copiar()}><Icone nome="lista" tamanho={16} /> Copiar texto</button>
                <Link className="botao botao--fantasma botao--pequeno" to={`/saidas/${r.saida.id}`}>Lista de passageiros</Link>
              </div>
              {r.alertas?.length ? <ul className="transfer__alertas">{r.alertas.map((a) => <li key={a}><Icone nome="alerta" tamanho={14} /> {a}</li>)}</ul> : null}
            </section>

            <section className="transfer__totais" aria-label="Totais da taxa">
              <div><span>A receber</span><strong>{formatarMoeda(t?.taxa.aReceber ?? 0)}</strong></div>
              <div><span>Recebido por PIX</span><strong>{formatarMoeda(t?.taxa.recebidoPix ?? 0)}</strong></div>
              <div><span>Recebido em dinheiro</span><strong>{formatarMoeda(t?.taxa.recebidoDinheiro ?? 0)}</strong></div>
              <div><span>Incluído no passeio</span><strong>{formatarMoeda(t?.taxa.incluidoNoPasseio ?? 0)}</strong></div>
              <div><span>Taxa por passageiro</span><strong>{r.config ? formatarMoeda(r.config.taxaPorPassageiroCentavos) : "—"}{r.config?.taxaAConfirmar ? " (a confirmar)" : ""}</strong></div>
            </section>

            {lista.length === 0 ? <Vazio titulo="Nenhuma reserva com transfer neste dia." /> : (
              <div className="tabela-rolagem">
                <table className="tabela tabela--compacta transfer__tabela">
                  <caption className="visualmente-oculto">Paradas do transfer em ordem de busca</caption>
                  <thead><tr><th>#</th><th>Busca</th><th>Bairro</th><th>Hotel / endereço</th><th>Titular</th><th>Pax</th><th>Situação</th><th>Taxa</th>{gerenciar && <th>Ordem</th>}</tr></thead>
                  <tbody>
                    {lista.map((p, i) => (
                      <tr key={p.id} className={arrastando === p.id ? "transfer__arrastando" : undefined}
                        draggable={gerenciar} onDragStart={() => setArrastando(p.id)} onDragEnd={() => setArrastando(null)}
                        onDragOver={(e) => { if (arrastando) e.preventDefault(); }}
                        onDrop={(e) => { e.preventDefault(); const alvo = lista.find((x) => x.id === arrastando); setArrastando(null); if (alvo && alvo.id !== p.id) void mover(alvo, i); }}>
                      <td className="sem-quebra">{i + 1}</td>
                        <td className="sem-quebra"><strong>{p.horario ?? "--:--"}</strong>{p.horarioManual && <span className="texto-fraco" title="Horário ajustado à mão"> ✎</span>}</td>
                        <td>{p.bairro ?? <span className="texto-atencao">definir</span>}</td>
                        <td>{p.endereco ?? <span className="texto-atencao">a informar</span>}</td>
                        <td>{p.titular}{verContatos && p.telefone && <div className="texto-fraco">{p.telefone}</div>}</td>
                        <td className="sem-quebra">{p.pax}{p.pax !== p.assentos ? <span className="texto-fraco"> ({p.assentos} lug.)</span> : ""}</td>
                        <td>
                          {gerenciar ? (
                            <select aria-label={`Situação de ${p.titular}`} value={p.situacao} disabled={ocupado} onChange={(e) => void agir(() => api.post<RespostaTransfer>(`/api/transfer/reservas/${p.id}/situacao`, { situacao: e.target.value as SituacaoBusca }))}>
                              {SITUACOES.map((s) => <option key={s} value={s}>{ROTULO_SITUACAO[s]}</option>)}
                            </select>
                          ) : <span className={`etiqueta ${CLASSE_SITUACAO[p.situacao]}`}>{ROTULO_SITUACAO[p.situacao]}</span>}
                        </td>
                        <td className={p.taxaSituacao === "A_RECEBER" && p.taxaCentavos > 0 ? "" : "texto-fraco"}>{descricaoTaxa(p, formatarMoeda)}</td>
                        {gerenciar && (
                          <td className="sem-quebra transfer__acoes">
                            <button type="button" className="botao botao--fantasma botao--pequeno" aria-label={`Subir ${p.titular}`} disabled={ocupado || i === 0} onClick={() => void mover(p, i - 1)}>↑</button>
                            <button type="button" className="botao botao--fantasma botao--pequeno" aria-label={`Descer ${p.titular}`} disabled={ocupado || i === lista.length - 1} onClick={() => void mover(p, i + 1)}>↓</button>
                            <button type="button" className="botao botao--fantasma botao--pequeno" aria-label={`Editar ${p.titular}`} onClick={() => setEditando(p)}>Editar</button>
                            {p.taxaSituacao === "RECEBIDO" && p.taxaForma !== "INCLUIDO_NO_PASSEIO" && (
                              <button type="button" className="botao botao--fantasma botao--pequeno" aria-label={`Desfazer recebimento de ${p.titular}`} disabled={ocupado} onClick={() => void agir(() => api.post<RespostaTransfer>(`/api/transfer/reservas/${p.id}/estornar`), "Recebimento desfeito.")}>Estornar</button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {gerenciar && lista.length > 1 && <p className="texto-fraco transfer__dica">No computador, também dá para arrastar as linhas para mudar a ordem de busca.</p>}
          </>
        )}
      {editandoDia && r?.dia && <EditarDia dia={r.dia} resposta={r} aoFechar={() => setEditandoDia(false)} aoSalvar={(n) => { carga.definir(() => ({ ...n, data })); setEditandoDia(false); notificar("Transfer atualizado."); }} />}
      {editando && r && <EditarParada parada={editando} resposta={r} aoFechar={() => setEditando(null)} aoSalvar={(n) => { carga.definir(() => ({ ...n, data })); setEditando(null); notificar("Parada atualizada."); }} />}
      {texto !== null && <TextoTransfer texto={texto} aoFechar={() => setTexto(null)} />}
    </div>
  );
}
