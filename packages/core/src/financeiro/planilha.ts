import { lerCsv } from "../importadores/csv.js";
import { dataFlexivel, normalizarTexto } from "./extrato.js";
import { paraCentavos } from "./dinheiro.js";

/**
 * Leitura da planilha de controle financeiro (aba mensal exportada em CSV).
 * Colunas (por nome, em qualquer ordem): MÊS, CONTA, DATA, GRUPO, CATEGORIA (CAT), FORNECEDOR, DESCRIÇÃO,
 * valores em " A PAGAR ", " SICREDI ", " UNILOS ", " QUIOSQUE ", " CARTÃO ", e OBS.
 * O resumo do topo da aba é ignorado (o cabeçalho é localizado pelo nome das colunas).
 */

export const COLUNAS_VALOR = ["APAGAR", "SICREDI", "UNILOS", "QUIOSQUE", "CARTAO"] as const;
export type ColunaValor = (typeof COLUNAS_VALOR)[number];
export const ROTULO_COLUNA: Record<ColunaValor, string> = { APAGAR: "A pagar", SICREDI: "Sicredi", UNILOS: "Unilos", QUIOSQUE: "Quiosque", CARTAO: "Cartão" };

/** Layout antigo (AGO/SET e "jan a out"): SAIDA SIC (positivo = saída) e ENTR SIC (positivo = entrada) no lugar de SICREDI. */
const RX_SAIDA_SIC = /^SAIDA SIC$/;
const RX_ENTR_SIC = /^ENTR(ADA)? SIC$/;

const RX_COLUNA: Array<[ColunaValor, RegExp]> = [
  ["APAGAR", /^A ?PAGAR$/], ["SICREDI", /^SICREDI$/], ["UNILOS", /^UNILOS$/], ["QUIOSQUE", /^(QUIOSQUE|QUIO|DINHEIRO)$/], ["CARTAO", /^CARTAO$/],
];

export interface LinhaPlanilha {
  /** Número da linha no arquivo (1 = primeira). */
  numero: number;
  data: string | null;
  /** Texto original da coluna DATA e da coluna MÊS (para a conferência de qualidade). */
  dataTexto: string;
  mes: string;
  conta: string;
  grupo: string;
  categoria: string;
  fornecedor: string;
  descricao: string;
  /** Texto bruto da coluna OBS — pode ter CPF/CNPJ/e-mail/telefone: nunca vai para descrição, log ou auditoria. */
  obs: string;
  valores: Partial<Record<ColunaValor, number>>;
  /** Linha "AAA SALDO": saldo inicial por conta. */
  saldo: boolean;
}

export interface PlanilhaLida {
  /** NOVO: A PAGAR | SICREDI | UNILOS | QUIOSQUE | CARTÃO (saídas negativas). ANTIGO: SAÍDA SIC e ENTR SIC (positivos) + CARTÃO + UNILOS. */
  layout: "NOVO" | "ANTIGO";
  /** Linhas com valor e data vazia ou inválida (ex.: "03/06" sem ano, "31/082026"): ficam de fora e são mostradas na prévia. */
  datasInvalidas: Array<{ linha: number; texto: string }>;
  cabecalhoLinha: number;
  linhas: LinhaPlanilha[];
  ignoradas: Array<{ linha: number; motivo: string }>;
  erros: Array<{ linha: number; motivo: string }>;
  colunasNaoReconhecidas: string[];
}

/** Valor da planilha: " R$  1.234,56 ", "R$  (1.000,00)", " R$ - " (vazio), "-1000". null = inválido; undefined = vazio. */
export function valorPlanilha(texto: string): number | null | undefined {
  const t = texto.replace(/R\$/gi, "").replace(/\s+/g, "");
  if (t === "" || t === "-" || t === "–") return undefined;
  return paraCentavos(t);
}

