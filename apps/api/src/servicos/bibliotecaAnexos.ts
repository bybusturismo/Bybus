/** Anexos da Biblioteca: tipos aceitos, limites de tamanho e conferência do conteúdo (assinatura do arquivo). */
export const MB = 1024 * 1024;
export const LIMITES = { IMAGEM: 8 * MB, ARQUIVO: 25 * MB, VIDEO: 100 * MB } as const;
export const MAIOR_LIMITE = LIMITES.VIDEO;
export const MAX_ANEXOS_POR_PAGINA = 100;

export type UsoAnexo = keyof typeof LIMITES;
export interface TipoAnexo {
  tipo: string;
  uso: UsoAnexo;
}

/** Tipos que o navegador pode declarar (Content-Type) e que o servidor aceita. */
export const TIPOS_DECLARADOS = [
  "image/png", "image/jpeg", "image/gif", "image/webp", "video/webm", "video/mp4", "application/pdf", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const comeca = (b: Buffer, ...bytes: number[]) => bytes.every((x, i) => b[i] === x);

/** Tipo REAL pelo conteúdo (nunca confia só no que foi declarado). SVG, HTML e executáveis nunca passam. */
export function detectarTipo(b: Buffer, nome: string): TipoAnexo | null {
  const ext = nome.toLowerCase().split(".").pop() ?? "";
  if (comeca(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { tipo: "image/png", uso: "IMAGEM" };
  if (comeca(b, 0xff, 0xd8, 0xff)) return { tipo: "image/jpeg", uso: "IMAGEM" };
  if (b.subarray(0, 4).toString("latin1") === "GIF8") return { tipo: "image/gif", uso: "IMAGEM" };
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return { tipo: "image/webp", uso: "IMAGEM" };
  if (comeca(b, 0x1a, 0x45, 0xdf, 0xa3)) return { tipo: "video/webm", uso: "VIDEO" };
  if (b.subarray(4, 8).toString("latin1") === "ftyp") return { tipo: "video/mp4", uso: "VIDEO" };
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return { tipo: "application/pdf", uso: "ARQUIVO" };
  if (comeca(b, 0x50, 0x4b, 0x03, 0x04)) {
    if (ext === "docx") return { tipo: DOCX, uso: "ARQUIVO" };
    if (ext === "xlsx") return { tipo: XLSX, uso: "ARQUIVO" };
    return null;
  }
  if ((ext === "txt" || ext === "csv") && b.length > 0 && !b.includes(0)) {
    const t = b.toString("utf8");
    if (!t.includes("\uFFFD")) return { tipo: ext === "csv" ? "text/csv" : "text/plain", uso: "ARQUIVO" };
  }
  return null;
}

/** Limite de tamanho pelo tipo declarado (usado antes de ler o corpo, para recusar cedo). */
export function limiteDoTipoDeclarado(tipo: string): number | null {
  if (!(TIPOS_DECLARADOS as readonly string[]).includes(tipo)) return null;
  if (tipo.startsWith("image/")) return LIMITES.IMAGEM;
  if (tipo.startsWith("video/")) return LIMITES.VIDEO;
  return LIMITES.ARQUIVO;
}

/** Nome de exibição: sem caminho, sem caracteres de controle, até 120 caracteres. */
export function nomeSeguro(nome: string): string {
  const base = nome.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const limpo = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim().slice(0, 120);
  return limpo || "arquivo";
}

/** Cabeçalho Content-Disposition seguro (nome em UTF-8 codificado). */
export function disposicao(uso: UsoAnexo, nome: string): string {
  const ascii = nome.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${uso === "ARQUIVO" ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}
