import { useState } from "react";
import {
  CATEGORIAS_PASSAGEIRO_GRUPO, ROTULO_CATEGORIA_GRUPO, ROTULO_DOC_GRUPO, TIPOS_DOC_GRUPO, lerPlanilhaPassageiros,
  type CategoriaPassageiroGrupo, type PassageiroGrupo,
} from "@bybus/core";
import { Aviso } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { formatarData } from "../../util/formato";

export interface LinhaLista { nome: string; tipoDocumento: string; documento: string; nascimento: string; categoria: string }

export const linhaVazia = (categoria: CategoriaPassageiroGrupo = "ALUNO"): LinhaLista => ({ nome: "", tipoDocumento: "", documento: "", nascimento: "", categoria });
export const paraLinhas = (lista: ReadonlyArray<Partial<PassageiroGrupo> & { nome: string }>): LinhaLista[] =>
  lista.map((p) => ({ nome: p.nome, tipoDocumento: p.tipoDocumento ?? "", documento: p.documento ?? "", nascimento: p.nascimento ?? "", categoria: p.categoria ?? "ALUNO" }));

/** Lê um arquivo .xlsx ou .csv em linhas de texto (o Excel só carrega quando um arquivo é escolhido). */
async function linhasDoArquivo(arquivo: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(arquivo.name)) {
    const { default: ExcelJS } = await import("exceljs");
    const { textoDaCelula } = await import("../financeiro/excel");
    const pasta = new ExcelJS.Workbook();
    await pasta.xlsx.load(await arquivo.arrayBuffer());
    const w = pasta.worksheets.find((x) => x.state !== "hidden" && x.state !== "veryHidden");
    if (!w) return [];
    const linhas: string[][] = [];
    for (let r = 1; r <= w.rowCount; r++) {
      const l: string[] = [];
      for (let c = 1; c <= w.columnCount; c++) l.push(textoDaCelula(w.getRow(r).getCell(c).value));
      linhas.push(l);
    }
    return linhas;
  }
  if (/\.xls$/i.test(arquivo.name)) throw new Error("Arquivo .xls antigo: abra no Excel e salve como .xlsx (ou .csv) e tente de novo.");
  // FileReader (funciona em todos os navegadores, inclusive os mais antigos dos celulares).
  const texto = await new Promise<string>((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => falha(r.error); r.readAsText(arquivo); });
  const sep = (texto.split("\n")[0] ?? "").includes(";") ? ";" : ",";
  return texto.split(/\r?\n/).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, "").trim()));
}

/**
 * "Planilha online" da lista de passageiros (13/11/2026): uma linha por pessoa, importar Excel/CSV, adicionar e remover linhas.
 * Usada pela equipe (ficha do grupo) e pelo representante (link público).
 */
