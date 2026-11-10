/** Plano padrão de categorias (espelha os grupos do controle financeiro da empresa), tipos de conta e formas de pagamento. */

export const TIPOS_CONTA_FINANCEIRA = ["CORRENTE", "APLICACAO", "CAIXA", "CARTAO"] as const;
export type TipoContaFinanceira = (typeof TIPOS_CONTA_FINANCEIRA)[number];

export const FORMAS_PAGAMENTO = ["PIX", "BOLETO", "TRANSFERENCIA", "DEBITO", "CARTAO", "DINHEIRO", "OUTRA"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export const TIPOS_CATEGORIA = ["RECEITA", "DESPESA"] as const;
export type TipoCategoria = (typeof TIPOS_CATEGORIA)[number];

/** Linhas de negócio (ADR 0005), espelhadas aqui para o núcleo não depender da API. */
export const LINHAS_FINANCEIRO = ["CITY_TOUR", "FRETAMENTO", "PUBLICIDADE", "RECREATIVO"] as const;

/**
 * Grupos da DRE gerencial (reorganização aprovada pelo dono em 10/11/2026). Cada grupo pertence a uma seção da DRE
 * (`SECOES_DRE` em dre.ts). Os valores com sinal se compensam dentro do grupo (ex.: revenda = venda − repasse).
 */
export const GRUPO_PASSEIOS = "Passeios regulares";
export const GRUPO_GRUPOS = "Grupos (escolas, empresas e eventos)";
export const GRUPO_FRETAMENTO = "Fretamento e transporte contratado";
export const GRUPO_PUBLICIDADE = "Publicidade";
export const GRUPO_TRENZINHO = "Trenzinho (venda total)";
export const GRUPO_RECREATIVO = "Recreativo";
/** Revenda de serviços de terceiros: só a margem (venda − repasse) entra como receita própria (tratamento contábil a confirmar). */
export const GRUPO_REVENDA = "Revenda de terceiros (margem)";
export const GRUPO_IMPOSTOS_FATURAMENTO = "Impostos sobre o faturamento";
/** Devoluções e estornos: abatem a receita. */
export const GRUPO_DEVOLUCOES = "Cancelamentos e devoluções";
export const GRUPO_COMISSOES = "Comissões e taxas de venda";
export const GRUPO_PARCERIAS = "Repasses de parcerias";
export const GRUPO_COMBUSTIVEL = "Combustível";
export const GRUPO_DIARIAS = "Diárias e terceirizados";
export const GRUPO_MANUTENCAO = "Manutenção e peças";
export const GRUPO_VIAGEM = "Viagem e deslocamento";
export const GRUPO_FROTA_FIXA = "Frota fixa (impostos, seguros e documentos)";
export const GRUPO_PESSOAL_FIXO = "Pessoal fixo";
export const GRUPO_ADM = "Administrativo e comercial";
export const GRUPO_FINANCEIRO = "Receitas e despesas financeiras";
/** Despesas pessoais pagas pela empresa: aparecem à parte e ficam FORA do resultado operacional. */
export const GRUPO_PESSOAL = "Pessoal (despesas pessoais pagas pela empresa)";
/** Empréstimos tomados e parcelas pagas (passivo): fora do resultado. Juros ficam em Receitas e despesas financeiras. */
export const GRUPO_EMPRESTIMOS = "Empréstimos (fora do resultado)";
/** Consórcio e compra de veículos/equipamentos: investimento, fora do resultado. */
export const GRUPO_INVESTIMENTOS = "Investimentos (fora do resultado)";
export const GRUPO_RETIRADAS = "Retirada dos sócios (fora do resultado)";
/** Grupos mostrados à parte na DRE, fora do resultado operacional ("abaixo da linha"). */
export const GRUPOS_FORA_DO_RESULTADO: readonly string[] = [GRUPO_PESSOAL, GRUPO_EMPRESTIMOS, GRUPO_INVESTIMENTOS, GRUPO_RETIRADAS];
/** Compatibilidade: nome antigo do grupo principal de receita. */
export const GRUPO_RECEITA = GRUPO_PASSEIOS;

export interface CategoriaPlano {
  codigo: string;
  nome: string;
  tipo: TipoCategoria;
  /** Grupo da DRE gerencial. */
  grupo: string;
}

const R = (codigo: string, nome: string, grupo: string): CategoriaPlano => ({ codigo, nome, tipo: "RECEITA", grupo });
const D = (codigo: string, nome: string, grupo: string): CategoriaPlano => ({ codigo, nome, tipo: "DESPESA", grupo });

/** Plano de categorias. Os códigos nunca mudam (lançamentos e sinônimos apontam para eles); nome, grupo e ordem podem mudar. */
export const PLANO_CATEGORIAS: readonly CategoriaPlano[] = [
  // Receita bruta
  R("REC_SITE_PAYTOUR", "Site (Paytour)", GRUPO_PASSEIOS),
  R("REC_QUIOSQUE", "Quiosque", GRUPO_PASSEIOS),
  R("REC_VIATOR", "Viator / Tripadvisor", GRUPO_PASSEIOS),
  R("REC_DECOLAR", "Decolar", GRUPO_PASSEIOS),
  R("REC_CIVITATIS", "Civitatis", GRUPO_PASSEIOS),
  R("REC_PARCEIRO", "Agências, parceiros e maquininhas", GRUPO_PASSEIOS),
  R("REC_PASSEIO", "Passeios (canal não informado)", GRUPO_PASSEIOS),
  R("REC_CLIENTE", "Clientes (canal não informado)", GRUPO_PASSEIOS),
  R("REC_EXTRA", "Extras", GRUPO_PASSEIOS),
  R("REC_GRUPOS", "Grupos: escolas, empresas e eventos", GRUPO_GRUPOS),
  R("REC_FRETAMENTO", "Fretamento e contratos de transporte", GRUPO_FRETAMENTO),
  R("REC_PUBLICIDADE", "Publicidade nos veículos", GRUPO_PUBLICIDADE),
  R("REC_TRENZINHO", "Trenzinho (venda total)", GRUPO_TRENZINHO),
  R("REC_RECREATIVO", "Recreativo", GRUPO_RECREATIVO),
  R("REC_REVENDA", "Revenda de terceiros: valor recebido do cliente", GRUPO_REVENDA),
  D("DESP_REVENDA_REPASSE", "Revenda de terceiros: repasse ao fornecedor", GRUPO_REVENDA),

  // Deduções da receita
  D("DESP_IMPOSTOS", "Impostos sobre o faturamento (Simples, ISS, CBS/IBS)", GRUPO_IMPOSTOS_FATURAMENTO),
  D("DESP_DEVOLUCAO", "Devoluções e estornos pagos", GRUPO_DEVOLUCOES),
  R("REC_DEVOLUCAO", "Devoluções e estornos recebidos", GRUPO_DEVOLUCOES),

  // Custos de venda
  D("DESP_COMISSOES", "Comissões de OTAs e agências", GRUPO_COMISSOES),
  D("DESP_TAXAS", "Taxas de cartão, maquininha e gateway", GRUPO_COMISSOES),
  D("DESP_AFILIADOS", "Afiliados", GRUPO_COMISSOES),
  D("DESP_COMISSAO_RH", "Comissões de vendedores", GRUPO_COMISSOES),
  D("DESP_TRENZINHO_REPASSE", "Repasse da parceria do trenzinho (50% TOMA)", GRUPO_PARCERIAS),

  // Custos da operação
  D("DESP_COMBUSTIVEL", "Combustível", GRUPO_COMBUSTIVEL),
  D("DESP_COMBUSTIVEL_BC", "Combustível (posto BC)", GRUPO_COMBUSTIVEL),
  D("DESP_DIARIAS", "Diárias de guias e motoristas", GRUPO_DIARIAS),
  D("DESP_MOTORISTA_R", "Motorista terceirizado", GRUPO_DIARIAS),
  D("DESP_MANUTENCAO", "Manutenção", GRUPO_MANUTENCAO),
  D("DESP_PNEUS", "Pneus e recapagem", GRUPO_MANUTENCAO),
  D("DESP_ALTERNADOR", "Peças: alternador", GRUPO_MANUTENCAO),
  D("DESP_RADIADOR", "Peças: radiador", GRUPO_MANUTENCAO),
  D("DESP_TOLDO", "Peças: toldo", GRUPO_MANUTENCAO),
  D("DESP_EXTINTORES", "Extintores", GRUPO_MANUTENCAO),
  D("DESP_INSUMOS", "Insumos", GRUPO_MANUTENCAO),
  D("DESP_LAVACAO", "Lavação", GRUPO_MANUTENCAO),
  D("DESP_PEDAGIO", "Pedágio e estacionamento", GRUPO_VIAGEM),
  D("DESP_DESLOCAMENTO", "Deslocamento", GRUPO_VIAGEM),
  D("DESP_LOCACAO", "Locação de veículos", GRUPO_VIAGEM),
  D("DESP_PASSEIO_BLU", "Passeio Blumenau (alimentação, hospedagem)", GRUPO_VIAGEM),
  D("DESP_PASSEIO_BC", "Passeio Balneário Camboriú (alimentação, hospedagem)", GRUPO_VIAGEM),

  // Despesas fixas
  D("DESP_IPVA", "IPVA", GRUPO_FROTA_FIXA),
  D("DESP_LICENCIAMENTO", "Licenciamento", GRUPO_FROTA_FIXA),
  D("DESP_VISTORIA", "Vistoria", GRUPO_FROTA_FIXA),
  D("DESP_TACOGRAFO", "Tacógrafo", GRUPO_FROTA_FIXA),
  D("DESP_SEGUROS", "Seguros", GRUPO_FROTA_FIXA),
  D("DESP_RASTREADOR", "Rastreador", GRUPO_FROTA_FIXA),
  D("DESP_MULTA", "Multas", GRUPO_FROTA_FIXA),

  D("DESP_SALARIOS", "Folha (sem detalhe)", GRUPO_PESSOAL_FIXO),
  D("DESP_FOLHA_CLT", "Salários CLT e encargos", GRUPO_PESSOAL_FIXO),
  D("DESP_FOLHA_PJ", "Prestadores PJ fixos", GRUPO_PESSOAL_FIXO),
  D("DESP_PRO_LABORE", "Pró-labore dos sócios", GRUPO_PESSOAL_FIXO),
  D("DESP_VALE", "Vales", GRUPO_PESSOAL_FIXO),
  D("DESP_BENEFICIO", "Benefícios", GRUPO_PESSOAL_FIXO),
  D("DESP_FERIAS", "Férias", GRUPO_PESSOAL_FIXO),
  D("DESP_DECIMO_TERCEIRO", "Décimo terceiro", GRUPO_PESSOAL_FIXO),
  D("DESP_RESCISAO", "Rescisões", GRUPO_PESSOAL_FIXO),
  D("DESP_EXAMES", "Exames", GRUPO_PESSOAL_FIXO),
  D("DESP_SEG_TRAB", "Segurança do trabalho", GRUPO_PESSOAL_FIXO),
  D("DESP_UNIFORMES", "Uniformes", GRUPO_PESSOAL_FIXO),

  D("DESP_ALUGUEL", "Aluguel", GRUPO_ADM),
  D("DESP_QUIOSQUE", "Despesas do quiosque", GRUPO_ADM),
  D("DESP_MARKETING", "Marketing", GRUPO_ADM),
  D("DESP_HONORARIOS", "Contabilidade e honorários", GRUPO_ADM),
  D("DESP_EMISSAO_NF", "Emissão de NF", GRUPO_ADM),
  D("DESP_SISTEMAS", "Sistemas, telefone e internet", GRUPO_ADM),
  D("DESP_OUTROS_IMPOSTOS", "Outros impostos e taxas", GRUPO_ADM),
  D("DESP_COTAS", "Cotas", GRUPO_ADM),
  D("DESP_OUTRAS", "Outras despesas", GRUPO_ADM),

  // Resultado financeiro
  R("REC_APLICACAO", "Rendimentos de aplicação", GRUPO_FINANCEIRO),
  R("REC_OUTRAS", "Outras receitas", GRUPO_FINANCEIRO),
  D("DESP_JUROS", "Juros de empréstimos e financiamentos", GRUPO_FINANCEIRO),
  D("DESP_TARIFAS", "Tarifas bancárias e IOF", GRUPO_FINANCEIRO),

  // Abaixo da linha
  R("REC_EMPRESTIMO", "Empréstimos tomados (entrada)", GRUPO_EMPRESTIMOS),
  D("DESP_EMPRESTIMO", "Parcela de empréstimo", GRUPO_EMPRESTIMOS),
  D("DESP_EMPRESTIMO_TERRENO", "Parcela do empréstimo do terreno", GRUPO_EMPRESTIMOS),
  D("DESP_CONSORCIO", "Consórcio", GRUPO_INVESTIMENTOS),
  D("DESP_VEICULOS", "Compra de veículos e equipamentos", GRUPO_INVESTIMENTOS),
  D("DESP_RETIRADA", "Retirada dos sócios (distribuição de lucros)", GRUPO_RETIRADAS),
  D("DESP_PESSOAL", "Despesa direta (pessoal)", GRUPO_PESSOAL),
];

/** Contas padrão (sem números de conta). */
export const CONTAS_PADRAO: ReadonlyArray<{ nome: string; tipo: TipoContaFinanceira; chave: string }> = [
  { nome: "Sicredi", tipo: "CORRENTE", chave: "SICREDI" },
  { nome: "Unilos", tipo: "CORRENTE", chave: "UNILOS" },
  { nome: "Quiosque", tipo: "CAIXA", chave: "QUIOSQUE" },
  { nome: "Cartão", tipo: "CARTAO", chave: "CARTAO" },
  { nome: "Aplicação", tipo: "APLICACAO", chave: "APLICACAO" },
];
