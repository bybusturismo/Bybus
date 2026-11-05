/** Plano padrão de categorias (espelha os grupos do controle financeiro da empresa), tipos de conta e formas de pagamento. */

export const TIPOS_CONTA_FINANCEIRA = ["CORRENTE", "APLICACAO", "CAIXA", "CARTAO"] as const;
export type TipoContaFinanceira = (typeof TIPOS_CONTA_FINANCEIRA)[number];

export const FORMAS_PAGAMENTO = ["PIX", "BOLETO", "TRANSFERENCIA", "DEBITO", "CARTAO", "DINHEIRO", "OUTRA"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export const TIPOS_CATEGORIA = ["RECEITA", "DESPESA"] as const;
export type TipoCategoria = (typeof TIPOS_CATEGORIA)[number];

/** Linhas de negócio (ADR 0005), espelhadas aqui para o núcleo não depender da API. */
export const LINHAS_FINANCEIRO = ["CITY_TOUR", "FRETAMENTO", "PUBLICIDADE", "RECREATIVO"] as const;

/** Grupos da DRE gerencial (os mesmos do resumo no topo da planilha de controle). */
export const GRUPO_RECEITA = "Receita";
export const GRUPO_OUTRAS_RECEITAS = "Outras receitas";
export const GRUPO_TAXAS = "Taxas";
export const GRUPO_FROTA = "Frota";
export const GRUPO_POSTO = "Posto";
export const GRUPO_FIXO = "Fixo";
export const GRUPO_TRIBUTOS = "Tributos";
export const GRUPO_RH = "RH";
export const GRUPO_ADM = "Administrativo";
/** Despesas pessoais pagas pela empresa: aparecem à parte e ficam FORA do resultado operacional. */
export const GRUPO_PESSOAL = "Pessoal (despesas pessoais pagas pela empresa)";
/** Empréstimos tomados e parcelas pagas (passivo): fora do resultado operacional. Juros, IOF e tarifas ficam em Taxas. */
export const GRUPO_EMPRESTIMOS = "Empréstimos (fora do resultado)";
/** Devoluções e estornos: abatem a receita ou a despesa de origem. */
export const GRUPO_DEVOLUCOES = "Devoluções e estornos";
/** Revenda de serviços de terceiros: só a margem (venda − repasse) entra como receita própria (tratamento contábil a confirmar). */
export const GRUPO_REVENDA = "Revenda de terceiros";
/** Grupos mostrados à parte na DRE, fora do resultado operacional. */
export const GRUPOS_FORA_DO_RESULTADO: readonly string[] = [GRUPO_PESSOAL, GRUPO_EMPRESTIMOS];

export interface CategoriaPlano {
  codigo: string;
  nome: string;
  tipo: TipoCategoria;
  /** Grupo da DRE gerencial. */
  grupo: string;
}

const R = (codigo: string, nome: string, grupo = GRUPO_RECEITA): CategoriaPlano => ({ codigo, nome, tipo: "RECEITA", grupo });
const D = (codigo: string, nome: string, grupo: string): CategoriaPlano => ({ codigo, nome, tipo: "DESPESA", grupo });

export const PLANO_CATEGORIAS: readonly CategoriaPlano[] = [
  R("REC_SITE_PAYTOUR", "Vendas pelo site (Paytour)"),
  R("REC_QUIOSQUE", "Vendas no quiosque"),
  R("REC_VIATOR", "Viator / Tripadvisor"),
  R("REC_DECOLAR", "Decolar"),
  R("REC_CIVITATIS", "Civitatis"),
  R("REC_FRETAMENTO", "Fretamento"),
  R("REC_PUBLICIDADE", "Publicidade"),
  R("REC_RECREATIVO", "Recreativo"),
  R("REC_CLIENTE", "Clientes"),
  R("REC_PARCEIRO", "Parceiros (gateways e maquininhas)"),
  R("REC_PASSEIO", "Passeios"),
  R("REC_EXTRA", "Extras"),
  R("REC_APLICACAO", "Rendimentos de aplicação", GRUPO_OUTRAS_RECEITAS),
  R("REC_OUTRAS", "Outras receitas", GRUPO_OUTRAS_RECEITAS),
  R("REC_DEVOLUCAO", "Devoluções e estornos recebidos", GRUPO_DEVOLUCOES),
  R("REC_EMPRESTIMO", "Empréstimos tomados (entrada)", GRUPO_EMPRESTIMOS),
  R("REC_REVENDA", "Revenda de terceiros: valor recebido do cliente", GRUPO_REVENDA),

  D("DESP_TAXAS", "Taxas (cartão, gateway, IOF e juros)", GRUPO_TAXAS),
  D("DESP_COMISSOES", "Comissões de OTAs e gateways", GRUPO_TAXAS),

  D("DESP_MANUTENCAO", "Manutenção da frota", GRUPO_FROTA),
  D("DESP_PEDAGIO", "Pedágio e estacionamento", GRUPO_FROTA),
  D("DESP_MOTORISTA_R", "Motorista terceirizado", GRUPO_FROTA),
  D("DESP_LAVACAO", "Lavação", GRUPO_FROTA),
  D("DESP_DESLOCAMENTO", "Deslocamento", GRUPO_FROTA),
  D("DESP_LOCACAO", "Locação de veículos", GRUPO_FROTA),
  D("DESP_MULTA", "Multas", GRUPO_FROTA),
  D("DESP_RASTREADOR", "Rastreador", GRUPO_FROTA),
  D("DESP_IPVA", "IPVA", GRUPO_FROTA),
  D("DESP_LICENCIAMENTO", "Licenciamento", GRUPO_FROTA),
  D("DESP_VISTORIA", "Vistoria", GRUPO_FROTA),
  D("DESP_PNEUS", "Pneus e recapagem", GRUPO_FROTA),
  D("DESP_INSUMOS", "Insumos", GRUPO_FROTA),
  D("DESP_TOLDO", "Toldo", GRUPO_FROTA),
  D("DESP_EXTINTORES", "Extintores", GRUPO_FROTA),
  D("DESP_ALTERNADOR", "Alternador", GRUPO_FROTA),
  D("DESP_RADIADOR", "Radiador", GRUPO_FROTA),
  D("DESP_TACOGRAFO", "Tacógrafo", GRUPO_FROTA),
  D("DESP_PASSEIO_BLU", "Passeio Blumenau", GRUPO_FROTA),
  D("DESP_PASSEIO_BC", "Passeio Balneário Camboriú", GRUPO_FROTA),

  D("DESP_COMBUSTIVEL", "Combustível (posto)", GRUPO_POSTO),
  D("DESP_COMBUSTIVEL_BC", "Combustível (posto BC)", GRUPO_POSTO),

  D("DESP_CONSORCIO", "Consórcio", GRUPO_FIXO),
  D("DESP_EMPRESTIMO", "Parcela de empréstimo", GRUPO_EMPRESTIMOS),
  D("DESP_EMPRESTIMO_TERRENO", "Parcela do empréstimo do terreno", GRUPO_EMPRESTIMOS),
  D("DESP_REVENDA_REPASSE", "Revenda de terceiros: repasse ao fornecedor", GRUPO_REVENDA),
  D("DESP_SEGUROS", "Seguros", GRUPO_FIXO),
  D("DESP_AFILIADOS", "Afiliados (comissões fixas)", GRUPO_FIXO),
  D("DESP_ALUGUEL", "Aluguel", GRUPO_FIXO),

  D("DESP_IMPOSTOS", "Impostos e tributos", GRUPO_TRIBUTOS),

  D("DESP_SALARIOS", "Folha", GRUPO_RH),
  D("DESP_FOLHA_CLT", "Folha CLT", GRUPO_RH),
  D("DESP_FOLHA_PJ", "Folha PJ", GRUPO_RH),
  D("DESP_VALE", "Vales", GRUPO_RH),
  D("DESP_BENEFICIO", "Benefícios", GRUPO_RH),
  D("DESP_FERIAS", "Férias", GRUPO_RH),
  D("DESP_EXAMES", "Exames", GRUPO_RH),
  D("DESP_RESCISAO", "Rescisão", GRUPO_RH),
  D("DESP_SEG_TRAB", "Segurança do trabalho", GRUPO_RH),
  D("DESP_COMISSAO_RH", "Comissões de pessoal", GRUPO_RH),
  D("DESP_UNIFORMES", "Uniformes", GRUPO_RH),
  D("DESP_DECIMO_TERCEIRO", "Décimo terceiro", GRUPO_RH),
  D("DESP_DIARIAS", "Diárias de guias e motoristas", GRUPO_RH),

  D("DESP_MARKETING", "Marketing", GRUPO_ADM),
  D("DESP_QUIOSQUE", "Despesas do quiosque", GRUPO_ADM),
  D("DESP_DEVOLUCAO", "Devoluções e estornos pagos", GRUPO_DEVOLUCOES),
  D("DESP_COTAS", "Cotas", GRUPO_ADM),
  D("DESP_HONORARIOS", "Honorários", GRUPO_ADM),
  D("DESP_EMISSAO_NF", "Emissão de NF", GRUPO_ADM),
  D("DESP_OUTRAS", "Outras despesas", GRUPO_ADM),

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
