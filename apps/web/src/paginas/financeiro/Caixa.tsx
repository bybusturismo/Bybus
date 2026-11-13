import { useState, type FormEvent } from "react";
import { ROTULO_SUSPEITA, type MotivoSuspeita } from "@bybus/core";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { centavosDeTexto, formatarData, formatarMoeda, hojeIso, somarDias, textoDeCentavos } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { useContas } from "./dados";
import type { CaixaDia, SaldoDiario } from "./tipos";
import { ROTULO_TIPO_CONTA } from "./util";

const sinal = (v: number) => (v < 0 ? "fin-valor--saida" : "");

interface Conferencia {
  saldoSistemaCentavos: number; saldoBancoCentavos: number; diferencaCentavos: number;
  composicao: { saldoInicialCentavos: number; saldoInicialEm: string | null; transferenciasCentavos: number; extratoCentavos: number; entradasCentavos: number; saidasCentavos: number };
  suspeitos: Array<{ id: string; origem: "LINHA" | "LANCAMENTO"; data: string; valorCentavos: number; descricao: string; transferencia: boolean; criadoPelaPlanilha: boolean; motivos: MotivoSuspeita[] }>;
}

/**
 * Conferência com o banco (dono, 13/11/2026): digita o saldo que o banco mostra num dia e o sistema compara, mostra de que é
 * feito o saldo e aponta os lançamentos que provavelmente explicam a diferença (repetidos, transferência em dobro…).
 */
