import type { TipoDocumento } from "./tipos.js";

/** Remove tudo que não é dígito. */
export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/** Valida CPF pelos dígitos verificadores. Aceita com ou sem máscara. */
export function cpfValido(valor: string): boolean {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digitos = cpf.split("").map(Number);
  const dv = (base: number) => {
    let soma = 0;
    for (let i = 0; i < base; i++) soma += digitos[i]! * (base + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(9) === digitos[9] && dv(10) === digitos[10];
}

export function formatarCpf(valor: string): string {
  const d = somenteDigitos(valor);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : valor;
}

/** Normaliza o documento para armazenamento (CPF só dígitos; demais em maiúsculas sem espaços). */
export function normalizarDocumento(tipo: TipoDocumento, valor: string): string {
  if (tipo === "CPF") return somenteDigitos(valor);
  return valor.toUpperCase().replace(/\s+/g, "");
}

export function documentoValido(tipo: TipoDocumento, valor: string): boolean {
  const normalizado = normalizarDocumento(tipo, valor);
  if (tipo === "CPF") return cpfValido(normalizado);
  return normalizado.length >= 5;
}

/** Mostra apenas os 4 últimos caracteres. Ex.: CPF ***.***.*89-01 vira "•••8901". */
export function mascararDocumento(valor: string): string {
  const v = valor.replace(/[^0-9A-Za-z]/g, "");
  if (v.length <= 4) return "••••";
  return `•••${v.slice(-4)}`;
}

/**
 * Documentos fictícios usados hoje na Paytour para lançar reservas de OTAs.
 * 1111 = Tripadvisor/Viator, 2222 = Decolar, 3333 = Civitatis (Manual do Atendente).
 */
export const DOCUMENTOS_FICTICIOS_OTA = { "1111": "VIATOR", "2222": "DECOLAR", "3333": "CIVITATIS" } as const;

export function canalPorDocumentoFicticio(valor: string | null | undefined) {
  if (!valor) return null;
  const d = somenteDigitos(valor);
  return (DOCUMENTOS_FICTICIOS_OTA as Record<string, "VIATOR" | "DECOLAR" | "CIVITATIS">)[d] ?? null;
}
