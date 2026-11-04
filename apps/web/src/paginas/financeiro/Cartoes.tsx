import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/cliente";
import { Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { formatarData } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { useContas } from "./dados";
import { FormTransferencia, ImportadorExtrato, PainelLinhas } from "./Extrato";
import type { CartaoFin, Fatura } from "./tipos";
import { centavosParaCampo, formatarReais } from "./util";

const ROTULO_SITUACAO: Record<Fatura["situacao"], string> = { ABERTA: "Aberta", FECHADA: "Fechada", ENCERRADA: "Vencimento passado" };

export function Cartoes() {
  const { pode } = useSessao();
  const notificar = useNotificar();
  const podeEditar = pode("financeiro:gerenciar");
  const [versao, setVersao] = useState(0);
  const cartoes = useCarregar((s) => api.get<CartaoFin[]>("/api/financeiro/cartoes", s), [versao]);
  const contas = useContas();
  const [escolhido, setEscolhido] = useState("");
  const [pagando, setPagando] = useState<{ cartao: CartaoFin; valor: string } | null>(null);
  const lista = cartoes.dados ?? [];
  const ativo = lista.find((c) => c.id === escolhido) ?? lista[0] ?? null;

  return (
    <>
      <div className="pagina__cabecalho">
        <div>
          <h1>Cartões de crédito</h1>
          <p className="pagina__descricao">Importe a fatura (CSV ou OFX), classifique cada compra por categoria, praça e veículo e acompanhe o total por ciclo. O pagamento da fatura é uma transferência entre contas.</p>
        </div>
      </div>
      {cartoes.carregando && !cartoes.dados ? <Carregando /> : cartoes.erro ? <ErroCarga mensagem={cartoes.erro} tentarDeNovo={cartoes.recarregar} /> : !ativo ? (
        <Vazio titulo="Nenhum cartão cadastrado.">
          <p><Link to="/financeiro/contas">Cadastre o cartão em “Contas e categorias”</Link> com o dia de fechamento e o de vencimento da fatura.</p>
        </Vazio>
      ) : (
        <>
          {lista.length > 1 && (
            <div className="filtros">
              <div className="campo campo--linha">
                <label htmlFor="cartao-escolha">Cartão</label>
                <select id="cartao-escolha" value={ativo.id} onChange={(e) => setEscolhido(e.target.value)}>{lista.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
              </div>
            </div>
          )}
          <section className="cartao" aria-labelledby="titulo-faturas">
            <h2 id="titulo-faturas">{ativo.nome}</h2>
            <p className="texto-fraco">
              Fecha no dia {ativo.diaFechamento}, vence no dia {ativo.diaVencimento}.
              {ativo.finalConta ? ` Final ${ativo.finalConta}.` : ""} Saldo do cartão: <strong>{formatarReais(ativo.saldoCentavos)}</strong> (negativo = fatura a pagar).
            </p>
            {ativo.faturas.length === 0 ? <p className="texto-fraco">Nenhuma compra importada ainda.</p> : (
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead><tr><th scope="col">Fatura</th><th scope="col">Fecha</th><th scope="col">Vence</th><th scope="col" className="fin-valor">Total</th><th scope="col">Situação</th>{podeEditar && <th scope="col"><span className="fin-oculto-visual">Ações</span></th>}</tr></thead>
                  <tbody>
                    {ativo.faturas.map((f) => (
                      <tr key={f.referencia}>
                        <td>{f.referencia.split("-").reverse().join("/")}</td>
                        <td>{formatarData(f.fechamento)}</td>
                        <td>{formatarData(f.vencimento)}</td>
                        <td className="fin-valor">{formatarReais(f.totalCentavos)}<div className="texto-fraco">{f.linhas} compra(s)</div></td>
                        <td>
                          <span className={`etiqueta ${f.situacao === "ABERTA" ? "etiqueta--neutra" : f.situacao === "FECHADA" ? "etiqueta--atencao" : "etiqueta--neutra"}`}>{ROTULO_SITUACAO[f.situacao]}</span>
                          {f.pendentes > 0 && <span className="etiqueta etiqueta--atencao">{f.pendentes} sem classificar</span>}
                        </td>
                        {podeEditar && (
                          <td>
                            {f.situacao !== "ABERTA" && f.totalCentavos > 0 && (
                              <button type="button" className="botao botao--pequeno botao--secundario" onClick={() => setPagando({ cartao: ativo, valor: centavosParaCampo(f.totalCentavos) })}>Pagar fatura</button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {podeEditar && <ImportadorExtrato conta={ativo} aoImportar={() => setVersao((v) => v + 1)} />}
          <PainelLinhas conta={ativo} versao={versao} />
        </>
      )}
      <Modal aberto={pagando !== null} titulo="Pagar fatura do cartão" aoFechar={() => setPagando(null)}>
        {pagando && contas.dados && (
          <FormTransferencia contas={contas.dados} origemInicial={pagando.cartao.contaPagamentoId ?? ""} destinoInicial={pagando.cartao.id} valorInicial={pagando.valor}
            aoConcluir={async () => { setPagando(null); notificar("Pagamento da fatura registrado."); setVersao((v) => v + 1); await contas.recarregar(); }} aoCancelar={() => setPagando(null)} />
        )}
      </Modal>
    </>
  );
}
