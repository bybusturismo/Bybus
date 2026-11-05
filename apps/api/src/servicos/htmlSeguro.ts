import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { criarLimpadorHtml, htmlVazio, MARCA_HTML, REGEX_ANEXO } from "@bybus/core";

/**
 * Limpeza do HTML das páginas da Biblioteca no servidor (DOMPurify 3.2.4 sobre jsdom), com as mesmas listas
 * de tags, atributos, estilos e classes do navegador (definidas em @bybus/core). Instância própria do DOMPurify.
 */
const janela = new JSDOM("").window;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const limpar = criarLimpadorHtml(createDOMPurify(janela as any) as never);

export function limparHtml(html: string): string {
  return limpar(html);
}

/** HTML vindo do editor → texto guardado (com a marca); vazio vira "". */
export function htmlParaGuardar(html: string): string {
  const limpo = limpar(html);
  return htmlVazio(limpo) ? "" : `${MARCA_HTML}${limpo}`;
}

/** Id dos anexos usados no HTML. */
export function anexosDoHtml(html: string): string[] {
  return [...html.matchAll(/\/api\/biblioteca\/anexos\/([0-9a-f-]{36})/gi)].map((m) => m[1]!.toLowerCase());
}

/** Tira do HTML as imagens e vídeos de um anexo (quando o anexo é excluído). */
export function removerAnexoDoHtml(html: string, anexoId: string): string {
  const doc = new JSDOM(`<body>${html}</body>`).window.document;
  for (const el of doc.querySelectorAll("img, video")) if (el.getAttribute("src")?.toLowerCase().endsWith(anexoId.toLowerCase())) el.remove();
  return doc.body.innerHTML;
}

/** Troca os ids de anexos (ao duplicar a página, as cópias recebem anexos novos). */
export function trocarAnexosNoHtml(html: string, mapa: Map<string, string>): string {
  return html.replace(/\/api\/biblioteca\/anexos\/([0-9a-f-]{36})/gi, (inteiro, id: string) => {
    const novo = mapa.get(id.toLowerCase());
    return novo ? `/api/biblioteca/anexos/${novo}` : inteiro;
  });
}

export const ehCaminhoDeAnexo = (s: string) => REGEX_ANEXO.test(s);