function separadorDoCabecalho(texto: string): string | undefined {
  for (const linha of texto.replace(/^﻿/, "").split(/\r?\n/)) {
    const n = normalizarTexto(linha);
    if (!/FORNECEDOR/.test(n) || !/DESCRI/.test(n)) continue;
    const cont = (ch: string) => linha.split(ch).length - 1;
    const melhor = [";", "\t", ","].map((ch) => [ch, cont(ch)] as const).sort((a, b) => b[1] - a[1])[0]!;
    if (melhor[1] > 0) return melhor[0];
  }
  return undefined;
}

const norm = (c: string | undefined) => normalizarTexto(c ?? "");

export function lerPlanilhaFinanceira(texto: string): PlanilhaLida {
  const linhas = lerCsv(texto, separadorDoCabecalho(texto));
  const iCab = linhas.findIndex((l) => {
    const c = l.map(norm);
    return c.some((x) => x === "FORNECEDOR") && c.some((x) => /^DESCRI/.test(x)) && c.some((x) => RX_COLUNA.some(([, rx]) => rx.test(x)) || RX_SAIDA_SIC.test(x) || RX_ENTR_SIC.test(x));
  });
  if (iCab < 0) throw new Error("Cabeçalho não encontrado: a planilha precisa ter as colunas DATA, CAT, FORNECEDOR, DESCRIÇÃO e ao menos uma de A PAGAR, SICREDI, UNILOS, QUIOSQUE ou CARTÃO.");
  const cab = linhas[iCab]!.map(norm);
  const achar = (rx: RegExp, excluir: number[] = []) => cab.findIndex((c, i) => !excluir.includes(i) && rx.test(c));
  const iData = achar(/^DATA$/);
  const iCat = achar(/^(CAT|CATEGORIA)$/);
  let iGrupo = achar(/^GRUPO$/);
  if (iGrupo < 0 && iCat > 0 && cab[iCat - 1] === "") iGrupo = iCat - 1;
  const iForn = achar(/^FORNECEDOR$/);
  const iDesc = achar(/^DESCRI/);
  const iObs = achar(/^OBS/);
  const iMes = achar(/^MES$/);
  const iConta = achar(/^CONTA$/);
  if (iData < 0) throw new Error("Coluna DATA não encontrada no cabeçalho.");
  if (iCat < 0) throw new Error("Coluna CAT (categoria) não encontrada no cabeçalho.");
  const colunas = new Map<ColunaValor, number>();
  cab.forEach((c, i) => { for (const [k, rx] of RX_COLUNA) if (rx.test(c) && !colunas.has(k)) colunas.set(k, i); });
  const iSaidaSic = achar(RX_SAIDA_SIC);
  const iEntrSic = achar(RX_ENTR_SIC);
  const layout: "NOVO" | "ANTIGO" = iSaidaSic >= 0 || iEntrSic >= 0 ? "ANTIGO" : "NOVO";
  if (layout === "ANTIGO" && !colunas.has("SICREDI")) colunas.set("SICREDI", iSaidaSic >= 0 ? iSaidaSic : iEntrSic);
  const conhecidas = new Set([iData, iCat, iGrupo, iForn, iDesc, iObs, iMes, iConta, iSaidaSic, iEntrSic, ...colunas.values()]);
  const colunasNaoReconhecidas = cab.map((c, i) => (c && !conhecidas.has(i) ? c : null)).filter((c): c is string => !!c);

  const lido: PlanilhaLida = { layout, datasInvalidas: [], cabecalhoLinha: iCab + 1, linhas: [], ignoradas: [], erros: [], colunasNaoReconhecidas };
  const celula = (l: string[], i: number) => (i >= 0 ? (l[i] ?? "").trim() : "");
  for (let i = iCab + 1; i < linhas.length; i++) {
    const l = linhas[i]!;
    const numero = i + 1;
    const textos = [iMes, iConta, iData, iGrupo, iCat, iForn, iDesc].map((j) => norm(celula(l, j)));
    const saldo = textos.some((t) => /^AAA SALDO\b/.test(t));
    const data = dataFlexivel(celula(l, iData));
    const valores: Partial<Record<ColunaValor, number>> = {};
    let invalido = false;
    if (layout === "ANTIGO") {
      // Sicredi = entrada − saída (os dois positivos na planilha antiga).
      const sa = valorPlanilha(celula(l, iSaidaSic));
      const en = valorPlanilha(celula(l, iEntrSic));
      if (sa === null || en === null) { lido.erros.push({ linha: numero, motivo: "Valor inválido na coluna SAÍDA SIC/ENTR SIC." }); continue; }
      const liquido = (en ?? 0) - (sa ?? 0);
      if (liquido !== 0) valores.SICREDI = liquido;
    }
    for (const [k, j] of colunas) {
      if (layout === "ANTIGO" && k === "SICREDI") continue;
      const v = valorPlanilha(celula(l, j));
      if (v === null) { invalido = true; lido.erros.push({ linha: numero, motivo: `Valor inválido na coluna ${ROTULO_COLUNA[k]}.` }); break; }
      if (v !== undefined && v !== 0) valores[k] = v;
    }
    if (invalido) continue;
    if (Object.keys(valores).length === 0) { if (l.some((c) => c.trim())) lido.ignoradas.push({ linha: numero, motivo: "Sem valor." }); continue; }
    if (!saldo && /^TOTAL/.test(norm(celula(l, iCat)))) { lido.ignoradas.push({ linha: numero, motivo: "Linha de total." }); continue; }
    if (!saldo && norm(celula(l, iConta)) === "AGE") { lido.ignoradas.push({ linha: numero, motivo: "Agenda (AGE): não é lançamento." }); continue; }
    if (!saldo && !data) { lido.datasInvalidas.push({ linha: numero, texto: celula(l, iData) }); continue; }
    lido.linhas.push({ numero, data, dataTexto: celula(l, iData), mes: celula(l, iMes), conta: celula(l, iConta), grupo: celula(l, iGrupo), categoria: celula(l, iCat), fornecedor: celula(l, iForn), descricao: celula(l, iDesc), obs: celula(l, iObs), valores, saldo });
  }
  return lido;
}

