/** Leitor de CSV (RFC 4180) com detecção de separador ";" ou ",". */
export function lerCsv(texto: string): string[][] {
  const conteudo = texto.replace(/^﻿/, "");
  const primeiraLinha = conteudo.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primeiraLinha.match(/;/g)?.length ?? 0) > (primeiraLinha.match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < conteudo.length; i++) {
    const ch = conteudo[i]!;
    if (aspas) {
      if (ch === '"' && conteudo[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && conteudo[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.some((v) => v.trim() !== "")) linhas.push(linha);
      linha = [];
    } else campo += ch;
  }
  linha.push(campo);
  if (linha.some((v) => v.trim() !== "")) linhas.push(linha);
  return linhas;
}
