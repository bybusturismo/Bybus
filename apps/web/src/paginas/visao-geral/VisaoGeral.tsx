import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import "../../estilos/visao-geral.css";
import { api, qs } from "../../api/cliente";
import type { Passeio } from "../../api/tipos";
import { Carregando, ErroCarga } from "../../componentes/Estados";
import { Icone, type NomeIcone } from "../../componentes/Icone";
import { useSessao } from "../../sessao/Sessao";
import { formatarMoeda, formatarNumero, hojeIso, somarDias } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { BarrasEmpilhadas, BarrasSimples, Linhas, Pizza, type Serie } from "./graficos";
import {
  CANAIS_GRAFICO, ROTULO_CANAL_GRAFICO, ROTULO_FORMA_PAGAMENTO,
  type CanalGrafico, type Comparativo, type DiaSemana, type Emissores, type Faturamento, type HorarioCompra, type Pagamentos, type PasseiosVendidos, type Resumo,
} from "./tipos";

const serieDoCanal = (c: CanalGrafico): Serie => ({ chave: c, rotulo: ROTULO_CANAL_GRAFICO[c], classe: `vg-c--${c}` });
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ORDEM_SEMANA = [1, 2, 3, 4, 5, 6, 0]; // segunda a domingo
const reais = (c: number) => formatarMoeda(c);
const reaisCurto = (c: number) => (c >= 100_000 ? `${formatarNumero(Math.round(c / 100_000) / 10)} mil` : formatarMoeda(c).replace(",00", ""));
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

interface Filtro { de: string; ate: string }

function Bloco({ id, titulo, filtros, largo, children }: { id: string; titulo: string; filtros?: ReactNode; largo?: boolean; children: ReactNode }) {
  return (
    <section className={`vg-bloco${largo ? " vg-bloco--largo" : ""}`} aria-labelledby={id}>
      <div className="vg-bloco__topo">
        <h2 id={id}>{titulo}</h2>
        {filtros && <div className="vg-bloco__filtros">{filtros}</div>}
      </div>
      {children}
    </section>
  );
}

function Estado<T>({ r, vazio, children }: { r: ReturnType<typeof useCarregar<T>>; vazio?: (d: T) => boolean; children: (d: T) => ReactNode }) {
  if (r.erro) return <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} />;
  if (!r.dados) return <Carregando />;
  if (vazio?.(r.dados)) return <p className="vg-vazio">Sem vendas no período.</p>;
  return <>{children(r.dados)}</>;
}

