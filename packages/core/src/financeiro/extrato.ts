import { lerCsv } from "../importadores/csv.js";
import { ehDataIso, paraCentavos } from "./dinheiro.js";

/** Linha de extrato (conta ou fatura de cartão). Valor com sinal: entrada positiva, saída negativa. */
export interface LinhaExtrato {
  /** Identificador do banco (FITID); ausente em CSV simples. */
  fitid: string | null;
  data: string;
  valorCentavos: number;
  descricao: string;
  documento: string | null;
}

export interface ExtratoLido {
  formato: "OFX" | "CSV";
  banco: string | null;
  agencia: string | null;
  /** Número da conta/cartão como veio no arquivo (o sistema só guarda o final). */
  conta: string | null;
  ehCartao: boolean;
  inicio: string | null;
  fim: string | null;
  saldoCentavos: number | null;
  saldoEm: string | null;
  linhas: LinhaExtrato[];
  /** Linhas ignoradas (sem data/valor válidos ou de valor zero), com o motivo. */
  ignoradas: Array<{ linha: number; motivo: string }>;
}

export function normalizarTexto(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

function tag(bloco: string, nome: string): string {
  const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, "i").exec(bloco);
  return m ? m[1]!.trim() : "";
}

function dataOfx(s: string): string | null {
  if (!/^\d{8}/.test(s)) return null;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return ehDataIso(iso) ? iso : null;
}

/**
 * TRNAMT do OFX: ponto decimal e sem separador de milhar ("-1234.56"). Alguns bancos brasileiros usam vírgula decimal.
 * Qualquer outra forma (ex.: "-100.000") é recusada em vez de interpretada.
 */
export function valorOfx(texto: string): number | null {
  const m = /^([+-])?(\d+)(?:[.,](\d{1,2}))?$/.exec(texto.trim());
  if (!m) return null;
  const v = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(v)) return null;
  return m[1] === "-" ? -v : v;
}

/** Lê OFX 1.x (SGML) e 2.x (XML). O texto deve vir já decodificado (UTF-8 ou Windows-1252). */
export function lerOfx(texto: string): ExtratoLido {
  if (!/<OFX>/i.test(texto)) throw new Error("Este arquivo não parece um extrato OFX. No internet banking, exporte o extrato no formato OFX.");
  const saldoTxt = tag(texto, "BALAMT");
  const lido: ExtratoLido = {
    formato: "OFX",
    banco: tag(texto, "BANKID") || null,
    agencia: tag(texto, "BRANCHID") || null,
    conta: tag(texto, "ACCTID") || null,
    ehCartao: /<CCACCTFROM>/i.test(texto),
    inicio: dataOfx(tag(texto, "DTSTART")),
    fim: dataOfx(tag(texto, "DTEND")),
    saldoCentavos: saldoTxt ? paraCentavos(saldoTxt) : null,
    saldoEm: dataOfx(tag(texto, "DTASOF")),
    linhas: [],
    ignoradas: [],
  };
  let n = 0;
  for (const m of texto.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi)) {
    n++;
    const b = m[1]!;
    const data = dataOfx(tag(b, "DTPOSTED"));
    const valor = valorOfx(tag(b, "TRNAMT"));
    if (!data) { lido.ignoradas.push({ linha: n, motivo: "Data inválida." }); continue; }
    if (valor === null) { lido.ignoradas.push({ linha: n, motivo: "Valor inválido." }); continue; }
    if (valor === 0) { lido.ignoradas.push({ linha: n, motivo: "Valor zero." }); continue; }
    const descricao = [tag(b, "NAME"), tag(b, "MEMO")].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(" · ").slice(0, 300);
    lido.linhas.push({ fitid: tag(b, "FITID") || null, data, valorCentavos: valor, descricao, documento: tag(b, "CHECKNUM") || tag(b, "REFNUM") || null });
  }
  if (lido.linhas.length === 0 && lido.ignoradas.length === 0) throw new Error("Nenhum lançamento encontrado no arquivo OFX.");
  return lido;
}

