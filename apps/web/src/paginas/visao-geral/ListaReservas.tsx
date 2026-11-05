import { Link, useSearchParams } from "react-router-dom";
import "../../estilos/visao-geral.css";
import { api, qs } from "../../api/cliente";
import type { Canal, Passeio } from "../../api/tipos";
import { Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { useSessao } from "../../sessao/Sessao";
import { formatarData, formatarDataHora, formatarMoeda, formatarNumero, hojeIso, somarDias } from "../../util/formato";
import { ROTULO_CANAL } from "../../util/rotulos";
import { useCarregar } from "../../util/useCarregar";
import type { ListaReservas } from "./tipos";

const PENDENCIAS: Record<string, string> = {
  a_conferir: "Reservas a conferir", sem_ponto: "Sem ponto de embarque", a_pagar: "Pagar no embarque", formulario: "Formulário de embarque pendente",
};

/** Listagem geral de reservas (a lista de uma saída continua em /saidas/:id/reservas). Os filtros ficam na URL. */
export function ListaDeReservas() {
  const { praca, pode } = useSessao();
  const [params, setParams] = useSearchParams();
  const pendencia = params.get("pendencia") ?? "";
  const hoje = hojeIso();
  const de = params.get("de") ?? (pendencia ? hoje : hoje);
  const ate = params.get("ate") ?? somarDias(de, 30);
  const f = {
    de, ate, passeioId: params.get("passeioId") ?? "", canal: params.get("canal") ?? "", situacao: params.get("situacao") ?? "",
    conferencia: params.get("conferencia") ?? "", busca: params.get("busca") ?? "", pagina: Number(params.get("pagina") ?? 1) || 1,
  };
  const mudar = (campo: string, valor: string) => {
    const p = new URLSearchParams(params);
    if (valor) p.set(campo, valor); else p.delete(campo);
    if (campo !== "pagina") p.delete("pagina");
    setParams(p, { replace: true });
  };
  const passeios = useCarregar((s) => api.get<Passeio[]>("/api/passeios", s), []);
  const lista = (passeios.dados ?? []).filter((p) => !praca || p.unidadeId === praca);
  const r = useCarregar((s) => api.get<ListaReservas>(`/api/reservas${qs({ ...f, pendencia, unidadeId: praca, limite: 50, de: params.get("de") ?? (pendencia ? "" : f.de), ate: params.get("ate") ?? (pendencia ? "" : f.ate) })}`, s), [params.toString(), praca]);
  const d = r.dados;
  const paginas = d ? Math.max(1, Math.ceil(d.total / d.limite)) : 1;

  return (
    <div className="pagina vg">
      <div className="pagina__cabecalho">
        <div>
          <h1>Listagem de reservas</h1>
          <p className="pagina__descricao">Por data do passeio. {pendencia && <>Filtrado por: <strong>{PENDENCIAS[pendencia] ?? pendencia}</strong> (passeios de hoje em diante). <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => mudar("pendencia", "")}>Limpar</button></>}</p>
        </div>
      </div>
      <form className="lr-filtros" role="search" aria-label="Filtros das reservas" onSubmit={(e) => e.preventDefault()}>
        <div className="campo"><label htmlFor="lr-de">De</label><input id="lr-de" type="date" value={d?.periodo.de ?? de} onChange={(e) => mudar("de", e.target.value)} /></div>
        <div className="campo"><label htmlFor="lr-ate">Até</label><input id="lr-ate" type="date" value={d?.periodo.ate ?? ate} onChange={(e) => mudar("ate", e.target.value)} /></div>
        <div className="campo"><label htmlFor="lr-passeio">Passeio</label>
          <select id="lr-passeio" value={f.passeioId} onChange={(e) => mudar("passeioId", e.target.value)}><option value="">Todos</option>{lista.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>
        <div className="campo"><label htmlFor="lr-canal">Canal</label>
          <select id="lr-canal" value={f.canal} onChange={(e) => mudar("canal", e.target.value)}><option value="">Todos</option>{Object.entries(ROTULO_CANAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="campo"><label htmlFor="lr-sit">Situação</label>
          <select id="lr-sit" value={f.situacao} onChange={(e) => mudar("situacao", e.target.value)}><option value="">Todas</option><option value="CONFIRMADA">Confirmada</option><option value="CANCELADA">Cancelada</option></select></div>
        <div className="campo"><label htmlFor="lr-conf">Conferência</label>
          <select id="lr-conf" value={f.conferencia} onChange={(e) => mudar("conferencia", e.target.value)}><option value="">Todas</option><option value="PENDENTE">A conferir</option><option value="CONFERIDA">Conferida</option></select></div>
        <div className="campo"><label htmlFor="lr-busca">Nome ou código</label><input id="lr-busca" type="search" value={f.busca} maxLength={80} onChange={(e) => mudar("busca", e.target.value)} placeholder="Buscar…" /></div>
      </form>
      {r.erro ? <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} /> : !d ? <Carregando /> : d.reservas.length === 0 ? <Vazio titulo="Nenhuma reserva com esses filtros." /> : (
        <>
          <div className="tabela-rolagem">
            <table className="tabela lr-tabela">
              <thead>
                <tr><th>Passeio</th><th>Data</th><th>Titular</th><th>Código</th><th>Canal</th><th className="num">Pax</th><th>Situação</th><th>Conferência</th><th>Pagamento</th><th>Embarque</th>{pode("financeiro:ver") && <th className="num">Valor</th>}<th>Comprada em</th></tr>
              </thead>
              <tbody>
                {d.reservas.map((x) => (
                  <tr key={x.id}>
                    <td>{x.passeio}</td>
                    <td><Link to={`/saidas/${x.saidaId}/reservas`}>{formatarData(x.data)}</Link></td>
                    <td>{x.contatoNome}</td>
                    <td>{x.codigoExterno ?? "—"}</td>
                    <td>{ROTULO_CANAL[x.canal as Canal] ?? x.canal}</td>
                    <td className="num">{x.passageiros}</td>
                    <td>{x.status === "CANCELADA" ? "Cancelada" : "Confirmada"}</td>
                    <td>{x.conferencia === "CONFERIDA" ? "Conferida" : "A conferir"}</td>
                    <td>{x.formaPagamento ?? (x.pagamento === "A_PAGAR" ? "Pagar no embarque" : x.pagamento === "PAGO" ? "Pago" : "—")}</td>
                    <td>{x.pontoEmbarque ?? "Sem ponto"}{x.formularioPendente ? " · form. pendente" : ""}</td>
                    {pode("financeiro:ver") && <td className="num">{x.valorCentavos != null ? formatarMoeda(x.valorCentavos) : "—"}</td>}
                    <td>{x.compraEm ? formatarDataHora(x.compraEm) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="lr-pag">
            <span>{formatarNumero(d.total)} reservas · página {d.pagina} de {paginas}</span>
            <span>
              <button type="button" className="botao botao--secundario botao--pequeno" disabled={d.pagina <= 1} onClick={() => mudar("pagina", String(d.pagina - 1))}>Anterior</button>{" "}
              <button type="button" className="botao botao--secundario botao--pequeno" disabled={d.pagina >= paginas} onClick={() => mudar("pagina", String(d.pagina + 1))}>Próxima</button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
