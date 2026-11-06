import { ErroApi } from "./cliente";

/**
 * Envia um arquivo como corpo cru (o Content-Type é o do próprio arquivo), como o servidor espera nos anexos.
 * Cabeçalho X-Bybus é a proteção CSRF; erros viram ErroApi em português.
 */
export async function enviarArquivo<T>(caminho: string, arquivo: File): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, { method: "POST", headers: { "Content-Type": arquivo.type || "application/octet-stream", "X-Bybus": "1", Accept: "application/json" }, credentials: "same-origin", body: arquivo });
  } catch {
    throw new ErroApi(0, "SEM_CONEXAO", "Sem conexão com o servidor. Verifique a internet e tente de novo.");
  }
  const dados = (await resposta.json().catch(() => null)) as { codigo?: string; mensagem?: string } | null;
  if (!resposta.ok) throw new ErroApi(resposta.status, dados?.codigo ?? `HTTP_${resposta.status}`, dados?.mensagem ?? "Não foi possível enviar o arquivo.");
  return dados as T;
}
