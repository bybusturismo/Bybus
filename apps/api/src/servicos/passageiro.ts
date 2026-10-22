import { documentoValido, mascararDocumento, normalizarDocumento, type TipoDocumento } from "@bybus/core";
import type { Cofre } from "../seguranca/cripto.js";

/** Prepara os campos de documento para gravação: normaliza, valida, cifra e guarda o final para exibição. */
export function camposDocumento(cofre: Cofre, tipo: TipoDocumento | null | undefined, valor: string | null | undefined) {
  if (!tipo || !valor || !valor.trim()) {
    return { documentoTipo: tipo ?? null, documentoCifrado: null, documentoFinal: null, documentoValido: null };
  }
  const normalizado = normalizarDocumento(tipo, valor);
  return {
    documentoTipo: tipo,
    documentoCifrado: cofre.cifrar(normalizado),
    documentoFinal: normalizado.slice(-4),
    documentoValido: documentoValido(tipo, normalizado),
  };
}

export function documentoMascarado(final: string | null): string | null {
  return final ? mascararDocumento(`xxxx${final}`) : null;
}