// ---------------------------------------------------------------- dicionário de sinônimos

export type TipoSinonimo = "GRUPO" | "CATEGORIA";
export interface Sinonimo {
  tipo: TipoSinonimo;
  /** GRUPO: texto do grupo como aparece na planilha. CATEGORIA: "GRUPO|CATEGORIA" (grupo canônico ou "*"; "GRUPO|*" = padrão do grupo). */
  texto: string;
  /** GRUPO: grupo canônico. CATEGORIA: código da categoria, "@TRANSFERENCIA" (movimento entre contas) ou "@IGNORAR". */
  alvo: string;
}

export const GRUPOS_CANONICOS = ["RECEITA", "FROTA", "RH", "FIXO", "ADM", "PESSOAL", "TAXAS", "IMPOSTOS", "POSTO", "AGENDA", "APLICACAO", "QUIO"] as const;
export const ALVO_TRANSFERENCIA = "@TRANSFERENCIA";
export const ALVO_IGNORAR = "@IGNORAR";
/** Aplicação e resgate: movimento entre a conta e a conta Aplicação (investimento); não é receita nem despesa. */
export const ALVO_APLICACAO = "@APLICACAO";

const G = (texto: string, alvo: string): Sinonimo => ({ tipo: "GRUPO", texto: normalizarTexto(texto), alvo });
const C = (texto: string, alvo: string): Sinonimo => ({ tipo: "CATEGORIA", texto: normalizarTexto(texto), alvo });

