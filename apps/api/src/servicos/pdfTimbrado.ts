import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import type { BlocoContrato } from "@bybus/core";

/**
 * PDF no papel timbrado da By Bus (13/11/2026): a folha A4 inteira do timbrado (cabeçalho com logo e rodapé com endereço e
 * redes) ao fundo de todas as páginas e o texto na área livre do meio. "**texto**" sai em negrito.
 */
let timbrado: Buffer | null = null;
function imagemTimbrado(): Buffer | null {
  if (timbrado) return timbrado;
  try {
    timbrado = readFileSync(fileURLToPath(new URL("../../recursos/timbrado-bybus.jpg", import.meta.url)));
  } catch {
    timbrado = null; // sem a imagem, o PDF sai em folha branca
  }
  return timbrado;
}

const A4 = { w: 595.28, h: 841.89 };
const MARGEM = { topo: 132, base: 128, esquerda: 62, direita: 56 };

/** Escreve um parágrafo com trechos em negrito (**…**). */
function escrever(doc: PDFKit.PDFDocument, texto: string, opcoes: PDFKit.Mixins.TextOptions & { tamanho?: number }) {
  const partes = texto.split(/(\*\*[^*]+\*\*)/).filter(Boolean);
  // O pdfkit descarta o espaço do começo de um trecho "continuado": leva o espaço para o fim do trecho anterior.
  for (let i = 1; i < partes.length; i++) {
    const m = /^\s+/.exec(partes[i]!);
    if (!m) continue;
    const ant = partes[i - 1]!;
    partes[i - 1] = ant.endsWith("**") ? `${ant.slice(0, -2)}${m[0]}**` : `${ant}${m[0]}`;
    partes[i] = partes[i]!.slice(m[0].length);
  }
  doc.fontSize(opcoes.tamanho ?? 10.5);
  partes.forEach((t, i) => {
    const negrito = t.startsWith("**") && t.endsWith("**");
    doc.font(negrito ? "Helvetica-Bold" : "Helvetica").text(negrito ? t.slice(2, -2) : t, { ...opcoes, continued: i < partes.length - 1 });
  });
}

export function gerarPdfTimbrado(titulo: string, blocos: BlocoContrato[], rodape?: string): Promise<Buffer> {
  return new Promise((ok, falha) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: MARGEM.topo, bottom: MARGEM.base, left: MARGEM.esquerda, right: MARGEM.direita }, info: { Title: titulo, Author: "By Bus Turismo" }, bufferPages: true });
    const partes: Buffer[] = [];
    doc.on("data", (b: Buffer) => partes.push(b));
    doc.on("end", () => ok(Buffer.concat(partes)));
    doc.on("error", falha);
    const fundo = imagemTimbrado();
    const pintarFundo = () => { if (fundo) doc.image(fundo, 0, 0, { width: A4.w, height: A4.h }); doc.x = MARGEM.esquerda; doc.y = MARGEM.topo; };
    pintarFundo();
    doc.on("pageAdded", pintarFundo);
    const largura = A4.w - MARGEM.esquerda - MARGEM.direita;
    for (const b of blocos) {
      if (b.tipo === "titulo") {
        doc.moveDown(0.3);
        escrever(doc, `**${b.texto}**`, { align: "center", width: largura, tamanho: 15 });
        doc.moveDown(0.8);
      } else if (b.tipo === "clausula") {
        if (doc.y > A4.h - MARGEM.base - 80) doc.addPage();
        doc.moveDown(0.6);
        escrever(doc, `**${b.texto}**`, { width: largura, tamanho: 11.5 });
        doc.moveDown(0.3);
      } else if (b.tipo === "paragrafo") {
        escrever(doc, b.texto, { align: "justify", width: largura, lineGap: 1.5 });
        doc.moveDown(0.45);
      } else {
        for (const parte of b.partes) {
          if (doc.y > A4.h - MARGEM.base - 110) doc.addPage();
          doc.moveDown(1.2);
          if (parte.papel) escrever(doc, `**${parte.papel}**`, { width: largura, tamanho: 11 });
          escrever(doc, parte.nome, { width: largura });
          for (const l of parte.linhas) {
            doc.moveDown(0.9);
            escrever(doc, l.endsWith(":") ? `${l} ________________________________________________` : l, { width: largura });
          }
        }
      }
    }
    if (rodape) {
      const total = doc.bufferedPageRange().count;
      for (let i = 0; i < total; i++) {
        doc.switchToPage(i);
        // Fora da margem de baixo: zera a margem enquanto escreve, senão o pdfkit abre uma página nova.
        const margemBase = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font("Helvetica").fontSize(7.5).fillColor("#555555").text(`${rodape} · página ${i + 1} de ${total}`, MARGEM.esquerda, A4.h - MARGEM.base + 6, { width: largura, align: "center", lineBreak: false });
        doc.fillColor("#000000");
        doc.page.margins.bottom = margemBase;
      }
    }
    doc.end();
  });
}
