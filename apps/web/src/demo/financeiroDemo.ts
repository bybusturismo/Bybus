/** Financeiro da demonstração: contas, lançamentos do mês, extratos com sugestões e cartão. Tudo fictício, em centavos. */
import {
  PLANO_CATEGORIAS, SINONIMOS_PADRAO, calcularBaixa, classificar, faturaDaData, lerPlanilhaFinanceira, montarDicionario, montarDre, montarFluxoSemanal, sugerirCategoria, sugerirCorrespondencias,
  type LancamentoCandidato, type LancamentoRelatorio, type RegraCategoria,
} from "@bybus/core";
import { NAO, UN_BC, UN_FLN, achar, aplicar, fimDoMes, semAcento, somarDias, type Corpo, type Ctx, type Rotear } from "./comum";

type Tipo = "PAGAR" | "RECEBER";
interface Conta { id: string; unidadeId: string | null; nome: string; tipo: string; banco: string | null; finalConta: string | null; saldoInicialCentavos: number; saldoInicialEm: string | null; diaFechamento: number | null; diaVencimento: number | null; contaPagamentoId: string | null; ativa: boolean; saldoCentavos: number }
interface Categoria { id: string; codigo: string; nome: string; tipo: "RECEITA" | "DESPESA"; grupo: string; ordem: number; ativa: boolean; sistema: boolean }
interface Regra { id: string; texto: string; tipo: "RECEITA" | "DESPESA" | null; categoriaId: string; unidadeId: string | null; linha: string | null; prioridade: number; ativa: boolean }
interface Lanc {
  id: string; tipo: Tipo; descricao: string; contraparte: string | null; categoriaId: string; contaId: string | null; unidadeId: string | null; linha: string | null; veiculo: string | null; canal: string | null; forma: string | null;
  valorCentavos: number; competencia: string; vencimento: string; situacao: "ABERTO" | "REALIZADO"; pagoEm: string | null; valorPagoCentavos: number | null; jurosCentavos: number; multaCentavos: number; descontoCentavos: number;
  grupoId: string | null; parcelaNumero: number | null; parcelaTotal: number | null; recorrente: boolean; observacao: string | null; origem: "MANUAL" | "EXTRATO" | "PLANILHA";
}
interface Linha { id: string; contaId: string; data: string; valorCentavos: number; descricao: string; documento: string | null; status: "PENDENTE" | "CONCILIADO" | "TRANSFERENCIA" | "IGNORADO"; lancamentoId: string | null; parLinhaId: string | null; manual: boolean; observacao: string | null }

let semeado = false;
let hoje = "";
let mesAtual = "";
const contas: Conta[] = [];
const categorias: Categoria[] = PLANO_CATEGORIAS.map((c, i) => ({ id: `cat-${c.codigo}`, codigo: c.codigo, nome: c.nome, tipo: c.tipo, grupo: c.grupo, ordem: i + 1, ativa: true, sistema: true }));
const regras: Regra[] = [];
const lancs: Lanc[] = [];
const linhas: Linha[] = [];
const recusas = new Set<string>();
const sinonimos: Array<{ id: string; tipo: string; texto: string; alvo: string }> = SINONIMOS_PADRAO.map((x, i) => ({ id: `sn-${i}`, tipo: x.tipo, texto: x.texto, alvo: x.alvo }));
const fechamentos: Array<{ contaId: string; data: string; saldoInicialCentavos: number; entradasCentavos: number; saidasCentavos: number; saldoCalculadoCentavos: number; saldoContadoCentavos: number; diferencaCentavos: number; observacao: string | null; fechadoEm: string }> = [];
const revendas: Array<{ id: string; descricao: string; fornecedor: string | null; vendedor: string | null; dataVenda: string; valorVendaCentavos: number; valorRepasseCentavos: number; comissaoCentavos: number }> = [];
const COLUNA_CONTA: Record<string, string> = { SICREDI: "co-fln", UNILOS: "co-bc", QUIOSQUE: "co-caixa", CARTAO: "co-cartao" };

const cat = (codigo: string) => `cat-${codigo}`;