export function EditorLista({ linhas, mudar, padrao = "ALUNO", desabilitado = false }: { linhas: LinhaLista[]; mudar: (l: LinhaLista[]) => void; padrao?: CategoriaPassageiroGrupo; desabilitado?: boolean }) {
  const [aviso, setAviso] = useState<string | null>(null);
  const alterar = (i: number, k: keyof LinhaLista, v: string) => mudar(linhas.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  async function importar(arquivo: File | undefined) {
    if (!arquivo) return;
    setAviso(null);
    try {
      const r = lerPlanilhaPassageiros(await linhasDoArquivo(arquivo), padrao);
      const atuais = linhas.filter((l) => l.nome.trim());
      mudar([...atuais, ...paraLinhas(r.passageiros)]);
      setAviso(`${r.passageiros.length} pessoa(s) importada(s) de "${arquivo.name}".${r.erros.length ? ` Linhas não importadas: ${r.erros.slice(0, 6).map((e) => `${e.linha} (${e.motivo})`).join(", ")}${r.erros.length > 6 ? "…" : ""}.` : ""} Confira e salve.`);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não consegui ler o arquivo.");
    }
  }
  const preenchidas = linhas.filter((l) => l.nome.trim()).length;
  return (
    <div className="lista-grupo">
      {aviso && <Aviso tipo="info">{aviso}</Aviso>}
      {!desabilitado && (
        <div className="filtros nao-imprimir">
          <div className="campo campo--linha">
            <label htmlFor="lista-importar">Importar planilha (Excel .xlsx ou .csv)</label>
            <input id="lista-importar" type="file" accept=".xlsx,.csv,.xls" onChange={(e) => { void importar(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
          <span className="texto-fraco">Colunas aceitas: Nome, Documento (CPF/RG), Tipo de documento, Data de nascimento, Função (aluno, professor…).</span>
        </div>
      )}
      <div className="tabela-rolagem nao-imprimir">
        <table className="tabela lista-grupo__tabela">
          <caption className="visualmente-oculto">Passageiros</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Nome completo</th><th scope="col">Documento</th><th scope="col">Número</th><th scope="col">Nascimento</th><th scope="col">Função</th>{!desabilitado && <th scope="col"><span className="visualmente-oculto">Remover</span></th>}</tr></thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><input aria-label={`Nome da linha ${i + 1}`} value={l.nome} maxLength={160} disabled={desabilitado} onChange={(e) => alterar(i, "nome", e.target.value)} /></td>
                <td><select aria-label={`Tipo de documento da linha ${i + 1}`} value={l.tipoDocumento} disabled={desabilitado} onChange={(e) => alterar(i, "tipoDocumento", e.target.value)}><option value="">Automático</option>{TIPOS_DOC_GRUPO.map((t) => <option key={t} value={t}>{ROTULO_DOC_GRUPO[t]}</option>)}</select></td>
                <td><input aria-label={`Documento da linha ${i + 1}`} value={l.documento} maxLength={40} disabled={desabilitado} onChange={(e) => alterar(i, "documento", e.target.value)} /></td>
                <td><input aria-label={`Nascimento da linha ${i + 1}`} type="date" value={l.nascimento} disabled={desabilitado} onChange={(e) => alterar(i, "nascimento", e.target.value)} /></td>
                <td><select aria-label={`Função da linha ${i + 1}`} value={l.categoria} disabled={desabilitado} onChange={(e) => alterar(i, "categoria", e.target.value)}>{CATEGORIAS_PASSAGEIRO_GRUPO.map((c) => <option key={c} value={c}>{ROTULO_CATEGORIA_GRUPO[c]}</option>)}</select></td>
                {!desabilitado && <td><button type="button" className="botao botao--pequeno botao--fantasma" aria-label={`Remover linha ${i + 1}`} onClick={() => mudar(linhas.filter((_, j) => j !== i))}><Icone nome="x" tamanho={14} /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!desabilitado && (
        <div className="barra-acoes nao-imprimir">
          <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => mudar([...linhas, linhaVazia(padrao)])}><Icone nome="mais" tamanho={14} /> Adicionar linha</button>
          <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => mudar([...linhas, ...Array.from({ length: 10 }, () => linhaVazia(padrao))])}>+10 linhas</button>
          <span className="texto-fraco">{preenchidas} pessoa(s) preenchida(s)</span>
        </div>
      )}
      {/* Versão de papel (lista física para a fiscalização). */}
      <table className="tabela so-impressao">
        <thead><tr><th>#</th><th>Nome completo</th><th>Documento</th><th>Nascimento</th><th>Função</th></tr></thead>
        <tbody>
          {linhas.filter((l) => l.nome.trim()).map((l, i) => (
            <tr key={i}><td>{i + 1}</td><td>{l.nome}</td><td>{l.documento ? `${l.tipoDocumento ? `${ROTULO_DOC_GRUPO[l.tipoDocumento as keyof typeof ROTULO_DOC_GRUPO] ?? l.tipoDocumento} ` : ""}${l.documento}` : "—"}</td><td>{l.nascimento ? formatarData(l.nascimento) : "—"}</td><td>{ROTULO_CATEGORIA_GRUPO[l.categoria as CategoriaPassageiroGrupo] ?? l.categoria}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Corpo para a API: só as linhas preenchidas. */
export const corpoLista = (linhas: LinhaLista[]) => linhas
  .filter((l) => l.nome.trim() || l.documento.trim())
  .map((l) => ({ nome: l.nome, tipoDocumento: l.tipoDocumento || null, documento: l.documento || null, nascimento: l.nascimento || null, categoria: l.categoria }));
