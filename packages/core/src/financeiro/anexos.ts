/** Anexos da conta a pagar/receber (pedido do dono, 18/11/2026): boleto para pagar, nota fiscal, comprovante e outros documentos. */
export const TIPOS_ANEXO_FIN = ["BOLETO", "NF", "COMPROVANTE", "OUTRO"] as const;
export type TipoAnexoFin = (typeof TIPOS_ANEXO_FIN)[number];
export const ROTULO_ANEXO_FIN: Record<TipoAnexoFin, string> = { BOLETO: "Boleto", NF: "Nota fiscal", COMPROVANTE: "Comprovante de pagamento", OUTRO: "Outro documento" };