/** Sinônimos de fábrica (variações e erros de digitação da planilha → grupo e categoria certos). Editáveis na tela. */
export const SINONIMOS_PADRAO: readonly Sinonimo[] = [
  ...GRUPOS_CANONICOS.map((g) => G(g, g)),
  G("RECEIRA", "RECEITA"), G("RECEITAS", "RECEITA"), G("FOTA", "FROTA"), G("RH - BC", "RH"), G("RH BC", "RH"), G("PESS", "PESSOAL"),
  G("TAXA", "TAXAS"), G("IMPOSTO", "IMPOSTOS"), G("TRIBUTOS", "IMPOSTOS"), G("TRIBUTO", "IMPOSTOS"), G("APLICAÇÃO", "APLICACAO"), G("QUIOSQUE", "QUIO"),
  // padrões por grupo
  C("PESSOAL|*", "DESP_PESSOAL"), C("IMPOSTOS|*", "DESP_IMPOSTOS"), C("TAXAS|*", "DESP_TAXAS"), C("POSTO|*", "DESP_COMBUSTIVEL"), C("APLICACAO|*", ALVO_APLICACAO),
  C("QUIO|DESPESA", "DESP_QUIOSQUE"), C("QUIO|RECEITA", "REC_QUIOSQUE"),
  // frota
  C("FROTA|MANUTENCAO", "DESP_MANUTENCAO"), C("FROTA|POSTO", "DESP_COMBUSTIVEL"), C("FROTA|POSTO BC", "DESP_COMBUSTIVEL_BC"), C("FROTA|COMBUSTIVEL", "DESP_COMBUSTIVEL"),
  C("FROTA|MOTORISTA R", "DESP_MOTORISTA_R"), C("FROTA|LAVACAO", "DESP_LAVACAO"), C("FROTA|DESLOCAMENTO", "DESP_DESLOCAMENTO"), C("FROTA|LOCACAO", "DESP_LOCACAO"),
  C("FROTA|MULTA", "DESP_MULTA"), C("*|RASTREADOR", "DESP_RASTREADOR"), C("FROTA|IPVA", "DESP_IPVA"), C("FROTA|LICENCIAMENTO", "DESP_LICENCIAMENTO"),
  C("FROTA|VISTORIA", "DESP_VISTORIA"), C("FROTA|PNEUS", "DESP_PNEUS"), C("FROTA|RECAPAGEM", "DESP_PNEUS"), C("FROTA|PNEUS/RECAPAGEM", "DESP_PNEUS"), C("FROTA|PNEUS / RECAPAGEM", "DESP_PNEUS"),
  C("FROTA|INSUMOS", "DESP_INSUMOS"), C("FROTA|TOLDO", "DESP_TOLDO"), C("FROTA|EXTINTORES", "DESP_EXTINTORES"), C("FROTA|ALTERNADOR", "DESP_ALTERNADOR"),
  C("FROTA|RADIADOR", "DESP_RADIADOR"), C("FROTA|TACOGRAFO", "DESP_TACOGRAFO"), C("FROTA|BLU - PASSEIO", "DESP_PASSEIO_BLU"), C("FROTA|BC - PASSEIO", "DESP_PASSEIO_BC"),
  C("FROTA|PUBLICIDADE - LOGIKA CTBA", "DESP_MARKETING"), C("FROTA|PEDAGIO", "DESP_PEDAGIO"), C("FROTA|ESTACIONAMENTO", "DESP_PEDAGIO"),
  // RH
  C("RH|FOLHA", "DESP_SALARIOS"), C("RH|FOLHA CLT", "DESP_FOLHA_CLT"), C("RH|FOLHA PJ", "DESP_FOLHA_PJ"), C("RH|VALE", "DESP_VALE"), C("RH|BENEFICIO", "DESP_BENEFICIO"),
  C("RH|BENEFICIOS", "DESP_BENEFICIO"), C("RH|FERIAS", "DESP_FERIAS"), C("RH|EXAME", "DESP_EXAMES"), C("RH|EXAMES", "DESP_EXAMES"), C("RH|RESCISAO", "DESP_RESCISAO"),
  C("RH|SEG TRAB", "DESP_SEG_TRAB"), C("RH|COMISSAO", "DESP_COMISSAO_RH"), C("RH|UNIFORMES", "DESP_UNIFORMES"), C("RH|UNIFORME", "DESP_UNIFORMES"),
  C("RH|DECIMO TERCEIRO", "DESP_DECIMO_TERCEIRO"), C("RH|13", "DESP_DECIMO_TERCEIRO"), C("RH|DIARIA", "DESP_DIARIAS"), C("RH|DIARIAS", "DESP_DIARIAS"),
  // fixo
  C("FIXO|CONSORCIO", "DESP_CONSORCIO"), C("FIXO|EMPRESTIMO", "DESP_EMPRESTIMO"), C("FIXO|EMPRESTIMO TERRENO", "DESP_EMPRESTIMO_TERRENO"), C("FIXO|SEGURO", "DESP_SEGUROS"),
  C("FIXO|TRIBUTOS", "DESP_IMPOSTOS"), C("FIXO|AFILIADOS", "DESP_AFILIADOS"), C("FIXO|ALUGUEL", "DESP_ALUGUEL"),
  // administrativo
  C("ADM|TRANSF", ALVO_TRANSFERENCIA), C("ADM|TRANS ENTRE CONTAS", ALVO_TRANSFERENCIA), C("ADM|TRANSFERENCIA", ALVO_TRANSFERENCIA), C("ADM|QUIOSQUE", "DESP_QUIOSQUE"),
  C("ADM|TAXAS", "DESP_TAXAS"), C("ADM|DEVOLUCAO", "DESP_DEVOLUCAO"), C("ADM|COTAS", "DESP_COTAS"), C("ADM|HONORARIOS", "DESP_HONORARIOS"), C("ADM|EMISSAO NF", "DESP_EMISSAO_NF"),
  C("ADM|APLICACAO", ALVO_APLICACAO), C("ADM|EMPRESTIMO - TREM", "DESP_EMPRESTIMO"), C("ADM|MARKETING", "DESP_MARKETING"), C("ADM|SEGURO", "DESP_SEGUROS"),
  C("*|TRANSF", ALVO_TRANSFERENCIA), C("*|TRANS ENTRE CONTAS", ALVO_TRANSFERENCIA),
  // receita
  C("RECEITA|CLIENTE", "REC_CLIENTE"), C("RECEITA|CLIENTE - EMITIR NF", "REC_CLIENTE"), C("RECEITA|PARCEIRO", "REC_PARCEIRO"), C("RECEITA|ZOOP", "REC_PARCEIRO"), C("RECEITA|CIELO", "REC_PARCEIRO"),
  C("RECEITA|TRANSF", ALVO_TRANSFERENCIA), C("RECEITA|DEVOLUCAO", "REC_DEVOLUCAO"), C("RECEITA|PASSEIO", "REC_PASSEIO"), C("RECEITA|EXTRA", "REC_EXTRA"), C("RECEITA|RESGATE", ALVO_APLICACAO),
  C("RECEITA|APLICACAO", ALVO_APLICACAO), C("*|APLICACAO", ALVO_APLICACAO), C("*|RESGATE", ALVO_APLICACAO), C("*|RENDIMENTO", "REC_APLICACAO"),
  C("*|EMPRESTIMO", "DESP_EMPRESTIMO"), C("*|EPRESTIMO", "DESP_EMPRESTIMO"), C("*|CAPITAL DE GIRO", "DESP_EMPRESTIMO"), C("*|EMPRESTIMO TERRENO", "DESP_EMPRESTIMO_TERRENO"), C("*|TRANF", ALVO_TRANSFERENCIA),
  C("*|COMISSAO BETO CARREIRO", "DESP_COMISSAO_RH"), C("RECEITA|FRETAMENTO", "REC_FRETAMENTO"), C("RECEITA|PUBLICIDADE", "REC_PUBLICIDADE"),
  // pessoal
  C("PESSOAL|DESP DIRETA", "DESP_PESSOAL"),
];

