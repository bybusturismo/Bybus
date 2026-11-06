import { useState } from "react";
import { Link } from "react-router-dom";
import { api, qs } from "../../api/cliente";
import { Carregando, ErroCarga } from "../../componentes/Estados";
import { Indicador, Indicadores } from "../../componentes/Indicador";
import { nomePraca, useSessao } from "../../sessao/Sessao";
import { formatarData, formatarMoeda, hojeIso, nomeMes, somarMes } from "../../util/formato";
import { ROTULO_LINHA } from "../../util/rotulos";
import { useCarregar } from "../../util/useCarregar";
import type { RespostaResumo } from "./tipos";
import { formatarMargem } from "./util";

const sinal = (v: number) => (v < 0 ? "fin-valor--saida" : v > 0 ? "fin-valor--entrada" : "");

export function Resumo() {
  const { praca, unidades } = useSessao();
  const [mes, setMes] = useState(() => hojeIso().slice(0, 7));
  const r = useCarregar((s) => api.get<RespostaResumo>(`/api/financeiro/resumo${qs({ mes, unidadeId: praca })}`, s), [mes, praca]);
  const d = r.dados;

  return (
    <>
      <div className="pagina__cabecalho">
        <div>
          <h1>Financeiro</h1>
          <p className="pagina__descricao">Faturamento e resultado por competência, contas do mês, vencidas e fluxo de caixa. Fonte oficial do faturamento; a Visão Geral mostra as vendas pela data da compra.</p>
        </div>
        <div className="fin-meses">
          <button type="button" className="botao botao--secundario" aria-label="Mês anterior" onClick={() => setMes(somarMes(mes, -1))}>←</button>
          <span className="fin-meses__nome" aria-live="polite">{nomeMes(mes)}</span>
          <button type="button" className="botao botao--secundario" aria-label="Próximo mês" onClick={() => setMes(somarMes(mes, 1))}>→</button>
        </div>
      </div>

      {r.carregando && !d ? <Carregando /> : r.erro ? <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} /> : d && (
        <>
          <Indicadores rotulo="Indicadores do mês">
            <Indicador tinta="rosa" icone="dinheiro" rotulo="A pagar no mês (em aberto)" valor={formatarMoeda(d.aPagar.abertoCentavos)} detalhe={`${d.aPagar.abertoQtd} conta(s) · já pago ${formatarMoeda(d.aPagar.realizadoCentavos)}`} />
            <Indicador tinta="verde" icone="dinheiro" rotulo="A receber no mês (em aberto)" valor={formatarMoeda(d.aReceber.abertoCentavos)} detalhe={`${d.aReceber.abertoQtd} conta(s) · já recebido ${formatarMoeda(d.aReceber.realizadoCentavos)}`} />
            <Indicador tinta="laranja" icone="calendario" rotulo="Vencidas a pagar" valor={formatarMoeda(d.vencidas.pagar.centavos)} detalhe={`${d.vencidas.pagar.qtd} conta(s)`} />
            <Indicador tinta="ambar" icone="calendario" rotulo="Vencidas a receber" valor={formatarMoeda(d.vencidas.receber.centavos)} detalhe={`${d.vencidas.receber.qtd} conta(s)`} />
            <Indicador tinta="azul" icone="cartao" rotulo="Saldo em contas" valor={formatarMoeda(d.saldoCaixaCentavos)} detalhe="Corrente, aplicação e caixa" />
          </Indicadores>
          {d.linhasPendentes > 0 && (
            <p className="aviso aviso--atencao" role="status">
              {d.linhasPendentes} linha(s) de extrato aguardando decisão. <Link to="/financeiro/extrato">Abrir conciliação</Link>
            </p>
          )}

          <div className="fin-grade">
            <section className="cartao" aria-labelledby="titulo-fluxo">
              <h2 id="titulo-fluxo">Fluxo de caixa semanal</h2>
              <p className="texto-fraco">Realizado pela data da baixa; previsto pelo vencimento das contas em aberto (as vencidas entram na semana atual).</p>
              <div className="tabela-rolagem">
                <table className="tabela tabela--compacta">
                  <thead>
                    <tr><th scope="col">Semana</th><th scope="col" className="fin-valor">Entradas</th><th scope="col" className="fin-valor">Saídas</th><th scope="col" className="fin-valor">Saldo projetado</th></tr>
                  </thead>
                  <tbody>
                    {d.fluxo.map((s) => {
                      const ent = s.entradasRealizadasCentavos + s.entradasPrevistasCentavos;
                      const sai = s.saidasRealizadasCentavos + s.saidasPrevistasCentavos;
                      return (
                        <tr key={s.inicio} className={s.atual ? "fin-semana--atual" : ""}>
                          <th scope="row">{formatarData(s.inicio).slice(0, 5)} a {formatarData(s.fim).slice(0, 5)}{s.atual && <span className="etiqueta etiqueta--neutra">atual</span>}</th>
                          <td className="fin-valor">
                            {formatarMoeda(ent)}
                            {s.entradasPrevistasCentavos > 0 && <div className="texto-fraco">prev. {formatarMoeda(s.entradasPrevistasCentavos)}</div>}
                          </td>
                          <td className="fin-valor">
                            {formatarMoeda(sai)}
                            {s.saidasPrevistasCentavos > 0 && <div className="texto-fraco">prev. {formatarMoeda(s.saidasPrevistasCentavos)}</div>}
                          </td>
                          <td className={`fin-valor ${s.saldoProjetadoCentavos === null ? "" : sinal(s.saldoProjetadoCentavos)}`}>{s.saldoProjetadoCentavos === null ? "—" : formatarMoeda(s.saldoProjetadoCentavos)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="cartao" aria-labelledby="titulo-dre">
              <h2 id="titulo-dre">DRE gerencial — {nomeMes(d.mes)}</h2>
              <p className="texto-fraco">Por competência. Juros, multas e descontos das baixas aparecem à parte.</p>
              {d.dre.grupos.length === 0 ? <p className="texto-fraco">Sem lançamentos com competência neste mês.</p> : (
                <div className="tabela-rolagem">
                  <table className="tabela tabela--compacta">
                    <tbody>
                      {(["RECEITA", "DESPESA"] as const).map((tipo) => (
                        <TrechoDre key={tipo} titulo={tipo === "RECEITA" ? "Receitas" : "Despesas"} grupos={d.dre.grupos.filter((g) => g.tipo === tipo)} total={tipo === "RECEITA" ? d.dre.receitaCentavos : d.dre.despesaCentavos} />
                      ))}
                      <tr className="fin-total">
                        <th scope="row">Resultado do mês <span className="texto-fraco">(margem {formatarMargem(d.dre.margemPontosBase)})</span></th>
                        <td className={`fin-valor ${sinal(d.dre.resultadoCentavos)}`}>{formatarMoeda(d.dre.resultadoCentavos)}</td>
                      </tr>
                      {d.dre.foraDoResultado.map((g) => (
                        <tr key={g.grupo} className="fin-sub">
                          <td>Fora do resultado: {g.grupo}{g.entradasCentavos > 0 && ` (entradas ${formatarMoeda(g.entradasCentavos)})`}</td>
                          <td className="fin-valor">{formatarMoeda(g.saidasCentavos)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <section className="cartao" aria-labelledby="titulo-praca">
            <h2 id="titulo-praca">Resultado por praça e linha de negócio</h2>
            {d.dre.porPracaLinha.length === 0 ? <p className="texto-fraco">Sem dados no mês.</p> : (
              <div className="tabela-rolagem">
                <table className="tabela tabela--compacta">
                  <thead>
                    <tr><th scope="col">Praça</th><th scope="col">Linha</th><th scope="col" className="fin-valor">Receita</th><th scope="col" className="fin-valor">Despesa</th><th scope="col" className="fin-valor">Resultado</th></tr>
                  </thead>
                  <tbody>
                    {d.dre.porPracaLinha.map((x) => (
                      <tr key={`${x.unidadeId}|${x.linha}`}>
                        <td>{x.unidadeId ? nomePraca(unidades, x.unidadeId) : "Empresa toda"}</td>
                        <td>{x.linha ? ROTULO_LINHA[x.linha] : "Sem linha"}</td>
                        <td className="fin-valor">{formatarMoeda(x.receitaCentavos)}</td>
                        <td className="fin-valor">{formatarMoeda(x.despesaCentavos)}</td>
                        <td className={`fin-valor ${sinal(x.resultadoCentavos)}`}>{formatarMoeda(x.resultadoCentavos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <QuadroSaldos saldos={d.saldos} total={d.saldoCaixaCentavos} />
          <ResumoDoMes d={d} />
        </>
      )}
    </>
  );
}

const ROTULO_TIPO_SALDO: Array<[string, string]> = [["CORRENTE", "Bancos"], ["CAIXA", "Caixa em dinheiro (quiosque)"], ["APLICACAO", "Aplicação"]];

/** Saldos por tipo de conta: bancos, caixa em dinheiro, aplicação e o total disponível (os cartões ficam à parte). */
function QuadroSaldos({ saldos, total }: { saldos: RespostaResumo["saldos"]; total: number }) {
  if (saldos.length === 0) return <section className="cartao" aria-labelledby="titulo-saldos"><h2 id="titulo-saldos">Saldos das contas</h2><p className="texto-fraco">Nenhuma conta cadastrada. <Link to="/financeiro/contas">Cadastrar contas</Link></p></section>;
  const cartoes = saldos.filter((s) => s.tipo === "CARTAO");
  return (
    <section className="cartao" aria-labelledby="titulo-saldos">
      <h2 id="titulo-saldos">Saldos das contas</h2>
      <div className="fin-grade">
        {ROTULO_TIPO_SALDO.map(([tipo, rotulo]) => {
          const lista = saldos.filter((s) => s.tipo === tipo);
          if (lista.length === 0) return null;
          return (
            <div key={tipo}>
              <h3>{rotulo}</h3>
              <ul className="fin-lista">{lista.map((s) => <li key={s.contaId}><span>{s.nome}</span><span className={`fin-valor ${sinal(s.saldoCentavos)}`}>{formatarMoeda(s.saldoCentavos)}</span></li>)}</ul>
            </div>
          );
        })}
      </div>
      <p className="fin-total" style={{ padding: "var(--esp-2)" }}>Total disponível (bancos + caixa + aplicação): <strong className={`fin-valor ${sinal(total)}`}>{formatarMoeda(total)}</strong></p>
      {cartoes.length > 0 && <p className="texto-fraco">Cartões (fatura em aberto, sinal negativo): {cartoes.map((c) => `${c.nome} ${formatarMoeda(c.saldoCentavos)}`).join("; ")}. Veja o saldo dia a dia em <Link to="/financeiro/caixa">Caixa e saldos</Link>.</p>}
    </section>
  );
}

const ORDEM_PLANILHA = ["Taxas", "Frota", "Fixo", "Tributos", "Posto", "Administrativo", "RH"];

/** Resumo do mês no formato do topo da planilha: receita por conta, despesas por grupo e RESULTADO (recalculado pelo sistema). */
function ResumoDoMes({ d }: { d: RespostaResumo }) {
  const grupo = (nome: string) => d.dre.grupos.find((g) => g.grupo === nome)?.totalCentavos ?? 0;
  const outros = d.dre.grupos.filter((g) => !["Receita", ...ORDEM_PLANILHA].includes(g.grupo));
  const emprestimos = d.dre.foraDoResultado.find((g) => g.grupo.startsWith("Empréstimos"));
  const linha = (rotulo: string, v: number, negativo = false) => <tr key={rotulo}><th scope="row">{rotulo}</th><td className={`fin-valor ${negativo ? "fin-valor--saida" : sinal(v)}`}>{negativo && v > 0 ? "−" : ""}{formatarMoeda(v)}</td></tr>;
  return (
    <section className="cartao" aria-labelledby="titulo-planilha">
      <h2 id="titulo-planilha">Resumo do mês, como na planilha — {nomeMes(d.mes)}</h2>
      <p className="texto-fraco">Calculado pelo sistema a partir dos lançamentos (competência do mês); pessoal e empréstimos ficam fora do resultado operacional.</p>
      <div className="tabela-rolagem">
        <table className="tabela tabela--compacta">
          <tbody>
            {d.receitaPorConta.map((c) => linha(`Receita — ${c.nome}`, c.totalCentavos))}
            {linha("Receita (todos os lançamentos do mês)", grupo("Receita"))}
            {ORDEM_PLANILHA.slice(0, 4).map((g) => linha(g, grupo(g), true))}
            {linha("Pessoal (fora do resultado)", d.dre.pessoalCentavos, true)}
            {ORDEM_PLANILHA.slice(4).map((g) => linha(g, grupo(g), true))}
            {outros.map((g) => linha(g.grupo, g.totalCentavos))}
            {emprestimos && linha("Empréstimos: entradas (fora do resultado)", emprestimos.entradasCentavos)}
            {emprestimos && linha("Empréstimos: parcelas pagas (fora do resultado)", emprestimos.saidasCentavos, true)}
            <tr className="fin-total"><th scope="row">RESULTADO</th><td className={`fin-valor ${sinal(d.dre.resultadoCentavos)}`}>{formatarMoeda(d.dre.resultadoCentavos)}</td></tr>
            <tr className="fin-total"><th scope="row">Resultado após despesas pessoais</th><td className={`fin-valor ${sinal(d.dre.resultadoAposPessoalCentavos)}`}>{formatarMoeda(d.dre.resultadoAposPessoalCentavos)}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TrechoDre({ titulo, grupos, total }: { titulo: string; grupos: RespostaResumo["dre"]["grupos"]; total: number }) {
  return (
    <>
      <tr className="fin-total"><th scope="row">{titulo}</th><td className="fin-valor">{formatarMoeda(total)}</td></tr>
      {grupos.map((g) => (
        <GrupoLinhas key={`${g.tipo}|${g.grupo}`} grupo={g} />
      ))}
    </>
  );
}

function GrupoLinhas({ grupo }: { grupo: RespostaResumo["dre"]["grupos"][number] }) {
  return (
    <>
      <tr className="fin-grupo"><th scope="row">{grupo.grupo}</th><td className="fin-valor">{formatarMoeda(grupo.totalCentavos)}</td></tr>
      {grupo.categorias.map((c) => (
        <tr key={c.categoriaId ?? c.nome} className="fin-sub"><td>{c.nome}</td><td className="fin-valor">{formatarMoeda(c.totalCentavos)}</td></tr>
      ))}
    </>
  );
}
