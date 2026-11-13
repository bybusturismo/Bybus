import { useMemo, useState } from "react";
import { ROTULO_SITUACAO_COMISSAO, type SituacaoComissao } from "@bybus/core";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Indicador, Indicadores } from "../../componentes/Indicador";
import { Confirmar } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { formatarData, formatarMoeda, hojeIso, somarDias } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";

interface Comissao {
  reservaId: string; pedidoCodigo: string; afiliadoId: string | null; afiliadoNome: string; passeio: string;
  dataVenda: string | null; dataPasseio: string; valorReservaCentavos: number; comissaoCentavos: number;
  situacao: SituacaoComissao; dataPagamento: string; pagamentoId: string | null;
}
interface Resposta {
  itens: Comissao[];
  totais: { previstaCentavos: number; aPagarCentavos: number; pagaCentavos: number; canceladaCentavos: number };
  ranking: Array<{ afiliadoId: string | null; nome: string; reservas: number; vendidoCentavos: number; comissaoCentavos: number }>;
  proximoPagamento: { data: string; pendentes: number; totalCentavos: number };
  /** Passeios até esta data: comissões já pagas fora do sistema (corte do histórico). */
  pagasForaAte: string | null;
}
interface Pagamento { id: string; dataPagamento: string; periodoDe: string; periodoAte: string; totalCentavos: number; afiliado: string; situacaoConta: string }

const ETIQUETA: Record<SituacaoComissao, string> = { PREVISTA: "etiqueta--neutra", A_PAGAR: "etiqueta--atencao", PAGA: "etiqueta--sucesso", CANCELADA: "etiqueta--perigo" };