export interface Dicionario {
  grupos: Map<string, string>;
  categorias: Map<string, string>;
}

export function montarDicionario(entradas: ReadonlyArray<Sinonimo>): Dicionario {
  const d: Dicionario = { grupos: new Map(), categorias: new Map() };
  for (const e of entradas) (e.tipo === "GRUPO" ? d.grupos : d.categorias).set(normalizarTexto(e.texto), e.alvo);
  return d;
}

export interface Classificacao {
  /** Chave normalizada "GRUPO|CATEGORIA" como veio na planilha (usada para mapear manualmente). */
  chave: string;
  grupoCanonico: string | null;
  /** Código da categoria, "@TRANSFERENCIA", "@IGNORAR" ou null (não reconhecido). */
  alvo: string | null;
}

export function classificar(grupo: string, categoria: string, dic: Dicionario): Classificacao {
  const g = normalizarTexto(grupo);
  const c = normalizarTexto(categoria);
  const canon = dic.grupos.get(g) ?? null;
  const chave = `${g || "?"}|${c || "?"}`;
  const tentativas: string[] = [];
  if (c) {
    if (canon) tentativas.push(`${canon}|${c}`);
    if (g) tentativas.push(`${g}|${c}`);
    tentativas.push(`*|${c}`);
  }
  if (canon) tentativas.push(`${canon}|*`);
  if (g) tentativas.push(`${g}|*`);
  for (const k of tentativas) {
    const alvo = dic.categorias.get(k);
    if (alvo) return { chave, grupoCanonico: canon, alvo };
  }
  // Reservas por palavra (grafias fora do dicionário): transferência, aplicação/resgate e empréstimo nunca são receita/despesa operacional.
  if (/TRANSF|TRANF|TRANS ENTRE/.test(c)) return { chave, grupoCanonico: canon, alvo: ALVO_TRANSFERENCIA };
  if (/APLICA|RESGATE/.test(c)) return { chave, grupoCanonico: canon, alvo: ALVO_APLICACAO };
  if (/EMPRESTIMO|EPRESTIMO|CAPITAL DE GIRO/.test(c)) return { chave, grupoCanonico: canon, alvo: "DESP_EMPRESTIMO" };
  return { chave, grupoCanonico: canon, alvo: null };
}

