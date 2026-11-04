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
  "escala:gerenciar",
  "reservas:editar",
  "importacoes:executar",
  "manifesto:ver",
  "manifesto:documentos",
  "manifesto:contatos",
  "embarque:registrar",
  "frota:ver",
  "frota:gerenciar",
  "frota:checklist",
  "rastreio:transmitir",
  "marketing:ver",
  "marketing:gerenciar",
  "biblioteca:ver",
  "biblioteca:editar",
  "ia:usar",
  "ia:gestores",
  "financeiro:ver",
  "financeiro:gerenciar",
  "whatsapp:ver",
  "whatsapp:responder",
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
  usuario: Usuario & { totpAtivo: boolean; perfilNome: string; todasUnidades: boolean; fotoVersao?: number | null };
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
  /** Coordenadas do ponto (rastreio); nulas até serem cadastradas. */
  latitude?: number | null;
  longitude?: number | null;
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

/** Situação de uma integração automática (GET /api/integracoes/paytour e /emails). */
export interface SituacaoIntegracao {
  configurada: boolean;
  automaticaACadaMinutos?: number;
  ultimaExecucaoEm: string | null;
  ultimoResultado: Record<string, unknown> | null;
  ultimoErro?: string | null;
}

export interface ResultadoSincronizacaoPaytour extends ResultadoImportacao {
  de: string;
  ate: string;
  pedidos: number;
}

/** GET /api/escala */
export interface DiaEscala {
  data: string;
  guiaId: string | null;
  guia: string | null;
  motoristaId: string | null;
  motorista: string | null;
  origem: "ESCALA" | "TROCA" | null;
  motivo: string | null;
  publicada: boolean;
  saida: { id: string; data: string; status: string } | null;
  alertas: string[];
}
export interface RespostaEscala {
  passeio: { id: string; nome: string; unidadeId: string; motoristaPadraoId: string | null; motoristaPadrao: string | null; veiculoPadrao: string | null };
  dias: DiaEscala[];
}
export interface EquipeEscala {
  guias: Array<{ id: string; nome: string; cadasturValidade: string | null }>;
  motoristas: Array<{ id: string; nome: string }>;
}

/** GET /api/conferencia */
export interface ItemConferencia {
  id: string;
  saidaId: string;
  data: string;
  passeio: string;
  passeioId: string;
  canal: Canal;
  codigoExterno: string | null;
  contatoNome: string;
  contatoTelefone: string | null;
  passageiros: number;
  categorias: Partial<Record<Categoria, number>>;
  pagamento: "PAGO" | "A_PAGAR" | "CORTESIA" | null;
  formaPagamento: string | null;
  origemCliente: string | null;
  ponto: { id: string; nome: string; horario: string; ehTransfer: boolean } | null;
  hospedagemInformada: string | null;
  pediuTransfer: boolean;
  informadoPeloClienteEm: string | null;
  conferencia: "PENDENTE" | "CONFERIDA";
  conferidaEm: string | null;
  conferidaPor: string | null;
  linkGerado: boolean;
  alertas: string[];
}

/** GET /api/fechamento */
export interface SituacaoFechamento {
  data: string;
  horaFechamento: string;
  automatico: boolean;
  whatsapp: { provedor: string; envioReal: boolean; grupoConfigurado: boolean };
  saidas: Array<{
    saidaId: string; passeio: string; data: string; guia: string | null; motorista: string | null; veiculo: string | null;
    listaFechadaEm: string | null; versao: number; reservas: number; naoConferidas: number; semPonto: number; depoisDoFechamento: number;
    mensagens: Record<string, number>;
  }>;
}
export interface MensagemFila {
  id: string; tipo: string; status: string; provedor: string | null; erro: string | null; criadoEm: string; enviadaEm: string | null;
  titular: string | null; destino: string | null; texto: string | null;
}

// ---------- IA: gestores e assistente (apps/api/src/rotas/ia.ts) ----------

export const IDS_GESTORES = ["comercial", "logistico", "frotas", "administrativo", "marketing", "juridico", "rh", "tecnologia"] as const;
export type IdGestor = (typeof IDS_GESTORES)[number];

export interface EstadoIa {
  ligada: boolean;
  assistente: boolean;
  gestores: boolean;
  /** Só para quem tem ia:gestores. */
  modelo?: string;
  modeloSintese?: string;
  limiteMesUsd?: number;
  gastoMesUsd?: number;
  avaliacaoDiaria?: boolean;
  horario?: string;
  emAndamento?: boolean;
}

