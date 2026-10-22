/**
 * Máscara e validação de CPF no cliente — só para ajudar quem digita.
 * A regra final (normalização, validação, criptografia) é do servidor.
 */

export function somenteDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

/** Aplica a máscara 000.000.000-00 progressivamente enquanto o usuário digita. */
export function mascararCpf(v: string): string {
  const d = somenteDigitos(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function cpfValido(v: string): boolean {
  const cpf = somenteDigitos(v);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const n = cpf.split("").map(Number);
  const dv = (base: number) => {
    let soma = 0;
    for (let i = 0; i < base; i++) soma += n[i]! * (base + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === n[9] && dv(10) === n[10];
}

/** Retorna mensagem de erro do documento, ou null se aceitável para envio. */
export function validarDocumento(tipo: string | null | undefined, valor: string): string | null {
  const v = valor.trim();
  if (!v) return null;
  if (!tipo) return "Escolha o tipo do documento.";
  if (tipo === "CPF") {
    if (somenteDigitos(v).length !== 11) return "CPF deve ter 11 dígitos.";
    if (!cpfValido(v)) return "CPF inválido (dígito verificador não confere).";
    return null;
  }
  if (v.replace(/[^0-9A-Za-z]/g, "").length < 5) return "Documento muito curto (mínimo 5 caracteres).";
  return null;
}
