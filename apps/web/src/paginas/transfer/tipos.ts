import type { FormaTaxa, SituacaoBusca, SituacaoTaxa } from "@bybus/core";

export type { FormaTaxa, SituacaoBusca, SituacaoTaxa };

export interface ParadaTransfer {
  id: string;
  reservaId: string;
  titular: string;
  pax: number;
  assentos: number;
  telefone: string | null;
  bairroId: string | null;
  bairro: string | null;
  endereco: string | null;
  horario: string | null;
  horarioManual: boolean;
  ordem: number;
  situacao: SituacaoBusca;
  taxaCentavos: number;
  taxaForma: FormaTaxa | null;
  taxaSituacao: SituacaoTaxa;
  recebidoPor: string | null;
  recebidoEm: string | null;
  observacoes: string | null;
  /** Ponto do hotel no mapa (avisos "a van chega em 5 min"); null = sem ponto. */
  mapa?: { lat: number; lng: number; origem: string | null } | null;
}

export interface TotaisTransfer {
  reservas: number;
  pax: number;
  assentos: number;
  buscados: number;
  naoApareceram: number;
  taxa: { total: number; aReceber: number; recebidoPix: number; recebidoDinheiro: number; incluidoNoPasseio: number; naoApareceram: number };
}

export interface DiaTransfer {
  id: string;
  veiculoId: string | null;
  veiculoTexto: string | null;
  veiculo: string | null;
  veiculoCapacidade: number | null;
  motoristaId: string | null;
  motorista: string | null;
  lugares: number | null;
  pontoEncontroId: string | null;
  chegadaPrevista: string | null;
  observacoes: string | null;
}

export interface RespostaTransfer {
  data: string;
  habilitado: boolean;
  saida: { id: string; data: string; status: string; passeioId: string; passeio: string; unidadeId: string; listaFechadaEm: string | null } | null;
  config?: { taxaPorPassageiroCentavos: number; taxaAConfirmar: boolean; intervaloMinutos: number };
  dia?: DiaTransfer | null;
  encontro?: { id: string; nome: string; horario: string } | null;
  pontosEncontro?: Array<{ id: string; nome: string; horario: string }>;
  bairros?: Array<{ id: string; nome: string; ordemBusca: number; horarioReferencia: string | null }>;
  reservas?: ParadaTransfer[];
  candidatas?: number;
  totais?: TotaisTransfer;
  alertas?: string[];
  opcoes?: { motoristas: Array<{ id: string; nome: string }>; veiculos: Array<{ id: string; placa: string; apelido: string | null; capacidade: number | null }> } | null;
}

export interface PasseioTransfer { id: string; nome: string; unidadeId: string }

export interface ConfigPasseioTransfer {
  config: {
    taxaPorPassageiroCentavos: number; taxaAConfirmar: boolean; intervaloMinutos: number; pontoEncontroId: string | null; chegadaPrevista: string | null;
    motoristaPadraoId: string | null; veiculoPadraoId: string | null; veiculoPadraoTexto: string | null; lugaresPadrao: number | null;
  };
  bairros: Array<{ id?: string; nome: string; ordemBusca: number; horarioReferencia: string | null; horarioAConfirmar: boolean; pontoEmbarqueId: string | null; ativo: boolean }>;
  pontos: Array<{ id: string; nome: string; horario: string; ehTransfer: boolean }>;
  motoristas: Array<{ id: string; nome: string }>;
  veiculos: Array<{ id: string; placa: string; apelido: string | null; capacidade: number | null }>;
}

export const ROTULO_SITUACAO: Record<SituacaoBusca, string> = { A_CONFIRMAR: "A confirmar", CONFIRMADO: "Confirmado", BUSCADO: "Buscado", NAO_APARECEU: "Não apareceu" };
export const SITUACOES: SituacaoBusca[] = ["A_CONFIRMAR", "CONFIRMADO", "BUSCADO", "NAO_APARECEU"];
export const CLASSE_SITUACAO: Record<SituacaoBusca, string> = { A_CONFIRMAR: "etiqueta--neutra", CONFIRMADO: "etiqueta--info", BUSCADO: "etiqueta--sucesso", NAO_APARECEU: "etiqueta--perigo" };

export function descricaoTaxa(p: Pick<ParadaTransfer, "taxaSituacao" | "taxaForma" | "taxaCentavos" | "recebidoPor">, moeda: (c: number) => string): string {
  if (p.taxaCentavos <= 0) return "sem taxa";
  if (p.taxaSituacao === "RECEBIDO") {
    if (p.taxaForma === "INCLUIDO_NO_PASSEIO") return `${moeda(p.taxaCentavos)} · incluída no passeio`;
    return `${moeda(p.taxaCentavos)} · recebida (${p.taxaForma === "PIX" ? "PIX" : "dinheiro"})${p.recebidoPor ? ` por ${p.recebidoPor}` : ""}`;
  }
  return `${moeda(p.taxaCentavos)} · a receber`;
}
