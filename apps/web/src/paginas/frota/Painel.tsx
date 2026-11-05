import { useState } from "react";
import { Link } from "react-router-dom";
import { api, qs } from "../../api/cliente";
import { Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Indicador, Indicadores } from "../../componentes/Indicador";
import { formatarData, formatarMoeda, formatarNumero, nomeMes } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { CabecalhoFrota, EtiquetaPlano, EtiquetaVencimento, formatarKm } from "./comum";
import { ROTULO_TIPO_DOC, rotuloVeiculo, type PainelFrota } from "./tipos";

export function PainelFrotaPagina() {
  const [mes, setMes] = useState("");
  const painel = useCarregar((sinal) => api.get<PainelFrota>(`/api/frota/painel${qs({ mes })}`, sinal), [mes]);
  const p = painel.dados;

  return (
    <div className="pagina">
      <CabecalhoFrota
        titulo="Frota e manutenção"
        descricao="Disponibilidade, vencimentos, manutenções e custos dos veículos."
        acoes={
          <div className="campo campo--linha">
            <label htmlFor="frota-mes">Mês</label>
            <input id="frota-mes" type="month" value={mes || p?.mes || ""} onChange={(e) => setMes(e.target.value)} />
          </div>
        }
      />
      {painel.carregando && !p ? <Carregando /> : painel.erro ? <ErroCarga mensagem={painel.erro} tentarDeNovo={painel.recarregar} /> : p && (
        <>
          <Indicadores rotulo="Resumo da frota">
            <Indicador tinta={p.disponibilidade.disponiveis === p.disponibilidade.total ? "verde" : "laranja"} icone="onibus" rotulo="Disponibilidade"
              valor={p.disponibilidade.percentual == null ? "—" : `${p.disponibilidade.percentual}%`} detalhe={`${p.disponibilidade.disponiveis} de ${p.disponibilidade.total} veículos`} />
            <Indicador tinta={p.vencimentosTotais.vencidos ? "rosa" : "verde"} icone="alerta" rotulo="Documentos vencidos" valor={p.vencimentosTotais.vencidos} detalhe={`${p.vencimentosTotais.aVencer} vencem em 30 dias`} />
            <Indicador tinta={p.manutencoes.some((m) => m.situacao === "VENCIDA") ? "rosa" : "ambar"} icone="engrenagem" rotulo="Manutenções a fazer" valor={p.manutencoes.length} detalhe={`${p.ordensAbertas} ordem(ns) aberta(s)`} />
            <Indicador tinta={p.checklist.pendentesHoje.length ? "ambar" : "verde"} icone="check" rotulo="Checklists pendentes hoje" valor={p.checklist.pendentesHoje.length} detalhe={`${p.checklist.reprovadosHoje} reprovado(s) hoje`} />
          </Indicadores>

          <div className="frota-duas-colunas">
            <section className="cartao" aria-labelledby="pf-indisponiveis">
              <h2 id="pf-indisponiveis">Veículos indisponíveis</h2>
              {p.disponibilidade.indisponiveis.length === 0 ? <p className="texto-fraco">Todos os veículos em operação estão liberados.</p> : (
                <ul className="frota-lista">
                  {p.disponibilidade.indisponiveis.map((v) => (
                    <li key={v.veiculoId}>
                      <strong>{rotuloVeiculo(v)}</strong>
                      <span className="frota-motivos">{v.motivos.map((m) => <span key={m} className="etiqueta etiqueta--perigo">{m}</span>)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="cartao" aria-labelledby="pf-venc">
              <h2 id="pf-venc">Próximos vencimentos</h2>
              {p.vencimentos.length === 0 ? <p className="texto-fraco">Nenhum documento vencido ou vencendo em 30 dias.</p> : (
                <ul className="frota-lista">
                  {p.vencimentos.map((d) => (
                    <li key={d.documentoId}>
                      <span><strong>{d.placa}</strong> · {d.descricao || ROTULO_TIPO_DOC[d.tipo]} · {formatarData(d.vencimento)}</span>
                      <EtiquetaVencimento situacao={d.situacao} dias={d.dias} />
                    </li>
                  ))}
                </ul>
              )}
              <p><Link to="/frota/documentos">Ver todos os documentos</Link></p>
            </section>

            <section className="cartao" aria-labelledby="pf-man">
              <h2 id="pf-man">Próximas manutenções</h2>
              {p.manutencoes.length === 0 ? <p className="texto-fraco">Nenhuma preventiva próxima do prazo.</p> : (
                <ul className="frota-lista">
                  {p.manutencoes.map((m) => (
                    <li key={m.planoId}>
                      <span><strong>{m.placa}</strong> · {m.nome}{m.critico && <> <span className="etiqueta etiqueta--neutra">crítica</span></>}</span>
                      <span>
                        <span className="texto-fraco">
                          {m.kmRestante != null && (m.kmRestante < 0 ? `${formatarNumero(-m.kmRestante)} km atrasada` : `faltam ${formatarNumero(m.kmRestante)} km`)}
                          {m.kmRestante != null && m.diasRestantes != null && " · "}
                          {m.diasRestantes != null && (m.diasRestantes < 0 ? `${-m.diasRestantes} dias atrasada` : `faltam ${m.diasRestantes} dias`)}
                        </span>{" "}
                        <EtiquetaPlano situacao={m.situacao} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p><Link to="/frota/manutencao">Ver planos e ordens</Link></p>
            </section>

            <section className="cartao" aria-labelledby="pf-check">
              <h2 id="pf-check">Checklist de hoje</h2>
              {p.checklist.pendentesHoje.length === 0 ? <p className="texto-fraco">Todos os veículos ativos já têm checklist hoje.</p> : (
                <ul className="frota-lista">
                  {p.checklist.pendentesHoje.map((v) => <li key={v.veiculoId}><strong>{rotuloVeiculo(v)}</strong><span className="etiqueta etiqueta--atencao">Sem checklist</span></li>)}
                </ul>
              )}
              {p.alertasConsumo.length > 0 && (
                <>
                  <h3>Consumo fora da média (30 dias)</h3>
                  <ul className="frota-lista">
                    {p.alertasConsumo.map((a) => (
                      <li key={a.abastecimentoId}>
                        <span><strong>{a.placa}</strong> · {formatarData(a.data)} · {a.kml?.toLocaleString("pt-BR")} km/l</span>
                        <span className={`etiqueta ${a.alerta === "ALTO" ? "etiqueta--perigo" : "etiqueta--atencao"}`}>{a.alerta === "ALTO" ? "Gasto alto" : "Conferir lançamento"}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>

          <section className="cartao" aria-labelledby="pf-custos">
            <h2 id="pf-custos">Custo por veículo — {nomeMes(p.mes)}</h2>
            {p.custos.length === 0 ? <Vazio titulo="Sem custos lançados neste mês." /> : (
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead>
                    <tr><th>Veículo</th><th className="frota-numero">Manutenção</th><th className="frota-numero">Combustível</th><th className="frota-numero" title="Lançamentos do financeiro (grupos Frota e Posto) com a placa do veículo">Financeiro</th><th className="frota-numero">Total</th><th className="frota-numero">Km rodados</th><th className="frota-numero">Custo por km</th></tr>
                  </thead>
                  <tbody>
                    {p.custos.map((c) => (
                      <tr key={c.veiculoId}>
                        <td>{rotuloVeiculo(c)}</td>
                        <td className="frota-numero">{formatarMoeda(c.manutencaoCentavos)}</td>
                        <td className="frota-numero">{formatarMoeda(c.combustivelCentavos)}</td>
                        <td className="frota-numero">{formatarMoeda(c.financeiroCentavos ?? 0)}</td>
                        <td className="frota-numero"><strong>{formatarMoeda(c.totalCentavos)}</strong></td>
                        <td className="frota-numero">{formatarKm(c.kmRodados || null)}</td>
                        <td className="frota-numero">{c.custoPorKmCentavos == null ? "—" : formatarMoeda(c.custoPorKmCentavos)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Total da frota</th>
                      <th className="frota-numero">{formatarMoeda(p.totais.manutencaoCentavos)}</th>
                      <th className="frota-numero">{formatarMoeda(p.totais.combustivelCentavos)}</th>
                      <th className="frota-numero">{formatarMoeda(p.totais.financeiroCentavos ?? 0)}</th>
                      <th className="frota-numero">{formatarMoeda(p.totais.manutencaoCentavos + p.totais.combustivelCentavos + (p.totais.financeiroCentavos ?? 0))}</th>
                      <th colSpan={2} className="frota-numero">{p.totais.mediaKml != null && `Média ${p.totais.mediaKml.toLocaleString("pt-BR")} km/l`}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
