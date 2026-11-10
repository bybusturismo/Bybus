import { Fragment, useState } from "react";
import { api, qs } from "../../api/cliente";
import { Carregando, ErroCarga } from "../../componentes/Estados";
import { Indicador, Indicadores } from "../../componentes/Indicador";
import { Modal } from "../../componentes/Modal";
import { useSessao } from "../../sessao/Sessao";
import { formatarData, formatarMoeda, hojeIso, nomeMes, ultimoDiaDoMes } from "../../util/formato";
import { ROTULO_LINHA } from "../../util/rotulos";
import { useCarregar } from "../../util/useCarregar";
import type { RespostaLancamentos } from "./tipos";
import { formatarMargem } from "./util";

/** Uma linha da DRE vinda da API (`montarDreGerencial`): valores com sinal, receita + e despesa −. */
export interface LinhaDreWeb {
  nivel: "SECAO" | "GRUPO" | "CATEGORIA" | "SUBTOTAL";
  chave: string;
  nome: string;
  secao: string;
  categoriaId: string | null;
  valores: number[];
  total: number;
}
export interface RespostaDre {
  meses: string[];
  regime: "COMPETENCIA" | "CAIXA";
  linhas: LinhaDreWeb[];
  abaixoDaLinha: LinhaDreWeb[];
  receitaBruta: number[];
  resultadoLiquido: number[];
}

const sinal = (v: number) => (v < 0 ? "fin-valor--saida" : v > 0 ? "fin-valor--entrada" : "");
const pct = (v: number, receita: number) => formatarMargem(receita > 0 ? Math.trunc((v * 10000) / receita) : null);
const soma = (a: number[]) => a.reduce((s, v) => s + v, 0);

