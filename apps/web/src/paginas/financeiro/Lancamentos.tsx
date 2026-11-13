import { useMemo, useState, type FormEvent } from "react";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { LINHAS_NEGOCIO, type LinhaNegocio } from "../../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { EtiquetaLinha } from "../../componentes/Etiquetas";
import { aplicarColunas, CabecalhoFiltro, VAZIO, type DefinicaoColuna, type EstadoColunas } from "../../componentes/FiltroColuna";
import { Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { Icone } from "../../componentes/Icone";
import { Indicador, Indicadores } from "../../componentes/Indicador";
import { nomePraca, useSessao } from "../../sessao/Sessao";
import { centavosDeTexto, formatarData, formatarMoeda, hojeIso, nomeMes, somarMes, textoDeCentavos, ultimoDiaDoMes } from "../../util/formato";
import { ROTULO_LINHA } from "../../util/rotulos";
import { useAtraso } from "../../util/useAtraso";
import { useCarregar } from "../../util/useCarregar";
import { useCategorias, useContas } from "./dados";
import { CANAIS_FIN, FORMAS, type CategoriaFin, type ContaFin, type FormaPagamento, type LancamentoFin, type RespostaLancamentos, type TipoLancamento } from "./tipos";
import { ROTULO_FORMA } from "./util";

type Repeticao = "UNICA" | "PARCELADO" | "RECORRENTE";

export function FormLancamento({ tipo, lancamento, categorias, contas, aoSalvar, aoCancelar }: {
  tipo: TipoLancamento;
  lancamento: LancamentoFin | null;
  categorias: CategoriaFin[];
  contas: ContaFin[];
  aoSalvar: () => Promise<void>;
  aoCancelar: () => void;
}) {
  const { unidades, praca, usuario } = useSessao();
  const hoje = hojeIso();
  const [descricao, setDescricao] = useState(lancamento?.descricao ?? "");
  const [contraparte, setContraparte] = useState(lancamento?.contraparte ?? "");
  const [categoriaId, setCategoriaId] = useState(lancamento?.categoriaId ?? "");
  const [unidadeId, setUnidadeId] = useState(lancamento ? (lancamento.unidadeId ?? "") : (praca || (unidades.length === 1 ? unidades[0]!.id : "")));
  const [linha, setLinha] = useState<string>(lancamento?.linha ?? "");
  const [veiculo, setVeiculo] = useState(lancamento?.veiculo ?? "");
  const [canal, setCanal] = useState<string>(lancamento?.canal ?? "");
  const [forma, setForma] = useState<string>(lancamento?.forma ?? "");
  const [contaId, setContaId] = useState(lancamento?.contaId ?? "");
  const [valor, setValor] = useState(lancamento ? textoDeCentavos(lancamento.valorCentavos) : "");
  const [competencia, setCompetencia] = useState(lancamento?.competencia ?? hoje);
  const [vencimento, setVencimento] = useState(lancamento?.vencimento ?? hoje);
  const [repeticao, setRepeticao] = useState<Repeticao>("UNICA");
  const [quantidade, setQuantidade] = useState("2");
  const [observacao, setObservacao] = useState(lancamento?.observacao ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const travaConciliado = !!lancamento?.conciliado;
  const travaValor = travaConciliado || lancamento?.situacao === "REALIZADO";
  const cats = categorias.filter((c) => c.ativa && c.tipo === (tipo === "PAGAR" ? "DESPESA" : "RECEITA"));
  const contasAtivas = contas.filter((c) => c.ativa);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const centavos = centavosDeTexto(valor);
    if (descricao.trim().length < 2) return setErro("Informe a descrição.");
    if (!categoriaId) return setErro("Escolha a categoria.");
    if (centavos === null || Number.isNaN(centavos) || centavos <= 0) return setErro("Informe o valor em reais (ex.: 1.234,56), com no máximo duas casas decimais.");
    if (!unidadeId && !usuario?.todasUnidades) return setErro("Escolha a praça.");
    if (!competencia || !vencimento) return setErro("Informe a competência e o vencimento.");
    const n = Number(quantidade);
    if (!lancamento && repeticao !== "UNICA" && (!Number.isInteger(n) || n < 2 || n > (repeticao === "PARCELADO" ? 120 : 60))) return setErro(repeticao === "PARCELADO" ? "Parcelas: de 2 a 120." : "Meses: de 2 a 60.");
    setSalvando(true);
    try {
      const comuns = {
        descricao: descricao.trim(), contraparte: contraparte.trim() || null, categoriaId, unidadeId: unidadeId || null,
        linha: (linha || null) as LinhaNegocio | null, veiculo: veiculo.trim() || null, canal: canal || null, forma: (forma || null) as FormaPagamento | null,
        contaId: contaId || null, observacao: observacao.trim() || null,
      };
      if (lancamento) {
        await api.patch(`/api/financeiro/lancamentos/${lancamento.id}`, {
          ...comuns,
          ...(travaConciliado ? { contaId: undefined } : {}),
          ...(travaValor ? {} : { valorCentavos: centavos }),
          ...(travaConciliado ? {} : { competencia, vencimento }),
        });
      } else {
        await api.post("/api/financeiro/lancamentos", {
          ...comuns, tipo, valorCentavos: centavos, competencia, vencimento,
          repeticao: repeticao === "UNICA" ? null : repeticao === "PARCELADO" ? { tipo: "PARCELADO", parcelas: n } : { tipo: "RECORRENTE", meses: n },
        });
      }
      await aoSalvar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {travaConciliado && <Aviso tipo="info">Lançamento conciliado com o extrato: valor, datas e conta não podem ser alterados (desfaça a conciliação primeiro).</Aviso>}
      {!travaConciliado && travaValor && <Aviso tipo="info">Lançamento já baixado: para alterar o valor, reabra a baixa antes.</Aviso>}
      <div className="grade-campos">
        <div className="campo campo--largo">
          <label htmlFor="lan-descricao">Descrição</label>
          <input id="lan-descricao" value={descricao} maxLength={200} onChange={(e) => setDescricao(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="lan-contraparte">{tipo === "PAGAR" ? "Fornecedor" : "Cliente ou canal"}</label>
          <input id="lan-contraparte" value={contraparte} maxLength={150} onChange={(e) => setContraparte(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="lan-categoria">Categoria</label>
          <select id="lan-categoria" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">Escolha…</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="lan-valor">{lancamento ? "Valor (R$)" : repeticao === "PARCELADO" ? "Valor total (R$)" : "Valor (R$)"}</label>
          <input id="lan-valor" inputMode="decimal" value={valor} disabled={travaValor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
        </div>
        <div className="campo">
          <label htmlFor="lan-vencimento">Vencimento</label>
          <input id="lan-vencimento" type="date" value={vencimento} disabled={travaConciliado} onChange={(e) => setVencimento(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="lan-competencia">Competência</label>
          <input id="lan-competencia" type="date" value={competencia} disabled={travaConciliado} onChange={(e) => setCompetencia(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="lan-praca">Praça</label>
          <select id="lan-praca" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            {usuario?.todasUnidades && <option value="">Empresa toda</option>}
            {!usuario?.todasUnidades && <option value="">Escolha…</option>}
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="lan-linha">Linha de negócio</label>
          <select id="lan-linha" value={linha} onChange={(e) => setLinha(e.target.value)}>
            <option value="">Sem linha</option>
            {LINHAS_NEGOCIO.map((l) => <option key={l} value={l}>{ROTULO_LINHA[l]}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="lan-veiculo">Veículo (placa)</label>
          <input id="lan-veiculo" value={veiculo} maxLength={10} onChange={(e) => setVeiculo(e.target.value.toUpperCase())} placeholder="Opcional" />
        </div>
        {tipo === "RECEBER" && (
          <div className="campo">
            <label htmlFor="lan-canal">Canal de venda</label>
            <select id="lan-canal" value={canal} onChange={(e) => setCanal(e.target.value)}>
              <option value="">Não se aplica</option>
              {CANAIS_FIN.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        <div className="campo">
          <label htmlFor="lan-forma">Forma</label>
          <select id="lan-forma" value={forma} onChange={(e) => setForma(e.target.value)}>
            <option value="">Não informada</option>
            {FORMAS.map((f) => <option key={f} value={f}>{ROTULO_FORMA[f]}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="lan-conta">Conta</label>
          <select id="lan-conta" value={contaId} disabled={travaConciliado} onChange={(e) => setContaId(e.target.value)}>
            <option value="">Definir na baixa</option>
            {contasAtivas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        {!lancamento && (
          <>
            <div className="campo">
              <label htmlFor="lan-repeticao">Repetição</label>
              <select id="lan-repeticao" value={repeticao} onChange={(e) => setRepeticao(e.target.value as Repeticao)}>
                <option value="UNICA">Lançamento único</option>
                <option value="PARCELADO">Parcelado (divide o valor total)</option>
                <option value="RECORRENTE">Recorrente (mesmo valor todo mês)</option>
              </select>
            </div>
            {repeticao !== "UNICA" && (
              <div className="campo">
                <label htmlFor="lan-quantidade">{repeticao === "PARCELADO" ? "Número de parcelas" : "Quantos meses"}</label>
                <input id="lan-quantidade" inputMode="numeric" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
              </div>
            )}
          </>
        )}
        <div className="campo campo--largo">
          <label htmlFor="lan-obs">Observação</label>
          <textarea id="lan-obs" rows={2} maxLength={1000} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </div>
      </div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : lancamento ? "Salvar" : "Lançar"}</button>
      </div>
    </form>
  );
}

function FormBaixa({ lancamento, contas, aoConcluir, aoCancelar }: { lancamento: LancamentoFin; contas: ContaFin[]; aoConcluir: () => Promise<void>; aoCancelar: () => void }) {
  const [pagoEm, setPagoEm] = useState(hojeIso());
  const [contaId, setContaId] = useState(lancamento.contaId ?? "");
  const [juros, setJuros] = useState("");
  const [multa, setMulta] = useState("");
  const [desconto, setDesconto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const campo = (t: string) => {
    if (t.trim() === "") return 0;
    const v = centavosDeTexto(t);
    return v === null || Number.isNaN(v) || v < 0 ? null : v;
  };
  const j = campo(juros);
  const m = campo(multa);
  const d = campo(desconto);
  const total = j === null || m === null || d === null ? null : lancamento.valorCentavos + j + m - d;
  const verbo = lancamento.tipo === "PAGAR" ? "pago" : "recebido";

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!contaId) return setErro("Escolha a conta.");
    if (total === null) return setErro("Juros, multa e desconto: valores em reais com até duas casas decimais.");
    if (total <= 0) return setErro("O desconto não pode ser igual ou maior que o valor devido.");
    setSalvando(true);
    try {
      await api.post(`/api/financeiro/lancamentos/${lancamento.id}/baixa`, { pagoEm, contaId, jurosCentavos: j, multaCentavos: m, descontoCentavos: d });
      await aoConcluir();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p><strong>{lancamento.descricao}</strong> — devido {formatarMoeda(lancamento.valorCentavos)}, vencimento {formatarData(lancamento.vencimento)}</p>
      <div className="grade-campos">
        <div className="campo">
          <label htmlFor="baixa-data">Data do pagamento</label>
          <input id="baixa-data" type="date" value={pagoEm} max={hojeIso()} onChange={(e) => setPagoEm(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="baixa-conta">Conta</label>
          <select id="baixa-conta" value={contaId} onChange={(e) => setContaId(e.target.value)}>
            <option value="">Escolha…</option>
            {contas.filter((c) => c.ativa).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div className="campo"><label htmlFor="baixa-juros">Juros (R$)</label><input id="baixa-juros" inputMode="decimal" value={juros} onChange={(e) => setJuros(e.target.value)} placeholder="0,00" /></div>
        <div className="campo"><label htmlFor="baixa-multa">Multa (R$)</label><input id="baixa-multa" inputMode="decimal" value={multa} onChange={(e) => setMulta(e.target.value)} placeholder="0,00" /></div>
        <div className="campo"><label htmlFor="baixa-desconto">Desconto (R$)</label><input id="baixa-desconto" inputMode="decimal" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" /></div>
      </div>
      <p aria-live="polite">Valor {verbo}: <strong>{total === null ? "—" : formatarMoeda(total)}</strong></p>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : lancamento.tipo === "PAGAR" ? "Confirmar pagamento" : "Confirmar recebimento"}</button>
      </div>
    </form>
  );
}

type Coluna = "vencimento" | "centro" | "descricao" | "categoria" | "valor" | "situacao";
const valorMostrado = (l: LancamentoFin) => (l.situacao === "REALIZADO" ? (l.valorPagoCentavos ?? l.valorCentavos) : l.valorCentavos);
/** Centro de custo em texto: praça · linha · veículo (placa ou trem). */
export function textoCentro(l: LancamentoFin, praca: (id: string) => string): string {
  return [l.unidadeId ? praca(l.unidadeId) : "Empresa toda", l.linha ? ROTULO_LINHA[l.linha] : null, l.veiculo].filter(Boolean).join(" · ");
}

/**
 * Saldo da conta escolhida no filtro (pedido do dono, 13/11/2026): no mês, o que entrou (contas a receber recebidas nesta
 * conta) menos o que saiu (contas a pagar pagas por ela), e o saldo atual da conta (saldo inicial + tudo o que já entrou e saiu).
 */
function SaldoDaConta({ conta, mes, praca }: { conta: ContaFin; mes: string; praca: string | null }) {
  const filtro = (t: TipoLancamento) => qs({ tipo: t, situacao: "REALIZADO", contaId: conta.id, unidadeId: praca, de: `${mes}-01`, ate: ultimoDiaDoMes(mes), limite: 1 });
  const r = useCarregar(async (s) => {
    const [rec, pag] = await Promise.all([
      api.get<RespostaLancamentos>(`/api/financeiro/lancamentos${filtro("RECEBER")}`, s),
      api.get<RespostaLancamentos>(`/api/financeiro/lancamentos${filtro("PAGAR")}`, s),
    ]);
    return { entrou: rec.somaRealizadoCentavos, saiu: pag.somaRealizadoCentavos };
  }, [conta.id, mes, praca]);
  return (
    <Indicadores rotulo={`Saldo de ${conta.nome}`}>
      <Indicador tinta="verde" icone="check" rotulo={`Recebido em ${nomeMes(mes)}`} valor={r.dados ? formatarMoeda(r.dados.entrou) : "…"} detalhe="Contas a receber nesta conta" />
      <Indicador tinta="rosa" icone="alerta" rotulo={`Pago em ${nomeMes(mes)}`} valor={r.dados ? formatarMoeda(r.dados.saiu) : "…"} detalhe="Contas a pagar nesta conta" />
      <Indicador tinta="azul" icone="lista" rotulo="Resultado do mês" valor={r.dados ? formatarMoeda(r.dados.entrou - r.dados.saiu) : "…"} detalhe="Recebido menos pago" />
      <Indicador tinta="ambar" icone="calendario" rotulo="Saldo atual da conta" valor={formatarMoeda(conta.saldoCentavos)} detalhe={conta.banco ?? conta.nome} />
    </Indicadores>
  );
}

export function Lancamentos({ tipo }: { tipo: TipoLancamento }) {
  const { praca, unidades, pode } = useSessao();
  const notificar = useNotificar();
  const podeEditar = pode("financeiro:gerenciar");
  const [mes, setMes] = useState(() => hojeIso().slice(0, 7));
  const [situacao, setSituacao] = useState<"" | "ABERTO" | "VENCIDO" | "REALIZADO">("");
  const [texto, setTexto] = useState("");
  const busca = useAtraso(texto.trim(), 300);
  // Filtros (pedido do dono, 11/11/2026): banco/conta, fornecedor, categoria e faixa de valor.
  const [contaFiltro, setContaFiltro] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [fornecedorTexto, setFornecedorTexto] = useState("");
  const fornecedor = useAtraso(fornecedorTexto.trim(), 300);
  const [valorDe, setValorDe] = useState("");
  const [valorAte, setValorAte] = useState("");
  const valorMin = useAtraso(centavosDeTexto(valorDe) ?? null, 400);
  const valorMax = useAtraso(centavosDeTexto(valorAte) ?? null, 400);
  const [maisFiltros, setMaisFiltros] = useState(false);
  const filtrosAtivos = [contaFiltro, categoriaFiltro, fornecedorTexto.trim(), valorDe.trim(), valorAte.trim()].filter(Boolean).length;
  const fornecedores = useCarregar((s) => api.get<Array<{ id: string; nome: string }>>("/api/financeiro/fornecedores", s), []);
  const [edicao, setEdicao] = useState<LancamentoFin | "novo" | null>(null);
  const [baixando, setBaixando] = useState<LancamentoFin | null>(null);
  const [excluindo, setExcluindo] = useState<LancamentoFin | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const categorias = useCategorias();
  const contas = useContas();
  // Filtros de coluna como no Excel (13/11/2026): classificar A–Z / Z–A e escolher valores (ex.: só uma placa ou o trem).
  const [colunas, setColunas] = useState<EstadoColunas<Coluna>>({ ordem: null, selecionados: {} });

  const lista = useCarregar((s) => api.get<RespostaLancamentos>(`/api/financeiro/lancamentos${qs({
    tipo, situacao, unidadeId: praca, q: busca, limite: 300,
    de: situacao === "VENCIDO" ? "" : `${mes}-01`, ate: situacao === "VENCIDO" ? "" : ultimoDiaDoMes(mes),
    contaId: contaFiltro || undefined, categoriaId: categoriaFiltro || undefined, fornecedor: fornecedor || undefined,
    valorMin: valorMin === null ? undefined : String(valorMin), valorMax: valorMax === null ? undefined : String(valorMax),
  })}`, s), [tipo, mes, situacao, praca, busca, contaFiltro, categoriaFiltro, fornecedor, valorMin, valorMax]);

  const rotulos = tipo === "PAGAR"
    ? { titulo: "Contas a pagar", novo: "Nova conta a pagar", baixa: "Pagar", realizado: "Pago", descricao: "Despesas com vencimento, categoria e centro de custo (praça, linha e veículo)." }
    : { titulo: "Contas a receber", novo: "Nova conta a receber", baixa: "Receber", realizado: "Recebido", descricao: "Repasses dos canais, fretamentos, publicidade e demais receitas." };
  const d = lista.dados;
  const nomes = useMemo(() => new Map((contas.dados ?? []).map((c) => [c.id, c.nome])), [contas.dados]);
  const defs = useMemo<Record<Coluna, DefinicaoColuna<LancamentoFin>>>(() => ({
    vencimento: { valor: (l) => formatarData(l.vencimento), ordenar: (l) => l.vencimento },
    centro: { valor: (l) => textoCentro(l, (id) => nomePraca(unidades, id)) },
    descricao: { valor: (l) => l.descricao || VAZIO },
    categoria: { valor: (l) => l.categoriaNome || VAZIO },
    valor: { valor: (l) => formatarMoeda(valorMostrado(l)), ordenar: (l) => valorMostrado(l) },
    situacao: { valor: (l) => (l.situacao === "REALIZADO" ? rotulos.realizado : l.vencido ? "Vencida" : "Em aberto") },
  }), [unidades, rotulos.realizado]);
  const visiveis = useMemo(() => (d ? aplicarColunas(d.itens, defs, colunas) : []), [d, defs, colunas]);
  const filtrandoColunas = Object.keys(colunas.selecionados).length > 0;

  async function recarregarTudo() {
    setEdicao(null);
    setBaixando(null);
    setExcluindo(null);
    await lista.recarregar();
  }

  async function reabrir(l: LancamentoFin) {
    setErro(null);
    try {
      await api.post(`/api/financeiro/lancamentos/${l.id}/reabrir`);
      notificar("Baixa reaberta.");
      await lista.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  async function excluir(l: LancamentoFin, serie: boolean) {
    setErro(null);
    try {
      const r = await api.delete<{ excluidos: number }>(`/api/financeiro/lancamentos/${l.id}${serie ? "?serie=1" : ""}`);
      notificar(r.excluidos === 1 ? "Lançamento excluído." : `${r.excluidos} lançamentos excluídos.`);
      setExcluindo(null);
      await lista.recarregar();
    } catch (x) {
      setExcluindo(null);
      setErro(mensagemDeErro(x));
    }
  }

  return (
    <>
      <div className="pagina__cabecalho">
        <div>
          <h1>{rotulos.titulo}</h1>
          <p className="pagina__descricao">{rotulos.descricao}</p>
        </div>
<div className="pagina__filtros">
        <div className="fin-meses" aria-label="Mês de vencimento">
          <button type="button" className="botao botao--secundario" aria-label="Mês anterior" disabled={situacao === "VENCIDO"} onClick={() => setMes(somarMes(mes, -1))}>←</button>
          <span className="fin-meses__nome" aria-live="polite">{situacao === "VENCIDO" ? "Todos os meses" : nomeMes(mes)}</span>
          <button type="button" className="botao botao--secundario" aria-label="Próximo mês" disabled={situacao === "VENCIDO"} onClick={() => setMes(somarMes(mes, 1))}>→</button>
        </div>
        <div className="campo campo--linha">
          <label htmlFor="fil-situacao">Situação</label>
          <select id="fil-situacao" value={situacao} onChange={(e) => setSituacao(e.target.value as typeof situacao)}>
            <option value="">Todas</option>
            <option value="ABERTO">Em aberto</option>
            <option value="VENCIDO">Vencidas</option>
            <option value="REALIZADO">{rotulos.realizado}</option>
          </select>
        </div>
        <div className="campo campo--linha campo--busca">
          <label htmlFor="fil-busca">Buscar</label>
          <input id="fil-busca" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nome, descrição ou fornecedor" />
        </div>
        <button type="button" className="botao botao--secundario" aria-expanded={maisFiltros} onClick={() => setMaisFiltros(!maisFiltros)}>
          <Icone nome="lista" /> Filtros{filtrosAtivos ? ` (${filtrosAtivos})` : ""}
        </button>
      </div>
        {podeEditar && (
          <div className="barra-acoes">
            <button type="button" className="botao botao--primario" onClick={() => setEdicao("novo")}>{rotulos.novo}</button>
          </div>
        )}
      </div>

      {maisFiltros && (
        <div className="filtros fin-filtros" role="search" aria-label="Mais filtros">
          <div className="campo">
            <label htmlFor="fil-conta">Banco / conta</label>
            <select id="fil-conta" value={contaFiltro} onChange={(e) => setContaFiltro(e.target.value)}>
              <option value="">Todas</option>
              {(contas.dados ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="fil-fornecedor">{tipo === "PAGAR" ? "Fornecedor" : "Cliente / canal"}</label>
            <input id="fil-fornecedor" type="search" list="fil-fornecedores" value={fornecedorTexto} onChange={(e) => setFornecedorTexto(e.target.value)} placeholder="Nome" />
            <datalist id="fil-fornecedores">{(fornecedores.dados ?? []).map((f) => <option key={f.id} value={f.nome} />)}</datalist>
          </div>
          <div className="campo">
            <label htmlFor="fil-categoria">Categoria</label>
            <select id="fil-categoria" value={categoriaFiltro} onChange={(e) => setCategoriaFiltro(e.target.value)}>
              <option value="">Todas</option>
              {(categorias.dados ?? []).filter((c) => c.tipo === (tipo === "PAGAR" ? "DESPESA" : "RECEITA")).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="fil-valor-de">Valor de (R$)</label>
            <input id="fil-valor-de" inputMode="decimal" value={valorDe} onChange={(e) => setValorDe(e.target.value)} placeholder="0,00" />
          </div>
          <div className="campo">
            <label htmlFor="fil-valor-ate">Valor até (R$)</label>
            <input id="fil-valor-ate" inputMode="decimal" value={valorAte} onChange={(e) => setValorAte(e.target.value)} placeholder="0,00" />
          </div>
          {filtrosAtivos > 0 && (
            <button type="button" className="botao botao--fantasma" onClick={() => { setContaFiltro(""); setCategoriaFiltro(""); setFornecedorTexto(""); setValorDe(""); setValorAte(""); }}>Limpar filtros</button>
          )}
        </div>
      )}

      {contaFiltro && contas.dados?.find((c) => c.id === contaFiltro) && (
        <SaldoDaConta conta={contas.dados.find((c) => c.id === contaFiltro)!} mes={mes} praca={praca} />
      )}
      {d && (
        <Indicadores rotulo="Totais do filtro">
          <Indicador tinta="azul" icone="lista" rotulo="Lançamentos" valor={String(d.total)} detalhe={`Total ${formatarMoeda(d.somaDevidoCentavos)}`} />
          <Indicador tinta="ambar" icone="calendario" rotulo="Em aberto" valor={formatarMoeda(d.somaAbertoCentavos)} />
          <Indicador tinta="rosa" icone="alerta" rotulo="Vencidas" valor={formatarMoeda(d.somaVencidoCentavos ?? 0)} detalhe={`${d.qtdVencido ?? 0} conta(s)`} />
          <Indicador tinta="verde" icone="check" rotulo={rotulos.realizado} valor={formatarMoeda(d.somaRealizadoCentavos)} />
        </Indicadores>
      )}

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {lista.carregando && !d ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : d && (d.itens.length === 0 ? <Vazio titulo="Nenhum lançamento neste filtro." /> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <CabecalhoFiltro coluna="vencimento" rotulo="Vencimento" linhas={d.itens} definicao={defs.vencimento} estado={colunas} mudar={setColunas} textos={{ asc: "Mais antigo primeiro", desc: "Mais recente primeiro" }} />
                <CabecalhoFiltro coluna="centro" rotulo="Centro de custo" linhas={d.itens} definicao={defs.centro} estado={colunas} mudar={setColunas} />
                <CabecalhoFiltro coluna="descricao" rotulo="Descrição" linhas={d.itens} definicao={defs.descricao} estado={colunas} mudar={setColunas} />
                <CabecalhoFiltro coluna="categoria" rotulo="Categoria" linhas={d.itens} definicao={defs.categoria} estado={colunas} mudar={setColunas} className="fin-esconder-celular" />
                <CabecalhoFiltro coluna="valor" rotulo="Valor" linhas={d.itens} definicao={defs.valor} estado={colunas} mudar={setColunas} className="fin-valor" textos={{ asc: "Do menor para o maior", desc: "Do maior para o menor" }} />
                <CabecalhoFiltro coluna="situacao" rotulo="Situação" linhas={d.itens} definicao={defs.situacao} estado={colunas} mudar={setColunas} />
                {podeEditar && <th scope="col"><span className="fin-oculto-visual">Ações</span></th>}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => (
                <tr key={l.id}>
                  <td className="sem-quebra">{formatarData(l.vencimento)}</td>
                  <td>
                    {l.unidadeId ? nomePraca(unidades, l.unidadeId) : "Empresa toda"} <EtiquetaLinha linha={l.linha} />
                    {l.veiculo && <div className="texto-fraco">{l.veiculo}</div>}
                  </td>
                  <td>
                    {l.descricao}
                    {l.recorrente && <span className="etiqueta etiqueta--neutra">recorrente</span>}
                    {l.contraparte && <div className="texto-fraco">{l.contraparte}</div>}
                  </td>
                  <td className="fin-esconder-celular">{l.categoriaNome}</td>
                  <td className="fin-valor">
                    {formatarMoeda(l.situacao === "REALIZADO" ? (l.valorPagoCentavos ?? l.valorCentavos) : l.valorCentavos)}
                    {l.situacao === "REALIZADO" && l.valorPagoCentavos !== l.valorCentavos && <div className="texto-fraco">devido {formatarMoeda(l.valorCentavos)}</div>}
                  </td>
                  <td>
                    {l.situacao === "REALIZADO" ? <span className="etiqueta etiqueta--sucesso">{rotulos.realizado} em {formatarData(l.pagoEm)}</span> : l.vencido ? <span className="etiqueta etiqueta--perigo">Vencida</span> : <span className="etiqueta etiqueta--neutra">Em aberto</span>}
                    {l.conciliado && <span className="etiqueta etiqueta--sucesso">Conciliado</span>}
                    {l.contaId && l.situacao === "REALIZADO" && <div className="texto-fraco">{nomes.get(l.contaId) ?? l.contaNome}</div>}
                  </td>
                  {podeEditar && (
                    <td>
                      <div className="fin-acoes">
                        {l.situacao === "ABERTO" && <button type="button" className="botao botao--pequeno botao--primario" onClick={() => setBaixando(l)}>{rotulos.baixa}</button>}
                        <button type="button" className="botao botao--pequeno botao--secundario" onClick={() => setEdicao(l)}>Editar</button>
                        {l.situacao === "REALIZADO" && !l.conciliado && <button type="button" className="botao botao--pequeno botao--secundario" onClick={() => void reabrir(l)}>Reabrir</button>}
                        {l.situacao === "ABERTO" && !l.conciliado && <button type="button" className="botao botao--pequeno botao--perigo-contorno" onClick={() => setExcluindo(l)}>Excluir</button>}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="fin-total">
                {filtrandoColunas ? (
                  <>
                    <td colSpan={4}>{visiveis.length} de {d.itens.length} lançamento(s) no filtro das colunas</td>
                    <td className="fin-valor" colSpan={podeEditar ? 3 : 2}>Soma {formatarMoeda(visiveis.reduce((a, l) => a + valorMostrado(l), 0))}</td>
                  </>
                ) : (
                  <>
                    <td colSpan={4}>{d.total} lançamento(s)</td>
                    <td className="fin-valor" colSpan={podeEditar ? 3 : 2}>
                      Em aberto {formatarMoeda(d.somaAbertoCentavos)} · {rotulos.realizado} {formatarMoeda(d.somaRealizadoCentavos)}
                    </td>
                  </>
                )}
              </tr>
            </tfoot>
          </table>
          {d.total > d.itens.length && <p className="texto-fraco">Mostrando {d.itens.length} de {d.total}. Use os filtros para refinar.</p>}
        </div>
      ))}

      <Modal aberto={edicao !== null} titulo={edicao === "novo" ? rotulos.novo : "Editar lançamento"} aoFechar={() => setEdicao(null)} largura="larga">
        {edicao !== null && categorias.dados && contas.dados && (
          <FormLancamento tipo={tipo} lancamento={edicao === "novo" ? null : edicao} categorias={categorias.dados} contas={contas.dados} aoSalvar={async () => { notificar("Lançamento salvo."); await recarregarTudo(); }} aoCancelar={() => setEdicao(null)} />
        )}
      </Modal>
      <Modal aberto={baixando !== null} titulo={tipo === "PAGAR" ? "Pagar conta" : "Receber conta"} aoFechar={() => setBaixando(null)}>
        {baixando && contas.dados && <FormBaixa lancamento={baixando} contas={contas.dados} aoConcluir={async () => { notificar("Baixa registrada."); await recarregarTudo(); }} aoCancelar={() => setBaixando(null)} />}
      </Modal>
      <Modal aberto={excluindo !== null} titulo="Excluir lançamento" aoFechar={() => setExcluindo(null)}>
        {excluindo && (
          <div>
            <p>Excluir <strong>{excluindo.descricao}</strong> ({formatarMoeda(excluindo.valorCentavos)})?</p>
            <div className="modal__acoes">
              <button type="button" className="botao botao--secundario" onClick={() => setExcluindo(null)}>Cancelar</button>
              {excluindo.grupoId && <button type="button" className="botao botao--perigo-contorno" onClick={() => void excluir(excluindo, true)}>Esta e as próximas em aberto</button>}
              <button type="button" className="botao botao--perigo" onClick={() => void excluir(excluindo, false)}>{excluindo.grupoId ? "Só esta" : "Excluir"}</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
