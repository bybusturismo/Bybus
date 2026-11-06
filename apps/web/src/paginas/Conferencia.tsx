import { useState } from "react";
import { Link } from "react-router-dom";
import { api, mensagemDeErro, qs } from "../api/cliente";
import type { ItemConferencia, PontoEmbarque } from "../api/tipos";
import { Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { useNotificar } from "../componentes/Notificacoes";
import { CabecalhoPagina, FaixaNumeros } from "../componentes/Pagina";
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

function Linha({ item, pontos, aoMudar }: { item: ItemConferencia; pontos: PontoEmbarque[]; aoMudar: () => Promise<void> }) {
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
    <tr className={conferida ? "linha--ok" : item.alertas.length > 0 ? "linha--atencao" : undefined}>
      <td>
        <strong>{item.contatoNome}</strong>
        <div className="texto-fraco">{item.passageiros} pax ({resumoCategorias(item.categorias)}){item.origemCliente ? ` · ${item.origemCliente}` : ""}</div>
        {item.alertas.length > 0 && (
          <div className="conferencia__alertas">
            {item.alertas.map((a) => <span key={a} className="etiqueta etiqueta--perigo">{a}</span>)}
          </div>
        )}
        {erro && <div className="texto-perigo" role="alert">{erro}</div>}
      </td>
      <td className="sem-quebra" data-rotulo="Passeio"><Link to={`/saidas/${item.saidaId}`}>{formatarDataCurta(item.data)}</Link><div className="texto-fraco">{item.passeio}</div></td>
      <td data-rotulo="Canal">{ROTULO_CANAL[item.canal] ?? item.canal}{item.codigoExterno ? <div className="texto-fraco mono">{item.codigoExterno}</div> : null}</td>
      <td data-rotulo="Pagamento">{item.pagamento ? <span className={`etiqueta ${item.pagamento === "A_PAGAR" ? "etiqueta--atencao" : "etiqueta--neutra"}`}>{ROTULO_PAGAMENTO[item.pagamento]}</span> : "—"}{item.formaPagamento ? <div className="texto-fraco">{item.formaPagamento}</div> : null}</td>
      <td className="sem-quebra" data-rotulo="Contato">{item.contatoTelefone ?? <span className="texto-fraco">sem telefone</span>}</td>
      <td data-rotulo="Informado pelo cliente">{item.hospedagemInformada ? `${item.hospedagemInformada}${item.pediuTransfer ? " (transfer)" : ""}` : <span className="texto-fraco">nada ainda</span>}</td>
      <td data-rotulo="Ponto de embarque">
        <label className="visualmente-oculto" htmlFor={`ponto-${item.id}`}>Ponto de embarque de {item.contatoNome}</label>
        <select id={`ponto-${item.id}`} value={pontoId} onChange={(e) => setPontoId(e.target.value)}>
          <option value="">Ponto de embarque…</option>
          {pontos.filter((p) => p.ativo !== false || p.id === pontoId).map((p) => <option key={p.id} value={p.id}>{p.horario} — {p.nome}{p.ativo === false ? " (inativo)" : ""}</option>)}
        </select>
      </td>
      <td className="celula-acoes">
        <button type="button" className="botao botao--primario botao--pequeno" disabled={ocupado || !pontoId} onClick={() => void conferir()}>
          {conferida ? "Conferir de novo" : "Confirmar embarque"}
        </button>{" "}
        <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void copiarLink()}>
          {item.linkGerado ? "Novo link" : "Link para o cliente"}
        </button>
      </td>
    </tr>
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
      <CabecalhoPagina
        titulo="Conferência de embarque"
        descricao="Confira ponto de embarque, pagamento e contato de cada reserva antes do fechamento da lista (21h da véspera)."
        filtros={
          <>
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
          </>
        }
      />
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : lista.dados?.length === 0 ? (
        <Vazio titulo={situacao === "PENDENTE" ? "Nada a conferir neste período." : "Nenhuma reserva neste período."} />
      ) : (
        <>
          <FaixaNumeros
            rotulo="Resumo da conferência"
            itens={[
              { rotulo: "reserva(s)", valor: lista.dados?.length ?? 0 },
              { rotulo: "a conferir", valor: (lista.dados ?? []).filter((i) => i.conferencia !== "CONFERIDA").length, tom: "atencao" },
              { rotulo: "com alerta", valor: (lista.dados ?? []).filter((i) => i.alertas.length > 0).length, tom: "perigo" },
            ]}
          />
          <div className="tabela-rolagem">
            <table className="tabela tabela--conferencia tabela--cartoes">
              <thead>
                <tr><th>Titular</th><th>Passeio</th><th>Canal</th><th>Pagamento</th><th>Contato</th><th>Informado pelo cliente</th><th>Ponto de embarque</th><th /></tr>
              </thead>
              <tbody>
                {lista.dados?.map((i) => <Linha key={i.id} item={i} pontos={pontos.dados?.[i.passeioId] ?? []} aoMudar={lista.recarregar} />)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
