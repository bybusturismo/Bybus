/** Tipos das respostas da API de frota (espelham apps/api/src/rotas/frota.ts) e rótulos de tela. */

export const TIPOS_VEICULO = ["ONIBUS_DOIS_ANDARES", "ONIBUS", "TRENZINHO", "VAN"] as const;
export type TipoVeiculo = (typeof TIPOS_VEICULO)[number];
export const SITUACOES_VEICULO = ["ATIVO", "MANUTENCAO", "INATIVO"] as const;
export type SituacaoVeiculo = (typeof SITUACOES_VEICULO)[number];
export const TIPOS_DOC_VEICULO = ["CRLV", "LICENCA_MUNICIPAL", "ANTT", "SEGURO", "CRONOTACOGRAFO", "VISTORIA", "OUTRO"] as const;
export type TipoDocVeiculo = (typeof TIPOS_DOC_VEICULO)[number];

export const ROTULO_TIPO_VEICULO: Record<TipoVeiculo, string> = {
  ONIBUS_DOIS_ANDARES: "Ônibus de dois andares",
  ONIBUS: "Ônibus",
  TRENZINHO: "Trenzinho",
  VAN: "Van",
};
export const ROTULO_SITUACAO_VEICULO: Record<SituacaoVeiculo, string> = { ATIVO: "Ativo", MANUTENCAO: "Em manutenção", INATIVO: "Inativo" };
export const ROTULO_TIPO_DOC: Record<TipoDocVeiculo, string> = {
  CRLV: "CRLV (licenciamento)",
  LICENCA_MUNICIPAL: "Licença municipal",
  ANTT: "ANTT",
  SEGURO: "Seguro",
  CRONOTACOGRAFO: "Cronotacógrafo",
  VISTORIA: "Vistoria",
  OUTRO: "Outro",
};

export interface Veiculo {
  id: string;
  unidadeId: string;
  unidadeNome: string;
  placa: string;
  apelido: string | null;
  tipo: TipoVeiculo;
  modelo: string | null;
  ano: number | null;
  capacidade: number | null;
  chassi: string | null;
  renavam: string | null;
  linhaPrincipal: string | null;
  usoPublicitario: boolean;
  situacao: SituacaoVeiculo;
  kmAtual: number;
  observacoes: string | null;
  /** Link da pasta do Google Drive com os gabaritos e outros arquivos. */
  driveLink?: string | null;
  disponivel: boolean;
  motivosBloqueio: string[];
  documentosVencidos: number;
  documentosAVencer: number;
  manutencoesPendentes: number;
}

export type SituacaoVencimento = "VENCIDO" | "A_VENCER" | "EM_DIA";
export interface DocumentoVeiculo {
  id: string;
  veiculoId: string;
  placa: string;
  apelido: string | null;
  tipo: TipoDocVeiculo;
  descricao: string | null;
  numero: string | null;
  vencimento: string;
  observacao: string | null;
  situacao: SituacaoVencimento;
  dias: number;
}

export type SituacaoPlano = "EM_DIA" | "PROXIMA" | "VENCIDA" | "SEM_BASE";
export interface PlanoManutencao {
  id: string;
  veiculoId: string;
  placa: string;
  apelido: string | null;
  kmAtual: number;
  nome: string;
  intervaloKm: number | null;
  intervaloDias: number | null;
  ultimoKm: number | null;
  ultimaData: string | null;
  critico: boolean;
  ativo: boolean;
  situacao: SituacaoPlano;
  proximoKm: number | null;
  proximaData: string | null;
  kmRestante: number | null;
  diasRestantes: number | null;
}

export type StatusOrdem = "ABERTA" | "EM_ANDAMENTO" | "CONCLUIDA" | "CANCELADA";
export interface OrdemManutencao {
  id: string;
  veiculoId: string;
  planoId: string | null;
  placa: string;
  apelido: string | null;
  tipo: "PREVENTIVA" | "CORRETIVA";
  status: StatusOrdem;
  descricao: string;
  oficina: string | null;
  pecas: string | null;
  imobiliza: boolean;
  abertaEm: string;
  concluidaEm: string | null;
  km: number | null;
  kmRevisao: number | null;
  valorPecasCentavos: number;
  valorServicoCentavos: number;
  custoCentavos: number;
  diasParado: number | null;
  anexos: AnexoOrdem[];
}
export const ROTULO_STATUS_ORDEM: Record<StatusOrdem, string> = { ABERTA: "Aberta", EM_ANDAMENTO: "Em andamento", CONCLUIDA: "Concluída", CANCELADA: "Cancelada" };

