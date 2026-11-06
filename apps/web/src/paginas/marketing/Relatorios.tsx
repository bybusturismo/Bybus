import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { useNotificar } from "../../componentes/Notificacoes";
import { CabecalhoPagina } from "../../componentes/Pagina";
import { useSessao } from "../../sessao/Sessao";
import { formatarData, formatarDataHora, formatarMoeda, formatarNumero } from "../../util/formato";
import { ROTULO_CANAL } from "../../util/rotulos";
import { useCarregar } from "../../util/useCarregar";
import { BarrasLista, Variacao } from "./comum";

interface Item { id: string; tipo: string; de: string; ate: string; praca: string; geradoEm: string; automatico: boolean; temResumoIa: boolean }
interface Dados {
  periodo: { rotulo: string; de: string; ate: string };
  vendas: { atual: { reservas: number; passageiros: number; receitaCentavos: number | null }; anterior: { reservas: number; passageiros: number; receitaCentavos: number | null }; variacao: { reservas: number | null; passageiros: number | null; receita: number | null };
    porCanal: Array<{ canal: string; reservas: number; passageiros: number; receitaCentavos: number | null; reservasAnterior: number; variacaoReservas: number | null }> };
  origem: Array<{ origem: string; passageiros: number }>;
  campanhas: Array<{ nome: string; reservas: number; receitaCentavos: number | null; investimentoCentavos: number; custoPorReservaCentavos: number | null; retorno: number | null }>;
  avaliacoes: { pedidosFeitos: number; avaliados: number; pedidosFeitosAnterior: number; avaliadosAnterior: number; notaInterna: number | null; notasCanais: Array<{ canal: string; nota: number; quantidade: number }> };
  nps: { respostas: number; nps: number | null; npsAnterior: number | null; detratores: number };
  orcamentos: { recebidos: number; recebidosAnterior: number; fechados: number } | null;
  bio: { visitas: number; cliques: number; visitasAnterior: number; cliquesAnterior: number } | null;
}
interface Detalhe { id: string; tipo: string; de: string; ate: string; praca: string; geradoEm: string; dados: Dados; resumoNumeros: string; resumoIa: string | null }

const rotuloCanal = (c: string) => (ROTULO_CANAL as Record<string, string>)[c] ?? c;
const tipoRotulo = (t: string) => (t === "SEMANAL" ? "Semanal" : "Mensal");

