/**
 * Markdown da Biblioteca: analisador próprio que devolve uma árvore de dados (nunca HTML).
 * A tela monta elementos React a partir dela, então não existe `innerHTML` nem script possível.
 * Suporta: títulos, parágrafos, listas, citação, código, régua, tabela, negrito, itálico, código em linha e links.
 * HTML escrito no texto aparece como texto. Links só com http, https, mailto, tel ou caminho interno.
 */
export type Inline =
  | { t: "texto"; v: string }
  | { t: "negrito"; c: Inline[] }
  | { t: "italico"; c: Inline[] }
  | { t: "codigo"; v: string }
  | { t: "link"; href: string; c: Inline[] };

export type Bloco =
  | { t: "titulo"; nivel: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: "paragrafo"; c: Inline[] }
  | { t: "lista"; ordenada: boolean; itens: Inline[][] }
  | { t: "citacao"; c: Inline[] }
  | { t: "codigo"; v: string }
  | { t: "regua" }
  | { t: "tabela"; cabecalho: Inline[][]; linhas: Inline[][][] };

/** Endereço permitido em link: http(s), mailto, tel ou caminho interno ("/biblioteca/..."). Qualquer outro vira texto. */
export function hrefSeguro(href: string): string | null {
  const h = href.trim();
  if (/^\/(?![/\\])/.test(h)) return h;
  try {
    const u = new URL(h);
    return ["http:", "https:", "mailto:", "tel:"].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

const MAX_PROFUNDIDADE = 4;

export function analisarInline(s: string, profundidade = 0): Inline[] {
  const saida: Inline[] = [];
  let texto = "";
  const soltar = () => {
    if (texto) saida.push({ t: "texto", v: texto });
    texto = "";
  };
  let i = 0;
  while (i < s.length) {
    const resto = s.slice(i);
    let m: RegExpExecArray | null;
    if (s[i] === "\\" && i + 1 < s.length && /[\\`*_[\]()#|>-]/.test(s[i + 1]!)) {
      texto += s[i + 1];
      i += 2;
    } else if ((m = /^`([^`]+)`/.exec(resto))) {
      soltar();
      saida.push({ t: "codigo", v: m[1]! });
      i += m[0].length;
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(resto))) {
      soltar();
      const href = hrefSeguro(m[2]!);
      const filhos: Inline[] = profundidade < MAX_PROFUNDIDADE ? analisarInline(m[1]!, profundidade + 1) : [{ t: "texto", v: m[1]! }];
      if (href) saida.push({ t: "link", href, c: filhos });
      else saida.push(...filhos);
      i += m[0].length;
    } else if (profundidade < MAX_PROFUNDIDADE && (m = /^\*\*(?=\S)(.+?)(?<=\S)\*\*/.exec(resto))) {
      soltar();
      saida.push({ t: "negrito", c: analisarInline(m[1]!, profundidade + 1) });
      i += m[0].length;
    } else if (profundidade < MAX_PROFUNDIDADE && (m = /^\*(?=[^\s*])(.+?)(?<=[^\s*])\*/.exec(resto))) {
      soltar();
      saida.push({ t: "italico", c: analisarInline(m[1]!, profundidade + 1) });
      i += m[0].length;
    } else if (profundidade < MAX_PROFUNDIDADE && (i === 0 || /\W/.test(s[i - 1]!)) && (m = /^_(?=[^\s_])(.+?)(?<=[^\s_])_(?!\w)/.exec(resto))) {
      soltar();
      saida.push({ t: "italico", c: analisarInline(m[1]!, profundidade + 1) });
      i += m[0].length;
    } else {
      texto += s[i];
      i += 1;
    }
  }
  soltar();
  return saida;
}

const celulas = (linha: string) => linha.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const ehSeparadorTabela = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
const ITEM = /^\s*([-*+]|\d+[.)])\s+/;

export function analisarMarkdown(fonte: string): Bloco[] {
  const linhas = fonte.replace(/\r\n?/g, "\n").split("\n");
  const blocos: Bloco[] = [];
  let i = 0;
  const iniciaBloco = (l: string) => /^(#{1,6}\s|>|```|(-{3,}|\*{3,})\s*$)/.test(l) || ITEM.test(l);
  while (i < linhas.length) {
    const l = linhas[i]!;
    if (!l.trim()) {
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    if (l.trimStart().startsWith("```")) {
      const corpo: string[] = [];
      i++;
      while (i < linhas.length && !linhas[i]!.trimStart().startsWith("```")) corpo.push(linhas[i++]!);
      i++;
      blocos.push({ t: "codigo", v: corpo.join("\n") });
    } else if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) {
      blocos.push({ t: "titulo", nivel: m[1]!.length as 1, c: analisarInline(m[2]!) });
      i++;
    } else if (/^(-{3,}|\*{3,})\s*$/.test(l)) {
      blocos.push({ t: "regua" });
      i++;
    } else if (l.includes("|") && i + 1 < linhas.length && ehSeparadorTabela(linhas[i + 1]!)) {
      const cabecalho = celulas(l).map((c) => analisarInline(c));
      i += 2;
      const corpo: Inline[][][] = [];
      while (i < linhas.length && linhas[i]!.trim() && linhas[i]!.includes("|")) corpo.push(celulas(linhas[i++]!).map((c) => analisarInline(c)));
      blocos.push({ t: "tabela", cabecalho, linhas: corpo });
    } else if (l.startsWith(">")) {
      const corpo: string[] = [];
      while (i < linhas.length && linhas[i]!.startsWith(">")) corpo.push(linhas[i++]!.replace(/^>\s?/, ""));
      blocos.push({ t: "citacao", c: analisarInline(corpo.join(" ")) });
    } else if (ITEM.test(l)) {
      const ordenada = /^\s*\d/.test(l);
      const itens: Inline[][] = [];
      while (i < linhas.length && ITEM.test(linhas[i]!) && /^\s*\d/.test(linhas[i]!) === ordenada) {
        let item = linhas[i]!.replace(ITEM, "");
        i++;
        while (i < linhas.length && /^\s{2,}\S/.test(linhas[i]!) && !ITEM.test(linhas[i]!)) item += ` ${linhas[i++]!.trim()}`;
        itens.push(analisarInline(item));
      }
      blocos.push({ t: "lista", ordenada, itens });
    } else {
      const corpo: string[] = [l.trim()];
      i++;
      while (i < linhas.length && linhas[i]!.trim() && !iniciaBloco(linhas[i]!)) corpo.push(linhas[i++]!.trim());
      blocos.push({ t: "paragrafo", c: analisarInline(corpo.join(" ")) });
    }
  }
  return blocos;
}
