import type { AcaoImportacao, Canal, Categoria, LinhaNegocio, NivelAlerta, PapelPessoa, Permissao, StatusEmbarque, StatusReserva, StatusSaida, TipoDocumento } from "../api/tipos";

/** Linhas de negócio (ADR 0005). */
export const ROTULO_LINHA: Record<LinhaNegocio, string> = {
  CITY_TOUR: "City tour",
  FRETAMENTO: "Fretamento",
  PUBLICIDADE: "Publicidade",
  RECREATIVO: "Recreativo",
};

export const ROTULO_PAPEL: Record<PapelPessoa, string> = {
  GUIA: "Guia",
  MOTORISTA: "Motorista",
  COLABORADOR: "Colaborador(a)",
  PARCEIRO: "Parceiro(a)",
};

/** Agrupamento das permissões por área (tela de perfis de acesso). Ordem = ordem de exibição. */
export const AREAS_PERMISSAO: Array<{ area: string; prefixos: string[] }> = [
  { area: "Administração", prefixos: ["usuarios", "unidades", "auditoria"] },
  { area: "Equipe", prefixos: ["pessoas"] },
  { area: "Produtos e pontos", prefixos: ["produtos", "pontos"] },
  { area: "Saídas e reservas", prefixos: ["saidas", "reservas", "importacoes"] },
  { area: "Lista de passageiros e embarque", prefixos: ["manifesto", "embarque"] },
];

export function areaDaPermissao(p: Permissao | string): string {
  const prefixo = p.split(":")[0] ?? "";
  return AREAS_PERMISSAO.find((a) => a.prefixos.includes(prefixo))?.area ?? "Outras";
}

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
  PERFIL_CRIADO: "Criou perfil de acesso",
  PERFIL_ALTERADO: "Alterou perfil de acesso",
  UNIDADE_CRIADA: "Criou praça",
  UNIDADE_ALTERADA: "Alterou praça",
  PASSEIO_CRIADO: "Criou passeio",
  PASSEIO_ALTERADO: "Alterou passeio",
  PESSOA_CRIADA: "Cadastrou pessoa da equipe",
  PESSOA_ALTERADA: "Alterou pessoa da equipe",
  RESERVAS_VISUALIZADAS: "Viu reservas",
};
