import { cnpjValido, cpfValido } from "./documento.js";

/**
 * Ficha completa do usuário (pedido do dono, 09/11/2026; mesmo espírito da ficha da equipe do APP TOMA): dados pessoais,
 * contratação, contato de emergência, pagamento e anexos (contrato, documentos). LGPD: só quem tem `usuarios:ficha` vê;
 * documentos, endereço, contatos e dados de pagamento ficam cifrados no banco.
 */
export const VINCULOS = [
  ["CLT", "CLT"], ["CLT_INTERMITENTE", "CLT intermitente"], ["PJ", "PJ (prestador)"], ["DIARISTA", "Diarista / freelancer"],
  ["ESTAGIO", "Estágio"], ["TEMPORARIO", "Temporário"], ["TERCEIRIZADO", "Terceirizado"], ["SOCIO", "Sócio(a)"],
] as const;
export type Vinculo = (typeof VINCULOS)[number][0];
export const PIX_TIPOS = ["CPF", "CNPJ", "TELEFONE", "EMAIL", "ALEATORIA"] as const;
export const TIPOS_ANEXO = [["CONTRATO", "Contrato"], ["DOCUMENTO", "Documento pessoal"], ["COMPROVANTE", "Comprovante (endereço, conta…)"], ["OUTRO", "Outro"]] as const;
export type TipoAnexo = (typeof TIPOS_ANEXO)[number][0];

/** Parte sensível da ficha (vai cifrada para o banco). */
export interface FichaSensivel {
  cpf: string | null;
  rg: string | null;
  rgOrgao: string | null;
  cnpj: string | null;
  emailPessoal: string | null;
  endereco: { cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null };
  emergencia: { nome: string | null; parentesco: string | null; telefone: string | null };
  pix: { tipo: (typeof PIX_TIPOS)[number] | null; chave: string | null };
  banco: { banco: string | null; agencia: string | null; conta: string | null };
  anotacoes: string | null;
}

export const FICHA_SENSIVEL_VAZIA: FichaSensivel = {
  cpf: null, rg: null, rgOrgao: null, cnpj: null, emailPessoal: null,
  endereco: { cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null },
  emergencia: { nome: null, parentesco: null, telefone: null },
  pix: { tipo: null, chave: null }, banco: { banco: null, agencia: null, conta: null }, anotacoes: null,
};

const txt = (v: unknown, n = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const digitos = (v: unknown) => (typeof v === "string" ? v.replace(/\D/g, "") : "");

/** Confere e limpa a parte sensível. Lança Error com a mensagem para a tela. */
export function normalizarFichaSensivel(b: Partial<Record<keyof FichaSensivel, unknown>>): FichaSensivel {
  const cpf = digitos(b.cpf);
  if (cpf && !cpfValido(cpf)) throw new Error("CPF inválido.");
  const cnpj = digitos(b.cnpj);
  if (cnpj && !cnpjValido(cnpj)) throw new Error("CNPJ inválido.");
  const e = (b.endereco ?? {}) as Record<string, unknown>;
  const em = (b.emergencia ?? {}) as Record<string, unknown>;
  const p = (b.pix ?? {}) as Record<string, unknown>;
  const bc = (b.banco ?? {}) as Record<string, unknown>;
  const pixChave = txt(p.chave, 140);
  const uf = txt(e.uf, 2)?.toUpperCase() ?? null;
  if (uf && !/^[A-Z]{2}$/.test(uf)) throw new Error("UF inválida.");
  return {
    cpf: cpf || null, rg: txt(b.rg, 30), rgOrgao: txt(b.rgOrgao, 30), cnpj: cnpj || null, emailPessoal: txt(b.emailPessoal, 200),
    endereco: { cep: digitos(e.cep).slice(0, 8) || null, logradouro: txt(e.logradouro, 160), numero: txt(e.numero, 20), complemento: txt(e.complemento, 80), bairro: txt(e.bairro, 80), cidade: txt(e.cidade, 80), uf },
    emergencia: { nome: txt(em.nome, 120), parentesco: txt(em.parentesco, 60), telefone: txt(em.telefone, 30) },
    pix: { chave: pixChave, tipo: pixChave ? ((PIX_TIPOS as readonly string[]).includes(String(p.tipo)) ? (p.tipo as FichaSensivel["pix"]["tipo"]) : "ALEATORIA") : null },
    banco: { banco: txt(bc.banco, 80), agencia: txt(bc.agencia, 20), conta: txt(bc.conta, 30) },
    anotacoes: txt(b.anotacoes, 4000),
  };
}

/** Idade em anos completos numa data (AAAA-MM-DD). */
export function idade(nascimento: string, hoje: string): number {
  const [a, m, d] = nascimento.split("-").map(Number);
  const [ah, mh, dh] = hoje.split("-").map(Number);
  return ah! - a! - (mh! < m! || (mh === m && dh! < d!) ? 1 : 0);
}

/** Anexo aceito: PDF, JPG ou PNG, conferido pelos primeiros bytes (não pela extensão), até 5 MB. */
export const ANEXO_MAX_BYTES = 5 * 1024 * 1024;
export function tipoDoArquivo(bytes: Uint8Array): "application/pdf" | "image/jpeg" | "image/png" | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}