// ---------------------------------------------------------------- OBS: dados do favorecido (sensíveis)

export interface ObsSeparada {
  /** O que sobra do OBS sem os dados de contato (pode ficar vazio). */
  texto: string;
  documentos: string[];
  emails: string[];
  telefones: string[];
}

const RX_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const RX_CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const RX_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const RX_FONE = /(?:\+?55[\s-]?)?(?:\(\d{2}\)|\b\d{2})?[\s-]?9?\d{4}[\s-]?\d{4}\b/g;
const RX_ROTULOS = /\b(CPF|CNPJ|PIX|TEL|TELEFONE|FONE|CEL|CELULAR|WHATSAPP|ZAP|EMAIL|E-MAIL|CHAVE)\b\s*[:\-]?/gi;

/** Separa CPF/CNPJ, e-mail e telefone do texto livre do OBS. Nada disso pode ir para descrição, log ou auditoria. */
export function separarObs(obs: string): ObsSeparada {
  let resto = obs;
  const pegar = (rx: RegExp, lista: string[]) => { resto = resto.replace(rx, (m) => { lista.push(m.trim()); return " "; }); };
  const emails: string[] = [], documentos: string[] = [], telefones: string[] = [];
  pegar(RX_EMAIL, emails);
  pegar(RX_CNPJ, documentos);
  pegar(RX_CPF, documentos);
  pegar(RX_FONE, telefones);
  const texto = resto.replace(RX_ROTULOS, " ").replace(/[\s,;:|/\-–]+/g, " ").trim();
  return { texto, documentos, emails, telefones };
}

/** Placa de veículo (antiga ou Mercosul) dentro de um texto: "QJQ2A16", "ABC-1234". */
export function extrairPlaca(texto: string): string | null {
  const m = /\b([A-Z]{3})-?(\d[A-Z0-9]\d{2})\b/i.exec(texto);
  return m ? `${m[1]}${m[2]}`.toUpperCase() : null;
}
