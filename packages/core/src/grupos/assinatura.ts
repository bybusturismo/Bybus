import type { BlocoContrato } from "./contrato.js";

/**
 * Assinatura eletrônica (13/11/2026): link individual, código de confirmação por e-mail, nome e CPF conferidos, aceite,
 * registro de data/hora (Brasília), IP e navegador; documento congelado com hash SHA-256 e código de verificação.
 * Base legal: MP 2.200-2/2001 (art. 10, § 2º) e Lei 14.063/2020 (assinatura eletrônica entre particulares).
 */
export const PAPEIS_SIGNATARIO = ["CONTRATANTE", "CONTRATADA", "TESTEMUNHA"] as const;
export type PapelSignatario = (typeof PAPEIS_SIGNATARIO)[number];
export const ROTULO_PAPEL_SIGNATARIO: Record<PapelSignatario, string> = { CONTRATANTE: "Contratante", CONTRATADA: "Contratada", TESTEMUNHA: "Testemunha" };
export const MINUTOS_CODIGO_ASSINATURA = 10;
export const TENTATIVAS_CODIGO_ASSINATURA = 5;

export function mascararEmail(email: string): string {
  const [u, d] = email.split("@");
  if (!u || !d) return "***";
  return `${u.slice(0, 2)}${"*".repeat(Math.max(1, u.length - 2))}@${d}`;
}
export const mascararCpf = (cpf: string) => { const d = cpf.replace(/\D/g, ""); return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : "***"; };

/** Resumo do navegador para a folha de assinaturas (sem o texto inteiro do user-agent). */
export function resumirNavegador(ua: string | null | undefined): string {
  if (!ua) return "não informado";
  const nav = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const so = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return so ? `${nav} em ${so}` : nav;
}

/** Mesma pessoa? (nome digitado na assinatura × nome cadastrado: sem acentos, maiúsculas e espaços extras). */
export function mesmoNome(a: string, b: string): boolean {
  const n = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  return n(a) === n(b);
}

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Folha de assinaturas anexada ao final do documento assinado. */
export function folhaDeAssinaturas(p: {
  titulo: string; hashOriginal: string; codigo: string; urlVerificacao: string; enviadoEm: string;
  signatarios: Array<{ papel: PapelSignatario; nome: string; email: string; cpf: string | null; assinadoEm: string; ip: string | null; navegador: string | null }>;
}): BlocoContrato[] {
  const b: BlocoContrato[] = [
    { tipo: "titulo", texto: "FOLHA DE ASSINATURAS ELETRÔNICAS" },
    { tipo: "paragrafo", texto: `**Documento:** ${p.titulo}` },
    { tipo: "paragrafo", texto: `**Código de verificação:** ${p.codigo} — confira em ${p.urlVerificacao}` },
    { tipo: "paragrafo", texto: `**Hash SHA-256 do documento original:** ${p.hashOriginal}` },
    { tipo: "paragrafo", texto: `**Enviado para assinatura em:** ${quando(p.enviadoEm)} (horário de Brasília)` },
  ];
  p.signatarios.forEach((s, i) => {
    b.push({ tipo: "clausula", texto: `${i + 1}. ${s.nome} — ${s.papel === "CONTRATANTE" ? "Contratante" : s.papel === "CONTRATADA" ? "Contratada" : "Testemunha"}` });
    b.push({ tipo: "paragrafo", texto: `Assinou eletronicamente em **${quando(s.assinadoEm)}** (horário de Brasília), após confirmar o código enviado ao e-mail ${mascararEmail(s.email)}${s.cpf ? `, CPF ${mascararCpf(s.cpf)}` : ""}. IP ${s.ip ?? "não informado"} · ${resumirNavegador(s.navegador)}.` });
  });
  b.push({ tipo: "paragrafo", texto: "As assinaturas foram realizadas por meio eletrônico que identifica os signatários (link individual, código de confirmação por e-mail, nome e CPF) e preserva a integridade do documento (hash SHA-256), nos termos do art. 10, § 2º, da MP nº 2.200-2/2001 e da Lei nº 14.063/2020, conforme a cláusula de assinatura do contrato." });
  return b;
}
