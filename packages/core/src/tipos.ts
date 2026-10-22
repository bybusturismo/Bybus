/** Canais de venda conhecidos. */
export const CANAIS = ["PAYTOUR", "VIATOR", "DECOLAR", "CIVITATIS", "BALCAO", "OUTRO"] as const;
export type Canal = (typeof CANAIS)[number];

/** Categorias de passageiro. COLO não ocupa assento; CORTESIA ocupa assento mas não conta como pagante. */
export const CATEGORIAS = ["ADULTO", "SENIOR", "INFANTIL", "COLO", "CORTESIA"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/** Tipos de documento aceitos (estrangeiros usam passaporte/DNI; crianças podem usar certidão). */
export const TIPOS_DOCUMENTO = ["CPF", "RG", "PASSAPORTE", "RNM", "DNI_MERCOSUL", "CERTIDAO_NASCIMENTO", "OUTRO"] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export const STATUS_RESERVA = ["CONFIRMADA", "CANCELADA"] as const;
export type StatusReserva = (typeof STATUS_RESERVA)[number];

export const STATUS_EMBARQUE = ["PENDENTE", "EMBARCOU", "NO_SHOW"] as const;
export type StatusEmbarque = (typeof STATUS_EMBARQUE)[number];

export interface PontoEmbarque {
  id: string;
  /** Sequência oficial de embarque (desempata pontos com o mesmo horário). */
  ordem: number;
  /** Horário "HH:MM". */
  horario: string;
  nome: string;
  endereco?: string | null;
  ehTransfer: boolean;
}

export interface PassageiroManifesto {
  id: string;
  nome: string;
  categoria: Categoria;
  documentoTipo?: TipoDocumento | null;
  /** Documento já mascarado ou completo, conforme permissão de quem pediu. */
  documento?: string | null;
  documentoValido?: boolean | null;
  embarque: StatusEmbarque;
  /** Ponto específico do passageiro, quando diferente do da reserva. */
  pontoEmbarqueId?: string | null;
}

export interface ReservaManifesto {
  id: string;
  canal: Canal;
  codigoExterno?: string | null;
  contatoNome: string;
  contatoTelefone?: string | null;
  pontoEmbarqueId?: string | null;
  status: StatusReserva;
  observacoes?: string | null;
  passageiros: PassageiroManifesto[];
}
