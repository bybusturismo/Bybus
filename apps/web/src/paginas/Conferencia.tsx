import { useState } from "react";
import { Link } from "react-router-dom";
import { api, mensagemDeErro, qs } from "../api/cliente";
import type { ItemConferencia, PontoEmbarque } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { useNotificar } from "../componentes/Notificacoes";
import { useSessao } from "../sessao/Sessao";
import { formatarDataCurta, hojeIso, somarDias } from "../util/formato";
import { ROTULO_CANAL } from "../util/rotulos";
import { useCarregar } from "../util/useCarregar";

const ROTULO_PAGAMENTO: Record<string, string> = { PAGO: "Pago", A_PAGAR: "Pagar no embarque", CORTESIA: "Cortesia" };
const SIGLA: Record<string, string> = { ADULTO: "A", SENIOR: "S", INFANTIL: "C", COLO: "Colo", CORTESIA: "Cort." };

/** "2 A · 1 C" */
export function resumoCategorias(c: ItemConferencia["categorias"]): string {
  return Object.entries(c).filter(([, n]) => n).map(([k, n]) => `${n} ${SIGLA[k] ?? k}`).join(" · ") || "—";
}

function Cartao({ item, pontos, aoMudar }: { item: ItemConferencia; pontos: PontoEmbarque[]; aoMudar: () => Promise<void> }) {
  const notificar = useNotificar();
  const [pontoId, setPontoId] = useState(item.ponto?.id ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function conferir() {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/api/reservas/${item.id}/conferir`, { pontoEmbarqueId: pontoId || null });
      notificar(`Reserva de ${item.contatoNome} conferida.`);
      await aoMudar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function copiarLink() {
    setErro(null);
    try {
      const r = await api.post<{ caminho: string }>(`/api/reservas/${item.id}/link-embarque`);
      const url = `${window.location.origin}${r.caminho}`;
      try {
        await navigator.clipboard.writeText(url);
        notificar("Link de embarque copiado. Envie ao cliente pelo WhatsApp.");
      } catch {
        window.prompt("Copie o link de embarque:", url);
      }
      await aoMudar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  const conferida = item.conferencia === "CONFERIDA";
  return (
    <li className={`conferencia${conferida ? " conferencia--ok" : ""}`}>
      <div className="conferencia__topo">
        <div>
          <strong className="conferencia__titular">{item.contatoNome}</strong>
          <span className="texto-fraco"> · {item.passageiros} pax ({resumoCategorias(item.categorias)})</span>
        </div>
        <span className={`etiqueta ${conferida ? "etiqueta--sucesso" : "etiqueta--atencao"}`}>{conferida ? "Conferida" : "A conferir"}</span>
      </div>
      <dl className="conferencia__dados">
        <div><dt>Passeio</dt><dd><Link to={`/saidas/${item.saidaId}`}>{formatarDataCurta(item.data)} · {item.passeio}</Link></dd></div>
        <div><dt>Canal</dt><dd>{ROTULO_CANAL[item.canal] ?? item.canal}{item.codigoExterno ? <span className="texto-fraco"> · {item.codigoExterno}</span> : null}</dd></div>
        <div><dt>Pagamento</dt><dd>{item.pagamento ? <span className={`etiqueta ${item.pagamento === "A_PAGAR" ? "etiqueta--atencao" : "etiqueta--neutra"}`}>{ROTULO_PAGAMENTO[item.pagamento]}</span> : "—"}{item.formaPagamento ? <span className="texto-fraco"> {item.formaPagamento}</span> : null}</dd></div>
        <div><dt>Origem</dt><dd>{item.origemCliente ?? "—"}</dd></div>
        <div><dt>Contato</dt><dd>{item.contatoTelefone ?? <span className="texto-fraco">sem telefone</span>}</dd></div>
        <div><dt>Informado pelo cliente</dt><dd>{item.hospedagemInformada ? `${item.hospedagemInformada}${item.pediuTransfer ? " (transfer)" : ""}` : <span className="texto-fraco">nada ainda</span>}</dd></div>
      </dl>
      {item.alertas.length > 0 && (
        <div className="conferencia__alertas">
          {item.alertas.map((a) => <span key={a} className="etiqueta etiqueta--perigo">{a}</span>)}
        </div>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="conferencia__acoes">
        <label className="visualmente-oculto" htmlFor={`ponto-${item.id}`}>Ponto de embarque de {item.contatoNome}</label>
        <select id={`ponto-${item.id}`} value={pontoId} onChange={(e) => setPontoId(e.target.value)}>
          <option value="">Ponto de embarque…</option>
          {pontos.filter((p) => p.ativo !== false || p.id === pontoId).map((p) => <option key={p.id} value={p.id}>{p.horario} — {p.nome}{p.ativo === false ? " (inativo)" : ""}</option>)}
        </select>
        <button type="button" className="botao botao--primario botao--pequeno" disabled={ocupado || !pontoId} onClick={() => void conferir()}>
          {conferida ? "Conferir de novo" : "Confirmar embarque"}
        </button>
        <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void copiarLink()}>
          {item.linkGerado ? "Novo link para o cliente" : "Link para o cliente"}
        </button>
      </div>
    </li>
  );
}

export function Conferencia() {
  const { praca } = useSessao();
  const hoje = hojeIso();
  const [de, setDe] = useState(hoje);
  const [ate, setAte] = useState(somarDias(hoje, 7));
  const [situacao, setSituacao] = useState<"PENDENTE" | "CONFERIDA" | "TODAS">("PENDENTE");
  const lista = useCarregar((s) => api.get<ItemConferencia[]>(`/api/conferencia${qs({ de, ate, situacao, unidadeId: praca || undefined })}`, s), [de, ate, situacao, praca]);
  const passeioIds = [...new Set((lista.dados ?? []).map((i) => i.passeioId))];
  const pontos = useCarregar(async (s) => Object.fromEntries(await Promise.all(passeioIds.map(async (id) => [id, await api.get<PontoEmbarque[]>(`/api/passeios/${id}/pontos`, s)] as const))), [passeioIds.join()]);

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Conferência de embarque</h1>
          <p className="pagina__descricao">Confira ponto de embarque, pagamento e contato de cada reserva antes do fechamento da lista (21h da véspera).</p>
        </div>
      </div>
      <div className="filtros">
        <div className="campo campo--linha"><label htmlFor="conf-de">De</label><input id="conf-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
        <div className="campo campo--linha"><label htmlFor="conf-ate">Até</label><input id="conf-ate" type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} /></div>
        <div className="campo campo--linha">
          <label htmlFor="conf-situacao">Situação</label>
          <select id="conf-situacao" value={situacao} onChange={(e) => setSituacao(e.target.value as typeof situacao)}>
            <option value="PENDENTE">A conferir</option>
            <option value="CONFERIDA">Conferidas</option>
            <option value="TODAS">Todas</option>
          </select>
        </div>
      </div>
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : lista.dados?.length === 0 ? (
        <Vazio titulo={situacao === "PENDENTE" ? "Nada a conferir neste período." : "Nenhuma reserva neste período."} />
      ) : (
        <>
          <p className="texto-fraco">{lista.dados?.length} reserva(s)</p>
          <ul className="lista-conferencia">
            {lista.dados?.map((i) => <Cartao key={i.id} item={i} pontos={pontos.dados?.[i.passeioId] ?? []} aoMudar={lista.recarregar} />)}
          </ul>
        </>
      )}
    </div>
  );
}