export function RelatorioDetalhe({ id }: { id: string }) {
  const r = useCarregar((s) => api.get<Detalhe>(`/api/marketing/relatorios/${id}`, s), [id]);
  const d = r.dados;
  if (r.erro) return <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} />;
  if (!d) return <Carregando />;
  const { dados: x } = d;
  return (
    <div className="pagina m2-relatorio">
      <CabecalhoPagina titulo={`Relatório ${tipoRotulo(d.tipo).toLowerCase()}: ${x.periodo.rotulo}`} descricao={`${d.praca} · gerado em ${formatarDataHora(d.geradoEm)}. Só números agregados.`}
        acoes={<><Link className="botao botao--fantasma nao-imprimir" to="/marketing/relatorios">Voltar à lista</Link><button type="button" className="botao botao--primario nao-imprimir" onClick={() => window.print()}><Icone nome="imprimir" /> Imprimir ou salvar em PDF</button></>} />
      <section className="cartao" aria-labelledby="r-res">
        <h2 id="r-res">Resumo</h2>
        {d.resumoIa ? <><p className="m2-relatorio__resumo">{d.resumoIa}</p><p className="texto-fraco">Resumo escrito pela IA a partir dos números abaixo.</p></> : <p className="m2-relatorio__resumo">{d.resumoNumeros}</p>}
      </section>
      <div className="m2-grade">
        <section className="cartao" aria-labelledby="r-v">
          <h2 id="r-v">Vendas</h2>
          <p>Reservas: <strong>{formatarNumero(x.vendas.atual.reservas)}</strong> <Variacao v={x.vendas.variacao.reservas} /> <span className="texto-fraco">(antes {formatarNumero(x.vendas.anterior.reservas)})</span></p>
          <p>Passageiros: <strong>{formatarNumero(x.vendas.atual.passageiros)}</strong> <Variacao v={x.vendas.variacao.passageiros} /></p>
          {x.vendas.atual.receitaCentavos != null && <p>Receita das reservas: <strong>{formatarMoeda(x.vendas.atual.receitaCentavos)}</strong> <Variacao v={x.vendas.variacao.receita} /></p>}
          {x.vendas.porCanal.length > 0 && <table className="tabela"><thead><tr><th>Canal</th><th className="num">Reservas</th><th className="num">Variação</th></tr></thead>
            <tbody>{x.vendas.porCanal.map((c) => <tr key={c.canal}><td>{rotuloCanal(c.canal)}</td><td className="num">{c.reservas}</td><td className="num"><Variacao v={c.variacaoReservas} /></td></tr>)}</tbody></table>}
        </section>
        <section className="cartao" aria-labelledby="r-o">
          <h2 id="r-o">Origem dos clientes</h2>
          {x.origem.length ? <BarrasLista itens={x.origem.map((o) => ({ rotulo: o.origem, valor: o.passageiros }))} /> : <p className="texto-fraco">Sem origem informada no período.</p>}
        </section>
        <section className="cartao" aria-labelledby="r-c">
          <h2 id="r-c">Campanhas</h2>
          {x.campanhas.length ? <table className="tabela"><thead><tr><th>Campanha</th><th className="num">Reservas</th><th className="num">Custo/reserva</th><th className="num">Retorno</th></tr></thead>
            <tbody>{x.campanhas.map((c) => <tr key={c.nome}><td>{c.nome}</td><td className="num">{c.reservas}</td><td className="num">{c.custoPorReservaCentavos == null ? "—" : formatarMoeda(c.custoPorReservaCentavos)}</td><td className="num">{c.retorno == null ? "—" : `${c.retorno.toLocaleString("pt-BR")}×`}</td></tr>)}</tbody></table> : <p className="texto-fraco">Nenhuma venda atribuída a campanha.</p>}
        </section>
        <section className="cartao" aria-labelledby="r-a">
          <h2 id="r-a">Avaliações e NPS</h2>
          <p>Pedidos feitos: <strong>{x.avaliacoes.pedidosFeitos}</strong> <span className="texto-fraco">(antes {x.avaliacoes.pedidosFeitosAnterior})</span> · avaliados: <strong>{x.avaliacoes.avaliados}</strong> <span className="texto-fraco">(antes {x.avaliacoes.avaliadosAnterior})</span></p>
          {x.avaliacoes.notaInterna != null && <p>Nota interna média: <strong>{x.avaliacoes.notaInterna.toLocaleString("pt-BR")}</strong></p>}
          {x.avaliacoes.notasCanais.map((n) => <p key={n.canal}>{n.canal}: <strong>{n.nota.toLocaleString("pt-BR")}</strong> <span className="texto-fraco">({formatarNumero(n.quantidade)} avaliações)</span></p>)}
          <p>NPS: <strong>{x.nps.nps ?? "—"}</strong> <span className="texto-fraco">({x.nps.respostas} resposta(s){x.nps.npsAnterior != null ? `, antes ${x.nps.npsAnterior}` : ""}; {x.nps.detratores} detrator(es))</span></p>
        </section>
        {x.orcamentos && <section className="cartao" aria-labelledby="r-q"><h2 id="r-q">Orçamentos de grupos</h2><p>Recebidos: <strong>{x.orcamentos.recebidos}</strong> <span className="texto-fraco">(antes {x.orcamentos.recebidosAnterior})</span> · fechados: <strong>{x.orcamentos.fechados}</strong></p></section>}
        {x.bio && <section className="cartao" aria-labelledby="r-b"><h2 id="r-b">Link na bio</h2><p>Visitas: <strong>{x.bio.visitas}</strong> <span className="texto-fraco">(antes {x.bio.visitasAnterior})</span> · cliques: <strong>{x.bio.cliques}</strong> <span className="texto-fraco">(antes {x.bio.cliquesAnterior})</span></p></section>}
      </div>
      <p className="texto-fraco">Vendas e origem contam reservas confirmadas com passeio no período; campanhas contam pela data da compra.</p>
    </div>
  );
}

