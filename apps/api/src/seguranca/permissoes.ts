/**
 * Catálogo de permissões. Os perfis (tabela `perfis`) são configuráveis pelo administrador,
 * mas só podem usar permissões deste catálogo. A checagem real é sempre no back-end.
 */
export const CATALOGO_PERMISSOES = {
  "usuarios:gerenciar": "Gerenciar usuários e perfis de acesso",
  "usuarios:ficha": "Ver e editar a ficha dos usuários (documentos, contratação, contato de emergência, pagamento e anexos)",
  "unidades:gerenciar": "Cadastrar e editar praças/unidades",
  "auditoria:ver": "Ver o histórico de auditoria",
  "pessoas:gerenciar": "Cadastrar e editar guias, motoristas e colaboradores",
  "pessoas:ver": "Consultar guias e motoristas (para escalar)",
  "produtos:gerenciar": "Cadastrar passeios/produtos (praça e linha de negócio)",
  "pontos:gerenciar": "Editar pontos de embarque",
  "saidas:gerenciar": "Criar saídas e editar veículo/equipe",
  "saidas:decidir": "Confirmar, cancelar ou encerrar saídas; fechar a lista e enviar mensagens",
  "escala:gerenciar": "Montar a escala mensal e trocar guia/motorista",
  "reservas:editar": "Lançar e editar reservas e passageiros",
  "importacoes:executar": "Importar reservas (Bókun, Paytour)",
  "manifesto:ver": "Ver a lista de passageiros",
  "manifesto:documentos": "Ver documentos completos (CPF/passaporte)",
  "manifesto:contatos": "Ver telefones e e-mails dos clientes",
  "embarque:registrar": "Registrar embarque (embarcou, atrasado, não veio)",
  "frota:ver": "Consultar frota: veículos, documentos, manutenção, abastecimento e painel",
  "frota:gerenciar": "Cadastrar veículos, documentos, planos, ordens de manutenção, abastecimentos e km",
  "frota:checklist": "Preencher o checklist diário do veículo (motorista)",
  "rastreio:transmitir": "Transmitir a posição do ônibus pelo celular (motorista da saída)",
  "marketing:ver": "Ver os painéis de marketing (canais, origem dos clientes, campanhas, avaliações, afiliados)",
  "marketing:gerenciar": "Gerenciar campanhas, calendário de conteúdo, avaliações e afiliados",
  "biblioteca:ver": "Ler as páginas da Biblioteca (manuais e procedimentos)",
  "biblioteca:editar": "Criar e editar páginas da Biblioteca, inclusive as restritas",
  "ia:usar": "Conversar com o assistente de IA (Turistinha)",
  "ia:gestores": "Ver os gestores de IA, rodar a avaliação e aprovar ou descartar ações sugeridas",
  "financeiro:ver": "Ver o financeiro (contas a pagar e a receber, extratos, DRE)",
  "financeiro:gerenciar": "Lançar, baixar, importar extratos e conciliar no financeiro",
  "whatsapp:ver": "Conversas (WhatsApp e Instagram): ver mensagens, comentários e contatos dos clientes",
  "whatsapp:responder": "Conversas (WhatsApp e Instagram): responder mensagens e comentários, etiquetar, atribuir e editar respostas prontas",
  "transfer:gerenciar": "Montar e ajustar o transfer do dia (ordem de busca, horários, van, motorista, taxa) e configurar os bairros",
  "transfer:operar": "Operar o transfer pelo celular (motorista): marcar buscado/não apareceu e registrar a taxa recebida",
} as const;

export type Permissao = keyof typeof CATALOGO_PERMISSOES;
export const PERMISSOES = Object.keys(CATALOGO_PERMISSOES) as Permissao[];

/** Quem tem qualquer uma destas permissões é obrigado a usar MFA (regra do sistema, não configurável). */
export const PERMISSOES_SENSIVEIS: readonly Permissao[] = [
  "usuarios:gerenciar",
  "usuarios:ficha",
  "unidades:gerenciar",
  "manifesto:documentos",
  "pessoas:gerenciar",
  "auditoria:ver",
  "ia:gestores",
  "financeiro:ver",
  "financeiro:gerenciar",
];

export function ehPermissao(valor: string): valor is Permissao {
  return valor in CATALOGO_PERMISSOES;
}

export function pode(u: { permissoes: readonly string[] }, permissao: Permissao): boolean {
  return u.permissoes.includes(permissao);
}

export function exigeMfa(permissoes: readonly string[]): boolean {
  return PERMISSOES_SENSIVEIS.some((p) => permissoes.includes(p));
}
