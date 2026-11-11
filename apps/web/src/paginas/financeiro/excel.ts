/**
 * Leitura de planilhas do Excel (.xlsx) no navegador (pedido do dono, 11/11/2026): cada aba vira o mesmo texto .csv
 * que a importação já entende. O arquivo não sai do computador até a pessoa escolher a aba (vai só o texto da aba).
 * A biblioteca (exceljs) é carregada só nesta tela, quando um .xlsx é escolhido.
 */

type ValorCelula = unknown;

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** Valor de uma célula como texto no formato da planilha brasileira (data dd/mm/aaaa, número com vírgula decimal). */
export function textoDaCelula(v: ValorCelula): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    return `${doisDigitos(v.getUTCDate())}/${doisDigitos(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    // Valores com centavos: duas casas e vírgula (o leitor da planilha entende "-1234,50"). Inteiros ficam inteiros.
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",");
  }
  if (typeof v === "boolean") return v ? "VERDADEIRO" : "FALSO";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return textoDaCelula(o.result); // fórmula: vale o resultado
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text?: string }>).map((p) => p.text ?? "").join("");
    if ("text" in o) return textoDaCelula(o.text); // link
    if ("error" in o) return "";
  }
  return String(v);
}

/** Uma linha do .csv com ";" (aspas quando o texto tem ";", aspas ou quebra de linha). */
export function linhaCsv(celulas: string[]): string {
  return celulas.map((c) => (/[;"\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(";");
}

/** Converte linhas de valores (como vêm do Excel) no texto .csv. */
export function linhasParaCsv(linhas: ValorCelula[][]): string {
  return linhas.map((l) => linhaCsv(l.map(textoDaCelula))).join("\r\n");
}

export interface PastaExcel {
  abas: string[];
  /** Texto .csv de uma aba. */
  csvDaAba: (nome: string) => string;
}

/** Abre um .xlsx e devolve as abas visíveis e o conversor para .csv. */
export async function abrirExcel(dados: ArrayBuffer): Promise<PastaExcel> {
  const { default: ExcelJS } = await import("exceljs");
  const pasta = new ExcelJS.Workbook();
  await pasta.xlsx.load(dados);
  const planilhas = pasta.worksheets.filter((w) => w.state !== "hidden" && w.state !== "veryHidden");
  return {
    abas: planilhas.map((w) => w.name),
    csvDaAba: (nome) => {
      const w = planilhas.find((x) => x.name === nome);
      if (!w) return "";
      const linhas: ValorCelula[][] = [];
      const colunas = w.columnCount;
      for (let r = 1; r <= w.rowCount; r++) {
        const row = w.getRow(r);
        const l: ValorCelula[] = [];
        for (let c = 1; c <= colunas; c++) l.push(row.getCell(c).value);
        linhas.push(l);
      }
      return linhasParaCsv(linhas);
    },
  };
}