export type NivelIa = "baixa" | "media" | "alta";
export interface ItemIa {
  titulo: string;
  detalhe: string;
  gravidade?: NivelIa;
  impacto?: "baixo" | "medio" | "alto";
  evidencia?: string;
}
export type StatusAcaoIa = "SUGERIDA" | "APROVADA" | "CONCLUIDA" | "DESCARTADA";
export interface AcaoIa {
  id: string;
  avaliacaoId?: string;
  titulo: string;
  detalhe: string;
  area: IdGestor;
  prioridade: NivelIa;
  prazoDias: number | null;
  status: StatusAcaoIa;
  decididaEm: string | null;
  observacao: string | null;
}
export interface ParecerAvaliacao {
  achados: ItemIa[];
  vulnerabilidades: ItemIa[];
  oportunidades: ItemIa[];
  acoes_sugeridas: Array<{ titulo: string; detalhe: string; prioridade: NivelIa; prazo_dias: number; area: IdGestor }>;
}
export interface ParecerDebate {
  comentarios: Array<{ gestor: IdGestor; tipo: "concordo" | "complemento" | "discordo"; texto: string }>;
  riscos_cruzados: Array<{ titulo: string; detalhe: string; areas: IdGestor[] }>;
  acoes_sugeridas: ParecerAvaliacao["acoes_sugeridas"];
}
export interface SinteseIa {
  resumo: string;
  vulnerabilidades: ItemIa[];
  oportunidades: ItemIa[];
  acoes_sugeridas: ParecerAvaliacao["acoes_sugeridas"];
  pontos_de_discordia: string[];
}
export type StatusAvaliacaoIa = "EXECUTANDO" | "CONCLUIDA" | "PARCIAL" | "FALHA" | "LIMITE";
export interface AvaliacaoResumoIa {
  id: string;
  dataRef: string;
  origem: "AUTOMATICA" | "MANUAL";
  status: StatusAvaliacaoIa;
  modelo: string;
  modeloSintese: string;
  iniciadaEm: string;
  concluidaEm: string | null;
  erro: string | null;
  custoUsd: number;
  resumo: string | null;
  acoes: Partial<Record<StatusAcaoIa, number>>;
}
export interface AvaliacaoDetalheIa extends Omit<AvaliacaoResumoIa, "resumo" | "acoes"> {
  retratos: Partial<Record<IdGestor, { alertas?: string[] } & Record<string, unknown>>> | null;
  sintese: SinteseIa | null;
  pareceres: Array<{ gestor: IdGestor; rodada: 1 | 2; conteudo: ParecerAvaliacao | ParecerDebate }>;
  acoes: AcaoIa[];
}
export interface RetratosIa {
  data: string;
  retratos: Record<IdGestor, { alertas?: string[] } & Record<string, unknown>>;
}
export interface RespostaAssistente {
  resposta: string;
  ferramentas: string[];
  custoUsd: number;
}

// ---------- WhatsApp: central de conversas (apps/api/src/rotas/whatsapp.ts) ----------

export interface WaModo { provedor: "simulado" | "evolution"; envioReal: boolean; simulado: boolean; avisosLigados: boolean; conexao: string | null }
export interface WaConversaResumo {
  id: string; telefone: string; nome: string | null; naoLidas: number; ultimaMensagemEm: string | null;
  unidadeId: string | null; unidadeCodigo: string | null;
  previa: string | null; previaTipo: string | null; previaDirecao: "ENTRADA" | "SAIDA" | null;
}
export interface WaLista { modo: WaModo; naoLidasTotal: number; conversas: WaConversaResumo[] }
export interface WaReservaContato { reservaId: string; saidaId: string; data: string; passeio: string; titular: string; canal: string; passageiros: number; proxima: boolean }
export interface WaConversaDetalhe { id: string; telefone: string; nome: string | null; naoLidas: number; unidadeId: string | null; modo: WaModo; reservas: WaReservaContato[] }
export interface WaMensagem {
  id: string; direcao: "ENTRADA" | "SAIDA"; texto: string | null; tipo: "TEXTO" | "IMAGEM" | "AUDIO" | "DOCUMENTO" | "OUTRO";
  status: "ENVIADA" | "SIMULADA" | "FALHA" | "RECEBIDA" | "LIDA"; criadoEm: string; automatica: boolean; tipoFila: string | null; enviadaPor: string | null;
}
export interface WaMensagens { itens: WaMensagem[]; temMais: boolean }
export interface WaEnvio { id: string | null; status: "ENVIADA" | "SIMULADA" | "FALHA"; erro: string | null }
