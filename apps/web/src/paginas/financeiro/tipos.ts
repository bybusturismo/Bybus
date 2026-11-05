/** Tipos das respostas da API do financeiro (apps/api/src/rotas/financeiro*.ts). Dinheiro sempre em centavos. */
import type { LinhaNegocio } from "../../api/tipos";

export type TipoLancamento = "PAGAR" | "RECEBER";
export type TipoConta = "CORRENTE" | "APLICACAO" | "CAIXA" | "CARTAO";
export type FormaPagamento = "PIX" | "BOLETO" | "TRANSFERENCIA" | "DEBITO" | "CARTAO" | "DINHEIRO" | "OUTRA";
export type StatusLinha = "PENDENTE" | "CONCILIADO" | "TRANSFERENCIA" | "IGNORADO";

export const TIPOS_CONTA: TipoConta[] = ["CORRENTE", "APLICACAO", "CAIXA", "CARTAO"];
export const FORMAS: FormaPagamento[] = ["PIX", "BOLETO", "TRANSFERENCIA", "DEBITO", "CARTAO", "DINHEIRO", "OUTRA"];
export const CANAIS_FIN = ["PAYTOUR", "VIATOR", "DECOLAR", "CIVITATIS", "BALCAO", "OUTRO"] as const;

export interface ContaFin {
  id: string;
  unidadeId: string | null;
  nome: string;
  tipo: TipoConta;
  banco: string | null;
  finalConta: string | null;
  saldoInicialCentavos: number;
  saldoInicialEm: string | null;
  diaFechamento: number | null;
  diaVencimento: number | null;
  contaPagamentoId: string | null;
  ativa: boolean;
  saldoCentavos: number;
  linhasPendentes: number;
}

export interface CategoriaFin {
  id: string;
  codigo: string;
  nome: string;
  tipo: "RECEITA" | "DESPESA";
  grupo: string;
  ordem: number;
  ativa: boolean;
  sistema: boolean;
}

export interface RegraFin {
  id: string;
  texto: string;
  tipo: "RECEITA" | "DESPESA" | null;
  categoriaId: string;
  unidadeId: string | null;
  linha: LinhaNegocio | null;
  prioridade: number;
  ativa: boolean;
}

export interface LancamentoFin {
  id: string;
  tipo: TipoLancamento;
  descricao: string;
  contraparte: string | null;
  categoriaId: string;
  categoriaNome: string;
  contaId: string | null;
  contaNome: string | null;
  unidadeId: string | null;
  linha: LinhaNegocio | null;
  veiculo: string | null;
  canal: string | null;
  forma: FormaPagamento | null;
  valorCentavos: number;
  competencia: string;
  vencimento: string;
  situacao: "ABERTO" | "REALIZADO";
  pagoEm: string | null;
  valorPagoCentavos: number | null;
  jurosCentavos: number;
  multaCentavos: number;
  descontoCentavos: number;
  grupoId: string | null;
  parcelaNumero: number | null;
  parcelaTotal: number | null;
  recorrente: boolean;
  observacao: string | null;
  origem: "MANUAL" | "EXTRATO";
  conciliado: boolean;
  vencido: boolean;
}

export interface RespostaLancamentos {
  hoje: string;
  itens: LancamentoFin[];
  total: number;
  somaDevidoCentavos: number;
  somaAbertoCentavos: number;
  somaRealizadoCentavos: number;
}

export interface SugestaoConc {
  lancamentoId: string;
  pontos: number;
  nivel: "ALTA" | "MEDIA" | "BAIXA";
  diferencaCentavos: number;
  motivos: string[];
  lancamento: { descricao: string; contraparte: string | null; valorCentavos: number; vencimento: string; categoriaNome: string };
}

export interface LinhaExtratoFin {
  id: string;
  data: string;
  valorCentavos: number;
  descricao: string;
  documento: string | null;
  status: StatusLinha;
  lancamentoId: string | null;
  lancamentoDescricao: string | null;
  parLinhaId: string | null;
  manual: boolean;
  observacao: string | null;
  sugestoes?: SugestaoConc[];
  pares?: Array<{ id: string; contaId: string; contaNome: string; data: string; descricao: string }>;
  categoriaSugerida?: { regraId: string; categoriaId: string; categoriaNome: string; unidadeId: string | null; linha: LinhaNegocio | null } | null;
}

export interface RespostaLinhas {
  conta: { id: string; nome: string; tipo: TipoConta };
  linhas: LinhaExtratoFin[];
  total: number;
  porStatus: Partial<Record<StatusLinha, number>>;
}

export interface PreviaImportacao {
  previa: boolean;
  previaId?: string;
  total: number;
  novas: number;
  repetidas: number;
  ignoradas: Array<{ linha: number; motivo: string }>;
  avisos: string[];
  inicio: string | null;
  fim: string | null;
  amostra?: Array<{ data: string; valorCentavos: number; descricao: string }>;
}

export interface Fatura {
  referencia: string;
  fechamento: string;
  vencimento: string;
  totalCentavos: number;
  linhas: number;
  pendentes: number;
  situacao: "ABERTA" | "FECHADA" | "ENCERRADA";
}
export interface CartaoFin extends ContaFin {
  faturas: Fatura[];
}

