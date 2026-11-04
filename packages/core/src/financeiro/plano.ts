/** Plano inicial de categorias, tipos de conta e formas de pagamento do módulo financeiro. */

export const TIPOS_CONTA_FINANCEIRA = ["CORRENTE", "APLICACAO", "CAIXA", "CARTAO"] as const;
export type TipoContaFinanceira = (typeof TIPOS_CONTA_FINANCEIRA)[number];

export const FORMAS_PAGAMENTO = ["PIX", "BOLETO", "TRANSFERENCIA", "DEBITO", "CARTAO", "DINHEIRO", "OUTRA"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export const TIPOS_CATEGORIA = ["RECEITA", "DESPESA"] as const;
export type TipoCategoria = (typeof TIPOS_CATEGORIA)[number];

/** Linhas de negócio (ADR 0005), espelhadas aqui para o núcleo não depender da API. */
export const LINHAS_FINANCEIRO = ["CITY_TOUR", "FRETAMENTO", "PUBLICIDADE", "RECREATIVO"] as const;

export interface CategoriaPlano {
  codigo: string;
  nome: string;
  tipo: TipoCategoria;
  /** Grupo da DRE gerencial. */
  grupo: string;
}

export const PLANO_CATEGORIAS: readonly CategoriaPlano[] = [
  { codigo: "REC_SITE_PAYTOUR", nome: "Vendas pelo site (Paytour)", tipo: "RECEITA", grupo: "Receitas operacionais" },
  { codigo: "REC_QUIOSQUE", nome: "Vendas no quiosque", tipo: "RECEITA", grupo: "Receitas operacionais" },
  { codigo: "REC_VIATOR", nome: "Viator / Tripadvisor", tipo: "RECEITA", grupo: "Receitas operacionais" },
  { codigo: "REC_DECOLAR", nome: "Decolar", tipo: "RECEITA", grupo: "Receitas operacionais" },
  { codigo: "REC_CIVITATIS", nome: "Civitatis", tipo: "RECEITA", grupo: "Receitas operacionais" },
  { codigo: "REC_FRETAMENTO", nome: "Fretamento", tipo: "RECEITA", grupo: "Receitas operacionais" },
  { codigo: "REC_PUBLICIDADE", nome: "Publicidade", tipo: "RECEITA", grupo: "Receitas operacionais" },
  { codigo: "REC_RECREATIVO", nome: "Recreativo", tipo: "RECEITA", grupo: "Receitas operacionais" },
  { codigo: "REC_APLICACAO", nome: "Rendimentos de aplicação", tipo: "RECEITA", grupo: "Outras receitas" },
  { codigo: "REC_OUTRAS", nome: "Outras receitas", tipo: "RECEITA", grupo: "Outras receitas" },
  { codigo: "DESP_COMBUSTIVEL", nome: "Combustível", tipo: "DESPESA", grupo: "Custos operacionais" },
  { codigo: "DESP_MANUTENCAO", nome: "Manutenção da frota", tipo: "DESPESA", grupo: "Custos operacionais" },
  { codigo: "DESP_PEDAGIO", nome: "Pedágio e estacionamento", tipo: "DESPESA", grupo: "Custos operacionais" },
  { codigo: "DESP_DIARIAS", nome: "Diárias de guias e motoristas", tipo: "DESPESA", grupo: "Custos operacionais" },
  { codigo: "DESP_SALARIOS", nome: "Salários e encargos", tipo: "DESPESA", grupo: "Pessoal" },
  { codigo: "DESP_COMISSOES", nome: "Comissões de afiliados e OTAs", tipo: "DESPESA", grupo: "Comissões e taxas" },
  { codigo: "DESP_TAXAS", nome: "Taxas de cartão e gateway", tipo: "DESPESA", grupo: "Comissões e taxas" },
  { codigo: "DESP_MARKETING", nome: "Marketing", tipo: "DESPESA", grupo: "Despesas administrativas" },
  { codigo: "DESP_ALUGUEL", nome: "Aluguel", tipo: "DESPESA", grupo: "Despesas administrativas" },
  { codigo: "DESP_SEGUROS", nome: "Seguros", tipo: "DESPESA", grupo: "Despesas administrativas" },
  { codigo: "DESP_OUTRAS", nome: "Outras despesas", tipo: "DESPESA", grupo: "Despesas administrativas" },
  { codigo: "DESP_IMPOSTOS", nome: "Impostos", tipo: "DESPESA", grupo: "Impostos" },
];
