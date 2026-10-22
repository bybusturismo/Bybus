/**
 * Tipos das respostas da API (espelham apps/api/src/rotas e packages/core/src/manifesto.ts).
 * Mantidos aqui para o front não depender do build do pacote core.
 */

export const PERFIS = ["ADMIN", "SUPERVISOR", "ATENDENTE", "GUIA", "MOTORISTA"] as const;
export type Perfil = (typeof PERFIS)[number];

export const PERMISSOES = [
  "usuarios:gerenciar",
  "auditoria:ver",
  "pontos:gerenciar",
  "saidas:gerenciar",
  "saidas:decidir",
  "reservas:editar",
  "importacoes:executar",
  "manifesto:ver",
  "manifesto:documentos",
  "manifesto:contatos",
  "embarque:registrar",
] as const;
export type Permissao = (typeof PERMISSOES)[number];

export const CANAIS = ["PAYTOUR", "VIATOR", "DECOLAR", "CIVITATIS", "BALCAO", "OUTRO"] as const;
export type Canal = (typeof CANAIS)[number];

export const CATEGORIAS = ["ADULTO", "SENIOR", "INFANTIL", "COLO", "CORTESIA"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const TIPOS_DOCUMENTO = ["CPF", "RG", "PASSAPORTE", "RNM", "DNI_MERCOSUL", "CERTIDAO_NASCIMENTO", "OUTRO"] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export type StatusReserva = "CONFIRMADA" | "CANCELADA";
export type StatusEmbarque = "PENDENTE" | "EMBARCOU" | "NO_SHOW";
export const STATUS_SAIDA = ["PREVISTA", "CONFIRMADA", "CANCELADA", "REALIZADA"] as const;
export type StatusSaida = (typeof STATUS_SAIDA)[number];
export type Pendencia = "TROCAR_SENHA" | "CONFIGURAR_MFA" | null;

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  totpAtivo?: boolean;
}

export interface RespostaEu {
  usuario: Usuario & { totpAtivo: boolean };
  pendencia: Pendencia;
  permissoes: Permissao[];
}

export interface Passeio {
  id: string;
  codigo: string;
  nome: string;
  cidade: string;
  capacidadePadrao: number;
  minimoConfirmacao: number;
  minimoSupervisor: number;
  ativo: boolean;
}

export interface PontoEmbarque {
  id: string;
  passeioId?: string;
  ordem: number;
  horario: string;
  nome: string;
  endereco?: string | null;
  ehTransfer: boolean;
  ativo?: boolean;
}

export interface SaidaResumo {
  id: string;
  data: string; // AAAA-MM-DD
  status: StatusSaida;
  capacidade: number;
  veiculo: string | null;
  guia: string | null;
  motorista: string | null;
  passeio: string;
  passeioId: string;
  reservas: number;
  passageiros: number;
  assentos: number;
  pagantes: number;
}

export interface Saida {
  id: string;
  passeioId: string;
  data: string;
  status: StatusSaida;
  capacidade: number;
  veiculo: string | null;
  guia: string | null;
  motorista: string | null;
  observacoes: string | null;
  criadoEm: string;
}

export interface PassageiroManifesto {
  id: string;
  nome: string;
  categoria: Categoria;
  documentoTipo?: TipoDocumento | null;
  documento?: string | null;
  documentoValido?: boolean | null;
  embarque: StatusEmbarque;
  pontoEmbarqueId?: string | null;
}

export type NivelAlerta = "info" | "atencao" | "critico";

export interface Alerta {
  codigo: string;
  nivel: NivelAlerta;
  mensagem: string;
  reservaIds?: string[];
  passageiroIds?: string[];
}

export interface LinhaManifesto {
  numero: number;
  reservaId: string;
  canal: Canal;
  codigoExterno: string | null;
  contatoNome: string;
  contatoTelefone: string | null;
  observacoes: string | null;
  passageiro: PassageiroManifesto;
}

export interface BlocoManifesto {
  ponto: PontoEmbarque | null;
  linhas: LinhaManifesto[];
}

export interface Totais {
  passageiros: number;
  assentos: number;
  pagantes: number;
  porCategoria: Record<Categoria, number>;
  embarcados: number;
  noShow: number;
}

export interface Manifesto {
  blocos: BlocoManifesto[];
  totais: Totais;
  alertas: Alerta[];
}

export interface RespostaManifesto {
  saida: Saida;
  passeio: Passeio;
  manifesto: Manifesto;
}

export interface PassageiroReserva {
  id: string;
  reservaId: string;
  nome: string;
  categoria: Categoria;
  documentoTipo: TipoDocumento | null;
  documento: string | null; // mascarado
  documentoValido: boolean | null;
  documentoPais: string | null;
  pontoEmbarqueId: string | null;
  embarque: StatusEmbarque;
  /** Ordem de cadastro (adicionada na API em 22/10/2026). */
  seq?: number;
}

export interface Reserva {
  id: string;
  saidaId: string;
  canal: Canal;
  canalOrigem: Canal | null;
  codigoExterno: string | null;
  referencias: string[];
  contatoNome: string;
  contatoTelefone: string | null;
  contatoEmail: string | null;
  pontoEmbarqueId: string | null;
  status: StatusReserva;
  observacoes: string | null;
  origem: string;
  criadoEm: string;
  atualizadoEm: string;
  passageiros: PassageiroReserva[];
}

export type AcaoImportacao = "CRIAR" | "ATUALIZAR" | "CANCELAR" | "IGNORAR";

export interface ItemPrevia {
  canal: string;
  codigoExterno: string;
  data: string;
  contatoNome: string;
  passageiros: number;
  pontoEmbarque: string | null;
  acao: AcaoImportacao;
  avisos: string[];
}

export interface ResultadoImportacao {
  previa: ItemPrevia[];
  resumo: Record<AcaoImportacao, number>;
  naoReconhecidos?: number;
  errosLeitura?: Array<{ linha: number; mensagem: string }>;
  colunasNaoEncontradas?: string[];
}

export interface UsuarioAdmin {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  totpAtivo: boolean;
  trocarSenha: boolean;
  criadoEm: string;
}

export interface RegistroAuditoria {
  id: string;
  acao: string;
  entidade: string | null;
  entidadeId: string | null;
  dados: Record<string, unknown> | null;
  ip: string | null;
  criadoEm: string;
  usuario: string | null;
}

export interface SessaoAtiva {
  id: string;
  criadaEm: string;
  ultimoUso: string;
  ip: string | null;
  userAgent: string | null;
  atual: boolean;
}