export function Relatorios() {
  const { id } = useParams();
  const { pode } = useSessao();
  const notificar = useNotificar();
  const [tipo, setTipo] = useState<"" | "SEMANAL" | "MENSAL">("");
  const r = useCarregar((s) => api.get<{ iaLigada: boolean; relatorios: Item[] }>(`/api/marketing/relatorios${tipo ? `?tipo=${tipo}` : ""}`, s), [tipo]);
  const [gerando, setGerando] = useState(false);
  if (id) return <RelatorioDetalhe id={id} />;

  async function gerar(t: "SEMANAL" | "MENSAL") {
    setGerando(true);
    try {
      const x = await api.post<{ gerados: number; periodo: { rotulo: string } }>("/api/marketing/relatorios/gerar", { tipo: t });
      notificar(x.gerados ? `Relatório gerado: ${x.periodo.rotulo}.` : `Já existe o relatório de ${x.periodo.rotulo}.`);
      await r.recarregar();
    } catch (e) { notificar(mensagemDeErro(e), "erro"); } finally { setGerando(false); }
  }
  const d = r.dados;
  return (
    <div className="pagina">
      <CabecalhoPagina titulo="Relatórios" descricao="Gerados sozinhos toda segunda às 7h (semanal) e no dia 1 (mensal): vendas, origem, campanhas, avaliações e NPS, comparados com o período anterior."
        filtros={<div className="campo campo--linha"><label htmlFor="rl-tipo">Tipo</label><select id="rl-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}><option value="">Todos</option><option value="SEMANAL">Semanais</option><option value="MENSAL">Mensais</option></select></div>}
        acoes={pode("marketing:gerenciar") && <><button type="button" className="botao botao--secundario" disabled={gerando} onClick={() => void gerar("MENSAL")}>Gerar o do mês passado</button><button type="button" className="botao botao--primario" disabled={gerando} onClick={() => void gerar("SEMANAL")}>Gerar o da semana passada</button></>} />
      {d && <Aviso tipo="info">{d.iaLigada ? "IA ligada: cada relatório traz um resumo escrito pelos Gestores de IA (só recebem números agregados)." : "IA desligada: os relatórios trazem só os números e um resumo em texto simples."}</Aviso>}
      {r.carregando && !d ? <Carregando /> : r.erro ? <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} /> : d && d.relatorios.length === 0 ? <Vazio titulo="Nenhum relatório ainda.">O primeiro sai na próxima segunda às 7h, ou gere agora pelos botões acima.</Vazio> : d ? (
        <div className="tabela-rolagem"><table className="tabela">
          <thead><tr><th>Período</th><th>Tipo</th><th>Praça</th><th>Gerado</th><th><span className="visualmente-oculto">Abrir</span></th></tr></thead>
          <tbody>{d.relatorios.map((x) => <tr key={x.id}><td className="sem-quebra">{formatarData(x.de)} a {formatarData(x.ate)}</td><td>{tipoRotulo(x.tipo)}</td><td>{x.praca}</td>
            <td>{formatarDataHora(x.geradoEm)} <span className="texto-fraco">{x.automatico ? "automático" : "manual"}{x.temResumoIa ? " · com IA" : ""}</span></td><td><Link to={`/marketing/relatorios/${x.id}`}>Abrir</Link></td></tr>)}</tbody>
        </table></div>
      ) : null}
    </div>
  );
}
