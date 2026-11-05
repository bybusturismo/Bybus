import createDOMPurify from "dompurify";
import { criarLimpadorHtml, htmlDoConteudo, MARCA_HTML } from "@bybus/core";

/**
 * Limpeza do HTML no navegador (DOMPurify 3.2.4), com as MESMAS listas do servidor (definidas em @bybus/core).
 * O servidor limpa de novo ao guardar; aqui a limpeza protege o que é mostrado e o que vai para o editor.
 */
let limpar: ((html: string) => string) | null = null;
function limpador() {
  limpar ??= criarLimpadorHtml(createDOMPurify(window) as never);
  return limpar;
}

export const limparHtmlNavegador = (html: string) => limpador()(html);

/** HTML limpo de qualquer página (nova em HTML ou antiga em Markdown), sem a marca, pronto para mostrar ou editar. */
export const htmlDaPagina = (conteudo: string) => limpador()(htmlDoConteudo(conteudo));

/** O que o editor devolve → o que se envia ao servidor (limpo; vazio vira ""). */
export function doEditor(html: string): string {
  const limpo = limpador()(html);
  const vazio = !/<(img|video|hr|table)\b/i.test(limpo) && limpo.replace(/<[^>]*>|&nbsp;|\s/g, "") === "";
  return vazio ? "" : `${MARCA_HTML}${limpo}`;
}
