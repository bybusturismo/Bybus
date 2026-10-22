import type { AcaoImportacao, Canal, Categoria, NivelAlerta, Perfil, StatusEmbarque, StatusReserva, StatusSaida, TipoDocumento } from "../api/tipos";

export const ROTULO_PERFIL: Record<Perfil, string> = {
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor(a)",
  ATENDENTE: "Atendente",
  GUIA: "Guia",
  MOTORISTA: "Motorista",
};

export const ROTULO_CANAL: Record<Canal, string> = {
  PAYTOUR: "Paytour",
  VIATOR: "Viator",
  DECOLAR: "Decolar",
  CIVITATIS: "Civitatis",
  BALCAO: "Balcão",
  OUTRO: "Outro",
};

export const ROTULO_CATEGORIA: Record<Categoria, string> = {
  ADULTO: "Adulto",
  SENIOR: "Sênior",
  INFANTIL: "Infantil",
  COLO: "Colo",
  CORTESIA: "Cortesia",
};

export const ROTULO_DOCUMENTO: Record<TipoDocumento, string> = {
  CPF: "CPF",
  RG: "RG",
  PASSAPORTE: "Passaporte",
  RNM: "RNM",
  DNI_MERCOSUL: "DNI Mercosul",
  CERTIDAO_NASCIMENTO: "Certidão de nascimento",
  OUTRO: "Outro",
};

export const ROTULO_STATUS_SAIDA: Record<StatusSaida, string> = {
  PREVISTA: "Prevista",
  CONFIRMADA: "Confirmada",
  CANCELADA: "Cancelada",
  REALIZADA: "Realizada",
};

export const ROTULO_STATUS_RESERVA: Record<StatusReserva, string> = {
  CONFIRMADA: "Confirmada",
  CANCELADA: "Cancelada",
};

export const ROTULO_EMBARQUE: Record<StatusEmbarque, string> = {
  PENDENTE: "Aguardando",
  EMBARCOU: "Embarcou",
  NO_SHOW: "Não compareceu",
};

export const ROTULO_NIVEL: Record<NivelAlerta, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  info: "Informação",
};

export const ROTULO_ACAO: Record<AcaoImportacao, string> = {
  CRIAR: "Criar",
  ATUALIZAR: "Atualizar",
  CANCELAR: "Cancelar",
  IGNORAR: "Ignorar",
};

/** Ações de auditoria → texto legível. Desconhecidas aparecem como vieram. */
export const ROTULO_ACAO_AUDITORIA: Record<string, string> = {
  LOGIN: "Entrou no sistema",
  LOGOUT: "Saiu do sistema",
  LOGIN_FALHOU: "Login falhou",
  USUARIO_BLOQUEADO: "Usuário bloqueado",
  MFA_FALHOU: "Código MFA inválido",
  MFA_ATIVADO: "Ativou verificação em duas etapas",
  SENHA_ALTERADA: "Alterou a senha",
  USUARIO_CRIADO: "Criou usuário",
  USUARIO_ALTERADO: "Alterou usuário",
  PONTO_ALTERADO: "Alterou ponto de embarque",
  SAIDA_CRIADA: "Criou saída",
  SAIDA_ALTERADA: "Alterou saída",
  RESERVA_CRIADA: "Criou reserva",
  RESERVA_ALTERADA: "Alterou reserva",
  RESERVA_CANCELADA: "Cancelou reserva",
  PASSAGEIRO_INCLUIDO: "Incluiu passageiro",
  PASSAGEIRO_ALTERADO: "Alterou passageiro",
  PASSAGEIRO_REMOVIDO: "Removeu passageiro",
  EMBARQUE_REGISTRADO: "Registrou embarque",
  MANIFESTO_VISUALIZADO: "Viu lista de passageiros",
  MANIFESTO_DOCUMENTOS_COMPLETOS: "Viu documentos completos",
  MANIFESTO_EXPORTADO: "Exportou lista (CSV)",
  IMPORTACAO_BOKUN: "Importou e-mails Bókun",
  IMPORTACAO_PAYTOUR: "Importou CSV Paytour",
};
