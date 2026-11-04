import { api, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Indicador, Indicadores } from "../../componentes/Indicador";
import { useSessao } from "../../sessao/Sessao";
import { formatarNumero } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { BarraProporcao, FiltroPeriodo, usePeriodo } from "./comum";

interface RespostaOrigem {
  ranking: Array<{ origem: string; reservas: number; passageiros: number; percentual: number }>;
  outras: number;
  semInformacao: { reservas: number; passageiros: number };
  totalInformado: number;
}

/** Ranking da origem dos clientes (estado ou país da reserva). Só agregados. */
export function Origem() {
  const { praca } = useSessao();
  const [periodo, setPeriodo] = usePeriodo();
  const r = useCarregar((s) => api.get<RespostaOrigem>(`/api/marketing/painel/origem${qs({ de: periodo.de, ate: periodo.ate, unidadeId: praca, limite: 20 })}`, s), [periodo.de, periodo.ate, praca]);
  const d = r.dados;
  const total = d ? d.totalInformado + d.semInformacao.passageiros : 0;

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Origem dos clientes</h1>
          <p className="pagina__descricao">De onde vêm os passageiros (estado ou país, como vem na reserva), em número de passageiros.</p>
        </div>
      </div>
      <FiltroPeriodo periodo={periodo} aoMudar={setPeriodo} />
      {r.carregando && !d ? (
        <Carregando />
      ) : r.erro ? (
        <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} />
      ) : d && total === 0 ? (
        <Vazio titulo="Nenhuma venda no período." />
      ) : d ? (
        <>
          <Indicadores rotulo="Resumo">
            <Indicador tinta="verde" icone="pessoas" rotulo="Passageiros com origem" valor={formatarNumero(d.totalInformado)} />
            <Indicador tinta="ambar" icone="alerta" rotulo="Sem origem informada" valor={formatarNumero(d.semInformacao.passageiros)} detalhe={total ? `${Math.round((d.semInformacao.passageiros / total) * 100)}% do total` : undefined} />
          </Indicadores>
          {d.semInformacao.passageiros > 0 && <Aviso tipo="info">Reservas sem origem não entram no ranking. Preencher o estado ou país na conferência melhora este painel.</Aviso>}
          <section className="cartao" aria-labelledby="t-origem">
            <h2 id="t-origem">Ranking</h2>
            {d.ranking.length === 0 ? (
              <p className="texto-fraco">Nenhuma reserva do período tem origem informada.</p>
            ) : (
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead>
                    <tr><th className="num">#</th><th>Origem</th><th className="num">Reservas</th><th className="num">Passageiros</th><th>Participação</th></tr>
                  </thead>
                  <tbody>
                    {d.ranking.map((l, i) => (
                      <tr key={l.origem}>
                        <td className="num">{i + 1}</td>
                        <td>{l.origem}</td>
                        <td className="num">{formatarNumero(l.reservas)}</td>
                        <td className="num">{formatarNumero(l.passageiros)}</td>
                        <td><BarraProporcao percentual={l.percentual} rotulo={`${l.percentual.toLocaleString("pt-BR")}%`} /></td>
                      </tr>
                    ))}
                    {d.outras > 0 && (
                      <tr>
                        <td />
                        <td className="texto-fraco">Outras origens</td>
                        <td />
                        <td className="num">{formatarNumero(d.outras)}</td>
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