function semear(dataMais: (n: number) => string) {
  if (semeado) return;
  semeado = true;
  hoje = dataMais(0);
  mesAtual = hoje.slice(0, 7);
  const hd = Number(hoje.slice(8));
  const dia = (d: number) => `${mesAtual}-${String(Math.max(1, Math.min(d, 28))).padStart(2, "0")}`;
  const passado = (d: number) => dia(Math.min(d, hd));

  contas.push(
    { id: "co-fln", unidadeId: UN_FLN, nome: "Conta corrente Floripa (fictícia)", tipo: "CORRENTE", banco: "Banco Exemplo", finalConta: "0001", saldoInicialCentavos: 3_000_000, saldoInicialEm: dia(1), diaFechamento: null, diaVencimento: null, contaPagamentoId: null, ativa: true, saldoCentavos: 4_835_000 },
    { id: "co-bc", unidadeId: UN_BC, nome: "Conta corrente Balneário Camboriú (fictícia)", tipo: "CORRENTE", banco: "Banco Exemplo", finalConta: "0002", saldoInicialCentavos: 1_500_000, saldoInicialEm: dia(1), diaFechamento: null, diaVencimento: null, contaPagamentoId: null, ativa: true, saldoCentavos: 2_212_050 },
    { id: "co-caixa", unidadeId: UN_FLN, nome: "Caixa do quiosque (fictício)", tipo: "CAIXA", banco: null, finalConta: null, saldoInicialCentavos: 30_000, saldoInicialEm: dia(1), diaFechamento: null, diaVencimento: null, contaPagamentoId: null, ativa: true, saldoCentavos: 87_000 },
    { id: "co-aplic", unidadeId: UN_FLN, nome: "Aplicação (fictícia)", tipo: "APLICACAO", banco: "Banco Exemplo", finalConta: null, saldoInicialCentavos: 2_000_000, saldoInicialEm: dia(1), diaFechamento: null, diaVencimento: null, contaPagamentoId: null, ativa: true, saldoCentavos: 2_000_000 },
    { id: "co-cartao", unidadeId: null, nome: "Cartão corporativo (fictício)", tipo: "CARTAO", banco: "Banco Exemplo", finalConta: "7788", saldoInicialCentavos: 0, saldoInicialEm: null, diaFechamento: 25, diaVencimento: 5, contaPagamentoId: "co-fln", ativa: true, saldoCentavos: -1_134_500 },
  );
  for (const [texto, codigo, tipo] of [["POSTO", "DESP_COMBUSTIVEL", "DESPESA"], ["TARIFA", "DESP_TAXAS", "DESPESA"], ["ESTACIONAMENTO", "DESP_PEDAGIO", "DESPESA"], ["GOOGLE", "DESP_MARKETING", "DESPESA"], ["PAYTOUR", "REC_SITE_PAYTOUR", "RECEITA"]] as const) {
    regras.push({ id: `rg-${codigo}`, texto, tipo, categoriaId: cat(codigo), unidadeId: null, linha: null, prioridade: 10, ativa: true });
  }

  let n = 1;
  const base = { observacao: null, grupoId: null, parcelaNumero: null, parcelaTotal: null, recorrente: false, origem: "MANUAL" as const, jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0, valorPagoCentavos: null, pagoEm: null, veiculo: null, canal: null, forma: null, linha: null };
  const novo = (l: Partial<Lanc> & Pick<Lanc, "tipo" | "descricao" | "categoriaId" | "valorCentavos" | "vencimento" | "unidadeId">): Lanc => {
    const x: Lanc = { ...base, id: `la-${n++}`, contraparte: null, contaId: null, competencia: l.vencimento, situacao: "ABERTO", ...l };
    lancs.push(x);
    return x;
  };
  const pago = (l: Lanc, em: string, contaId: string) => Object.assign(l, { situacao: "REALIZADO" as const, pagoEm: em, valorPagoCentavos: l.valorCentavos, contaId });

  novo({ tipo: "PAGAR", descricao: "Combustível da frota — semana", contraparte: "Posto Ilha (fictício)", categoriaId: cat("DESP_COMBUSTIVEL"), valorCentavos: 325_000, vencimento: dia(8), unidadeId: UN_FLN, linha: "CITY_TOUR", veiculo: "DEM1A23", forma: "PIX" });
  novo({ tipo: "PAGAR", descricao: "Salários e encargos — equipe Floripa", categoriaId: cat("DESP_SALARIOS"), valorCentavos: 2_840_000, vencimento: dia(5), unidadeId: UN_FLN, forma: "TRANSFERENCIA", recorrente: true });
  novo({ tipo: "PAGAR", descricao: "Aluguel do quiosque", contraparte: "Condomínio Exemplo (fictício)", categoriaId: cat("DESP_ALUGUEL"), valorCentavos: 480_000, vencimento: dia(10), unidadeId: UN_FLN, forma: "BOLETO", recorrente: true });
  novo({ tipo: "PAGAR", descricao: "Seguro da frota — parcela 3/10", contraparte: "Seguradora Exemplo (fictícia)", categoriaId: cat("DESP_SEGUROS"), valorCentavos: 148_000, vencimento: dia(12), unidadeId: UN_FLN, forma: "PIX", grupoId: "gr-seguro", parcelaNumero: 3, parcelaTotal: 10 });
  pago(novo({ tipo: "PAGAR", descricao: "Troca de bateria — Trenzinho BC", contraparte: "Auto Elétrica Exemplo (fictícia)", categoriaId: cat("DESP_MANUTENCAO"), valorCentavos: 129_000, vencimento: dia(1), unidadeId: UN_BC, linha: "CITY_TOUR", veiculo: "DEM2B34", forma: "PIX" }), passado(2), "co-bc");
  pago(novo({ tipo: "PAGAR", descricao: "Anúncios no Google Ads", contraparte: "Google (fictício)", categoriaId: cat("DESP_MARKETING"), valorCentavos: 250_000, vencimento: dia(2), unidadeId: UN_FLN, forma: "CARTAO" }), passado(2), "co-fln");
  novo({ tipo: "PAGAR", descricao: "Taxas do gateway de pagamento", contraparte: "Gateway Exemplo (fictício)", categoriaId: cat("DESP_TAXAS"), valorCentavos: 186_045, vencimento: dia(15), unidadeId: UN_FLN, forma: "BOLETO" });
  novo({ tipo: "PAGAR", descricao: "Diárias de guias e motoristas — quinzena", categoriaId: cat("DESP_DIARIAS"), valorCentavos: 520_000, vencimento: dia(20), unidadeId: UN_FLN, forma: "PIX" });
  novo({ tipo: "PAGAR", descricao: "Taxa municipal de licença de operação", contraparte: "Prefeitura Exemplo (fictícia)", categoriaId: cat("DESP_OUTRAS"), valorCentavos: 92_000, vencimento: hd > 3 ? somarDias(hoje, -3) : dia(1), unidadeId: UN_FLN, forma: "BOLETO" });
  novo({ tipo: "RECEBER", descricao: "Repasse Paytour — vendas da quinzena", contraparte: "Paytour", categoriaId: cat("REC_SITE_PAYTOUR"), valorCentavos: 1_248_000, vencimento: dia(12), unidadeId: UN_FLN, linha: "CITY_TOUR", canal: "PAYTOUR", forma: "PIX" });
  novo({ tipo: "RECEBER", descricao: "Repasse Viator — reservas do mês", contraparte: "Viator", categoriaId: cat("REC_VIATOR"), valorCentavos: 692_050, vencimento: dia(18), unidadeId: UN_FLN, linha: "CITY_TOUR", canal: "VIATOR", forma: "TRANSFERENCIA" });
  novo({ tipo: "RECEBER", descricao: "Repasse Decolar — reservas do mês", contraparte: "Decolar", categoriaId: cat("REC_DECOLAR"), valorCentavos: 334_000, vencimento: dia(22), unidadeId: UN_BC, linha: "CITY_TOUR", canal: "DECOLAR", forma: "TRANSFERENCIA" });
  pago(novo({ tipo: "RECEBER", descricao: "Repasse Civitatis — reservas do mês anterior", contraparte: "Civitatis", categoriaId: cat("REC_CIVITATIS"), valorCentavos: 215_000, vencimento: dia(2), unidadeId: UN_FLN, linha: "CITY_TOUR", canal: "CIVITATIS", forma: "TRANSFERENCIA" }), passado(2), "co-fln");
  novo({ tipo: "RECEBER", descricao: "Fretamento — evento corporativo (fictício)", contraparte: "Empresa Exemplo Ltda (fictícia)", categoriaId: cat("REC_FRETAMENTO"), valorCentavos: 980_000, vencimento: dia(25), unidadeId: UN_BC, linha: "FRETAMENTO", forma: "BOLETO" });
  pago(novo({ tipo: "RECEBER", descricao: "Publicidade no ônibus — parceiro (fictício)", contraparte: "Parceiro Exemplo (fictício)", categoriaId: cat("REC_PUBLICIDADE"), valorCentavos: 450_000, vencimento: dia(3), unidadeId: UN_FLN, linha: "PUBLICIDADE", forma: "PIX" }), passado(3), "co-fln");
  pago(novo({ tipo: "RECEBER", descricao: "Vendas do quiosque — fechamento semanal", categoriaId: cat("REC_QUIOSQUE"), valorCentavos: 587_000, vencimento: dia(3), unidadeId: UN_FLN, linha: "CITY_TOUR", canal: "BALCAO", forma: "DINHEIRO" }), passado(3), "co-fln");

  const idLanc = (descricao: string) => lancs.find((l) => l.descricao.startsWith(descricao))!.id;
  let k = 1;
  const linha = (contaId: string, dias: number, valorCentavos: number, descricao: string, status: Linha["status"] = "PENDENTE", extra: Partial<Linha> = {}) =>
    linhas.push({ id: `ln-${k++}`, contaId, data: somarDias(hoje, dias), valorCentavos, descricao, documento: null, status, lancamentoId: null, parLinhaId: null, manual: false, observacao: null, ...extra });
  linha("co-fln", -1, 1_248_000, "PIX RECEBIDO PAYTOUR REPASSE");
  linha("co-fln", -1, -325_000, "PIX ENVIADO POSTO ILHA COMBUSTIVEIS");
  linha("co-fln", -2, -8_990, "TARIFA PACOTE SERVICOS");
  linha("co-fln", -2, -500_000, "TRANSF ENVIADA CONTA BC");
  linha("co-fln", -3, 450_000, "PIX RECEBIDO PARCEIRO EXEMPLO", "CONCILIADO", { lancamentoId: idLanc("Publicidade no ônibus") });
  linha("co-fln", -3, 215_000, "TED RECEBIDA CIVITATIS", "CONCILIADO", { lancamentoId: idLanc("Repasse Civitatis") });
  linha("co-bc", -2, 500_000, "TRANSF RECEBIDA CONTA FLN");
  linha("co-bc", -1, -42_000, "PIX ENVIADO ESTACIONAMENTO CENTRO");
  linha("co-bc", -2, -129_000, "PIX ENVIADO AUTO ELETRICA EXEMPLO", "CONCILIADO", { lancamentoId: idLanc("Troca de bateria") });
  [[-3, -28_000, "POSTO CENTRO BC", "PENDENTE"], [-8, -145_000, "ANUNCIOS GOOGLE", "PENDENTE"], [-15, -312_500, "OFICINA EXEMPLO PECAS", "CONCILIADO"], [-22, -96_000, "HOSPEDAGEM EVENTO EXEMPLO", "CONCILIADO"], [-33, -250_000, "ANUNCIOS META", "CONCILIADO"], [-41, -180_000, "DESPESAS DE VIAGEM", "CONCILIADO"], [-52, -122_000, "MATERIAL DE ESCRITORIO", "CONCILIADO"], [-60, -101_000, "SOFTWARE DE GESTAO", "CONCILIADO"]]
    .forEach(([d, v, t, s]) => linha("co-cartao", d as number, v as number, t as string, s as Linha["status"]));
}

