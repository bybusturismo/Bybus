import { tipoDoArquivo } from "./ficha.js";

/**
 * Documentos da empresa (pedido do dono, 11/11/2026): contrato social, cartão CNPJ, contratos, certidões, documentos dos sócios.
 * Pastas com acesso aberto (todos com "documentos:ver") ou restrito (administrador + perfis e pessoas escolhidos).
 */

export const DOCUMENTO_MAX_BYTES = 15 * 1024 * 1024;
export const ANTECEDENCIA_VENCIMENTO_DOC_DIAS = 30;

export type AcessoPasta = "TODOS" | "RESTRITO";
export interface PastaAcesso { acesso: AcessoPasta; perfis: string[]; usuarios: string[] }
export interface QuemAcessa { id: string; perfil: string }

/** Pasta restrita: só o administrador e quem está na lista (pelo perfil ou pela pessoa). */
export function podeVerPasta(p: PastaAcesso, u: QuemAcessa): boolean {
  if (u.perfil === "ADMIN" || p.acesso === "TODOS") return true;
  return p.usuarios.includes(u.id) || p.perfis.includes(u.perfil);
}

const MIME_ESCRITORIO: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * Tipo do arquivo conferido pelos primeiros bytes: PDF, JPG, PNG ou documento do Office (Word/Excel/PowerPoint, que é um .zip:
 * aí vale a extensão). Qualquer outro tipo é recusado.
 */
export function tipoDocumentoEmpresa(bytes: Uint8Array, nome: string): string | null {
  const base = tipoDoArquivo(bytes);
  if (base) return base;
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const ext = /\.([a-z0-9]+)$/i.exec(nome)?.[1]?.toLowerCase() ?? "";
  return zip ? MIME_ESCRITORIO[ext] ?? null : null;
}
