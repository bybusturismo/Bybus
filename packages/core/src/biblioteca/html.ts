import { analisarMarkdown, type Bloco, type Inline } from "./markdown.js";

/**
 * HTML das páginas da Biblioteca. O texto novo é guardado em HTML limpo (DOMPurify no servidor E no navegador, com as
 * MESMAS listas abaixo), começando por MARCA_HTML. Páginas antigas, em Markdown, continuam abrindo e viram HTML ao salvar.
 */
export const MARCA_HTML = "<!--html-->";

export const TAGS_HTML = [
  "p", "br", "h1", "h2", "h3", "blockquote", "strong", "b", "em", "i", "u", "s", "strike", "span", "a", "ul", "ol", "li", "hr",
  "table", "thead", "tbody", "tr", "th", "td", "img", "video", "div", "pre", "code",
] as const;
export const ATRIBUTOS_HTML = ["href", "src", "alt", "title", "colspan", "rowspan", "class", "style", "controls", "target", "rel"] as const;
/** Únicas classes aceitas (quebra de página e bloco de vídeo). */
export const CLASSES_HTML = ["quebra-pagina", "bib-video"] as const;
/** Imagens e vídeos só podem apontar para anexos da própria Biblioteca. */
export const REGEX_ANEXO = /^\/api\/biblioteca\/anexos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Links: http(s), mailto, tel ou caminho interno. */
export const REGEX_LINK = /^(?:https?:\/\/|mailto:|tel:|\/(?![/\\]))/i;

const COR = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+\s*)?\)|[a-z]{3,20})$/i;
const TAMANHO = /^(?:\d{1,3}(?:\.\d{1,2})?(?:px|em|rem|%|pt)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large)$/i;