// ---------- derivações ----------
const lancBase = (): Omit<Lanc, "id" | "tipo" | "descricao" | "categoriaId" | "valorCentavos" | "competencia" | "vencimento" | "unidadeId"> => ({
  contraparte: null, contaId: null, linha: null, veiculo: null, canal: null, forma: null, situacao: "ABERTO", pagoEm: null, valorPagoCentavos: null, jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0,
  grupoId: null, parcelaNumero: null, parcelaTotal: null, recorrente: false, observacao: null, origem: "MANUAL",
});
function receitaPorConta(doMes: Lanc[]) {
  const por = new Map<string, number>();
  for (const l of doMes) if (l.tipo === "RECEBER" && l.situacao === "REALIZADO") por.set(l.contaId ?? "", (por.get(l.contaId ?? "") ?? 0) + (l.valorPagoCentavos ?? 0));
  return [...por].map(([id, total]) => ({ contaId: id || null, nome: nomeConta(id || null) ?? "Sem conta", totalCentavos: total }));
}

/** Importação de planilha na demonstração: lê o conteúdo enviado (use a planilha de exemplo fictícia) com as mesmas regras do sistema. */
function importarPlanilha(ctx: Ctx, c: Corpo) {
  const dic = montarDicionario(sinonimos.map((x) => ({ tipo: x.tipo as "GRUPO" | "CATEGORIA", texto: x.texto, alvo: x.alvo })));
  let lida;
  try { lida = lerPlanilhaFinanceira(String(c.conteudo ?? "")); } catch (e) { throw ctx.erro(400, "PLANILHA_INVALIDA", (e as Error).message); }
  const mapa = (c.mapeamentos ?? {}) as Record<string, string>;
  const novos: Array<{ tipo: Tipo; aberto: boolean; descricao: string; categoriaId: string; categoria: string; valor: number; data: string; coluna: string; fornecedor: string }> = [];
  const naoRec = new Map<string, { chave: string; grupo: string; categoria: string; qtd: number; totalCentavos: number }>();
  const saldos: Array<{ coluna: string; rotulo: string; valorCentavos: number; data: string; aplicar: boolean; motivo: string | null; calculadoCentavos: null; divergenciaCentavos: null }> = [];
  let transf = 0;
  let ignoradas = lida.ignoradas.length;
  const datas = lida.linhas.filter((l) => l.data).map((l) => l.data!).sort();
  for (const l of lida.linhas) {
    if (l.saldo) {
      for (const [coluna, v] of Object.entries(l.valores)) if (coluna !== "APAGAR") saldos.push({ coluna, rotulo: coluna, valorCentavos: v!, data: l.data ?? datas[0] ?? "", aplicar: true, motivo: null, calculadoCentavos: null, divergenciaCentavos: null });
      continue;
    }
    const cls = classificar(l.grupo, l.categoria, dic);
    let alvo = cls.alvo;
    if (!alvo) {
      const m = mapa[cls.chave];
      if (m === "IGNORAR") alvo = "@IGNORAR"; else if (m === "TRANSFERENCIA") alvo = "@TRANSFERENCIA"; else if (m) alvo = categorias.find((k) => k.id === m)?.codigo ?? null;
    }
    if (!alvo) {
      const x = naoRec.get(cls.chave) ?? { chave: cls.chave, grupo: l.grupo, categoria: l.categoria, qtd: 0, totalCentavos: 0 };
      x.qtd += 1;
      x.totalCentavos += Object.values(l.valores).reduce((s, v) => s + Math.abs(v ?? 0), 0);
      naoRec.set(cls.chave, x);
      continue;
    }
    if (alvo === "@IGNORAR") { ignoradas += 1; continue; }
    if (alvo.startsWith("@")) { transf += 1; continue; }
    const k = categorias.find((x) => x.codigo === alvo)!;
    for (const [coluna, v] of Object.entries(l.valores) as Array<[string, number]>) {
      const aberto = coluna === "APAGAR";
      novos.push({ tipo: aberto || v < 0 ? "PAGAR" : "RECEBER", aberto, descricao: l.descricao || k.nome, categoriaId: k.id, categoria: k.nome, valor: Math.abs(v), data: l.data!, coluna, fornecedor: l.fornecedor });
    }
  }
  const porConta = ["APAGAR", "SICREDI", "UNILOS", "QUIOSQUE", "CARTAO"].map((coluna) => {
    const itens = novos.filter((x) => x.coluna === coluna);
    return { coluna, rotulo: coluna === "APAGAR" ? "A pagar (em aberto)" : coluna, conta: COLUNA_CONTA[coluna] ? nomeConta(COLUNA_CONTA[coluna]!) : null, criar: false, qtd: itens.length, entradasCentavos: itens.filter((x) => x.tipo === "RECEBER").reduce((s, x) => s + x.valor, 0), saidasCentavos: itens.filter((x) => x.tipo === "PAGAR").reduce((s, x) => s + x.valor, 0) };
  }).filter((x) => x.qtd > 0);
  const resumo = {
    previa: !c.confirmar, layout: lida.layout, cabecalhoLinha: lida.cabecalhoLinha, lidos: novos.length + transf, novos: { lancamentos: novos.length, transferencias: transf }, jaExistentes: 0,
    abertos: novos.filter((x) => x.aberto).length, realizados: novos.filter((x) => !x.aberto).length, transferencias: transf, contasACriar: [], porConta, saldos, naoReconhecidos: [...naoRec.values()],
    qualidade: { dataInvalida: { total: lida.datasInvalidas.length, linhas: lida.datasInvalidas }, mesDiferente: { total: 0, linhas: [] }, anoFora: { total: 0, linhas: [] }, grupoVazio: { total: 0, linhas: [] }, grafias: [], duplicadas: { total: 0, grupos: [] }, pessoaFisica: { total: 0, linhas: [] }, previstas: 0, apagarSemConta: novos.filter((x) => x.aberto).length, apagarDiferente: 0 },
    avisos: ["Demonstração: use a planilha de exemplo fictícia. O resumo do topo não é importado."], ignoradas, erros: lida.erros, totalErros: lida.erros.length,
    amostra: novos.slice(0, 10).map((x) => ({ data: x.data, tipo: x.tipo, aberto: x.aberto, descricao: x.descricao, categoria: x.categoria, fornecedor: x.fornecedor || null, valorCentavos: x.valor, conta: x.aberto ? null : nomeConta(COLUNA_CONTA[x.coluna] ?? null) })),
  };
  if (!c.confirmar) return resumo;
  for (const x of novos) {
    const l: Lanc = { ...lancBase(), id: ctx.id("la"), tipo: x.tipo, descricao: x.descricao, categoriaId: x.categoriaId, valorCentavos: x.valor, competencia: x.data, vencimento: x.data, unidadeId: c.unidadeId ?? UN_FLN, contraparte: x.fornecedor || null, origem: "PLANILHA" };
    if (!x.aberto) Object.assign(l, { situacao: "REALIZADO", pagoEm: x.data, valorPagoCentavos: x.valor, contaId: COLUNA_CONTA[x.coluna] ?? null });
    lancs.push(l);
  }
  ctx.auditar("FIN_PLANILHA_IMPORTADA", "fin_planilha", undefined, { lancamentos: novos.length });
  return { ...resumo, previa: false, resultado: { lancamentos: novos.length, transferencias: transf, jaExistentes: 0, contasCriadas: [], saldosAplicados: 0, fornecedores: 0, sinonimosSalvos: 0 } };
}
const nomeCat = (id: string) => categorias.find((c) => c.id === id)?.nome ?? "";
const nomeConta = (id: string | null) => contas.find((c) => c.id === id)?.nome ?? null;
const pendentesDe = (contaId: string) => linhas.filter((l) => l.contaId === contaId && l.status === "PENDENTE").length;
const contaPublica = (c: Conta) => ({ ...c, linhasPendentes: pendentesDe(c.id) });
const lancPublico = (l: Lanc) => ({
  ...l, categoriaNome: nomeCat(l.categoriaId), contaNome: nomeConta(l.contaId),
  conciliado: linhas.some((x) => x.lancamentoId === l.id && x.status === "CONCILIADO"), vencido: l.situacao === "ABERTO" && l.vencimento < hoje,
});
const comoRelatorio = (l: Lanc): LancamentoRelatorio => ({ tipo: l.tipo, situacao: l.situacao, valorCentavos: l.valorCentavos, valorPagoCentavos: l.valorPagoCentavos, jurosCentavos: l.jurosCentavos, multaCentavos: l.multaCentavos, descontoCentavos: l.descontoCentavos, vencimento: l.vencimento, pagoEm: l.pagoEm, categoriaId: l.categoriaId, unidadeId: l.unidadeId, linha: l.linha });
const escopoUnidade = (u: string | null, q: URLSearchParams) => !q.get("unidadeId") || u === q.get("unidadeId");