/** "03/10/2026", "03/10/26", "03-10-2026" ou "2026-10-03" → "2026-10-03" (ou null). */
export function dataFlexivel(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return ehDataIso(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})/.exec(t);
  if (!m) return null;
  const ano = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  const iso = `${ano}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return ehDataIso(iso) ? iso : null;
}

const col = (cab: string[], re: RegExp, excluir: number[] = []) => cab.findIndex((c, i) => !excluir.includes(i) && re.test(normalizarTexto(c)));

const ehCabecalho = (l: string[]) => {
  const c = l.map(normalizarTexto);
  return c.length >= 2 && c.some((x) => /^(DATA|DATE)\b/.test(x)) && c.some((x) => /VALOR|AMOUNT|CREDITO|DEBITO/.test(x));
};

/** Separador da linha de cabeçalho (o título do banco nas primeiras linhas não decide nada). */
function separadorDoCabecalho(texto: string): string | undefined {
  for (const linha of texto.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const n = normalizarTexto(linha);
    if (!/(^|[^A-Z])(DATA|DATE)\b/.test(n) || !/VALOR|AMOUNT|CREDITO|DEBITO/.test(n)) continue;
    const cont = (ch: string) => linha.split(ch).length - 1;
    const melhor = [";", "\t", ","].map((ch) => [ch, cont(ch)] as const).sort((a, b) => b[1] - a[1])[0]!;
    if (melhor[1] > 0) return melhor[0];
  }
  return undefined;
}

export interface OpcoesCsvExtrato {
  /** Fatura de cartão: na maioria dos CSVs compra é positiva; aqui o sinal é invertido (compra vira saída). */
  faturaCartao?: boolean;
}

/**
 * CSV simples de extrato: cabeçalho com colunas de data, descrição e valor
 * (ou crédito e débito separados). Separador ";" ou ",". Valor em formato brasileiro ou internacional.
 */
export function lerCsvExtrato(texto: string, opcoes: OpcoesCsvExtrato = {}): ExtratoLido {
  const linhas = lerCsv(texto, separadorDoCabecalho(texto));
  const iCab = linhas.findIndex(ehCabecalho);
  if (iCab < 0) throw new Error("Cabeçalho não reconhecido: o CSV precisa ter colunas de data, descrição e valor (ou crédito e débito).");
  const cab = linhas[iCab]!;
  const iData = col(cab, /^(DATA|DATE)\b/);
  // A coluna de descrição nunca é a de data ("Data Lançamento" é data); "Lançamento" sozinho só vale como último recurso.
  const iDescPrincipal = col(cab, /DESCRI|HISTORICO|MEMO|ESTABELECIMENTO|NOME/, [iData]);
  const iDesc = iDescPrincipal >= 0 ? iDescPrincipal : col(cab, /LANCAMENTO/, [iData]);
  const iValor = col(cab, /^(VALOR|AMOUNT)\b/);
  const iCred = col(cab, /CREDITO|ENTRADA/);
  const iDeb = col(cab, /DEBITO|SAIDA/);
  const iDoc = col(cab, /DOCUMENTO|DOC\b|FITID|IDENTIFICADOR|^ID$|NUMERO/);
  if (iDesc < 0) throw new Error("Coluna de descrição não encontrada (ex.: Descrição, Histórico).");
  if (iValor < 0 && iCred < 0 && iDeb < 0) throw new Error("Coluna de valor não encontrada (Valor, ou Crédito e Débito).");
  const lido: ExtratoLido = { formato: "CSV", banco: null, agencia: null, conta: null, ehCartao: !!opcoes.faturaCartao, inicio: null, fim: null, saldoCentavos: null, saldoEm: null, linhas: [], ignoradas: [] };
  for (let i = iCab + 1; i < linhas.length; i++) {
    const l = linhas[i]!;
    const numero = i + 1;
    const data = dataFlexivel(l[iData] ?? "");
    if (!data) { lido.ignoradas.push({ linha: numero, motivo: "Data inválida." }); continue; }
    let valor: number | null = null;
    let valorUnico = false;
    if (iValor >= 0 && (l[iValor] ?? "").trim() !== "") { valor = paraCentavos(l[iValor]); valorUnico = true; }
    else {
      const c = iCred >= 0 && (l[iCred] ?? "").trim() ? paraCentavos(l[iCred]) : null;
      const d = iDeb >= 0 && (l[iDeb] ?? "").trim() ? paraCentavos(l[iDeb]) : null;
      if (c !== null && c !== 0) valor = Math.abs(c);
      else if (d !== null && d !== 0) valor = -Math.abs(d);
      else valor = c === 0 || d === 0 ? 0 : null;
    }
    if (valor === null) { lido.ignoradas.push({ linha: numero, motivo: "Valor inválido." }); continue; }
    if (valor === 0) { lido.ignoradas.push({ linha: numero, motivo: "Valor zero." }); continue; }
    // Só a coluna "Valor" única segue a convenção "compra positiva"; em Crédito/Débito o sinal já está certo.
    if (opcoes.faturaCartao && valorUnico) valor = -valor;
    lido.linhas.push({ fitid: null, data, valorCentavos: valor, descricao: (l[iDesc] ?? "").trim().slice(0, 300), documento: iDoc >= 0 ? (l[iDoc] ?? "").trim() || null : null });
  }
  if (lido.linhas.length === 0) throw new Error(lido.ignoradas.length ? `Nenhuma linha válida (${lido.ignoradas[0]!.motivo} Linha ${lido.ignoradas[0]!.linha}).` : "O CSV não tem linhas de lançamento.");
  const datas = lido.linhas.map((x) => x.data).sort();
  lido.inicio = datas[0]!;
  lido.fim = datas.at(-1)!;
  return lido;
}

/** Hash curto e estável (FNV-1a de 32 bits em hexadecimal) para compor identificadores sintéticos. */
export function hashCurto(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** "Linha igual": mesma data, mesmo valor e mesma descrição (sem acento, caixa ou espaços repetidos). */
export function chaveLinha(l: Pick<LinhaExtrato, "data" | "valorCentavos" | "descricao">): string {
  return `${l.data}|${l.valorCentavos}|${normalizarTexto(l.descricao)}`;
}

export interface LinhaPreparada extends LinhaExtrato {
  /** Identificador único por conta: o FITID do banco ou um identificador sintético estável. */
  idUnico: string;
  chave: string;
  /** Ocorrência desta "linha igual" dentro do arquivo (1, 2…). */
  ordem: number;
}

/**
 * Prepara as linhas para gravar sem duplicar:
 * - com FITID: o identificador é o próprio FITID; se o mesmo FITID se repetir no arquivo com conteúdo diferente
 *   (alguns bancos fazem isso), a repetição ganha sufixo estável; com conteúdo igual, é repetição do arquivo e é descartada;
 * - sem FITID (CSV): o identificador é derivado de data + valor + descrição + ordem de ocorrência no arquivo,
 *   então duas compras iguais no mesmo dia continuam distintas, e reimportar o mesmo arquivo não duplica nada.
 */
export function prepararLinhas(linhas: LinhaExtrato[]): { preparadas: LinhaPreparada[]; repetidasNoArquivo: number } {
  const ordemPorChave = new Map<string, number>();
  const idsVistos = new Map<string, string>(); // idUnico → chave
  const preparadas: LinhaPreparada[] = [];
  let repetidas = 0;
  for (const l of linhas) {
    const chave = chaveLinha(l);
    const ordem = (ordemPorChave.get(chave) ?? 0) + 1;
    ordemPorChave.set(chave, ordem);
    let idUnico: string;
    if (l.fitid) {
      idUnico = l.fitid;
      const anterior = idsVistos.get(idUnico);
      if (anterior !== undefined) {
        if (anterior === chave) { repetidas++; continue; }
        idUnico = `${l.fitid}~${hashCurto(chave)}`;
      }
    } else {
      idUnico = `L:${l.data}:${l.valorCentavos}:${hashCurto(normalizarTexto(l.descricao))}:${ordem}`;
    }
    if (idsVistos.has(idUnico)) { repetidas++; continue; }
    idsVistos.set(idUnico, chave);
    preparadas.push({ ...l, idUnico, chave, ordem });
  }
  return { preparadas, repetidasNoArquivo: repetidas };
}
