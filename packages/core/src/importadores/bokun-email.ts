import { categoriaPorRotulo, type ReservaImportada } from "./comum.js";
import type { Canal, Categoria } from "../tipos.js";
import { dataHoraBrasiliaParaUtc, lerValorBokun, type VendaImportada } from "../vendas/vendas.js";

const MESES: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function tabela(corpo: string): Map<string, string> {
  const campos = new Map<string, string>();
  for (const linha of corpo.split(/\r?\n/)) {
    // Sem regex de backtracking (evita ReDoS com linhas maliciosas).
    const t = linha.trim();
    if (t.length < 3 || t.length > 2000 || !t.startsWith("|") || !t.endsWith("|")) continue;
    const [chave, ...resto] = t.slice(1, -1).split("|");
    if (!chave || resto.length === 0) continue;
    campos.set(chave.trim().toLowerCase(), resto.join("|").trim().replace(/\[\]\([^)\s]*\)/g, "").trim());
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

/** "Wed, October 21 2026 @ 05:07" → ISO UTC (lido como horário de Brasília — [A CONFIRMAR] o fuso da conta Bókun). */
export function lerCriacaoBokun(texto: string): string | null {
  const m = /([A-Za-z]{3})[a-z]*\s+(\d{1,2})\s+(\d{4})(?:\s*@\s*(\d{1,2}):(\d{2}))?/.exec(texto);
  const mes = m ? MESES[m[1]!.toLowerCase()] : undefined;
  if (!m || !mes) return null;
  return dataHoraBrasiliaParaUtc(`${m[3]}-${mes}-${m[2]!.padStart(2, "0")} ${(m[4] ?? "12").padStart(2, "0")}:${m[5] ?? "00"}`);
}

/** "2 Adult, 1 Child" → [ADULTO, ADULTO, INFANTIL] */
/** Limite de passageiros por reserva importada (protege contra arquivos/e-mails malformados). */
export const MAX_PASSAGEIROS_POR_RESERVA = 80;

export function lerPax(texto: string): { categorias: Categoria[]; desconhecidos: string[] } {
  const categorias: Categoria[] = [];
  const desconhecidos: string[] = [];
  for (const parte of texto.slice(0, 500).split(/[,;]/)) {
    const m = /^(\d{1,6})\s*x?\s*(\S.{0,60})$/i.exec(parte.trim());
    if (!m) continue;
    const cat = categoriaPorRotulo(m[2]!);
    if (!cat) desconhecidos.push(m[2]!.trim());
    const qtd = Math.min(Number(m[1]), MAX_PASSAGEIROS_POR_RESERVA - categorias.length);
    for (let i = 0; i < qtd; i++) categorias.push(cat ?? "ADULTO");
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

  // Valor: o e-mail da Bókun pode trazer o total da reserva (chaves a confirmar com um e-mail real). Só em reais.
  const textoValor = ["total", "total price", "total amount", "price", "amount", "gross price", "sell price", "total paid"].map((k) => c.get(k)).find((v) => !!v);
  const valor = lerValorBokun(textoValor);
  if (textoValor && valor.centavos === null) avisos.push(valor.moeda && valor.moeda !== "BRL" ? `Valor em ${valor.moeda} não convertido: reserva ficou sem valor em R$.` : "Valor do e-mail não reconhecido: reserva ficou sem valor.");
  const criada = lerCriacaoBokun(c.get("created") ?? "");
  const venda: VendaImportada | null = valor.centavos === null ? null : {
    pedidoCodigo: ref, fonte: "BOKUN_EMAIL", canalVenda: "OTA", valorCentavos: valor.centavos, subtotalCentavos: valor.centavos, descontoCentavos: 0,
    cupomExternoId: null, metodoPagamento: null, metodoPagamentoExterno: null, tipoPagamento: null, parcelas: null, dataHoraCompra: criada,
    operadorId: null, afiliadoId: null, afiliadoComissaoCentavos: null, parceiroId: null, parceiroComissaoCentavos: null, pagamentoPendenteCentavos: 0,
    utmSource: null, utmMedium: null, utmCampaign: null, clienteCidade: null,
  };

  return {
    canal,
    valorCentavos: venda?.valorCentavos ?? null,
    descontoCentavos: 0,
    venda,
    // Reserva de OTA chega paga no canal.
    pagamento: "PAGO",
    formaPagamento: canal === "VIATOR" ? "Pago na Viator" : "Pago no canal",
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
