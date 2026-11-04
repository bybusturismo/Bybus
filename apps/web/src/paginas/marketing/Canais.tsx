import { api, qs } from "../../api/cliente";
import { ROTULO_CANAL } from "../../util/rotulos";
import type { Canal } from "../../api/tipos";
import { Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Indicador, Indicadores } from "../../componentes/Indicador";
import { useSessao } from "../../sessao/Sessao";
import { formatarNumero } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { BarraProporcao, FiltroPeriodo, nomeMes, usePeriodo } from "./comum";

interface RespostaCanais {
  periodo: { de: string; ate: string };
  total: { reservas: number; passageiros: number };
  porCanal: Array<{ canal: Canal; reservas: number; passageiros: number; percentual: number }>;
  porPasseioMes: Array<{ mes: string; passeioId: string; passeio: string; reservas: number; passageiros: number }>;
}

/** Vendas por canal real e por passeio e mês. Só números agregados: nenhum dado de cliente. */
export function Canais() {
  const { praca } = useSessao();
  const [periodo, setPeriodo] = usePeriodo();
  const r = useCarregar((s) => api.get<RespostaCanais>(`/api/marketing/painel/canais${qs({ de: periodo.de, ate: periodo.ate, unidadeId: praca })}`, s), [periodo.de, periodo.ate, praca]);
  const d = r.dados;

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Vendas por canal</h1>
          <p className="pagina__descricao">Reservas confirmadas por data do passeio. O canal é o de origem: uma reserva espelho (ex.: Viator lançada na Paytour) conta como Viator.</p>
        </div>
      </div>
      <FiltroPeriodo periodo={periodo} aoMudar={setPeriodo} />
      {r.carregando && !d ? (
        <Carregando />
      ) : r.erro ? (
        <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} />
      ) : d && d.total.reservas === 0 ? (
        <Vazio titulo="Nenhuma venda no período." />
      ) : d ? (
        <>
          <Indicadores rotulo="Totais do período">
            <Indicador tinta="azul" icone="bilhete" rotulo="Reservas" valor={formatarNumero(d.total.reservas)} />
            <Indicador tinta="verde" icone="pessoas" rotulo="Passageiros" valor={formatarNumero(d.total.passageiros)} />
          </Indicadores>
          <section className="cartao" aria-labelledby="t-canal">
            <h2 id="t-canal">Por canal</h2>
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr><th>Canal</th><th className="num">Reservas</th><th className="num">Passageiros</th><th>Participação</th></tr>
                </thead>
                <tbody>
                  {d.porCanal.map((c) => (
                    <tr key={c.canal}>
                      <td>{ROTULO_CANAL[c.canal] ?? c.canal}</td>
                      <td className="num">{formatarNumero(c.reservas)}</td>
                      <td className="num">{formatarNumero(c.passageiros)}</td>
                      <td><BarraProporcao percentual={c.percentual} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="cartao" aria-labelledby="t-passeio-mes">
            <h2 id="t-passeio-mes">Por passeio e mês</h2>
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr><th>Mês</th><th>Passeio</th><th className="num">Reservas</th><th className="num">Passageiros</th></tr>
                </thead>
                <tbody>
                  {d.porPasseioMes.map((l) => (
                    <tr key={`${l.mes}-${l.passeioId}`}>
                      <td>{nomeMes(l.mes)}</td>
                      <td>{l.passeio}</td>
                      <td className="num">{formatarNumero(l.reservas)}</td>
                      <td className="num">{formatarNumero(l.passageiros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