function SeletorPasseio({ id, passeios, valor, aoMudar }: { id: string; passeios: Passeio[]; valor: string; aoMudar: (v: string) => void }) {
  return (
    <>
      <label htmlFor={id} className="sr-only">Passeio</label>
      <select id={id} value={valor} onChange={(e) => aoMudar(e.target.value)} aria-label="Filtrar por passeio">
        <option value="">Todos os passeios</option>
        {passeios.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
      </select>
    </>
  );
}
function SeletorCanal({ id, valor, aoMudar }: { id: string; valor: string; aoMudar: (v: string) => void }) {
  return (
    <>
      <label htmlFor={id} className="sr-only">Canal</label>
      <select id={id} value={valor} onChange={(e) => aoMudar(e.target.value)} aria-label="Filtrar por canal">
        <option value="">Todos os canais</option>
        {CANAIS_GRAFICO.map((c) => <option key={c} value={c}>{ROTULO_CANAL_GRAFICO[c]}</option>)}
      </select>
    </>
  );
}

function Rank({ itens }: { itens: Array<{ chave: string; nome: string; numeros: string; percentual: number }> }) {
  return (
    <ol className="vg-rank">
      {itens.map((i) => (
        <li key={i.chave}>
          <span className="vg-rank__nome" title={i.nome}>{i.nome}</span>
          <span className="vg-rank__nums">{i.numeros}</span>
          <span className="vg-rank__barra" aria-hidden="true"><span style={{ width: `${Math.min(100, i.percentual)}%` }} /></span>
        </li>
      ))}
    </ol>
  );
}
const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export function VisaoGeral() {
  const { pode, praca } = useSessao();
  const verAnalise = pode("marketing:ver") || pode("financeiro:ver");
  const verValores = pode("financeiro:ver");
  const hoje = hojeIso();
  const [periodo, setPeriodo] = useState<Filtro>({ de: somarDias(hoje, -29), ate: hoje });
  const [passeioEmissores, setPasseioEmissores] = useState("");
  const [canalSemana, setCanalSemana] = useState("");
  const [passeioFat, setPasseioFat] = useState("");
  const [canalFat, setCanalFat] = useState("");
  const [passeioPag, setPasseioPag] = useState("");
  const [canalPas, setCanalPas] = useState("");

  const base = { de: periodo.de, ate: periodo.ate, unidadeId: praca };
  const resumo = useCarregar((s) => api.get<Resumo>(`/api/visao-geral/resumo${qs({ unidadeId: praca })}`, s), [praca]);
  const passeios = useCarregar((s) => (verAnalise ? api.get<Passeio[]>("/api/passeios", s) : Promise.resolve([] as Passeio[])), [verAnalise]);
  const lista = (passeios.dados ?? []).filter((p) => !praca || p.unidadeId === praca);
  const r = resumo.dados;

  const emissores = useCarregar((s) => (verAnalise ? api.get<Emissores>(`/api/visao-geral/emissores${qs({ ...base, passeioId: passeioEmissores })}`, s) : Promise.resolve(null)), [verAnalise, periodo.de, periodo.ate, praca, passeioEmissores]);
  const comparativo = useCarregar((s) => (verAnalise && verValores ? api.get<Comparativo>(`/api/visao-geral/comparativo${qs(base)}`, s) : Promise.resolve(null)), [verAnalise, verValores, periodo.de, periodo.ate, praca]);
  const semana = useCarregar((s) => (verAnalise ? api.get<DiaSemana>(`/api/visao-geral/dia-semana${qs({ ...base, canal: canalSemana })}`, s) : Promise.resolve(null)), [verAnalise, periodo.de, periodo.ate, praca, canalSemana]);
  const horario = useCarregar((s) => (verAnalise ? api.get<HorarioCompra>(`/api/visao-geral/horario-compra${qs(base)}`, s) : Promise.resolve(null)), [verAnalise, periodo.de, periodo.ate, praca]);
  const vendidos = useCarregar((s) => (verAnalise ? api.get<PasseiosVendidos>(`/api/visao-geral/passeios${qs({ ...base, canal: canalPas })}`, s) : Promise.resolve(null)), [verAnalise, periodo.de, periodo.ate, praca, canalPas]);
  const pagamentos = useCarregar((s) => (verAnalise ? api.get<Pagamentos>(`/api/visao-geral/pagamentos${qs({ ...base, passeioId: passeioPag })}`, s) : Promise.resolve(null)), [verAnalise, periodo.de, periodo.ate, praca, passeioPag]);
  const faturamento = useCarregar((s) => (verAnalise && verValores ? api.get<Faturamento>(`/api/visao-geral/faturamento${qs({ ...base, passeioId: passeioFat, canal: canalFat })}`, s) : Promise.resolve(null)), [verAnalise, verValores, periodo.de, periodo.ate, praca, passeioFat, canalFat]);

  const so = r?.saidasHoje ?? [];
  const checkinDe = so.length === 1 ? `/saidas/${so[0]!.id}/embarque` : "/listas/saidas";
  const checkinsPendentes = so.reduce((t, s) => t + s.checkinsPendentes, 0);
  const totalPendencias = r ? r.pendencias.aConferir + r.pendencias.semPonto + r.pendencias.aPagarNoEmbarque + r.pendencias.formularioPendente : 0;
  const variacao = r?.faturamentoMes.valorCentavos != null && r.faturamentoMes.mesAnteriorCentavos
    ? Math.round(((r.faturamentoMes.valorCentavos - r.faturamentoMes.mesAnteriorCentavos) / r.faturamentoMes.mesAnteriorCentavos) * 100)
    : null;

  const atalho = (para: string, rotulo: string, icone: NomeIcone, ok = true) => ok && (
    <Link to={para} className="botao botao--secundario botao--pequeno"><Icone nome={icone} tamanho={16} /> {rotulo}</Link>
  );

  return (
    <div className="pagina vg">
      <div className="pagina__cabecalho">
        <div>
          <h1>Visão geral</h1>
          <p className="pagina__descricao">Vendas por data da compra; saídas e pendências por data do passeio. {verValores && " Reservas sem preço (ex.: Decolar) não entram nos totais em R$."}</p>
        </div>
        <div className="filtros" role="group" aria-label="Período dos gráficos">
          <div className="campo campo--linha">
            <label htmlFor="vg-de">De</label>
            <input id="vg-de" type="date" value={periodo.de} max={periodo.ate} onChange={(e) => e.target.value && setPeriodo({ ...periodo, de: e.target.value })} />
          </div>
          <div className="campo campo--linha">
            <label htmlFor="vg-ate">Até</label>
            <input id="vg-ate" type="date" value={periodo.ate} min={periodo.de} onChange={(e) => e.target.value && setPeriodo({ ...periodo, ate: e.target.value })} />
          </div>
        </div>
      </div>

      <nav className="vg-atalhos" aria-label="Atalhos">
        {atalho("/listas/saidas?acao=nova-reserva", "Nova reserva", "mais", pode("reservas:editar"))}
        {atalho("/listas/saidas", "Disponibilidade", "calendario")}
        {atalho(checkinDe, "Fazer check-in", "check", pode("embarque:registrar"))}
        {atalho("/passeios", "Atividades", "bilhete", pode("produtos:gerenciar"))}
        {atalho("/reservas", "Listagem de reservas", "lista")}
      </nav>

      {resumo.erro ? <ErroCarga mensagem={resumo.erro} tentarDeNovo={resumo.recarregar} /> : !r ? <Carregando /> : (
        <>
          <section className="vg-cartoes" aria-label="Indicadores">
            {r.faturamentoMes.valorCentavos !== null ? (
              <div className="vg-cartao">
                <span className="vg-cartao__rotulo">Vendas do mês · pela data da compra</span>
                <span className="vg-cartao__valor">{reais(r.faturamentoMes.valorCentavos)}</span>
                <span className="vg-cartao__detalhe">
                  {formatarNumero(r.faturamentoMes.reservas)} reservas
                  {variacao !== null && <> · <span className={variacao >= 0 ? "vg-variacao--alta" : "vg-variacao--baixa"}>{variacao >= 0 ? "+" : ""}{variacao}%</span> vs. mês anterior até hoje</>}
                  {r.faturamentoMes.semValor > 0 && <> · {r.faturamentoMes.semValor} sem valor</>}
                </span>
                {pode("financeiro:ver") && <Link className="vg-cartao__detalhe" to="/financeiro">Ver faturamento no Resumo financeiro</Link>}
              </div>
            ) : (
              <div className="vg-cartao">
                <span className="vg-cartao__rotulo">Reservas do mês</span>
                <span className="vg-cartao__valor">{formatarNumero(r.faturamentoMes.reservas)}</span>
              </div>
            )}
            <div className="vg-cartao">
              <span className="vg-cartao__rotulo">Cupons usados no mês</span>
              <span className="vg-cartao__valor">{formatarNumero(r.cupons.usos)}</span>
              <span className="vg-cartao__detalhe">
                {r.cupons.descontoCentavos !== null && <>Desconto total {reais(r.cupons.descontoCentavos)}</>}
                {r.cupons.porCupom.length > 0 && <>{r.cupons.descontoCentavos !== null ? " · " : ""}Cupom {r.cupons.porCupom.map((c) => `#${c.cupomId} (${c.usos})`).join(", ")}</>}
              </span>
            </div>
            <div className={`vg-cartao${totalPendencias > 0 ? " vg-cartao--alerta" : ""}`}>
              <span className="vg-cartao__rotulo">Pendências (de hoje em diante)</span>
              <ul className="vg-pendencias">
                <li><Link to="/reservas?pendencia=a_conferir">Reservas a conferir <b>{r.pendencias.aConferir}</b></Link></li>
                <li><Link to="/reservas?pendencia=sem_ponto">Sem ponto de embarque <b>{r.pendencias.semPonto}</b></Link></li>
                <li><Link to="/reservas?pendencia=a_pagar">Pagar no embarque <b>{r.pendencias.aPagarNoEmbarque}</b></Link></li>
                <li><Link to="/reservas?pendencia=formulario">Formulário de embarque pendente <b>{r.pendencias.formularioPendente}</b></Link></li>
              </ul>
            </div>
            <div className="vg-cartao">
              <span className="vg-cartao__rotulo">Check-ins pendentes hoje</span>
              <span className="vg-cartao__valor">{formatarNumero(checkinsPendentes)}</span>
              <span className="vg-cartao__detalhe">{so.length} {so.length === 1 ? "saída" : "saídas"} hoje</span>
            </div>
            <div className="vg-cartao">
              <span className="vg-cartao__rotulo">Aguardando pagamento</span>
              <span className="vg-cartao__valor">{r.aguardandoPagamento.saldoCentavos !== null ? reais(r.aguardandoPagamento.saldoCentavos) : formatarNumero(r.aguardandoPagamento.pedidos)}</span>
              <span className="vg-cartao__detalhe">{formatarNumero(r.aguardandoPagamento.pedidos)} pedidos com saldo a receber</span>
            </div>
            {r.comissaoAfiliados.totalCentavos !== null && (
              <div className="vg-cartao">
                <span className="vg-cartao__rotulo">Comissão de afiliados no mês</span>
                <span className="vg-cartao__valor">{reais(r.comissaoAfiliados.totalCentavos)}</span>
                <span className="vg-cartao__detalhe">{formatarNumero(r.comissaoAfiliados.pedidos)} pedidos de afiliados</span>
              </div>
            )}
            {r.whatsapp.disponivel && r.whatsapp.naoLidas !== null && (
              <div className="vg-cartao">
                <span className="vg-cartao__rotulo">WhatsApp não lidas</span>
                <span className="vg-cartao__valor">{formatarNumero(r.whatsapp.naoLidas)}</span>
              </div>
            )}
          </section>

          <Bloco id="vg-hoje" titulo="Saídas de hoje">
            {so.length === 0 ? <p className="vg-vazio">Nenhuma saída hoje.</p> : (
              <div className="vg-hoje">
                {so.map((s) => (
                  <div key={s.id} className="vg-hoje__linha">
                    <Link to={`/saidas/${s.id}`}><strong>{s.passeio}</strong></Link>
                    <div className={`vg-ocupacao${s.ocupacao >= 90 ? " vg-ocupacao--cheia" : ""}`} role="img" aria-label={`${s.vendidos} de ${s.capacidade} lugares, ${s.ocupacao}% de ocupação`}>
                      <span className="vg-ocupacao__trilho" aria-hidden="true"><span style={{ width: `${Math.min(100, s.ocupacao)}%` }} /></span>
                      <span>{s.vendidos}/{s.capacidade} ({s.ocupacao}%)</span>
                    </div>
                    <span className="vg-hoje__equipe">Guia: {s.guia ?? "a definir"} · Motorista: {s.motorista ?? "a definir"}{s.veiculo ? ` · ${s.veiculo}` : ""}</span>
                    <span>{s.checkinsPendentes > 0 ? <Link to={`/saidas/${s.id}/embarque`}>{s.checkinsPendentes} check-ins pendentes</Link> : "Check-ins em dia"}</span>
                  </div>
                ))}
              </div>
            )}
          </Bloco>
        </>
      )}

      {verAnalise && (
        <div className="vg-grade">
          {verValores && (
          <Bloco id="vg-fat" titulo="Vendas por período" largo filtros={<><Link to="/financeiro">Ver faturamento no Resumo financeiro</Link><SeletorPasseio id="vg-fat-p" passeios={lista} valor={passeioFat} aoMudar={setPasseioFat} /><SeletorCanal id="vg-fat-c" valor={canalFat} aoMudar={setCanalFat} /></>}>
            {(
              <Estado r={faturamento} vazio={(d) => !d || d.pontos.length === 0}>
                {(d) => d && (
                  <>
                    <p className="vg-nota">Total {reais(d.totalCentavos)} · vendas pela data da compra (não é o faturamento por competência), barras por {d.agrupamento === "mes" ? "mês" : "dia"} e empilhadas por canal.</p>
                    <BarrasEmpilhadas
                      titulo="Vendas por período e canal" descricao={`Total de ${reais(d.totalCentavos)} entre ${dataCurta(d.periodo.de)} e ${dataCurta(d.periodo.ate)}.`}
                      categorias={d.pontos.map((p) => ({ chave: p.chave, rotulo: d.agrupamento === "mes" ? p.chave.slice(5) + "/" + p.chave.slice(2, 4) : dataCurta(p.chave), rotuloLongo: d.agrupamento === "mes" ? p.chave : dataCurta(p.chave), valores: p.porCanal }))}
                      series={CANAIS_GRAFICO.map(serieDoCanal)} formato={reaisCurto}
                    />
                  </>
                )}
              </Estado>
            )}
          </Bloco>
          )}

          <Bloco id="vg-sem" titulo="Reservas por dia da semana" filtros={<SeletorCanal id="vg-sem-c" valor={canalSemana} aoMudar={setCanalSemana} />}>
            <Estado r={semana} vazio={(d) => !d || d.dias.every((x) => x.total === 0)}>
              {(d) => d && (
                <BarrasEmpilhadas
                  titulo="Reservas por dia da semana" descricao="Reservas compradas em cada dia da semana, empilhadas por canal."
                  categorias={ORDEM_SEMANA.map((i) => ({ chave: String(i), rotulo: DIAS_SEMANA[i]!, valores: d.dias[i]!.porCanal }))}
                  series={CANAIS_GRAFICO.map(serieDoCanal)} formato={(n) => formatarNumero(Math.round(n))}
                />
              )}
            </Estado>
          </Bloco>

          <Bloco id="vg-hor" titulo="Reservas por horário da compra">
            <Estado r={horario} vazio={(d) => !d || d.faixas.every((f) => f.site + f.admin === 0)}>
              {(d) => d && (
                <>
                  <Linhas
                    titulo="Reservas por faixa de horário da compra" descricao="Duas linhas: compras pelo site e pelo admin, em faixas de quatro horas."
                    categorias={d.faixas.map((f) => f.rotulo)}
                    series={[
                      { chave: "site", rotulo: "Site", classe: "vg-c--SITE", valores: d.faixas.map((f) => f.site) },
                      { chave: "admin", rotulo: "Admin", classe: "vg-c--ADMIN", valores: d.faixas.map((f) => f.admin) },
                    ]}
                    formato={(n) => formatarNumero(Math.round(n))}
                  />
                  <p className="vg-nota">{d.nota}</p>
                </>
              )}
            </Estado>
          </Bloco>

          <Bloco id="vg-pas" titulo="Passeios mais vendidos" filtros={<SeletorCanal id="vg-pas-c" valor={canalPas} aoMudar={setCanalPas} />}>
            <Estado r={vendidos} vazio={(d) => !d || d.passeios.length === 0}>
              {(d) => d && (
                <>
                  <Rank itens={d.passeios.map((p) => ({ chave: p.passeioId, nome: p.passeio, numeros: `${p.valorCentavos !== null ? `${reais(p.valorCentavos)} · ` : ""}${p.reservas} res. · ${pct(p.percentual)}`, percentual: p.percentual }))} />
                  <p className="vg-nota">% sobre {d.baseDoPercentual === "valor" ? "o faturamento" : "os passageiros"} do período.</p>
                </>
              )}
            </Estado>
          </Bloco>

          <Bloco id="vg-pag" titulo="Métodos de pagamento" filtros={<SeletorPasseio id="vg-pag-p" passeios={lista} valor={passeioPag} aoMudar={setPasseioPag} />}>
            <Estado r={pagamentos} vazio={(d) => !d || d.formas.length === 0}>
              {(d) => d && (
                <>
                  <Pizza
                    titulo="Métodos de pagamento" descricao="Participação de cada forma de pagamento no período."
                    fatias={d.formas.map((f) => ({ chave: f.forma, rotulo: ROTULO_FORMA_PAGAMENTO[f.forma] ?? f.forma, valor: d.baseDoPercentual === "valor" ? f.valorCentavos ?? 0 : f.reservas, texto: `${f.valorCentavos !== null ? `${reais(f.valorCentavos)} · ` : ""}${f.reservas} · ${pct(f.percentual)}` }))}
                  />
                  <p className="vg-nota">% sobre {d.baseDoPercentual === "valor" ? "o faturamento" : "as reservas"}.</p>
                </>
              )}
            </Estado>
          </Bloco>

          <Bloco id="vg-emi" titulo="Maiores emissores (cidade/UF)" filtros={<SeletorPasseio id="vg-emi-p" passeios={lista} valor={passeioEmissores} aoMudar={setPasseioEmissores} />}>
            <Estado r={emissores} vazio={(d) => !d || d.emissores.length === 0}>
              {(d) => d && (
                <>
                  <div className="tabela-rolagem">
                    <table className="tabela tabela--compacta">
                      <thead><tr><th>Cidade</th><th>UF</th>{d.total.valorCentavos !== null && <th className="num">R$</th>}<th className="num">Reservas</th><th className="num">%</th></tr></thead>
                      <tbody>
                        {d.emissores.map((e) => (
                          <tr key={`${e.cidade}-${e.uf}`}>
                            <td>{e.cidade}</td><td>{e.uf}</td>
                            {e.valorCentavos !== null && <td className="num">{reais(e.valorCentavos)}</td>}
                            <td className="num">{e.reservas}</td><td className="num">{pct(e.percentual)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="vg-nota">Cidade do cliente informada no pedido; para estrangeiros, a coluna UF mostra o país. % sobre {d.baseDoPercentual === "valor" ? "o faturamento" : "as reservas"}.</p>
                </>
              )}
            </Estado>
          </Bloco>

          {verValores && (
            <Bloco id="vg-comp" titulo="Comparativo dos últimos 3 anos (mesmo período)">
              <Estado r={comparativo} vazio={(d) => !d || d.anos.every((a) => a.reservas === 0)}>
                {(d) => d && (
                  <>
                    <BarrasSimples
                      titulo="Faturamento no mesmo período, nos últimos três anos" descricao="Uma barra por ano, com o mesmo intervalo de datas."
                      itens={[...d.anos].reverse().map((a, i, todos) => ({ chave: String(a.ano), rotulo: String(a.ano), valor: a.valorCentavos, destaque: i === todos.length - 1 }))}
                      formato={reaisCurto}
                    />
                    {d.semHistorico && <p className="vg-nota">Anos anteriores sem vendas: o histórico ainda não foi importado.</p>}
                  </>
                )}
              </Estado>
            </Bloco>
          )}

          <Bloco id="vg-ota" titulo="Vendas por canal (resumo)" filtros={pode("marketing:ver") ? <Link to="/marketing/canais">Ver vendas por canal no Marketing</Link> : undefined}>
            {verValores && faturamento.dados && faturamento.dados.totalCentavos > 0 && (
              <Rank itens={Object.entries(faturamento.dados.totaisPorCanal).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([c, v]) => ({
                chave: c, nome: ROTULO_CANAL_GRAFICO[c as keyof typeof ROTULO_CANAL_GRAFICO] ?? c, numeros: `${reais(v)} · ${pct(Math.round((v / faturamento.dados!.totalCentavos) * 1000) / 10)}`, percentual: (v / faturamento.dados!.totalCentavos) * 100,
              }))} />
            )}
            <p className="vg-nota">Reserva espelho (ex.: Viator lançada na Paytour) conta no canal de origem, igual em Vendas por canal.</p>
            <p className="vg-oculto-nao-integrado">{(r?.ota.naoIntegradas ?? ["GetYourGuide"]).join(", ")}: não integrado.</p>
          </Bloco>
        </div>
      )}
    </div>
  );
}
