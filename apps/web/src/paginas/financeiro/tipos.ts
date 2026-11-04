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
  };
  linhasPendentes: number;
}