function linhaPublica(l: Linha, enriquecer: boolean) {
  const base = { id: l.id, data: l.data, valorCentavos: l.valorCentavos, descricao: l.descricao, documento: l.documento, status: l.status, lancamentoId: l.lancamentoId, lancamentoDescricao: lancs.find((x) => x.id === l.lancamentoId)?.descricao ?? null, parLinhaId: l.parLinhaId, manual: l.manual, observacao: l.observacao };
  if (!enriquecer || l.status !== "PENDENTE") return base;
  const candidatos: LancamentoCandidato[] = lancs.filter((x) => x.situacao === "ABERTO").map((x) => ({ id: x.id, tipo: x.tipo, valorCentavos: x.valorCentavos, vencimento: x.vencimento, descricao: x.descricao, contraparte: x.contraparte }));
  const recusados = new Set([...recusas].filter((r) => r.startsWith(`${l.id}|`)).map((r) => r.split("|")[1]!));
  const sugestoes = sugerirCorrespondencias({ valorCentavos: l.valorCentavos, data: l.data, descricao: l.descricao }, candidatos, recusados, 3).map((s) => {
    const x = lancs.find((y) => y.id === s.lancamentoId)!;
    return { ...s, lancamento: { descricao: x.descricao, contraparte: x.contraparte, valorCentavos: x.valorCentavos, vencimento: x.vencimento, categoriaNome: nomeCat(x.categoriaId) } };
  });
  const regrasAtivas: RegraCategoria[] = regras.filter((r) => r.ativa).map((r) => ({ id: r.id, texto: r.texto, tipo: r.tipo ?? categorias.find((c) => c.id === r.categoriaId)?.tipo ?? null, categoriaId: r.categoriaId, prioridade: r.prioridade }));
  const achada = sugerirCategoria(l.descricao, l.valorCentavos, regrasAtivas);
  const regra = achada ? regras.find((r) => r.id === achada.id)! : null;
  const pares = linhas.filter((p) => p.id !== l.id && p.contaId !== l.contaId && p.status === "PENDENTE" && p.valorCentavos === -l.valorCentavos && Math.abs(Date.parse(p.data) - Date.parse(l.data)) <= 3 * 86_400_000)
    .slice(0, 3).map((p) => ({ id: p.id, contaId: p.contaId, contaNome: nomeConta(p.contaId) ?? "", data: p.data, descricao: p.descricao }));
  return { ...base, sugestoes, pares, categoriaSugerida: regra ? { regraId: regra.id, categoriaId: regra.categoriaId, categoriaNome: nomeCat(regra.categoriaId), unidadeId: regra.unidadeId, linha: regra.linha } : null };
}

