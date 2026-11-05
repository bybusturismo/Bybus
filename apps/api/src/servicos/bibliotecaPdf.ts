import PDFDocument from "pdfkit";
import { JSDOM } from "jsdom";

/**
 * PDF de uma página da Biblioteca (pdfkit, no servidor): título, texto formatado, títulos, listas, tabelas, imagens PNG/JPEG
 * e quebras de página. Vídeos viram um aviso. Recebe HTML já limpo; o acesso à página é conferido antes, na rota.
 */
export interface EntradaPdf {
  titulo: string;
  autor?: string | null;
  atualizadoEm: Date;
  html: string;
  /** Devolve os bytes do anexo (imagem) pelo id, ou null. */
  buscarImagem: (anexoId: string) => Promise<Buffer | null>;
}

// pdfkit usa as fontes padrão (WinAnsi): o que está fora disso (emoji etc.) é retirado em vez de sair com símbolo errado.
const EXTRA_WINANSI = new Set([..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"]);
const limparTexto = (t: string) => [...t.replace(/ /g, " ").replace(/[​-‍﻿]/g, "")].filter((c) => c.charCodeAt(0) < 256 || EXTRA_WINANSI.has(c)).join("");

interface Trecho { texto: string; negrito: boolean; italico: boolean; sublinhado: boolean; tachado: boolean; link?: string }
const fonte = (t: Pick<Trecho, "negrito" | "italico">, base = "Helvetica") =>
  base === "Courier" ? "Courier" : t.negrito ? (t.italico ? "Helvetica-BoldOblique" : "Helvetica-Bold") : t.italico ? "Helvetica-Oblique" : "Helvetica";

const BLOCOS = new Set(["P", "DIV", "H1", "H2", "H3", "BLOCKQUOTE", "UL", "OL", "LI", "HR", "TABLE", "PRE", "IMG", "VIDEO"]);

function trechos(no: Node, est: Omit<Trecho, "texto"> = { negrito: false, italico: false, sublinhado: false, tachado: false }): Trecho[] {
  const saida: Trecho[] = [];
  for (const f of Array.from(no.childNodes)) {
    if (f.nodeType === 3) {
      const texto = limparTexto((f.textContent ?? "").replace(/\s+/g, " "));
      if (texto) saida.push({ ...est, texto });
    } else if (f.nodeType === 1) {
      const el = f as Element;
      const tag = el.tagName;
      if (BLOCOS.has(tag)) continue;
      if (tag === "BR") { saida.push({ ...est, texto: "\n" }); continue; }
      const prox = { ...est };
      if (tag === "STRONG" || tag === "B") prox.negrito = true;
      if (tag === "EM" || tag === "I") prox.italico = true;
      if (tag === "U") prox.sublinhado = true;
      if (tag === "S" || tag === "STRIKE") prox.tachado = true;
      const st = el.getAttribute("style") ?? "";
      if (/font-weight:\s*(bold|[6-9]00)/i.test(st)) prox.negrito = true;
      if (/font-style:\s*italic/i.test(st)) prox.italico = true;
      if (/underline/i.test(st)) prox.sublinhado = true;
      if (/line-through/i.test(st)) prox.tachado = true;
      const href = tag === "A" ? el.getAttribute("href") ?? undefined : undefined;
      const filhos = trechos(el, prox);
      saida.push(...(href ? filhos.map((t) => ({ ...t, link: href, sublinhado: true })) : filhos));
    }
  }
  return saida;
}

type Doc = InstanceType<typeof PDFDocument>;

function escrever(doc: Doc, lista: Trecho[], opcoes: { tamanho: number; cor?: string; indent?: number; base?: string; largura?: number }) {
  const itens = lista.filter((t) => t.texto !== "");
  if (itens.length === 0) { doc.moveDown(0.4); return; }
  itens[0]!.texto = itens[0]!.texto.replace(/^\s+/, "");
  itens[itens.length - 1]!.texto = itens[itens.length - 1]!.texto.replace(/\s+$/, "");
  itens.forEach((t, i) => {
    doc.font(fonte(t, opcoes.base)).fontSize(opcoes.tamanho).fillColor(t.link ? "#0069ad" : (opcoes.cor ?? "#222222"));
    doc.text(t.texto, i === 0 ? doc.page.margins.left + (opcoes.indent ?? 0) : undefined, i === 0 ? undefined : undefined, {
      continued: i < itens.length - 1,
      underline: t.sublinhado,
      strike: t.tachado,
      link: t.link && /^https?:|^mailto:/i.test(t.link) ? t.link : undefined,
      width: opcoes.largura,
      lineGap: 2,
    });
  });
  doc.fillColor("#222222");
}

function textoSimples(el: Element): string {
  return limparTexto((el.textContent ?? "").replace(/\s+/g, " ").trim());
}

function tabela(doc: Doc, el: Element) {
  const linhas = Array.from(el.querySelectorAll("tr")).map((tr) => Array.from(tr.children).map((c) => ({ t: textoSimples(c), cab: c.tagName === "TH" })));
  if (linhas.length === 0) return;
  const colunas = Math.max(...linhas.map((l) => l.length));
  const largura = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const w = largura / colunas;
  const pad = 4;
  const x0 = doc.page.margins.left;
  for (const l of linhas) {
    const alt = Math.max(18, ...l.map((c) => doc.font(c.cab ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).heightOfString(c.t || " ", { width: w - pad * 2 }) + pad * 2));
    if (doc.y + alt > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    l.forEach((c, i) => {
      if (c.cab) doc.rect(x0 + i * w, y, w, alt).fill("#f1f1ef");
      doc.rect(x0 + i * w, y, w, alt).lineWidth(0.6).strokeColor("#cfcfcb").stroke();
      doc.font(c.cab ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor("#222222").text(c.t, x0 + i * w + pad, y + pad, { width: w - pad * 2 });
    });
    doc.x = x0;
    doc.y = y + alt;
  }
  doc.moveDown(0.6);
}

async function blocos(doc: Doc, pai: Element, ctx: { buscarImagem: EntradaPdf["buscarImagem"]; nivelLista: number }): Promise<void> {
  const esq = doc.page.margins.left;
  const largura = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  // texto solto entre blocos vira parágrafo
  let solto: Node[] = [];
  const soltarTexto = () => {
    if (solto.length === 0) return;
    const div = pai.ownerDocument.createElement("p");
    solto.forEach((n) => div.appendChild(n.cloneNode(true)));
    solto = [];
    const t = trechos(div);
    if (t.some((x) => x.texto.trim())) { escrever(doc, t, { tamanho: 10.5, indent: 0 }); doc.moveDown(0.5); }
  };
  for (const f of Array.from(pai.childNodes)) {
    const el = f.nodeType === 1 ? (f as Element) : null;
    if (!el || !BLOCOS.has(el.tagName)) { solto.push(f); continue; }
    soltarTexto();
    doc.x = esq;
    switch (el.tagName) {
      case "H1": case "H2": case "H3": {
        const tam = { H1: 18, H2: 15, H3: 12.5 }[el.tagName]!;
        doc.moveDown(0.5);
        escrever(doc, trechos(el, { negrito: true, italico: false, sublinhado: false, tachado: false }), { tamanho: tam, cor: "#111111" });
        doc.moveDown(0.3);
        break;
      }
      case "P": case "DIV": {
        if (el.classList.contains("quebra-pagina")) { doc.addPage(); break; }
        if (el.querySelector("img, video, table, ul, ol, h1, h2, h3, p")) { await blocos(doc, el, ctx); break; }
        escrever(doc, trechos(el), { tamanho: 10.5 });
        doc.moveDown(0.5);
        break;
      }
      case "BLOCKQUOTE":
        escrever(doc, trechos(el, { negrito: false, italico: true, sublinhado: false, tachado: false }), { tamanho: 10.5, cor: "#555555", indent: 14, largura: largura() - 14 });
        doc.moveDown(0.5);
        break;
      case "UL": case "OL": {
        let n = 0;
        for (const li of Array.from(el.children).filter((c) => c.tagName === "LI")) {
          n++;
          const recuo = 10 + ctx.nivelLista * 14;
          const t = trechos(li);
          t.unshift({ texto: el.tagName === "OL" ? `${n}.  ` : "•  ", negrito: false, italico: false, sublinhado: false, tachado: false });
          doc.x = esq;
          escrever(doc, t, { tamanho: 10.5, indent: recuo, largura: largura() - recuo });
          doc.moveDown(0.15);
          for (const sub of Array.from(li.children).filter((c) => c.tagName === "UL" || c.tagName === "OL")) {
            const caixa = li.ownerDocument.createElement("div");
            caixa.appendChild(sub.cloneNode(true));
            await blocos(doc, caixa, { ...ctx, nivelLista: ctx.nivelLista + 1 });
          }
        }
        doc.moveDown(0.4);
        break;
      }
      case "LI": escrever(doc, trechos(el), { tamanho: 10.5 }); break;
      case "HR":
        if (el.classList.contains("quebra-pagina")) doc.addPage();
        else doc.moveDown(0.3).moveTo(esq, doc.y).lineTo(esq + largura(), doc.y).lineWidth(0.6).strokeColor("#dddddd").stroke().moveDown(0.5);
        break;
      case "TABLE": tabela(doc, el); break;
      case "PRE":
        escrever(doc, [{ texto: limparTexto(el.textContent ?? ""), negrito: false, italico: false, sublinhado: false, tachado: false }], { tamanho: 9, base: "Courier", cor: "#333333" });
        doc.moveDown(0.5);
        break;
      case "IMG": {
        const id = el.getAttribute("src")?.match(/anexos\/([0-9a-f-]{36})/i)?.[1];
        const buf = id ? await ctx.buscarImagem(id.toLowerCase()) : null;
        const png = buf?.subarray(0, 4).toString("hex") === "89504e47";
        const jpg = buf?.subarray(0, 3).toString("hex") === "ffd8ff";
        if (buf && (png || jpg)) {
          try {
            const img = (doc as unknown as { openImage(b: Buffer): { width: number; height: number } }).openImage(buf);
            const escala = Math.min(1, largura() / img.width, 420 / img.height);
            const alt = img.height * escala;
            if (doc.y + alt > doc.page.height - doc.page.margins.bottom) doc.addPage();
            doc.image(buf, esq, doc.y, { width: img.width * escala, height: alt });
            doc.y += alt + 8;
            doc.x = esq;
            break;
          } catch { /* imagem inválida: cai no aviso */ }
        }
        doc.font("Helvetica-Oblique").fontSize(9.5).fillColor("#777777").text("[imagem não incluída no PDF]", esq);
        doc.fillColor("#222222").moveDown(0.4);
        break;
      }
      case "VIDEO":
        doc.font("Helvetica-Oblique").fontSize(9.5).fillColor("#777777").text("[vídeo: assista na página da Biblioteca]", esq);
        doc.fillColor("#222222").moveDown(0.4);
        break;
    }
  }
  soltarTexto();
}

export async function gerarPdfDaPagina(e: EntradaPdf): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: limparTexto(e.titulo), Producer: "Bybus Gestão" } });
  const partes: Buffer[] = [];
  doc.on("data", (c: Buffer) => partes.push(c));
  const pronto = new Promise<Buffer>((ok, erro) => { doc.on("end", () => ok(Buffer.concat(partes))); doc.on("error", erro); });
  doc.font("Helvetica-Bold").fontSize(22).fillColor("#111111").text(limparTexto(e.titulo) || "Página", { lineGap: 2 });
  const data = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(e.atualizadoEm);
  doc.font("Helvetica").fontSize(9).fillColor("#777777").text(`By Bus Turismo · Biblioteca · atualizada em ${data}${e.autor ? ` por ${limparTexto(e.autor)}` : ""}`).moveDown(1);
  const corpo = new JSDOM(`<body>${e.html}</body>`).window.document.body;
  await blocos(doc, corpo, { buscarImagem: e.buscarImagem, nivelLista: 0 });
  doc.end();
  return pronto;
}
