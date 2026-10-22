/** CSV para Excel pt-BR: separador ";", BOM UTF-8 e aspas quando necessário. */
export function gerarCsv(cabecalho: string[], linhas: Array<Array<string | number | null | undefined>>): string {
  const campo = (v: string | number | null | undefined) => {
    const t = v === null || v === undefined ? "" : String(v);
    // Evita fórmula injetada ao abrir no Excel (=, +, -, @).
    const seguro = /^[=+\-@]/.test(t) ? `'${t}` : t;
    return /[;"\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
  };
  return "﻿" + [cabecalho, ...linhas].map((l) => l.map(campo).join(";")).join("\r\n");
}

export function baixarCsv(nomeArquivo: string, conteudo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