export const rotearFinanceiro: Rotear = (ctx, metodo, caminho, q, c) => {
  if (!caminho.startsWith("/api/financeiro/")) return NAO;
  semear(ctx.dataMais);
  hoje = ctx.dataMais(0);
  let m: RegExpMatchArray | null;
  const r = (re: RegExp) => (m = caminho.match(re));
  const ver = () => ctx.exigir("financeiro:ver");
  const gerir = () => ctx.exigir("financeiro:gerenciar");

  // Contas, categorias e regras
  if (metodo === "GET" && caminho === "/api/financeiro/contas") { ver(); return contas.filter((x) => escopoUnidade(x.unidadeId, q)).map(contaPublica); }
  if (metodo === "POST" && caminho === "/api/financeiro/contas") {
    gerir();
    const novaConta: Conta = { id: ctx.id("co"), unidadeId: c.unidadeId ?? null, nome: c.nome, tipo: c.tipo, banco: c.banco ?? null, finalConta: c.finalConta ?? null, saldoInicialCentavos: c.saldoInicialCentavos ?? 0, saldoInicialEm: c.saldoInicialEm ?? null, diaFechamento: c.diaFechamento ?? null, diaVencimento: c.diaVencimento ?? null, contaPagamentoId: c.contaPagamentoId ?? null, ativa: true, saldoCentavos: c.saldoInicialCentavos ?? 0 };
    contas.push(novaConta);
    return contaPublica(novaConta);
  }
  if (metodo === "PATCH" && r(/^\/api\/financeiro\/contas\/([^/]+)$/)) {
    gerir();
    return contaPublica(aplicar(achar(contas, m![1]!, ctx, "Conta"), c, ["nome", "banco", "finalConta", "unidadeId", "diaFechamento", "diaVencimento", "contaPagamentoId", "ativa"]));
  }
  if (metodo === "GET" && caminho === "/api/financeiro/categorias") { ver(); return categorias; }
  if (metodo === "POST" && caminho === "/api/financeiro/categorias") {
    gerir();
    const x: Categoria = { id: ctx.id("cat"), codigo: `PERS_${categorias.length + 1}`, nome: c.nome, tipo: c.tipo, grupo: c.grupo, ordem: categorias.length + 1, ativa: true, sistema: false };
    categorias.push(x);
    return x;
  }
  if (metodo === "PATCH" && r(/^\/api\/financeiro\/categorias\/([^/]+)$/)) { gerir(); return aplicar(achar(categorias, m![1]!, ctx, "Categoria"), c, ["nome", "grupo", "ativa"]); }
  if (metodo === "GET" && caminho === "/api/financeiro/regras") { ver(); return regras; }
  if (metodo === "POST" && caminho === "/api/financeiro/regras") {
    gerir();
    const x: Regra = { id: ctx.id("rg"), texto: c.texto, tipo: c.tipo ?? null, categoriaId: c.categoriaId, unidadeId: c.unidadeId ?? null, linha: c.linha ?? null, prioridade: c.prioridade ?? 0, ativa: true };
    regras.push(x);
    return x;
  }
  if (r(/^\/api\/financeiro\/regras\/([^/]+)$/)) {
    gerir();
    const x = achar(regras, m![1]!, ctx, "Regra");
    if (metodo === "DELETE") { regras.splice(regras.indexOf(x), 1); return { ok: true }; }
    if (metodo === "PATCH") return aplicar(x, c, ["texto", "categoriaId", "unidadeId", "linha", "prioridade", "ativa"]);
  }

  // Lançamentos
  if (metodo === "GET" && caminho === "/api/financeiro/lancamentos") {
    ver();
    const campo = (q.get("campo") || "vencimento") as "vencimento" | "competencia" | "pagoEm";
    const busca = semAcento(q.get("q") ?? "");
    const filtrados = lancs.filter((l) => {
      const dt = l[campo];
      return (!q.get("tipo") || l.tipo === q.get("tipo")) && escopoUnidade(l.unidadeId, q)
        && (q.get("situacao") === "VENCIDO" ? l.situacao === "ABERTO" && l.vencimento < hoje : !q.get("situacao") || l.situacao === q.get("situacao"))
        && (!q.get("de") || (dt != null && dt >= q.get("de")!)) && (!q.get("ate") || (dt != null && dt <= q.get("ate")!))
        && (!q.get("contaId") || l.contaId === q.get("contaId")) && (!q.get("categoriaId") || l.categoriaId === q.get("categoriaId"))
        && (!busca || semAcento(`${l.descricao} ${l.contraparte ?? ""}`).includes(busca));
    }).sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.id.localeCompare(b.id));
    return {
      hoje, itens: filtrados.map(lancPublico), total: filtrados.length,
      somaDevidoCentavos: filtrados.reduce((s, l) => s + l.valorCentavos, 0),
      somaAbertoCentavos: filtrados.filter((l) => l.situacao === "ABERTO").reduce((s, l) => s + l.valorCentavos, 0),
      somaRealizadoCentavos: filtrados.filter((l) => l.situacao === "REALIZADO").reduce((s, l) => s + (l.valorPagoCentavos ?? 0), 0),
    };
  }
  if (metodo === "POST" && caminho === "/api/financeiro/lancamentos") {
    gerir();
    const x: Lanc = {
      id: ctx.id("la"), tipo: c.tipo, descricao: c.descricao, contraparte: c.contraparte ?? null, categoriaId: c.categoriaId, contaId: c.contaId ?? null, unidadeId: c.unidadeId ?? null, linha: c.linha ?? null, veiculo: c.veiculo ?? null, canal: c.canal ?? null, forma: c.forma ?? null,
      valorCentavos: c.valorCentavos, competencia: c.competencia ?? c.vencimento, vencimento: c.vencimento, situacao: "ABERTO", pagoEm: null, valorPagoCentavos: null, jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0,
      grupoId: null, parcelaNumero: null, parcelaTotal: null, recorrente: c.repeticao?.tipo === "RECORRENTE", observacao: c.observacao ?? null, origem: "MANUAL",
    };
    lancs.push(x);
    ctx.auditar("LANCAMENTO_CRIADO", "lancamento", x.id);
    return { criados: 1, itens: [lancPublico(x)] };
  }
  if (r(/^\/api\/financeiro\/lancamentos\/([^/]+)(?:\/(baixa|reabrir))?$/)) {
    gerir();
    const x = achar(lancs, m![1]!, ctx, "Lançamento");
    const acao = m![2];
    if (metodo === "PATCH" && !acao) {
      aplicar(x, c, ["descricao", "contraparte", "categoriaId", "contaId", "unidadeId", "linha", "veiculo", "canal", "forma", "observacao", "valorCentavos", "competencia", "vencimento"]);
      return lancPublico(x);
    }
    if (metodo === "POST" && acao === "baixa") {
      const total = calcularBaixa({ valorCentavos: x.valorCentavos, jurosCentavos: c.jurosCentavos, multaCentavos: c.multaCentavos, descontoCentavos: c.descontoCentavos });
      Object.assign(x, { situacao: "REALIZADO", pagoEm: c.pagoEm ?? hoje, contaId: c.contaId ?? x.contaId, valorPagoCentavos: total, jurosCentavos: c.jurosCentavos ?? 0, multaCentavos: c.multaCentavos ?? 0, descontoCentavos: c.descontoCentavos ?? 0 });
      ctx.auditar("LANCAMENTO_BAIXADO", "lancamento", x.id);
      return lancPublico(x);
    }
    if (metodo === "POST" && acao === "reabrir") {
      Object.assign(x, { situacao: "ABERTO", pagoEm: null, valorPagoCentavos: null, jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0 });
      return lancPublico(x);
    }
    if (metodo === "DELETE" && !acao) {
      const grupo = q.get("serie") && x.grupoId ? lancs.filter((l) => l.grupoId === x.grupoId && l.situacao === "ABERTO") : [x];
      for (const l of grupo) lancs.splice(lancs.indexOf(l), 1);
      return { excluidos: grupo.length };
    }
  }

  // Resumo (a pagar/receber, saldos, fluxo semanal e DRE do mês)
  if (metodo === "GET" && caminho === "/api/financeiro/resumo") {
    ver();
    const mes = q.get("mes") || hoje.slice(0, 7);
    const ini = `${mes}-01`;
    const fim = fimDoMes(mes);
    const nosso = lancs.filter((l) => escopoUnidade(l.unidadeId, q));
    const doMes = nosso.filter((l) => l.vencimento >= ini && l.vencimento <= fim);
    const bloco = (tipo: Tipo) => {
      const a = doMes.filter((l) => l.tipo === tipo && l.situacao === "ABERTO");
      const re = doMes.filter((l) => l.tipo === tipo && l.situacao === "REALIZADO");
      return { abertoCentavos: a.reduce((s, l) => s + l.valorCentavos, 0), abertoQtd: a.length, realizadoCentavos: re.reduce((s, l) => s + (l.valorPagoCentavos ?? 0), 0), realizadoQtd: re.length };
    };
    const venc = (tipo: Tipo) => { const v = nosso.filter((l) => l.tipo === tipo && l.situacao === "ABERTO" && l.vencimento < hoje); return { qtd: v.length, centavos: v.reduce((s, l) => s + l.valorCentavos, 0) }; };
    const ativas = contas.filter((x) => x.ativa && escopoUnidade(x.unidadeId, q));
    const saldoCaixa = ativas.filter((x) => x.tipo !== "CARTAO").reduce((s, x) => s + x.saldoCentavos, 0);
    const doCaixa = nosso.filter((l) => !l.contaId || contas.find((x) => x.id === l.contaId)?.tipo !== "CARTAO");
    const fluxo = montarFluxoSemanal({ hoje, semanasAntes: 4, semanasDepois: 8, lancamentos: doCaixa.map(comoRelatorio), saldoAtualCentavos: saldoCaixa });
    const mapaCats = new Map(categorias.map((x) => [x.id, { nome: x.nome, tipo: x.tipo, grupo: x.grupo, ordem: x.ordem }]));
    const dre = montarDre(nosso.filter((l) => l.competencia >= ini && l.competencia <= fim).map(comoRelatorio), mapaCats);
    return {
      hoje, mes, aPagar: bloco("PAGAR"), aReceber: bloco("RECEBER"), vencidas: { pagar: venc("PAGAR"), receber: venc("RECEBER") },
      saldos: ativas.map((x) => ({ contaId: x.id, nome: x.nome, tipo: x.tipo, saldoCentavos: x.saldoCentavos })), saldoCaixaCentavos: saldoCaixa,
      fluxo, dre, receitaPorConta: receitaPorConta(nosso.filter((l) => l.competencia >= ini && l.competencia <= fim)), linhasPendentes: ativas.reduce((s, x) => s + pendentesDe(x.id), 0),
    };
  }

  // Planilha de controle (prévia e confirmação com a planilha fictícia enviada), sinônimos, caixa, saldos e revenda
  if (metodo === "POST" && caminho === "/api/financeiro/planilha/importar") { gerir(); return importarPlanilha(ctx, c); }
  // Demonstração: pendências não ficam guardadas (nada é salvo ao recarregar).
  if (metodo === "GET" && caminho === "/api/financeiro/planilha/pendencias") return { itens: [], abas: [] };
  if (metodo === "POST" && caminho === "/api/financeiro/contas/padrao") { gerir(); return { criadas: [] }; }
  if (metodo === "GET" && caminho === "/api/financeiro/sinonimos") {
    ver();
    return sinonimos.map((x) => ({ ...x, alvoNome: x.tipo === "GRUPO" ? x.alvo : x.alvo.startsWith("@") ? x.alvo.slice(1).toLowerCase() : categorias.find((k) => k.codigo === x.alvo)?.nome ?? x.alvo }));
  }
  if (metodo === "POST" && caminho === "/api/financeiro/sinonimos") {
    gerir();
    const x = { id: ctx.id("sn"), tipo: c.tipo, texto: semAcento(c.texto).toUpperCase(), alvo: c.alvo };
    sinonimos.push(x);
    return x;
  }
  if (r(/^\/api\/financeiro\/sinonimos\/([^/]+)$/)) {
    gerir();
    const x = achar(sinonimos, m![1]!, ctx, "Sinônimo");
    if (metodo === "DELETE") { sinonimos.splice(sinonimos.indexOf(x), 1); return { ok: true }; }
    return aplicar(x, c, ["alvo"]);
  }
  if (metodo === "GET" && r(/^\/api\/financeiro\/contas\/([^/]+)\/saldo-diario$/)) {
    ver();
    const conta = achar(contas, m![1]!, ctx, "Conta");
    const ate = q.get("ate") ?? hoje;
    const de = q.get("de") ?? somarDias(ate, -29);
    const dias = [];
    for (let d = de; d <= ate; d = somarDias(d, 1)) dias.push({ data: d, entradasCentavos: 0, saidasCentavos: 0, saldoFinalCentavos: conta.saldoCentavos });
    return { conta: { id: conta.id, nome: conta.nome, tipo: conta.tipo }, saldoInicialCentavos: conta.saldoCentavos, dias };
  }
  if (metodo === "GET" && caminho === "/api/financeiro/caixa/dia") {
    ver();
    const conta = achar(contas, q.get("contaId") ?? "", ctx, "Conta");
    const data = q.get("data") ?? hoje;
    const f = fechamentos.find((x) => x.contaId === conta.id && x.data === data) ?? null;
    return {
      conta: { id: conta.id, nome: conta.nome }, data, saldoInicialCentavos: conta.saldoCentavos, entradasCentavos: 0, saidasCentavos: 0, saldoCalculadoCentavos: conta.saldoCentavos, fechamento: f, lancamentos: [],
      recentes: fechamentos.filter((x) => x.contaId === conta.id).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 10),
    };
  }
  if (metodo === "POST" && caminho === "/api/financeiro/caixa/fechar") {
    gerir();
    const conta = achar(contas, c.contaId, ctx, "Conta");
    if (fechamentos.some((x) => x.contaId === conta.id && x.data === c.data)) throw ctx.erro(409, "CAIXA_JA_FECHADO", "Este dia do caixa já foi fechado.");
    const f = { contaId: conta.id, data: c.data, saldoInicialCentavos: conta.saldoCentavos, entradasCentavos: 0, saidasCentavos: 0, saldoCalculadoCentavos: conta.saldoCentavos, saldoContadoCentavos: c.saldoContadoCentavos, diferencaCentavos: c.saldoContadoCentavos - conta.saldoCentavos, observacao: c.observacao ?? null, fechadoEm: ctx.agoraIso() };
    fechamentos.push(f);
    ctx.auditar("FIN_CAIXA_FECHADO", "fin_conta", conta.id);
    return f;
  }
  if (metodo === "GET" && caminho === "/api/financeiro/revendas") {
    ver();
    return { aviso: "Tratamento contábil da revenda (só a margem como receita) a confirmar com o contador.", itens: revendas.map((x) => ({ ...x, margemCentavos: x.valorVendaCentavos - x.valorRepasseCentavos })) };
  }
  if (metodo === "POST" && caminho === "/api/financeiro/revendas") {
    gerir();
    const x = { id: ctx.id("rv"), descricao: c.descricao, fornecedor: c.fornecedor ?? null, vendedor: c.vendedor ?? null, dataVenda: c.dataVenda, valorVendaCentavos: c.valorVendaCentavos, valorRepasseCentavos: c.valorRepasseCentavos, comissaoCentavos: c.comissaoCentavos ?? 0 };
    revendas.push(x);
    const u = c.unidadeId ?? null;
    const mk = (tipo: Tipo, desc: string, codigo: string, valor: number, venc: string) => lancs.push({ ...lancBase(), id: ctx.id("la"), tipo, descricao: desc, categoriaId: cat(codigo), valorCentavos: valor, competencia: c.dataVenda, vencimento: venc, unidadeId: u });
    mk("RECEBER", `Revenda: ${x.descricao}`, "REC_REVENDA", x.valorVendaCentavos, x.dataVenda);
    if (x.valorRepasseCentavos > 0) mk("PAGAR", `Repasse: ${x.descricao}`, "DESP_REVENDA_REPASSE", x.valorRepasseCentavos, c.vencimentoRepasse);
    if (x.comissaoCentavos > 0) mk("PAGAR", `Comissão: ${x.descricao}`, "DESP_COMISSAO_RH", x.comissaoCentavos, c.vencimentoRepasse);
    return { ...x, margemCentavos: x.valorVendaCentavos - x.valorRepasseCentavos };
  }

  // Cartões e faturas
  if (metodo === "GET" && caminho === "/api/financeiro/cartoes") {
    ver();
    return contas.filter((x) => x.tipo === "CARTAO").map((cartao) => {
      const faturas = new Map<string, { referencia: string; fechamento: string; vencimento: string; totalCentavos: number; linhas: number; pendentes: number }>();
      if (cartao.diaFechamento && cartao.diaVencimento) {
        for (const l of linhas.filter((x) => x.contaId === cartao.id && x.status !== "TRANSFERENCIA")) {
          const f = faturaDaData(l.data, cartao.diaFechamento, cartao.diaVencimento);
          const x = faturas.get(f.referencia) ?? { ...f, totalCentavos: 0, linhas: 0, pendentes: 0 };
          x.totalCentavos += -l.valorCentavos;
          x.linhas += 1;
          if (l.status === "PENDENTE") x.pendentes += 1;
          faturas.set(f.referencia, x);
        }
      }
      return { ...contaPublica(cartao), faturas: [...faturas.values()].sort((a, b) => b.referencia.localeCompare(a.referencia)).map((f) => ({ ...f, situacao: hoje <= f.fechamento ? "ABERTA" : hoje <= f.vencimento ? "FECHADA" : "ENCERRADA" })) };
    });
  }

  // Extrato: leitura
  if (metodo === "GET" && caminho === "/api/financeiro/extratos") {
    ver();
    return contas.filter((x) => escopoUnidade(x.unidadeId, q)).map((x) => ({ contaId: x.id, nome: x.nome, linhas: linhas.filter((l) => l.contaId === x.id).length, pendentes: pendentesDe(x.id) }));
  }
  if (metodo === "GET" && caminho === "/api/financeiro/extrato/linhas") {
    ver();
    const conta = achar(contas, q.get("contaId") ?? "", ctx, "Conta");
    const da = linhas.filter((l) => l.contaId === conta.id);
    const busca = semAcento(q.get("q") ?? "");
    const filtradas = da.filter((l) => (!q.get("status") || l.status === q.get("status")) && (!busca || semAcento(l.descricao).includes(busca))).sort((a, b) => b.data.localeCompare(a.data) || a.id.localeCompare(b.id));
    const limite = Number(q.get("limite") ?? 100);
    const pagina = Number(q.get("pagina") ?? 1);
    const porStatus: Record<string, number> = {};
    for (const l of da) porStatus[l.status] = (porStatus[l.status] ?? 0) + 1;
    return { conta: { id: conta.id, nome: conta.nome, tipo: conta.tipo }, linhas: filtradas.slice((pagina - 1) * limite, pagina * limite).map((l) => linhaPublica(l, true)), total: filtradas.length, porStatus };
  }

  // Extrato: decisões sobre uma linha
  if (metodo === "POST" && r(/^\/api\/financeiro\/extrato\/linhas\/([^/]+)\/(conciliar|recusar|lancar|ignorar|desfazer|transferencia)$/)) {
    gerir();
    const l = achar(linhas, m![1]!, ctx, "Linha");
    const acao = m![2]!;
    if (acao === "conciliar") {
      const x = achar(lancs, c.lancamentoId, ctx, "Lançamento");
      Object.assign(x, { situacao: "REALIZADO", pagoEm: l.data, valorPagoCentavos: Math.abs(l.valorCentavos), contaId: l.contaId });
      Object.assign(l, { status: "CONCILIADO", lancamentoId: x.id });
    } else if (acao === "recusar") recusas.add(`${l.id}|${c.lancamentoId}`);
    else if (acao === "lancar") {
      const x: Lanc = {
        id: ctx.id("la"), tipo: l.valorCentavos < 0 ? "PAGAR" : "RECEBER", descricao: c.descricao || l.descricao, contraparte: null, categoriaId: c.categoriaId, contaId: l.contaId, unidadeId: c.unidadeId ?? null, linha: c.linha ?? null, veiculo: null, canal: null, forma: null,
        valorCentavos: Math.abs(l.valorCentavos), competencia: l.data, vencimento: l.data, situacao: "REALIZADO", pagoEm: l.data, valorPagoCentavos: Math.abs(l.valorCentavos), jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0,
        grupoId: null, parcelaNumero: null, parcelaTotal: null, recorrente: false, observacao: null, origem: "EXTRATO",
      };
      lancs.push(x);
      Object.assign(l, { status: "CONCILIADO", lancamentoId: x.id });
    } else if (acao === "ignorar") l.status = "IGNORADO";
    else if (acao === "desfazer") {
      const x = lancs.find((y) => y.id === l.lancamentoId);
      if (x?.origem === "EXTRATO") lancs.splice(lancs.indexOf(x), 1);
      else if (x) Object.assign(x, { situacao: "ABERTO", pagoEm: null, valorPagoCentavos: null });
      const par = linhas.find((y) => y.id === l.parLinhaId);
      if (par) Object.assign(par, { status: "PENDENTE", parLinhaId: null });
      Object.assign(l, { status: "PENDENTE", lancamentoId: null, parLinhaId: null });
    } else {
      const par = achar(linhas, c.parLinhaId, ctx, "Linha do par");
      Object.assign(l, { status: "TRANSFERENCIA", parLinhaId: par.id });
      Object.assign(par, { status: "TRANSFERENCIA", parLinhaId: l.id });
    }
    ctx.auditar("EXTRATO_LINHA_DECIDIDA", "extrato_linha", l.id, { acao });
    return linhaPublica(l, false);
  }
  if (metodo === "POST" && caminho === "/api/financeiro/transferencias") {
    gerir();
    const o = achar(contas, c.contaOrigemId, ctx, "Conta de origem");
    const d = achar(contas, c.contaDestinoId, ctx, "Conta de destino");
    const a: Linha = { id: ctx.id("ln"), contaId: o.id, data: c.data ?? hoje, valorCentavos: -c.valorCentavos, descricao: `TRANSFERENCIA PARA ${d.nome}`, documento: null, status: "TRANSFERENCIA", lancamentoId: null, parLinhaId: null, manual: true, observacao: null };
    const b: Linha = { ...a, id: ctx.id("ln"), contaId: d.id, valorCentavos: c.valorCentavos, descricao: `TRANSFERENCIA DE ${o.nome}`, parLinhaId: a.id };
    a.parLinhaId = b.id;
    linhas.push(a, b);
    return { ok: true };
  }
  if (metodo === "POST" && caminho === "/api/financeiro/extratos/importar") {
    gerir();
    // Demonstração: nada é lido nem gravado; devolve uma prévia vazia.
    return { previa: !c.confirmar, total: 0, novas: 0, repetidas: 0, ignoradas: [], avisos: ["Demonstração: a importação de extratos não grava nada."], inicio: null, fim: null, amostra: [] };
  }
  throw ctx.erro(404, "NAO_ENCONTRADO", "Função não disponível na demonstração.");
};
