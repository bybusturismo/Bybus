/**
 * Diretoria virtual: os 8 gestores de IA. Cada um recebe só o "retrato" agregado da sua área
 * (contagens, somas, percentuais, alertas) — nunca nomes, documentos, telefones ou e-mails (LGPD).
 */
export const IDS_GESTORES = ["comercial", "logistico", "frotas", "administrativo", "marketing", "juridico", "rh", "tecnologia"] as const;
export type IdGestor = (typeof IDS_GESTORES)[number];

export interface DefinicaoGestor {
  id: IdGestor;
  nome: string;
  /** Frase curta para a tela. */
  descricao: string;
  /** Foco do gestor: entra no prompt de sistema. */
  foco: string;
}

export const GESTORES: readonly DefinicaoGestor[] = [
  {
    id: "comercial",
    nome: "Gestor comercial",
    descricao: "Vendas, canais, ocupação, cancelamentos e oportunidades de receita.",
    foco: "Vendas por canal (Paytour, Viator, Decolar, Civitatis, balcão), ocupação dos passeios, cancelamentos, saídas abaixo do mínimo, dependência de um canal e oportunidades de preencher lugares vazios.",
  },
  {
    id: "logistico",
    nome: "Gestor logístico",
    descricao: "Operação dos passeios: saídas, lotação, embarque, conferência e escala do dia.",
    foco: "Saídas dos próximos dias, lotação e capacidade, saídas sem guia/motorista/veículo, lista de passageiros aberta, conferência de embarque pendente, no-show, passageiros sem ponto de embarque e pedidos de transfer.",
  },
  {
    id: "frotas",
    nome: "Gestor de frotas",
    descricao: "Veículos: uso, conflitos de agenda, capacidade e manutenção.",
    foco: "Veículos usados nas saídas, saídas sem veículo informado, o mesmo veículo em mais de uma saída no mesmo dia, capacidade contra demanda e a lacuna de dados enquanto o módulo de frota (manutenção, documentos do veículo) não estiver implantado.",
  },
  {
    id: "administrativo",
    nome: "Gestor administrativo (financeiro)",
    descricao: "Formas de pagamento, cortesias, valores a receber no embarque e custo de equipe.",
    foco: "Pagamento (pago, a pagar no embarque, cortesia, não informado), peso de cortesias, reservas sem pagamento informado, custo estimado de diárias de guias e a lacuna de dados financeiros (valores, contas a pagar/receber) enquanto esses módulos não existirem. Dinheiro sempre em centavos nos dados.",
  },
  {
    id: "marketing",
    nome: "Gestor de marketing",
    descricao: "Origem dos clientes, canais, comunicação e oportunidades de campanha.",
    foco: "Mix de canais, origem dos clientes (estado/país, só agregado), comunicação com o cliente (mensagens enviadas, falhas, sem telefone), sazonalidade e oportunidades de campanha e de venda direta.",
  },
  {
    id: "juridico",
    nome: "Gestor jurídico",
    descricao: "Regulatório, LGPD, direito do consumidor e contratos.",
    foco: "Cadastur de guias, CNH de motoristas, documentos de passageiros (válidos/inválidos/ausentes), menores e idosos a bordo, acesso a dados pessoais, MFA dos usuários, cancelamentos (direito do consumidor) e o que exige revisão de contrato ou de política de privacidade.",
  },
  {
    id: "rh",
    nome: "Gestor de RH",
    descricao: "Equipe, escalas e documentos de guias e motoristas.",
    foco: "Equipe ativa por papel, cobertura da escala nos próximos dias, trocas por força maior, concentração de dias escalados por pessoa, idiomas disponíveis, documentos vencendo (Cadastur, CNH) e risco de sobrecarga.",
  },
  {
    id: "tecnologia",
    nome: "Gestor de tecnologia",
    descricao: "Segurança e saúde do sistema.",
    foco: "Usuários sem MFA, contas bloqueadas, sessões ativas, falhas de login, saúde das integrações (Paytour, e-mails), fila de mensagens com falha, volume de auditoria e uso/custo da própria IA.",
  },
];

export function gestorPorId(id: string): DefinicaoGestor | undefined {
  return GESTORES.find((g) => g.id === id);
}

export function ehIdGestor(v: string): v is IdGestor {
  return (IDS_GESTORES as readonly string[]).includes(v);
}
