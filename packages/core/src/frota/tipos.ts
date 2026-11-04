/** Tipos e rótulos do módulo de frota (docs/produto/modulo-frota.md). */

export const TIPOS_VEICULO = ["ONIBUS_DOIS_ANDARES", "ONIBUS", "TRENZINHO", "VAN"] as const;
export type TipoVeiculo = (typeof TIPOS_VEICULO)[number];

export const SITUACOES_VEICULO = ["ATIVO", "MANUTENCAO", "INATIVO"] as const;
export type SituacaoVeiculo = (typeof SITUACOES_VEICULO)[number];

/** Documentos de veículo (licenças municipais e ANTT: exigências a confirmar com o dono por praça/linha). */
export const TIPOS_DOC_VEICULO = ["CRLV", "LICENCA_MUNICIPAL", "ANTT", "SEGURO", "CRONOTACOGRAFO", "VISTORIA", "OUTRO"] as const;
export type TipoDocVeiculo = (typeof TIPOS_DOC_VEICULO)[number];

export const TIPOS_ORDEM = ["PREVENTIVA", "CORRETIVA"] as const;
export type TipoOrdem = (typeof TIPOS_ORDEM)[number];

export const STATUS_ORDEM = ["ABERTA", "EM_ANDAMENTO", "CONCLUIDA", "CANCELADA"] as const;
export type StatusOrdem = (typeof STATUS_ORDEM)[number];

/** Origem de uma leitura de quilometragem. KHRONOS é reservado para a integração com o rastreador. */
export const FONTES_KM = ["MANUAL", "CHECKLIST", "ABASTECIMENTO", "ORDEM", "KHRONOS"] as const;
export type FonteKm = (typeof FONTES_KM)[number];

/** Normaliza a placa: maiúsculas, sem hífen/espaços (aceita o padrão antigo e o Mercosul). */
export function normalizarPlaca(placa: string): string {
  return placa.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function placaValida(placa: string): boolean {
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(normalizarPlaca(placa));
}