function ConferenciaComBanco({ contaId }: { contaId: string }) {
  const [data, setData] = useState(hojeIso());
  const [saldoBanco, setSaldoBanco] = useState("");
  const [r, setR] = useState<Conferencia | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function conferir(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const texto = saldoBanco.trim();
    const negativo = texto.startsWith("-");
    const v = centavosDeTexto(negativo ? texto.slice(1) : texto);
    if (v === null || Number.isNaN(v)) return setErro("Informe o saldo do banco em reais (ex.: 3.196,04; negativo com sinal de menos).");
    setOcupado(true);
    try {
      setR(await api.get<Conferencia>(`/api/financeiro/contas/${contaId}/conferencia${qs({ data, saldoBancoCentavos: String(negativo ? -v : v) })}`));
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setOcupado(false);
    }
  }
  const c = r?.composicao;
  return (
    <section className="cartao" aria-labelledby="titulo-conferencia">
      <h2 id="titulo-conferencia">Conferir com o banco</h2>
      <p className="texto-fraco">Digite o saldo que o banco mostra no fim de um dia. O sistema compara e aponta o que pode explicar a diferença.</p>
      <form className="filtros" onSubmit={(e) => void conferir(e)}>
        <div className="campo campo--linha"><label htmlFor="conf-data">Dia</label><input id="conf-data" type="date" max={hojeIso()} value={data} onChange={(e) => { setData(e.target.value || hojeIso()); setR(null); }} /></div>
        <div className="campo campo--linha"><label htmlFor="conf-saldo">Saldo no banco (R$)</label><input id="conf-saldo" inputMode="decimal" value={saldoBanco} onChange={(e) => { setSaldoBanco(e.target.value); setR(null); }} placeholder="0,00" /></div>
        <button type="submit" className="botao botao--primario" disabled={ocupado}>{ocupado ? "Conferindo…" : "Conferir"}</button>
      </form>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {r && c && (
        <>
          {r.diferencaCentavos === 0 ? (
            <Aviso tipo="sucesso">Saldo confere com o banco: {formatarMoeda(r.saldoSistemaCentavos)} em {formatarData(data)}.</Aviso>
          ) : (
            <Aviso tipo="atencao">
              No sistema: <strong>{formatarMoeda(r.saldoSistemaCentavos)}</strong> · no banco: <strong>{formatarMoeda(r.saldoBancoCentavos)}</strong> ·
              diferença: <strong>{formatarMoeda(Math.abs(r.diferencaCentavos))} {r.diferencaCentavos > 0 ? "a mais no sistema" : "a menos no sistema"}</strong>
            </Aviso>
          )}
          <p className="texto-fraco">
            Como o sistema chega ao saldo: saldo inicial {formatarMoeda(c.saldoInicialCentavos)}{c.saldoInicialEm ? ` em ${formatarData(c.saldoInicialEm)}` : ""}
            {c.transferenciasCentavos ? ` · transferências ${formatarMoeda(c.transferenciasCentavos)}` : ""}
            {c.extratoCentavos ? ` · extrato do banco ${formatarMoeda(c.extratoCentavos)}` : ""}
            {` · recebimentos ${formatarMoeda(c.entradasCentavos)} · pagamentos ${formatarMoeda(c.saidasCentavos)}`}.
            {" "}Se o saldo inicial não for o saldo do banco no fim do dia anterior, corrija em “Contas e categorias”.
          </p>
          {r.diferencaCentavos !== 0 && (r.suspeitos.length === 0 ? (
            <p>Nenhum lançamento suspeito encontrado. Confira o saldo inicial ou importe o extrato do banco em “Extrato e conciliação”.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <caption className="fin-oculto-visual">Possíveis causas da diferença</caption>
                <thead><tr><th scope="col">Data</th><th scope="col">Descrição</th><th scope="col">Origem</th><th scope="col" className="fin-valor">Valor</th><th scope="col">Por que conferir</th></tr></thead>
                <tbody>
                  {r.suspeitos.map((x) => (
                    <tr key={x.id}>
                      <td className="sem-quebra">{formatarData(x.data)}</td>
                      <td>{x.descricao || "—"}</td>
                      <td>{x.transferencia ? (x.criadoPelaPlanilha ? "Transferência (planilha)" : "Transferência") : x.origem === "LINHA" ? "Extrato do banco" : x.criadoPelaPlanilha ? "Lançamento (planilha)" : "Lançamento (à mão)"}</td>
                      <td className={`fin-valor ${sinal(x.valorCentavos)}`}>{formatarMoeda(x.valorCentavos)}</td>
                      <td>{x.motivos.map((m) => ROTULO_SUSPEITA[m]).join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function FechamentoDoDia({ contaId, podeEditar }: { contaId: string; podeEditar: boolean }) {
  const notificar = useNotificar();
  const [data, setData] = useState(hojeIso());
  const [contado, setContado] = useState("");
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const dia = useCarregar((s) => api.get<CaixaDia>(`/api/financeiro/caixa/dia${qs({ contaId, data })}`, s), [contaId, data]);
  const d = dia.dados;
  const valor = contado.trim() ? centavosDeTexto(contado) : null;

  async function fechar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (valor === null || Number.isNaN(valor)) return setErro("Informe o saldo contado em reais (ex.: 470,00).");
    try {
      await api.post("/api/financeiro/caixa/fechar", { contaId, data, saldoContadoCentavos: valor, observacao: obs.trim() || null });
      notificar("Caixa do dia fechado.");
      setContado("");
      setObs("");
      await dia.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  return (
    <section className="cartao" aria-labelledby="titulo-fechamento">
      <h2 id="titulo-fechamento">Fechamento do caixa do dia</h2>
      <div className="campo campo--linha">
        <label htmlFor="cx-data">Dia</label>
        <input id="cx-data" type="date" max={hojeIso()} value={data} onChange={(e) => setData(e.target.value)} />
      </div>
      {dia.carregando && !d ? <Carregando /> : dia.erro ? <ErroCarga mensagem={dia.erro} tentarDeNovo={dia.recarregar} /> : d && (
        <>
          <ul className="fin-lista" aria-label="Contas do dia">
            <li><span>Saldo inicial</span><span className={`fin-valor ${sinal(d.saldoInicialCentavos)}`}>{formatarMoeda(d.saldoInicialCentavos)}</span></li>
            <li><span>Entradas (passeios em dinheiro, aportes)</span><span className="fin-valor fin-valor--entrada">+{formatarMoeda(d.entradasCentavos)}</span></li>
            <li><span>Saídas (guia, transfer, combustível, retiradas)</span><span className="fin-valor fin-valor--saida">−{formatarMoeda(d.saidasCentavos)}</span></li>
            <li><strong>Saldo calculado</strong><strong className={`fin-valor ${sinal(d.saldoCalculadoCentavos)}`}>{formatarMoeda(d.saldoCalculadoCentavos)}</strong></li>
          </ul>
          {d.lancamentos.length > 0 && (
            <details>
              <summary>{d.lancamentos.length} lançamento(s) do dia</summary>
              <ul className="fin-lista">{d.lancamentos.map((l) => <li key={l.id}><span>{l.descricao} <span className="texto-fraco">({l.categoria})</span></span><span className={`fin-valor ${l.tipo === "PAGAR" ? "fin-valor--saida" : "fin-valor--entrada"}`}>{l.tipo === "PAGAR" ? "−" : "+"}{formatarMoeda(l.valorPagoCentavos ?? 0)}</span></li>)}</ul>
            </details>
          )}
          {d.fechamento ? (
            <Aviso tipo={d.fechamento.diferencaCentavos === 0 ? "sucesso" : "atencao"} titulo="Dia fechado">
              Saldo contado {formatarMoeda(d.fechamento.saldoContadoCentavos)}; diferença de {formatarMoeda(d.fechamento.diferencaCentavos)}{d.fechamento.observacao ? ` (${d.fechamento.observacao})` : ""}. Baixas e reaberturas nesta data ficam bloqueadas.
            </Aviso>
          ) : podeEditar ? (
            <form onSubmit={fechar}>
              {erro && <Aviso tipo="erro">{erro}</Aviso>}
              <div className="grade-campos">
                <div className="campo"><label htmlFor="cx-contado">Saldo contado no caixa (R$)</label><input id="cx-contado" inputMode="decimal" value={contado} onChange={(e) => setContado(e.target.value)} placeholder={textoDeCentavos(d.saldoCalculadoCentavos)} /></div>
                <div className="campo"><label htmlFor="cx-obs">Observação</label><input id="cx-obs" value={obs} maxLength={300} onChange={(e) => setObs(e.target.value)} /></div>
              </div>
              {valor !== null && !Number.isNaN(valor) && <p aria-live="polite">Diferença: <strong className={`fin-valor ${sinal(valor - d.saldoCalculadoCentavos)}`}>{formatarMoeda(valor - d.saldoCalculadoCentavos)}</strong></p>}
              <button type="submit" className="botao botao--primario">Fechar o dia</button>
            </form>
          ) : <p className="texto-fraco">Dia ainda aberto. Quem gerencia o financeiro faz o fechamento.</p>}
          {d.recentes.length > 0 && (
            <>
              <h3>Últimos fechamentos</h3>
              <ul className="fin-lista">{d.recentes.map((r) => <li key={r.data}><span>{formatarData(r.data)}: calculado {formatarMoeda(r.saldoCalculadoCentavos)}, contado {formatarMoeda(r.saldoContadoCentavos)}</span><span className={`fin-valor ${sinal(r.diferencaCentavos)}`}>{formatarMoeda(r.diferencaCentavos)}</span></li>)}</ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function SaldoDiarioDaConta({ contaId }: { contaId: string }) {
  const [ate, setAte] = useState(hojeIso());
  const de = somarDias(ate, -29);
  const r = useCarregar((s) => api.get<SaldoDiario>(`/api/financeiro/contas/${contaId}/saldo-diario${qs({ de, ate })}`, s), [contaId, ate]);
  return (
    <section className="cartao" aria-labelledby="titulo-diario">
      <h2 id="titulo-diario">Saldo dia a dia (30 dias até a data)</h2>
      <div className="campo campo--linha"><label htmlFor="sd-ate">Até</label><input id="sd-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
      {r.carregando && !r.dados ? <Carregando /> : r.erro ? <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} /> : r.dados && (
        <div className="tabela-rolagem">
          <table className="tabela tabela--compacta">
            <caption className="fin-oculto-visual">Saldo diário de {r.dados.conta.nome}</caption>
            <thead><tr><th scope="col">Dia</th><th scope="col" className="fin-valor">Entradas</th><th scope="col" className="fin-valor">Saídas</th><th scope="col" className="fin-valor">Saldo ao fim do dia</th></tr></thead>
            <tbody>
              <tr className="fin-total"><th scope="row">Saldo inicial</th><td /><td /><td className={`fin-valor ${sinal(r.dados.saldoInicialCentavos)}`}>{formatarMoeda(r.dados.saldoInicialCentavos)}</td></tr>
              {r.dados.dias.map((x) => (
                <tr key={x.data}>
                  <th scope="row">{formatarData(x.data)}</th>
                  <td className="fin-valor">{x.entradasCentavos ? formatarMoeda(x.entradasCentavos) : "—"}</td>
                  <td className="fin-valor">{x.saidasCentavos ? formatarMoeda(x.saidasCentavos) : "—"}</td>
                  <td className={`fin-valor ${sinal(x.saldoFinalCentavos)}`}>{formatarMoeda(x.saldoFinalCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function Caixa() {
  const { pode } = useSessao();
  const contas = useContas();
  const [contaId, setContaId] = useState("");
  const lista = (contas.dados ?? []).filter((c) => c.ativa && c.tipo !== "CARTAO");
  const conta = lista.find((c) => c.id === contaId) ?? lista.find((c) => c.tipo === "CAIXA") ?? lista[0] ?? null;
  return (
    <>
      <div className="pagina__cabecalho">
        <div>
          <h1>Caixa e saldos</h1>
          <p className="pagina__descricao">Saldo dia a dia de cada conta e fechamento diário do caixa em dinheiro do quiosque (a “caixinha”).</p>
        </div>
      </div>
      {contas.carregando && !contas.dados ? <Carregando /> : contas.erro ? <ErroCarga mensagem={contas.erro} tentarDeNovo={contas.recarregar} /> : !conta ? (
        <Vazio titulo="Cadastre as contas (ou use as contas padrão) em “Contas e categorias”." />
      ) : (
        <>
          <div className="filtros">
            <div className="campo campo--linha">
              <label htmlFor="caixa-conta">Conta</label>
              <select id="caixa-conta" value={conta.id} onChange={(e) => setContaId(e.target.value)}>
                {lista.map((c) => <option key={c.id} value={c.id}>{c.nome} — {ROTULO_TIPO_CONTA[c.tipo]}</option>)}
              </select>
            </div>
            <span>Saldo atual: <strong className={`fin-valor ${sinal(conta.saldoCentavos)}`}>{formatarMoeda(conta.saldoCentavos)}</strong></span>
          </div>
          {conta.tipo === "CAIXA" && <FechamentoDoDia key={`fech-${conta.id}`} contaId={conta.id} podeEditar={pode("financeiro:gerenciar")} />}
          <ConferenciaComBanco key={`conf-${conta.id}`} contaId={conta.id} />
          <SaldoDiarioDaConta key={`dia-${conta.id}`} contaId={conta.id} />
        </>
      )}
    </>
  );
}