export interface BlocoMes {
  abertoCentavos: number;
  abertoQtd: number;
  realizadoCentavos: number;
  realizadoQtd: number;
}
export interface SemanaFluxo {
  inicio: string;
  fim: string;
  atual: boolean;
  entradasRealizadasCentavos: number;
  saidasRealizadasCentavos: number;
  entradasPrevistasCentavos: number;
  saidasPrevistasCentavos: number;
  saldoProjetadoCentavos: number | null;
}
export interface GrupoDre {
  grupo: string;
  tipo: "RECEITA" | "DESPESA";
  totalCentavos: number;
  categorias: Array<{ categoriaId: string | null; nome: string; totalCentavos: number }>;
}
export interface RespostaResumo {
  hoje: string;
  mes: string;
  aPagar: BlocoMes;
  aReceber: BlocoMes;
  vencidas: { pagar: { qtd: number; centavos: number }; receber: { qtd: number; centavos: number } };
  saldos: Array<{ contaId: string; nome: string; tipo: TipoConta; saldoCentavos: number }>;
  saldoCaixaCentavos: number;
  fluxo: SemanaFluxo[];
  dre: {
    receitaCentavos: number;
    despesaCentavos: number;
    resultadoCentavos: number;
    margemPontosBase: number | null;
    grupos: GrupoDre[];
    porPracaLinha: Array<{ unidadeId: string | null; linha: LinhaNegocio | null; receitaCentavos: number; despesaCentavos: number; resultadoCentavos: number }>;
    /** Grupos fora do resultado operacional (despesas pessoais pagas pela empresa; empréstimos). */
    foraDoResultado: Array<{ grupo: string; entradasCentavos: number; saidasCentavos: number; categorias: Array<{ categoriaId: string; nome: string; tipo: "RECEITA" | "DESPESA"; totalCentavos: number }> }>;
    pessoalCentavos: number;
    resultadoAposPessoalCentavos: number;
  };
  receitaPorConta: Array<{ contaId: string | null; nome: string; totalCentavos: number }>;
  linhasPendentes: number;
}

/** Importação da planilha de controle financeiro (prévia e resultado). */
export interface PreviaPlanilha {
  previa: boolean;
  layout: "NOVO" | "ANTIGO";
  cabecalhoLinha: number;
  lidos: number;
  novos: { lancamentos: number; transferencias: number };
  jaExistentes: number;
  abertos: number;
  realizados: number;
  transferencias: number;
  contasACriar: string[];
  porConta: Array<{ coluna: string; rotulo: string; conta: string | null; criar: boolean; qtd: number; entradasCentavos: number; saidasCentavos: number }>;
  saldos: Array<{ coluna: string; rotulo: string; valorCentavos: number; data: string; aplicar: boolean; motivo: string | null; calculadoCentavos: number | null; divergenciaCentavos: number | null }>;
  naoReconhecidos: Array<{ chave: string; grupo: string; categoria: string; qtd: number; totalCentavos: number }>;
  qualidade: {
    dataInvalida: { total: number; linhas: Array<{ linha: number; texto: string }> };
    mesDiferente: { total: number; linhas: Array<{ linha: number; mes: string; data: string }> };
    anoFora: { total: number; linhas: Array<{ linha: number; data: string }> };
    grupoVazio: { total: number; linhas: number[] };
    grafias: Array<{ canonico: string; variantes: Array<{ texto: string; qtd: number }> }>;
    duplicadas: { total: number; grupos: Array<{ linhas: number[]; data: string; fornecedor: string; valorCentavos: number }> };
    pessoaFisica: { total: number; linhas: number[] };
    previstas: number;
    apagarSemConta: number;
    apagarDiferente: number;
  };
  avisos: string[];
  ignoradas: number;
  erros: Array<{ linha: number; motivo: string }>;
  totalErros: number;
  amostra: Array<{ data: string; tipo: TipoLancamento; aberto: boolean; descricao: string; categoria: string; fornecedor: string | null; valorCentavos: number; conta: string | null }>;
  resultado?: { lancamentos: number; transferencias: number; jaExistentes: number; contasCriadas: string[]; saldosAplicados: number; fornecedores: number; sinonimosSalvos: number };
}

export interface SinonimoFin {
  id: string;
  tipo: "GRUPO" | "CATEGORIA";
  texto: string;
  alvo: string;
  alvoNome: string;
}

export interface CaixaDia {
  conta: { id: string; nome: string };
  data: string;
  saldoInicialCentavos: number;
  entradasCentavos: number;
  saidasCentavos: number;
  saldoCalculadoCentavos: number;
  fechamento: { saldoContadoCentavos: number; diferencaCentavos: number; observacao: string | null; fechadoEm: string } | null;
  lancamentos: Array<{ id: string; tipo: TipoLancamento; descricao: string; valorPagoCentavos: number | null; categoria: string }>;
  recentes: Array<{ data: string; saldoCalculadoCentavos: number; saldoContadoCentavos: number; diferencaCentavos: number }>;
}

export interface SaldoDiario {
  conta: { id: string; nome: string; tipo: TipoConta };
  saldoInicialCentavos: number;
  dias: Array<{ data: string; entradasCentavos: number; saidasCentavos: number; saldoFinalCentavos: number }>;
}

export interface RevendaFin {
  id: string;
  descricao: string;
  fornecedor: string | null;
  vendedor: string | null;
  dataVenda: string;
  valorVendaCentavos: number;
  valorRepasseCentavos: number;
  comissaoCentavos: number;
  margemCentavos: number;
}
