/** Funções puras da importação (testáveis sem navegador). */

export interface EmailColado {
  assunto: string;
  corpo: string;
}

/**
 * Separa o texto colado em e-mails. Separador: linha só com "-----" (5 ou mais hífens).
 * A primeira linha não vazia de cada bloco é tratada como assunto quando não é linha de tabela ("| campo | valor |").
 */
export function separarEmails(texto: string): EmailColado[] {
  return texto
    .replace(/\r\n?/g, "\n")
    .split(/^\s*-{5,}\s*$/m)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((bloco) => {
      const linhas = bloco.split("\n");
      const primeira = linhas[0]!.trim();
      const pareceAssunto = !primeira.startsWith("|") && primeira.length <= 500;
      return { assunto: pareceAssunto ? primeira : "", corpo: pareceAssunto ? linhas.slice(1).join("\n") : bloco };
    });
}

/** Tenta UTF-8; se aparecer caractere de substituição (�), relê como ISO-8859-1/Windows-1252 (exportações antigas do Excel). */
export function decodificarCsv(bytes: ArrayBuffer): { texto: string; codificacao: "UTF-8" | "ISO-8859-1" } {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("�")) return { texto: utf8.replace(/^﻿/, ""), codificacao: "UTF-8" };
  return { texto: new TextDecoder("iso-8859-1").decode(bytes), codificacao: "ISO-8859-1" };
}

export function lerArquivo(arquivo: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result as ArrayBuffer);
    leitor.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    leitor.readAsArrayBuffer(arquivo);
  });
}