/** Mantém só propriedades de estilo inofensivas (cor, alinhamento, tamanho e destaque do texto). Nunca `url()`. */
export function limparEstilo(valor: string): string {
  const saida: string[] = [];
  for (const parte of valor.split(";")) {
    const i = parte.indexOf(":");
    if (i < 0) continue;
    const prop = parte.slice(0, i).trim().toLowerCase();
    const v = parte.slice(i + 1).trim();
    if (!v || /url\s*\(|expression|[\\<>@{}]|\/\*|javascript|!important/i.test(v)) continue;
    const ok =
      ((prop === "color" || prop === "background-color") && COR.test(v)) ||
      (prop === "text-align" && /^(left|right|center|justify)$/i.test(v)) ||
      (prop === "font-size" && TAMANHO.test(v)) ||
      (prop === "font-weight" && /^(bold|normal|[1-9]00)$/i.test(v)) ||
      (prop === "font-style" && /^(italic|normal)$/i.test(v)) ||
      (prop === "text-decoration" && /^(underline|line-through|none)$/i.test(v));
    if (ok) saida.push(`${prop}: ${v}`);
  }
  return saida.join("; ");
}

export function limparClasses(valor: string): string {
  return valor.split(/\s+/).filter((c) => (CLASSES_HTML as readonly string[]).includes(c)).join(" ");
}

/** O que o DOMPurify (de qualquer ambiente) precisa para aplicar as regras acima. */
export interface PurifyLike {
  sanitize(html: string, config: Record<string, unknown>): string | { toString(): string };
  addHook(nome: string, fn: (node: any, data: any) => void): void;
}

/** Monta a função de limpeza em cima de uma instância própria do DOMPurify (os ganchos ficam só nela). */
export function criarLimpadorHtml(purify: PurifyLike): (html: string) => string {
  purify.addHook("uponSanitizeAttribute", (_no, d) => {
    const nome = String(d.attrName);
    const v = String(d.attrValue);
    if (nome === "style") {
      d.attrValue = limparEstilo(v);
      if (!d.attrValue) d.keepAttr = false;
    } else if (nome === "class") {
      d.attrValue = limparClasses(v);
      if (!d.attrValue) d.keepAttr = false;
    } else if (nome === "src") {
      if (!REGEX_ANEXO.test(v.trim())) d.keepAttr = false;
    } else if (nome === "href") {
      if (!REGEX_LINK.test(v.trim())) d.keepAttr = false;
    } else if (nome === "target" || nome === "rel") {
      d.keepAttr = false; // refeitos abaixo, sempre iguais
    }
  });
  purify.addHook("afterSanitizeAttributes", (no) => {
    const tag = String(no.tagName ?? "").toUpperCase();
    if (tag === "A" && no.hasAttribute?.("href")) {
      no.setAttribute("target", "_blank");
      no.setAttribute("rel", "noopener noreferrer");
    }
    if ((tag === "IMG" || tag === "VIDEO") && !no.hasAttribute?.("src")) no.parentNode?.removeChild(no);
    if (tag === "VIDEO") no.setAttribute("controls", "");
  });
  return (html) =>
    String(
      purify.sanitize(html, {
        ALLOWED_TAGS: [...TAGS_HTML],
        ALLOWED_ATTR: [...ATRIBUTOS_HTML],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
        KEEP_CONTENT: true,
      }),
    );
}

export const ehHtml = (conteudo: string) => conteudo.startsWith(MARCA_HTML);

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escaparHtml = (t: string) => t.replace(/[&<>"']/g, (c) => ESC[c]!);

function inlineParaHtml(itens: Inline[]): string {
  return itens
    .map((n) => {
      switch (n.t) {
        case "texto": return escaparHtml(n.v);
        case "negrito": return `<strong>${inlineParaHtml(n.c)}</strong>`;
        case "italico": return `<em>${inlineParaHtml(n.c)}</em>`;
        case "codigo": return `<code>${escaparHtml(n.v)}</code>`;
        case "link": return `<a href="${escaparHtml(n.href)}">${inlineParaHtml(n.c)}</a>`;
      }
    })
    .join("");
}

function blocoParaHtml(b: Bloco): string {
  switch (b.t) {
    case "titulo": return `<h${Math.min(3, b.nivel)}>${inlineParaHtml(b.c)}</h${Math.min(3, b.nivel)}>`;
    case "paragrafo": return `<p>${inlineParaHtml(b.c)}</p>`;
    case "lista": {
      const tag = b.ordenada ? "ol" : "ul";
      return `<${tag}>${b.itens.map((i) => `<li>${inlineParaHtml(i)}</li>`).join("")}</${tag}>`;
    }
    case "citacao": return `<blockquote>${inlineParaHtml(b.c)}</blockquote>`;
    case "codigo": return `<pre><code>${escaparHtml(b.v)}</code></pre>`;
    case "regua": return "<hr>";
    case "tabela":
      return `<table><thead><tr>${b.cabecalho.map((c) => `<th>${inlineParaHtml(c)}</th>`).join("")}</tr></thead><tbody>${b.linhas.map((l) => `<tr>${l.map((c) => `<td>${inlineParaHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
}

/** Markdown → HTML (tudo escapado; ainda passa pelo limpador antes de ser guardado ou mostrado). */
export function markdownParaHtml(md: string): string {
  return analisarMarkdown(md).map(blocoParaHtml).join("");
}

/** HTML de qualquer página (nova em HTML ou antiga em Markdown), SEM a marca. Ainda NÃO limpo. */
export function htmlDoConteudo(conteudo: string): string {
  return ehHtml(conteudo) ? conteudo.slice(MARCA_HTML.length) : markdownParaHtml(conteudo);
}

const ENTIDADES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** Texto puro de um HTML (para busca e trechos). */
export function htmlParaTexto(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre)>|<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTIDADES[e] ?? e)
    .replace(/\s+/g, " ")
    .trim();
}

/** Texto puro da página para a coluna de busca. */
export function textoDaPagina(conteudo: string): string {
  return ehHtml(conteudo) ? htmlParaTexto(conteudo.slice(MARCA_HTML.length)) : conteudo.replace(/[#>*_`|]/g, " ").replace(/\s+/g, " ").trim();
}

/** HTML sem conteúdo visível (só <p><br></p> e espaços)? */
export function htmlVazio(html: string): boolean {
  return !/<(img|video|hr|table)\b/i.test(html) && htmlParaTexto(html) === "";
}
