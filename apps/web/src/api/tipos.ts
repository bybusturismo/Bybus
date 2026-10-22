/**
 * Tipos das respostas da API (espelham apps/api/src/rotas e packages/core/src/manifesto.ts).
 * Mantidos aqui para o front não depender do build do pacote core.
 */

/** Código do perfil de acesso (ADMIN ou perfil criado pelo administrador). Perfis são configuráveis (ADR 0005). */
export type Perfil = string;

/** Espelha CATALOGO_PERMISSOES da API (apps/api/src/seguranca/permissoes.ts). */
export const PERMISSOES = [
  "usuarios:gerenciar",
  "unidades:gerenciar",
  "auditoria:ver",
  "pessoas:gerenciar",
  "pessoas:ver",
  "produtos:gerenciar",
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

export const LINHAS_NEGOCIO = ["CITY_TOUR", "FRETAMENTO", "PUBLICIDADE", "RECREATIVO"] as const;
export type LinhaNegocio = (typeof LINHAS_NEGOCIO)[number];

export const PAPEIS_PESSOA = ["GUIA", "MOTORISTA", "COLABORADOR", "PARCEIRO"] as const;
export type PapelPessoa = (typeof PAPEIS_PESSOA)[number];

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  perfilNome?: string;
  todasUnidades?: boolean;
  totpAtivo?: boolean;
}

/** Praça/unidade resumida (como vem em /api/auth/eu). */
export interface UnidadeResumo {
  id: string;
  codigo: string;
  nome: string;
}

export interface Unidade extends UnidadeResumo {
  cidade: string;
  uf: string;
  ativa: boolean;
  criadoEm?: string;
}

export interface RespostaEu {
  usuario: Usuario & { totpAtivo: boolean; perfilNome: string; todasUnidades: boolean };
  pendencia: Pendencia;
  permissoes: Permissao[];
  unidades: UnidadeResumo[];
}

export interface Passeio {
  id: string;
  codigo: string;
  nome: string;
  cidade: string;
  unidadeId: string;
  linha: LinhaNegocio;
  capacidadePadrao: number;
  minimoConfirmacao: number;
  minimoSupervisor: number;
  ativo: boolean;
  /** Só em GET /api/passeios. */
  unidade?: string;
  unidadeCodigo?: string;
}

export interface PermissaoCatalogo {
  codigo: Permissao;
  descricao: string;
  exigeMfa: boolean;
}

export interface PerfilAcesso {
  id: string;
  codigo: Perfil;
  nome: string;
  descricao: string | null;
  permissoes: Permissao[];
  sistema: boolean;
  criadoEm: string;
}

/** Pessoa do cadastro único. Com só "pessoas:ver" a API manda o resumo (sem contato/documentos). */
export interface Pessoa {
  id: string;
  nome: string;
  papeis: PapelPessoa[];
  unidadeId: string | null;
  idiomas: string[];
  ativo: boolean;
  telefone?: string | null;
  email?: string | null;
  documentoTipo?: TipoDocumento | null;
  documento?: string | null; // mascarado
  documentoFinal?: string | null;
  cnhCategoria?: string | null;
  cnhValidade?: string | null;
  cadasturNumero?: string | null;
  cadasturValidade?: string | null;
  diariaCentavos?: number | null;
  observacoes?: string | null;
  usuarioId?: string | null;
  criadoEm?: string;
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
  guiaId: string | null;
  motoristaId: string | null;
  passeio: string;
  passeioId: string;
  linha: LinhaNegocio;
  unidadeId: string;
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
  guiaId?: string | null;
  motoristaId?: string | null;
  observacoes: string | null;
  criadoEm: string;
}

/** GET /api/saidas/:id — cabeçalho da saída sem carregar (nem auditar) a lista de passageiros. */
export interface RespostaSaida {
  saida: Saida;
  passeio: Passeio;
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
  perfilNome: string;
  todasUnidades: boolean;
  unidadeIds: string[];
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
