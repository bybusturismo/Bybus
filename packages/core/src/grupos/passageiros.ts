import { cpfValido, somenteDigitos } from "../documento.js";

/**
 * Lista de passageiros do grupo fechado (dono, 13/11/2026): o representante preenche por um link (planilha online) ou a
 * equipe importa o Excel. Nome completo e documento (a fiscalização exige a lista física com documento).
 */
export const CATEGORIAS_PASSAGEIRO_GRUPO = ["ALUNO", "PROFESSOR", "ACOMPANHANTE", "OUTRO"] as const;
export type CategoriaPassageiroGrupo = (typeof CATEGORIAS_PASSAGEIRO_GRUPO)[number];
export const ROTULO_CATEGORIA_GRUPO: Record<CategoriaPassageiroGrupo, string> = { ALUNO: "Aluno", PROFESSOR: "Professor(a) / monitor(a)", ACOMPANHANTE: "Acompanhante", OUTRO: "Outro" };
export const TIPOS_DOC_GRUPO = ["CPF", "RG", "PASSAPORTE", "CERTIDAO", "OUTRO"] as const;
export type TipoDocGrupo = (typeof TIPOS_DOC_GRUPO)[number];
export const ROTULO_DOC_GRUPO: Record<TipoDocGrupo, string> = { CPF: "CPF", RG: "RG", PASSAPORTE: "Passaporte", CERTIDAO: "Certidão de nascimento", OUTRO: "Outro" };
export const MAX_PASSAGEIROS_GRUPO = 500;

export interface PassageiroGrupo {
  nome: string;
  tipoDocumento: TipoDocGrupo | null;
  documento: string | null;
  /** AAAA-MM-DD. */
  nascimento: string | null;
  categoria: CategoriaPassageiroGrupo;
}

const sem = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** "dd/mm/aaaa", "dd/mm/aa", "aaaa-mm-dd" → "aaaa-mm-dd" (ou null). */
export function dataDaPlanilha(t: string): string | null {
  const v = t.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(v);
  if (!m) return null;
  const ano = m[3]!.length === 2 ? (Number(m[3]) > 30 ? 1900 : 2000) + Number(m[3]) : Number(m[3]);
  const d = Number(m[1]), mes = Number(m[2]);
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function categoriaDoTexto(t: string, padrao: CategoriaPassageiroGrupo): CategoriaPassageiroGrupo {
  const s = sem(t);
  if (!s) return padrao;
  if (/alun|estudant|crianc/.test(s)) return "ALUNO";
  if (/profes|monitor|coorden|educador/.test(s)) return "PROFESSOR";
  if (/acompanh|respons|\bpai\b|\bmae\b|familia/.test(s)) return "ACOMPANHANTE";
  return "OUTRO";
}

/** Tipo do documento: o informado ou, se não houver, CPF quando o número for um CPF válido. */
export function tipoDoDocumento(tipoTexto: string, numero: string): TipoDocGrupo | null {
  const s = sem(tipoTexto);
  if (/cpf/.test(s)) return "CPF";
  if (/\brg\b|identidade/.test(s)) return "RG";
  if (/passap/.test(s)) return "PASSAPORTE";
  if (/certid/.test(s)) return "CERTIDAO";
  if (!numero.trim()) return null;
  if (s) return "OUTRO";
  // Formato de CPF (000.000.000-00 ou 11 dígitos) conta como CPF, mesmo inválido (para apontar o erro de digitação).
  return /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(numero.trim()) || /^\d{11}$/.test(numero.trim()) ? "CPF" : "RG";
}

/** Limpa e valida uma linha; devolve o motivo quando não dá para usar. */
export function normalizarPassageiro(p: { nome: string; tipoDocumento?: string | null; documento?: string | null; nascimento?: string | null; categoria?: string | null }, padrao: CategoriaPassageiroGrupo = "ALUNO"): PassageiroGrupo | { erro: string } {
  const nome = p.nome.replace(/\s+/g, " ").trim();
  if (nome.length < 3) return { erro: "nome muito curto" };
  if (nome.length > 160) return { erro: "nome muito longo" };
  const documento = (p.documento ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || null;
  const tipo = documento ? (CATEGORIAS_PASSAGEIRO_GRUPO as readonly string[]).includes(p.tipoDocumento ?? "") ? null : (TIPOS_DOC_GRUPO as readonly string[]).includes(p.tipoDocumento ?? "") ? (p.tipoDocumento as TipoDocGrupo) : tipoDoDocumento(p.tipoDocumento ?? "", documento) : null;
  if (tipo === "CPF" && documento && !cpfValido(documento)) return { erro: "CPF inválido" };
  const nascimento = p.nascimento ? (/^\d{4}-\d{2}-\d{2}$/.test(p.nascimento) ? p.nascimento : dataDaPlanilha(p.nascimento)) : null;
  if (p.nascimento && !nascimento) return { erro: "data de nascimento inválida" };
  const categoria = (CATEGORIAS_PASSAGEIRO_GRUPO as readonly string[]).includes(p.categoria ?? "") ? (p.categoria as CategoriaPassageiroGrupo) : categoriaDoTexto(p.categoria ?? "", padrao);
  return { nome, tipoDocumento: tipo, documento: tipo === "CPF" && documento ? somenteDigitos(documento) : documento, nascimento, categoria };
}

/**
 * Lê as linhas de uma planilha (Excel/CSV já convertido em texto): acha a linha de cabeçalho (com "nome") e as colunas de
 * documento, tipo de documento, nascimento e categoria/função. Sem cabeçalho, usa a 1ª coluna como nome e a 2ª como documento.
 */
export function lerPlanilhaPassageiros(linhas: string[][], padrao: CategoriaPassageiroGrupo = "ALUNO"): { passageiros: PassageiroGrupo[]; erros: Array<{ linha: number; motivo: string }> } {
  const iCab = linhas.findIndex((l) => l.some((c) => /^nome/.test(sem(c))));
  const cab = iCab >= 0 ? linhas[iCab]!.map(sem) : [];
  const col = (re: RegExp) => cab.findIndex((c) => re.test(c));
  const cNome = iCab >= 0 ? col(/^nome/) : 0;
  const cTipo = col(/tipo.*doc/);
  const cDoc = iCab >= 0 ? cab.findIndex((c, i) => i !== cTipo && /doc|cpf|\brg\b|identidade|passaporte/.test(c)) : 1;
  const cNasc = col(/nasc/);
  const cCat = cab.findIndex((c, i) => i !== cTipo && /categ|funcao|cargo|tipo|perfil/.test(c));
  const passageiros: PassageiroGrupo[] = [];
  const erros: Array<{ linha: number; motivo: string }> = [];
  linhas.forEach((l, i) => {
    if (i <= iCab) return;
    const v = (c: number) => (c >= 0 ? (l[c] ?? "").trim() : "");
    if (l.every((x) => !x.trim())) return;
    const r = normalizarPassageiro({ nome: v(cNome), tipoDocumento: v(cTipo), documento: v(cDoc), nascimento: v(cNasc) || null, categoria: v(cCat) }, padrao);
    if ("erro" in r) erros.push({ linha: i + 1, motivo: r.erro });
    else passageiros.push(r);
  });
  return { passageiros: passageiros.slice(0, MAX_PASSAGEIROS_GRUPO), erros };
}

export function contarPorCategoria(lista: readonly PassageiroGrupo[]): Record<CategoriaPassageiroGrupo, number> {
  const r = { ALUNO: 0, PROFESSOR: 0, ACOMPANHANTE: 0, OUTRO: 0 };
  for (const p of lista) r[p.categoria]++;
  return r;
}