/** Aba DRE (10/11/2026): 12 meses lado a lado, acumulado do ano e % da receita bruta; clique na categoria para ver os lançamentos. */
export function Dre() {
  const { praca } = useSessao();
  const [ano, setAno] = useState(() => Number(hojeIso().slice(0, 4)));
  const [regime, setRegime] = useState<"COMPETENCIA" | "CAIXA">("COMPETENCIA");
  const [linha, setLinha] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [detalhe, setDetalhe] = useState<{ linha: LinhaDreWeb; mes: string | null } | null>(null);
  const r = useCarregar((s) => api.get<RespostaDre>(`/api/financeiro/dre${qs({ ano: String(ano), regime, unidadeId: praca, linha: linha || undefined })}`, s), [ano, regime, praca, linha]);
  const d = r.dados;

  const alternar = (chave: string) => setAbertos((a) => {
    const n = new Set(a);
    if (n.has(chave)) n.delete(chave); else n.add(chave);
    return n;
  });

  return (
    <>
      <div className="pagina__cabecalho">
        <div>
          <h1>DRE gerencial</h1>
          <p className="pagina__descricao">Resultado mês a mês, do faturamento ao lucro. Clique num grupo para abrir as categorias e num valor para ver os lançamentos.</p>
        </div>
        <div className="fin-meses">
          <button type="button" className="botao botao--secundario" aria-label="Ano anterior" onClick={() => setAno(ano - 1)}>←</button>
          <span className="fin-meses__nome" aria-live="polite">{ano}</span>
          <button type="button" className="botao botao--secundario" aria-label="Próximo ano" onClick={() => setAno(ano + 1)}>→</button>
        </div>
      </div>

      <div className="filtros">
        <div className="campo">
          <label htmlFor="dre-regime">Visão</label>
          <select id="dre-regime" value={regime} onChange={(e) => setRegime(e.target.value as "COMPETENCIA" | "CAIXA")}>
            <option value="COMPETENCIA">Competência (mês da venda ou do serviço)</option>
            <option value="CAIXA">Caixa (mês em que o dinheiro entrou ou saiu)</option>
          </select>
        </div>
        <div className="campo">
          <label htmlFor="dre-linha">Linha de negócio</label>
          <select id="dre-linha" value={linha} onChange={(e) => setLinha(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(ROTULO_LINHA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      {r.carregando && !d ? <Carregando /> : r.erro ? <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} /> : d && <TabelaDre d={d} abertos={abertos} alternar={alternar} abrir={(l, mes) => setDetalhe({ linha: l, mes })} />}

      {detalhe && d && <DetalheLancamentos linha={detalhe.linha} mes={detalhe.mes} ano={ano} regime={d.regime} unidadeId={praca} linhaNegocio={linha} aoFechar={() => setDetalhe(null)} />}
    </>
  );
}

function TabelaDre({ d, abertos, alternar, abrir }: { d: RespostaDre; abertos: Set<string>; alternar: (k: string) => void; abrir: (l: LinhaDreWeb, mes: string | null) => void }) {
  const receitaAno = soma(d.receitaBruta);
  const sub = (chave: string) => d.linhas.find((l) => l.chave === chave)?.total ?? 0;
  const vazio = d.linhas.every((l) => l.total === 0 && l.valores.every((v) => v === 0)) && d.abaixoDaLinha.length === 0;
  // Meses sem nenhum valor (ex.: meses futuros) ficam de fora para a tabela caber melhor.
  const usados = d.meses.map((_, i) => d.linhas.some((l) => l.valores[i] !== 0) || d.abaixoDaLinha.some((l) => l.valores[i] !== 0));
  const colunas = d.meses.map((m, i) => ({ m, i })).filter((c) => usados[c.i]);

  const linhasVisiveis = (lista: LinhaDreWeb[]) => {
    let grupoAtual = "";
    return lista.filter((l) => {
      if (l.nivel === "GRUPO") grupoAtual = l.chave;
      return l.nivel !== "CATEGORIA" || abertos.has(grupoAtual);
    });
  };

  const linhaTabela = (l: LinhaDreWeb) => {
    const clicavel = l.nivel === "CATEGORIA" && l.categoriaId;
    const classe = l.nivel === "SUBTOTAL" ? "fin-total dre__subtotal" : l.nivel === "SECAO" ? "fin-total" : l.nivel === "GRUPO" ? "fin-grupo" : "fin-sub";
    return (
      <tr key={l.chave} className={classe}>
        <th scope="row" className="dre__nome">
          {l.nivel === "GRUPO" ? (
            <button type="button" className="botao botao--fantasma botao--pequeno dre__alternar" aria-expanded={abertos.has(l.chave)} onClick={() => alternar(l.chave)}>
              {abertos.has(l.chave) ? "▾" : "▸"} {l.nome}
            </button>
          ) : l.nivel === "SUBTOTAL" ? `= ${l.nome}` : l.nome}
        </th>
        {colunas.map(({ m, i }) => (
          <td key={m} className={`fin-valor ${sinal(l.valores[i] ?? 0)}`}>
            {clicavel && l.valores[i] ? <button type="button" className="dre__valor" onClick={() => abrir(l, m)} aria-label={`Ver lançamentos de ${l.nome} em ${nomeMes(m)}`}>{formatarMoeda(l.valores[i]!)}</button> : formatarMoeda(l.valores[i] ?? 0)}
          </td>
        ))}
        <td className={`fin-valor dre__acumulado ${sinal(l.total)}`}>
          {clicavel && l.total ? <button type="button" className="dre__valor" onClick={() => abrir(l, null)} aria-label={`Ver lançamentos de ${l.nome} no ano`}>{formatarMoeda(l.total)}</button> : formatarMoeda(l.total)}
        </td>
        <td className="fin-valor texto-fraco">{l.secao === "ABAIXO_DA_LINHA" ? "" : pct(l.total, receitaAno)}</td>
      </tr>
    );
  };

  return (
    <>
      <Indicadores rotulo="Resultado do ano">
        <Indicador tinta="azul" icone="dinheiro" rotulo="Receita bruta" valor={formatarMoeda(receitaAno)} />
        <Indicador tinta="verde" icone="dinheiro" rotulo="Margem de contribuição" valor={formatarMoeda(sub("SUB_CUSTOS_VENDA"))} detalhe={`${pct(sub("SUB_CUSTOS_VENDA"), receitaAno)} da receita`} />
        <Indicador tinta="violeta" icone="dinheiro" rotulo="Resultado operacional (EBITDA)" valor={formatarMoeda(sub("SUB_ADMINISTRATIVO"))} detalhe={`${pct(sub("SUB_ADMINISTRATIVO"), receitaAno)} da receita`} />
        <Indicador tinta={soma(d.resultadoLiquido) < 0 ? "rosa" : "verde"} icone="dinheiro" rotulo="Resultado líquido" valor={formatarMoeda(soma(d.resultadoLiquido))} detalhe={`${pct(soma(d.resultadoLiquido), receitaAno)} da receita`} />
      </Indicadores>

      {vazio ? <section className="cartao"><p className="texto-fraco">Sem lançamentos neste ano{d.regime === "CAIXA" ? " (na visão de caixa só entram as contas já pagas ou recebidas)" : ""}.</p></section> : (
        <section className="cartao" aria-labelledby="titulo-dre-tabela">
          <h2 id="titulo-dre-tabela">{d.regime === "CAIXA" ? "Visão de caixa" : "Visão por competência"}</h2>
          <div className="tabela-rolagem">
            <table className="tabela tabela--compacta dre">
              <thead>
                <tr>
                  <th scope="col" className="dre__nome">Linha</th>
                  {colunas.map(({ m }) => <th key={m} scope="col" className="fin-valor">{nomeMes(m, "short")}</th>)}
                  <th scope="col" className="fin-valor dre__acumulado">Acumulado</th>
                  <th scope="col" className="fin-valor">% receita</th>
                </tr>
              </thead>
              <tbody>
                {linhasVisiveis(d.linhas).map(linhaTabela)}
              </tbody>
              {d.abaixoDaLinha.length > 0 && (
                <tbody>
                  <tr className="fin-total"><th scope="row" className="dre__nome" colSpan={colunas.length + 3}>Abaixo da linha: mexe no caixa, mas não é lucro nem prejuízo</th></tr>
                  {linhasVisiveis(d.abaixoDaLinha).map((l) => <Fragment key={l.chave}>{linhaTabela(l)}</Fragment>)}
                </tbody>
              )}
            </table>
          </div>
          <p className="texto-fraco">Impostos sobre o faturamento: regime tributário a confirmar com o contador. Juros, multas e descontos das baixas entram no resultado financeiro.</p>
        </section>
      )}
    </>
  );
}

function DetalheLancamentos({ linha, mes, ano, regime, unidadeId, linhaNegocio, aoFechar }: {
  linha: LinhaDreWeb; mes: string | null; ano: number; regime: "COMPETENCIA" | "CAIXA"; unidadeId: string | null; linhaNegocio: string; aoFechar: () => void;
}) {
  const de = mes ? `${mes}-01` : `${ano}-01-01`;
  const ate = mes ? ultimoDiaDoMes(mes) : `${ano}-12-31`;
  const r = useCarregar((s) => api.get<RespostaLancamentos>(`/api/financeiro/lancamentos${qs({
    categoriaId: linha.categoriaId ?? undefined, campo: regime === "CAIXA" ? "pagoEm" : "competencia", de, ate,
    situacao: regime === "CAIXA" ? "REALIZADO" : undefined, unidadeId, linha: linhaNegocio || undefined, limite: "500",
  })}`, s), [linha.categoriaId, de, ate, regime, unidadeId, linhaNegocio]);
  return (
    <Modal aberto titulo={`${linha.nome} — ${mes ? nomeMes(mes) : ano}`} aoFechar={aoFechar} largura="larga">
      {r.carregando && !r.dados ? <Carregando /> : r.erro ? <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} /> : r.dados && (
        <div className="tabela-rolagem">
          <table className="tabela tabela--compacta">
            <thead><tr><th scope="col">{regime === "CAIXA" ? "Pago em" : "Competência"}</th><th scope="col">Descrição</th><th scope="col">Favorecido</th><th scope="col">Situação</th><th scope="col" className="fin-valor">Valor</th></tr></thead>
            <tbody>
              {r.dados.itens.map((l) => (
                <tr key={l.id}>
                  <td className="sem-quebra">{formatarData(regime === "CAIXA" ? l.pagoEm ?? l.competencia : l.competencia)}</td>
                  <td>{l.descricao}</td>
                  <td>{l.contraparte ?? "—"}</td>
                  <td>{l.situacao === "REALIZADO" ? (l.tipo === "PAGAR" ? "Pago" : "Recebido") : "Em aberto"}</td>
                  <td className={`fin-valor ${l.tipo === "PAGAR" ? "fin-valor--saida" : "fin-valor--entrada"}`}>{l.tipo === "PAGAR" ? "−" : ""}{formatarMoeda(l.valorCentavos)}</td>
                </tr>
              ))}
              {r.dados.itens.length === 0 && <tr><td colSpan={5} className="texto-fraco">Nenhum lançamento.</td></tr>}
            </tbody>
          </table>
          {r.dados.total > r.dados.itens.length && <p className="texto-fraco">Mostrando {r.dados.itens.length} de {r.dados.total}. Veja todos em A pagar / A receber.</p>}
        </div>
      )}
    </Modal>
  );
}