/** Datas de pagamento (dia 01 e 16) já alcançadas, da mais recente para trás. */
export function datasDePagamento(hoje: string, quantas = 6): string[] {
  const saida: string[] = [];
  let [a, m] = hoje.split("-").map(Number) as [number, number];
  const d = Number(hoje.slice(8, 10));
  const iso = (ano: number, mes: number, dia: number) => `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  if (d >= 16) saida.push(iso(a, m, 16));
  while (saida.length < quantas) {
    saida.push(iso(a, m, 1));
    if (saida.length >= quantas) break;
    [a, m] = m === 1 ? [a - 1, 12] : [a, m - 1];
    saida.push(iso(a, m, 16));
  }
  return saida;
}

/**
 * Comissões de afiliados (13/11/2026): valor da Paytour, válido depois do passeio realizado, pago a cada quinzena
 * (dia 01 e 16) como conta a pagar no financeiro. Ranking dos afiliados no período.
 */
export function ComissoesAfiliados() {
  const { pode } = useSessao();
  const notificar = useNotificar();
  const hoje = hojeIso();
  const [de, setDe] = useState(somarDias(hoje, -60));
  const [ate, setAte] = useState(somarDias(hoje, 60));
  const [por, setPor] = useState<"PASSEIO" | "VENDA">("PASSEIO");
  const [afiliadoId, setAfiliadoId] = useState("");
  const [dataPagamento, setDataPagamento] = useState(() => datasDePagamento(hoje)[0]!);
  const [gerando, setGerando] = useState(false);
  const [desfazer, setDesfazer] = useState<Pagamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [corte, setCorte] = useState("");
  const dados = useCarregar((s) => api.get<Resposta>(`/api/afiliados/comissoes${qs({ de, ate, por, afiliadoId: afiliadoId || undefined })}`, s), [de, ate, por, afiliadoId]);
  const pagamentos = useCarregar((s) => api.get<Pagamento[]>("/api/afiliados/pagamentos", s), []);
  const afiliados = useMemo(() => (dados.dados?.ranking ?? []).filter((r) => r.afiliadoId).sort((a, b) => a.nome.localeCompare(b.nome)), [dados.dados]);
  const podePagar = pode("financeiro:gerenciar");

  async function gerar() {
    setGerando(true);
    setErro(null);
    try {
      const r = await api.post<{ pagamentos: number; comissoes: number; totalCentavos: number }>("/api/afiliados/pagamentos", { dataPagamento });
      notificar(r.pagamentos ? `${r.pagamentos} conta(s) a pagar criada(s) no financeiro: ${formatarMoeda(r.totalCentavos)}.` : "Nenhuma comissão a pagar neste período.");
      await Promise.all([dados.recarregar(), pagamentos.recarregar()]);
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setGerando(false);
    }
  }

  async function salvarCorte() {
    setErro(null);
    try {
      await api.put("/api/afiliados/corte", { pagasAte: corte });
      notificar("Data de corte salva.");
      setCorte("");
      await dados.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  const d = dados.dados;
  return (
    <>
      <div className="pagina__cabecalho">
        <div>
          <h1>Comissões de afiliados</h1>
          <p className="pagina__descricao">
            Valor calculado pela Paytour. A comissão só vale depois que o cliente realiza o passeio (não compareceu ou cancelou: não gera).
            Pagamento quinzenal: dia 01 (passeios de 16 ao fim do mês anterior) e dia 16 (passeios de 01 a 15).
          </p>
        </div>
      </div>

      {d && (
        <section className="cartao" aria-labelledby="titulo-pagar">
          <h2 id="titulo-pagar">Pagamento quinzenal</h2>
          <p>
            Próximo pagamento: <strong>{formatarData(d.proximoPagamento.data)}</strong> · {d.proximoPagamento.pendentes} comissão(ões) já liberada(s) e ainda não
            pagas: <strong>{formatarMoeda(d.proximoPagamento.totalCentavos)}</strong>.
          </p>
          {d.pagasForaAte ? (
            <p className="texto-fraco">Comissões de passeios até {formatarData(d.pagasForaAte)} contam como já pagas fora do sistema.</p>
          ) : (
            <Aviso tipo="atencao">Antes do primeiro pagamento, informe até que data de passeio as comissões já foram pagas pela rotina antiga (fora do sistema). Assim ninguém recebe duas vezes.</Aviso>
          )}
          {podePagar && (
            <div className="filtros">
              <div className="campo campo--linha">
                <label htmlFor="cm-corte">Comissões já pagas até o passeio de</label>
                <input id="cm-corte" type="date" max={hoje} value={corte} onChange={(e) => setCorte(e.target.value)} />
              </div>
              <button type="button" className="botao botao--secundario" disabled={!corte} onClick={() => void salvarCorte()}>Salvar corte</button>
            </div>
          )}
          {podePagar && (
            <div className="filtros">
              <div className="campo campo--linha">
                <label htmlFor="cm-data-pag">Gerar o pagamento de</label>
                <select id="cm-data-pag" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)}>
                  {datasDePagamento(hoje).map((x) => <option key={x} value={x}>{formatarData(x)}</option>)}
                </select>
              </div>
              <button type="button" className="botao botao--primario" disabled={gerando} onClick={() => void gerar()}>{gerando ? "Gerando…" : "Gerar contas a pagar"}</button>
            </div>
          )}
          <p className="texto-fraco">Cria uma conta a pagar por afiliado (categoria Afiliados) em Financeiro › A pagar, com vencimento no dia do pagamento. Comissões que ficaram de quinzenas anteriores entram junto.</p>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
        </section>
      )}

      <div className="filtros" role="search" aria-label="Filtros das comissões">
        <div className="campo campo--linha"><label htmlFor="cm-por">Período pela data</label>
          <select id="cm-por" value={por} onChange={(e) => setPor(e.target.value as "PASSEIO" | "VENDA")}>
            <option value="PASSEIO">do passeio</option><option value="VENDA">da venda</option>
          </select>
        </div>
        <div className="campo campo--linha"><label htmlFor="cm-de">De</label><input id="cm-de" type="date" value={de} onChange={(e) => setDe(e.target.value || de)} /></div>
        <div className="campo campo--linha"><label htmlFor="cm-ate">Até</label><input id="cm-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value || ate)} /></div>
        <div className="campo campo--linha"><label htmlFor="cm-afiliado">Afiliado</label>
          <select id="cm-afiliado" value={afiliadoId} onChange={(e) => setAfiliadoId(e.target.value)}>
            <option value="">Todos</option>
            {afiliados.map((a) => <option key={a.afiliadoId!} value={a.afiliadoId!}>{a.nome}</option>)}
          </select>
        </div>
      </div>

      {dados.carregando && !d ? <Carregando /> : dados.erro ? <ErroCarga mensagem={dados.erro} tentarDeNovo={dados.recarregar} /> : d && (
        <>
          <Indicadores rotulo="Totais do período">
            <Indicador tinta="azul" icone="calendario" rotulo="Previstas" valor={formatarMoeda(d.totais.previstaCentavos)} detalhe="Passeio ainda não realizado" />
            <Indicador tinta="ambar" icone="alerta" rotulo="A pagar" valor={formatarMoeda(d.totais.aPagarCentavos)} detalhe="Passeio realizado" />
            <Indicador tinta="verde" icone="check" rotulo="Pagas" valor={formatarMoeda(d.totais.pagaCentavos)} />
            <Indicador tinta="rosa" icone="lista" rotulo="Canceladas" valor={formatarMoeda(d.totais.canceladaCentavos)} detalhe="Não compareceu ou cancelou" />
          </Indicadores>

          <section className="cartao" aria-labelledby="titulo-ranking">
            <h2 id="titulo-ranking">Ranking dos afiliados</h2>
            {d.ranking.length === 0 ? <p className="texto-fraco">Nenhuma venda de afiliado no período.</p> : (
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead><tr><th scope="col">#</th><th scope="col">Afiliado</th><th scope="col" className="num">Reservas</th><th scope="col" className="num">Vendido</th><th scope="col" className="num">Comissão</th></tr></thead>
                  <tbody>
                    {d.ranking.map((r, i) => (
                      <tr key={r.afiliadoId ?? r.nome}><td>{i + 1}º</td><td>{r.nome}</td><td className="num">{r.reservas}</td><td className="num">{formatarMoeda(r.vendidoCentavos)}</td><td className="num">{formatarMoeda(r.comissaoCentavos)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="cartao" aria-labelledby="titulo-comissoes">
            <h2 id="titulo-comissoes">Comissões por reserva</h2>
            {d.itens.length === 0 ? <Vazio titulo="Nenhuma comissão no período." /> : (
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead><tr><th scope="col">Venda</th><th scope="col">Passeio</th><th scope="col">Afiliado</th><th scope="col">Pedido</th><th scope="col" className="num">Valor</th><th scope="col" className="num">Comissão</th><th scope="col">Situação</th><th scope="col">Pagamento</th></tr></thead>
                  <tbody>
                    {d.itens.map((c) => (
                      <tr key={c.reservaId}>
                        <td className="sem-quebra">{c.dataVenda ? formatarData(c.dataVenda) : "—"}</td>
                        <td>{formatarData(c.dataPasseio)}<div className="texto-fraco">{c.passeio}</div></td>
                        <td>{c.afiliadoNome}</td>
                        <td className="sem-quebra">{c.pedidoCodigo}</td>
                        <td className="num">{formatarMoeda(c.valorReservaCentavos)}</td>
                        <td className="num"><strong>{formatarMoeda(c.comissaoCentavos)}</strong></td>
                        <td><span className={`etiqueta ${ETIQUETA[c.situacao]}`}>{ROTULO_SITUACAO_COMISSAO[c.situacao]}</span></td>
                        <td className="sem-quebra">{c.situacao === "CANCELADA" ? "—" : formatarData(c.dataPagamento)}{c.pagamentoId && c.situacao !== "PAGA" ? <div className="texto-fraco">conta gerada</div> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <section className="cartao" aria-labelledby="titulo-pagamentos">
        <h2 id="titulo-pagamentos">Pagamentos gerados</h2>
        {pagamentos.carregando && !pagamentos.dados ? <Carregando /> : !(pagamentos.dados ?? []).length ? <p className="texto-fraco">Nenhum pagamento gerado ainda.</p> : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th scope="col">Pagamento</th><th scope="col">Passeios de</th><th scope="col">Afiliado</th><th scope="col" className="num">Total</th><th scope="col">Situação</th>{podePagar && <th scope="col"><span className="fin-oculto-visual">Ações</span></th>}</tr></thead>
              <tbody>
                {pagamentos.dados!.map((p) => (
                  <tr key={p.id}>
                    <td>{formatarData(p.dataPagamento)}</td>
                    <td className="sem-quebra">{formatarData(p.periodoDe)} a {formatarData(p.periodoAte)}</td>
                    <td>{p.afiliado}</td>
                    <td className="num">{formatarMoeda(p.totalCentavos)}</td>
                    <td><span className={`etiqueta ${p.situacaoConta === "REALIZADO" ? "etiqueta--sucesso" : "etiqueta--atencao"}`}>{p.situacaoConta === "REALIZADO" ? "Pago" : "Em aberto no financeiro"}</span></td>
                    {podePagar && <td>{p.situacaoConta !== "REALIZADO" && <button type="button" className="botao botao--pequeno botao--secundario" onClick={() => setDesfazer(p)}>Desfazer</button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {desfazer && (
        <Confirmar
          aberto
          perigo
          titulo="Desfazer pagamento"
          mensagem={`A conta a pagar de ${formatarMoeda(desfazer.totalCentavos)} para ${desfazer.afiliado} será apagada do financeiro e as comissões voltam a ficar a pagar.`}
          textoConfirmar="Desfazer"
          aoConfirmar={async () => {
            try {
              await api.delete(`/api/afiliados/pagamentos/${desfazer.id}`);
              notificar("Pagamento desfeito.");
              setDesfazer(null);
              await Promise.all([dados.recarregar(), pagamentos.recarregar()]);
            } catch (x) {
              setErro(mensagemDeErro(x));
              setDesfazer(null);
            }
          }}
          aoFechar={() => setDesfazer(null)}
        />
      )}
    </>
  );
}
