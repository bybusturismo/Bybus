// @vitest-environment node
import { lerPlanilhaFinanceira, paraCentavos } from "@bybus/core";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { abrirExcel, linhaCsv, textoDaCelula } from "./excel";

const CSV = readFileSync(new URL("../../../../api/test/fixtures/controle-financeiro-ficticio.csv", import.meta.url), "utf8");

/** Lê o CSV de teste (vírgula) e monta um .xlsx como o Excel guardaria: valores como número, datas como data. */
async function xlsxDoCsv(): Promise<ArrayBuffer> {
  const pasta = new ExcelJS.Workbook();
  pasta.addWorksheet("Resumo").addRow(["outra aba"]);
  const aba = pasta.addWorksheet("OUT2026");
  const oculta = pasta.addWorksheet("Oculta");
  oculta.state = "hidden";
  for (const linha of CSV.split(/\r?\n/)) {
    const celulas: string[] = [];
    let atual = "", aspas = false;
    for (const ch of linha) {
      if (ch === '"') aspas = !aspas;
      else if (ch === "," && !aspas) { celulas.push(atual); atual = ""; }
      else atual += ch;
    }
    celulas.push(atual);
    aba.addRow(celulas.map((c) => {
      const t = c.trim();
      const data = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
      if (data) return new Date(Date.UTC(Number(data[3]), Number(data[2]) - 1, Number(data[1])));
      if (/^R\$/.test(t)) {
        const v = paraCentavos(t);
        return v === null ? c : { formula: "1+0", result: v / 100 };
      }
      return c;
    }));
  }
  return (await pasta.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("Planilha do Excel (.xlsx)", () => {
  it("converte células: data, número com centavos, fórmula, texto com ponto e vírgula", () => {
    expect(textoDaCelula(new Date(Date.UTC(2026, 9, 2)))).toBe("02/10/2026");
    expect(textoDaCelula(-1500.25)).toBe("-1500,25");
    expect(textoDaCelula(5000)).toBe("5000");
    expect(textoDaCelula({ formula: "A1*2", result: 12.5 })).toBe("12,50");
    expect(textoDaCelula({ richText: [{ text: "Oficina " }, { text: "Teste" }] })).toBe("Oficina Teste");
    expect(linhaCsv(["a;b", 'diz "oi"', "c"])).toBe('"a;b";"diz ""oi""";c');
  });

  it("lê as abas visíveis e a aba vira o mesmo resultado do .csv", async () => {
    const pasta = await abrirExcel(await xlsxDoCsv());
    expect(pasta.abas).toEqual(["Resumo", "OUT2026"]);
    const doExcel = lerPlanilhaFinanceira(pasta.csvDaAba("OUT2026"));
    const doCsv = lerPlanilhaFinanceira(CSV);
    expect(doExcel.erros).toEqual([]);
    expect(doExcel.linhas.map((l) => [l.data, l.grupo.trim(), l.categoria, l.descricao, l.valores])).toEqual(doCsv.linhas.map((l) => [l.data, l.grupo.trim(), l.categoria, l.descricao, l.valores]));
  });
});
