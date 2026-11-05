import { ErroApi } from "../../api/cliente";
import type { Anexo } from "./tipos";

export interface AnexoEnviado extends Anexo {
  url: string;
}

/** Tipos aceitos pelo servidor (o conteúdo do arquivo também é conferido lá). */
export const ACEITA_ARQUIVO = ".pdf,.txt,.csv,.docx,.xlsx,image/png,image/jpeg,image/gif,image/webp,video/webm,video/mp4";
export const ACEITA_IMAGEM = "image/png,image/jpeg,image/gif,image/webp";
export const LIMITES_MB = { IMAGEM: 8, ARQUIVO: 25, VIDEO: 100 } as const;

export const tamanhoLegivel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Envia um arquivo para a página: o próprio arquivo vai no corpo, com o tipo dele no Content-Type. */
export async function enviarAnexo(paginaId: string, arquivo: Blob, nome: string): Promise<AnexoEnviado> {
  const tipo = arquivo.type || "application/octet-stream";
  const r = await fetch(`/api/biblioteca/paginas/${paginaId}/anexos?nome=${encodeURIComponent(nome)}`, {
    method: "POST",
    headers: { "X-Bybus": "1", "Content-Type": tipo, Accept: "application/json" },
    credentials: "same-origin",
    body: arquivo,
  });
  const dados = (await r.json().catch(() => null)) as (AnexoEnviado & { codigo?: string; mensagem?: string }) | null;
  if (!r.ok) throw new ErroApi(r.status, dados?.codigo ?? `HTTP_${r.status}`, dados?.mensagem ?? "Não foi possível enviar o arquivo.");
  return dados!;
}
