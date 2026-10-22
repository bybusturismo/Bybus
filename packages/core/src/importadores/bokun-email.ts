import { categoriaPorRotulo, type ReservaImportada } from "./comum.js";
import type { Canal, Categoria } from "../tipos.js";

const MESES: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function tabela(corpo: string): Map<string, string> {
  const campos = new Map<string, string>();
  for (const linha of corpo.split(/\r?\n/)) {
    const m = /^\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$/.exec(linha);
    if (m) campos.set(m[1]!.toLowerCase(), m[2]!.replace(/\[\]\([^)]*\)/g, "").trim());
  }
  return campos;
}

/** "Sat 24.Oct '26 @ 08:00" → { data: "2026-10-24", horario: "08:00" } */
export function lerDataBokun(texto: string): { data: string; horario: string | null } | null {
  const m = /(\d{1,2})\.([A-Za-z]{3})\s+'(\d{2})(?:\s*@\s*(\d{1,2}:\d{2}))?/.exec(texto);
  if (!m) return null;
  const mes = MESES[m[2]!.toLowerCase()];
  if (!mes) return null;
  return { data: `20${m[3]}-${mes}-${m[1]!.padStart(2, "0")}`, horario: m[4] ? m[4].padStart(5, "0") : null };
}

/** "2 Adult, 1 Child" → [ADULTO, ADULTO, INFANTIL] */
export function lerPax(texto: string): { categorias: Categoria[]; desconhecidos: string[] } {
  const categorias: Categoria[] = [];
  const desconhecidos: string[] = [];
  for (const parte of texto.split(/[,;]/)) {
    const m = /(\d+)\s*x?\s*(.+)/i.exec(parte.trim());
    if (!m) continue;
    const cat = categoriaPorRotulo(m[2]!);
    if (!cat) desconhecidos.push(m[2]!.trim());
    for (let i = 0; i < Number(m[1]); i++) categorias.push(cat ?? "ADULTO");
  }
  return { categorias, desconhecidos };
}

function canalPorVendedor(vendedor: string): Canal {
  const v = vendedor.toLowerCase();
  if (v.includes("viator") || v.includes("tripadvisor")) return "VIATOR";
  if (v.includes("civitatis")) return "CIVITATIS";
  if (v.includes("decolar") || v.includes("despegar")) return "DECOLAR";
  return "OUTRO";
}

/** "Wilson, Carla" → "Carla Wilson" */
function nomeCliente(texto: string): string {
  const [sobrenome, nome] = texto.split(",").map((s) => s.trim());
  return nome ? `${nome} ${sobrenome}` : texto.trim();
}

/**
 * Lê o e-mail de notificação da Bókun ("New booking" / "Cancelled booking") enviado ao Gmail da empresa.
 * Retorna null se o texto não for uma notificação de reserva reconhecível.
 */
export function lerEmailBokun(assunto: string, corpo: string): ReservaImportada | null {
  const c = tabela(corpo);
  const ref = c.get("booking ref.");
  const dataTexto = c.get("date");
  if (!ref || !dataTexto) return null;
  const quando = lerDataBokun(dataTexto);
  if (!quando) return null;

  const avisos: string[] = [];
  const pax = lerPax(c.get("pax") ?? "");
  if (pax.desconhecidos.length) avisos.push(`Categoria desconhecida tratada como adulto: ${pax.desconhecidos.join(", ")}`);
  if (pax.categorias.length === 0) avisos.push("Quantidade de passageiros não encontrada no e-mail.");

  const contatoNome = nomeCliente(c.get("customer") ?? "");
  const telefone = c.get("customer phone") || null;
  const email = c.get("customer email") || null;
  const canal = canalPorVendedor(c.get("booking channel") || c.get("sold by") || "");
  const cancelada = /cancel/i.test(assunto) || /cancel/i.test(c.get("status") ?? "");

  const referencias = [c.get("product booking ref."), c.get("ext. booking ref")]
    .filter((x): x is string => !!x)
    .map((x) => x.replace(/\s+/g, ""));

  return {
    canal,
    codigoExterno: ref,
    referencias,
    data: quando.data,
    horario: quando.horario,
    produto: c.get("product") ?? "",
    contatoNome,
    contatoTelefone: telefone,
    contatoEmail: email,
    pontoEmbarqueTexto: c.get("pick-up") || c.get("pickup") || c.get("meeting point") || null,
    cancelada,
    observacoes: null,
    // Nome de cada passageiro não vem no e-mail: o titular fica no primeiro; os demais ficam "a informar".
    passageiros: pax.categorias.map((categoria, i) => ({
      nome: i === 0 ? contatoNome : "",
      categoria,
      documentoTipo: null,
      documento: null,
    })),
    avisos,
  };
}