export interface Abastecimento {
  id: string;
  veiculoId: string;
  placa: string;
  apelido: string | null;
  data: string;
  km: number;
  litros: number;
  valorCentavos: number;
  posto: string | null;
  tanqueCheio: boolean;
  /** COMBUSTIVEL, OLEO ou LUBRIFICANTE (13/11/2026). */
  tipo: "COMBUSTIVEL" | "OLEO" | "LUBRIFICANTE";
  kml: number | null;
  alerta: "ALTO" | "BAIXO" | null;
}
export interface ResumoAbastecimento {
  veiculoId: string;
  placa: string;
  apelido: string | null;
  litros: number;
  valorCentavos: number;
  mediaKml: number | null;
  alertas: number;
}

export interface ItemChecklist {
  id: string;
  grupo: string;
  descricao: string;
  critico: boolean;
  ordem: number;
  ativo: boolean;
}
export interface VeiculoChecklist {
  id: string;
  placa: string;
  apelido: string | null;
  tipo: TipoVeiculo;
  kmAtual: number;
  situacao: SituacaoVeiculo;
  feitoHoje: boolean;
  aprovadoHoje: boolean | null;
}
export interface ChecklistFeito {
  id: string;
  veiculoId: string;
  placa: string;
  apelido: string | null;
  motorista: string | null;
  data: string;
  km: number | null;
  aprovado: boolean;
  observacao: string | null;
  respostas: Array<{ itemId: string; grupo: string; descricao: string; critico: boolean; ok: boolean; observacao: string | null }>;
  resumo: { total: number; naoOk: number; criticosNaoOk: number; aprovado: boolean };
}

export interface RotuloVeiculo {
  veiculoId: string;
  placa: string;
  apelido: string | null;
}
export interface PainelFrota {
  mes: string;
  disponibilidade: { total: number; disponiveis: number; percentual: number | null; indisponiveis: Array<RotuloVeiculo & { motivos: string[] }> };
  vencimentos: Array<RotuloVeiculo & { documentoId: string; tipo: TipoDocVeiculo; descricao: string | null; vencimento: string; situacao: SituacaoVencimento; dias: number }>;
  vencimentosTotais: { vencidos: number; aVencer: number };
  manutencoes: Array<RotuloVeiculo & { planoId: string; nome: string; critico: boolean; situacao: SituacaoPlano; kmRestante: number | null; diasRestantes: number | null }>;
  ordensAbertas: number;
  checklist: { pendentesHoje: RotuloVeiculo[]; reprovadosHoje: number };
  custos: Array<RotuloVeiculo & { manutencaoCentavos: number; combustivelCentavos: number; financeiroCentavos?: number; totalCentavos: number; kmRodados: number; custoPorKmCentavos: number | null }>;
  totais: { manutencaoCentavos: number; combustivelCentavos: number; financeiroCentavos?: number; litros: number; mediaKml: number | null };
  alertasConsumo: Array<RotuloVeiculo & { abastecimentoId: string; data: string; kml: number | null; alerta: "ALTO" | "BAIXO" }>;
}

export const rotuloVeiculo = (v: { placa: string; apelido?: string | null }) => (v.apelido ? `${v.placa} — ${v.apelido}` : v.placa);

export type TipoAnexoOrdem = "OS" | "NF" | "NFSE" | "OUTRO";
export const ROTULO_ANEXO_ORDEM: Record<TipoAnexoOrdem, string> = { OS: "Ordem de serviço", NF: "NF (peças)", NFSE: "NFS-e (serviço)", OUTRO: "Outro" };
export interface AnexoOrdem { id: string; tipo: TipoAnexoOrdem; nomeArquivo: string; tamanho: number }
