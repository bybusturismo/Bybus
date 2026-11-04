import type { Categoria } from "../tipos.js";
import { MAX_PASSAGEIROS_POR_RESERVA } from "./bokun-email.js";
import type { ReservaImportada } from "./comum.js";

/**
 * E-mail "nova reserva" da Decolar/Despegar (sistema PAM), enviado a contatofbyb@gmail.com
 * por "Despegar Argentina <noreply@decolar.com>", assunto "Decolar - Nova reserva ID: <ID Compra>".
 * Formato visto em 04/11/2026 (linhas "Rótulo: valor"):
 *   Titular da reserva: … (Contatar passageiro *) · Telefone: … · Passageiros: Adultos: 3 | Crianças: 0 | Infantes: 0
 *   Service id · Data de reserva · Código de reserva PAM · ID Compra Decolar · Lugar de compra · Canal: Despegar
 *   Produto comprado: … · Temporada · Data de excursão: 14/01/2025
 * Não traz horário nem ponto de embarque. [A CONFIRMAR] formato do e-mail de cancelamento.
 */

/**
 * Lê "Rótulo: valor" linha a linha (sem regex com retrocesso; ignora os asteriscos do negrito).
 * O texto do e-mail quebra linhas longas ("…Tour: Toda" + "ilha"): linha sem rótulo continua o campo anterior,
 * até uma linha em branco.
 */
function campos(corpo: string): Map<string, string> {
  const mapa = new Map<string, string>();
  let ultimo: string | null = null;
  for (const linha of corpo.split(/\r?\n/)) {
    const t = linha.replace(/[*_]/g, "").trim();
    if (!t) {
      ultimo = null;
      continue;
    }
    if (t.length > 500) continue;
    const i = t.indexOf(":");
    const rotulo = i >= 2 && i <= 40 ? t.slice(0, i).trim() : "";
    if (rotulo && /^[\p{L} ]+$/u.test(rotulo)) {
      const chave = rotulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (mapa.has(chave)) {
        ultimo = null;
        continue;
      }
      mapa.set(chave, t.slice(i + 1).trim());
      ultimo = chave;
    } else if (ultimo) {
      mapa.set(ultimo, `${mapa.get(ultimo)} ${t}`.trim());
    }
  }
  return mapa;
}

/** "Adultos: 3 | Crianças: 0 | Infantes: 0" → categorias. */
function passageiros(texto: string): Categoria[] {
  const lista: Categoria[] = [];
  const qtd = (rotulo: RegExp) => {
    const m = rotulo.exec(texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
    return m ? Math.min(Number(m[1]), MAX_PASSAGEIROS_POR_RESERVA) : 0;
  };
  const add = (n: number, c: Categoria) => { for (let i = 0; i < n && lista.length < MAX_PASSAGEIROS_POR_RESERVA; i++) lista.push(c); };
  add(qtd(/adultos?\s*:\s*(\d{1,3})/), "ADULTO");
  add(qtd(/criancas?\s*:\s*(\d{1,3})/), "INFANTIL");
  add(qtd(/infantes?\s*:\s*(\d{1,3})/), "COLO");
  return lista;
}

/** "14/01/2025" → "2025-01-14" */
function data(texto: string | undefined): string | null {
  const m = texto ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(texto) : null;
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : null;
}

export function ehEmailDecolar(assunto: string, corpo: string): boolean {
  return /id compra decolar|codigo de reserva pam/i.test(corpo.normalize("NFD").replace(/[̀-ͯ]/g, "")) || /decolar|despegar/i.test(assunto);
}

export function lerEmailDecolar(assunto: string, corpo: string): ReservaImportada | null {
  const c = campos(corpo);
  const idCompra = c.get("id compra decolar")?.replace(/\D/g, "");
  const pam = c.get("codigo de reserva pam")?.replace(/\D/g, "");
  const dia = data(c.get("data de excursao"));
  if ((!idCompra && !pam) || !dia) return null;

  const titular = (c.get("titular da reserva") ?? "").replace(/\s*\(.*$/, "").trim();
  const lista = passageiros(c.get("passageiros") ?? "");
  const avisos: string[] = [];
  if (lista.length === 0) avisos.push("Quantidade de passageiros não informada no e-mail — conferir no PAM.");
  const texto = `${assunto} ${corpo}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  return {
    canal: "DECOLAR",
    codigoExterno: `DEC-${idCompra || pam}`,
    referencias: [idCompra && `DEC-${idCompra}`, pam && `PAM-${pam}`].filter((r): r is string => !!r),
    data: dia,
    horario: null,
    produto: c.get("produto comprado") ?? "",
    contatoNome: titular,
    contatoTelefone: c.get("telefone") ? `+${c.get("telefone")!.replace(/\D/g, "")}` : null,
    contatoEmail: null,
    pontoEmbarqueTexto: null,
    // Só o assunto ou a frase de cancelamento contam (o rodapé pode citar "política de cancelamento").
    cancelada: !/nova reserva/.test(texto) && (/cancelad|anulad/.test(assunto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()) || /reserva (foi )?(cancelada|anulada)/.test(texto)),
    observacoes: [c.get("canal") && `Canal: ${c.get("canal")}`, c.get("lugar de compra") && `Compra: ${c.get("lugar de compra")}`].filter(Boolean).join(" · ") || null,
    passageiros: lista.map((categoria, i) => ({ nome: i === 0 ? titular : "", categoria, documentoTipo: null, documento: null })),
    avisos,
  };
}
