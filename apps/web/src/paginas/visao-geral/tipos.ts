/** Respostas da API da Visão Geral (só números agregados). Valores em reais vêm em centavos e podem ser null (sem permissão de ver o financeiro). */

export const CANAIS_GRAFICO = ["SITE", "ADMIN", "AFILIADO", "BALCAO", "PARCEIRO", "VIATOR", "DECOLAR", "CIVITATIS", "OTA", "SEM_CANAL"] as const;
export type CanalGrafico = (typeof CANAIS_GRAFICO)[number];

export const ROTULO_CANAL_GRAFICO: Record<CanalGrafico, string> = {
  SITE: "Site",
  ADMIN: "Admin",
  AFILIADO: "Afiliados",
  BALCAO: "Maquininha/Balcão",
  PARCEIRO: "Parceiros",
  VIATOR: "Viator",
  DECOLAR: "Decolar",
  CIVITATIS: "Civitatis",
  OTA: "Outras OTAs",
  SEM_CANAL: "Sem canal identificado",
};

export const ROTULO_FORMA_PAGAMENTO: Record<string, string> = {
  NO_DIA: "Pagar no dia",
  EXTERNO: "Pagamento externo",
  PIX: "Pix",
  CARTAO_1X: "Cartão 1x",
  CARTAO_2_6X: "Cartão 2–6x",
  CARTAO_7X: "Cartão 7x ou mais",
  DINHEIRO: "Dinheiro",
  CANAL: "Pago no canal (Viator, Decolar, Civitatis)",
  CORTESIA: "Cortesia",
  OUTROS: "Outros / não informado",
};

export interface Resumo {
  hoje: string;
  faturamentoMes: { mes: string; reservas: number; semValor: number; valorCentavos: number | null; mesAnteriorCentavos: number | null };
  cupons: { usos: number; descontoCentavos: number | null; porCupom: Array<{ cupomId: string; usos: number; descontoCentavos: number | null }> };
  pendencias: { aConferir: number; semPonto: number; aPagarNoEmbarque: number; formularioPendente: number };
  saidasHoje: Array<{ id: string; passeio: string; status: string; capacidade: number; vendidos: number; ocupacao: number; veiculo: string | null; guia: string | null; motorista: string | null; checkinsPendentes: number }>;
  aguardandoPagamento: { pedidos: number; saldoCentavos: number | null };
  comissaoAfiliados: { pedidos: number; totalCentavos: number | null };
  whatsapp: { disponivel: boolean; naoLidas: number | null };
  ota: { naoIntegradas: string[] };
}

type Periodo = { periodo: { de: string; ate: string } };
export interface Emissores extends Periodo {
  baseDoPercentual: "valor" | "reservas";
  total: { reservas: number; valorCentavos: number | null };
  emissores: Array<{ cidade: string; uf: string; reservas: number; passageiros: number; valorCentavos: number | null; percentual: number }>;
}
export interface Comparativo extends Periodo {
  anos: Array<{ ano: number; de: string; ate: string; reservas: number; valorCentavos: number }>;
  semHistorico: boolean;
}
export interface DiaSemana extends Periodo {
  dias: Array<{ dia: number; total: number; porCanal: Record<string, number> }>;
  canais: CanalGrafico[];
}
export interface HorarioCompra extends Periodo {
  faixas: Array<{ rotulo: string; site: number; admin: number; outros: number }>;
  nota: string;
}
export interface PasseiosVendidos extends Periodo {
  baseDoPercentual: "valor" | "passageiros";
  total: { reservas: number; passageiros: number; valorCentavos: number | null };
  passeios: Array<{ passeioId: string; passeio: string; reservas: number; passageiros: number; valorCentavos: number | null; percentual: number }>;
}
export interface Pagamentos extends Periodo {
  baseDoPercentual: "valor" | "reservas";
  total: { reservas: number; valorCentavos: number | null };
  formas: Array<{ forma: string; reservas: number; valorCentavos: number | null; percentual: number }>;
}
export interface Faturamento extends Periodo {
  agrupamento: "dia" | "mes";
  pontos: Array<{ chave: string; total: number; porCanal: Record<string, number> }>;
  totaisPorCanal: Record<string, number>;
  totalCentavos: number;
  canais: CanalGrafico[];
}

export interface LinhaReserva {
  id: string;
  saidaId: string;
  data: string;
  passeio: string;
  passeioId: string;
  canal: string;
  codigoExterno: string | null;
  contatoNome: string;
  passageiros: number;
  status: "CONFIRMADA" | "CANCELADA";
  conferencia: "PENDENTE" | "CONFERIDA";
  pagamento: string | null;
  formaPagamento: string | null;
  pontoEmbarque: string | null;
  formularioPendente: boolean;
  compraEm: string | null;
  valorCentavos?: number | null;
}
export interface ListaReservas {
  periodo: { de: string; ate: string };
  total: number;
  pagina: number;
  limite: number;
  reservas: LinhaReserva[];
}
