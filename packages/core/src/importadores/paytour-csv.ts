import { canalPorDocumentoFicticio, somenteDigitos, cpfValido } from "../documento.js";
import { extrairReferenciasOta } from "../dedupe.js";
import type { Canal, TipoDocumento } from "../tipos.js";
import { categoriaPorRotulo, type ReservaImportada } from "./comum.js";
import { MAX_PASSAGEIROS_POR_RESERVA } from "./bokun-email.js";
import { lerCsv } from "./csv.js";

/**
 * Mapeamento de colunas do relatório exportado da Paytour.
 * [A CONFIRMAR] O formato real do export ainda não foi visto; os nomes abaixo são os mais prováveis
 * e podem ser ajustados na tela de importação sem mudar código.
 */
export interface MapeamentoPaytour {
  codigo: string[];
  data: string[];
  horario: string[];
  produto: string[];
  nome: string[];
  documento: string[];
  telefone: string[];
  email: string[];
  categoria: string[];
  quantidade: string[];
  pontoEmbarque: string[];
  afiliado: string[];
  status: string[];
  observacoes: string[];
}

export const MAPEAMENTO_PAYTOUR_PADRAO: MapeamentoPaytour = {
  codigo: ["codigo", "código", "reserva", "nº reserva", "numero da reserva", "pedido", "id"],
  data: ["data", "data do passeio", "data da atividade", "data atividade"],
  horario: ["horario", "horário", "hora"],
  produto: ["atividade", "passeio", "produto"],
  nome: ["nome", "cliente", "passageiro", "nome do passageiro", "participante"],
  documento: ["documento", "cpf", "doc", "rg", "passaporte"],
  telefone: ["telefone", "celular", "whatsapp", "fone"],
  email: ["email", "e-mail"],
  categoria: ["categoria", "tarifa", "tipo", "tipo de ingresso"],
  quantidade: ["quantidade", "qtd", "qtde", "pax"],
  pontoEmbarque: ["ponto de embarque", "embarque", "local de embarque", "ponto"],
  afiliado: ["afiliado", "parceiro", "vendedor", "canal"],
  status: ["status", "situacao", "situação"],
  observacoes: ["observacoes", "observações", "obs", "voucher"],
};

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function indice(cabecalho: string[], nomes: string[]): number {
  const alvo = nomes.map(normalizar);
  return cabecalho.findIndex((c) => alvo.includes(normalizar(c)));
}

/** "24/10/2026" ou "2026-10-24" → "2026-10-24" */
export function lerDataBr(texto: string): string | null {
  const t = texto.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function canalPorAfiliado(afiliado: string): Canal | null {
  const a = afiliado.toLowerCase();
  if (a.includes("tripadvisor") || a.includes("viator")) return "VIATOR";
  if (a.includes("decolar")) return "DECOLAR";
  if (a.includes("civitatis")) return "CIVITATIS";
  return null;
}

function tipoDocumento(valor: string): TipoDocumento {
  const d = somenteDigitos(valor);
  if (d.length === 11 && cpfValido(d)) return "CPF";
  if (/^[A-Za-z]{1,2}\d{5,}$/.test(valor.replace(/\s/g, ""))) return "PASSAPORTE";
  return d.length === 11 ? "CPF" : "OUTRO";
}

export interface ResultadoImportacaoCsv {
  reservas: ReservaImportada[];
  erros: Array<{ linha: number; mensagem: string }>;
  colunasNaoEncontradas: Array<keyof MapeamentoPaytour>;
}

/**
 * Converte o CSV de reservas da Paytour em reservas importadas. Aceita uma linha por passageiro
 * (linhas com o mesmo código são agrupadas) ou uma linha por reserva com coluna "quantidade".
 * Reservas espelho de OTA (documento 1111/2222/3333 ou afiliado interno) recebem o canal de origem.
 */
export function lerCsvPaytour(texto: string, mapeamento: MapeamentoPaytour = MAPEAMENTO_PAYTOUR_PADRAO): ResultadoImportacaoCsv {
  const linhas = lerCsv(texto);
  const erros: ResultadoImportacaoCsv["erros"] = [];
  if (linhas.length < 2) return { reservas: [], erros: [{ linha: 1, mensagem: "Arquivo vazio ou sem dados." }], colunasNaoEncontradas: [] };

  const cab = linhas[0]!;
  const idx = Object.fromEntries(
    (Object.keys(mapeamento) as Array<keyof MapeamentoPaytour>).map((k) => [k, indice(cab, mapeamento[k])]),
  ) as Record<keyof MapeamentoPaytour, number>;
  const colunasNaoEncontradas = (Object.keys(idx) as Array<keyof MapeamentoPaytour>).filter((k) => idx[k] < 0);
  for (const obrig of ["codigo", "data", "nome"] as const) {
    if (idx[obrig] < 0) erros.push({ linha: 1, mensagem: `Coluna obrigatória não encontrada: ${obrig}` });
  }
  if (erros.length) return { reservas: [], erros, colunasNaoEncontradas };

  const val = (linha: string[], k: keyof MapeamentoPaytour) => (idx[k] >= 0 ? (linha[idx[k]] ?? "").trim() : "");
  const porCodigo = new Map<string, ReservaImportada>();

  linhas.slice(1).forEach((linha, i) => {
    const n = i + 2;
    const codigo = val(linha, "codigo");
    const data = lerDataBr(val(linha, "data"));
    if (!codigo) return erros.push({ linha: n, mensagem: "Linha sem código de reserva." });
    if (!data) return erros.push({ linha: n, mensagem: `Data inválida: "${val(linha, "data")}"` });

    const documentoBruto = val(linha, "documento");
    const afiliado = val(linha, "afiliado");
    const origemOta = canalPorDocumentoFicticio(documentoBruto) ?? canalPorAfiliado(afiliado);
    const ehFicticio = !!canalPorDocumentoFicticio(documentoBruto);
    const obs = val(linha, "observacoes");
    const statusTxt = normalizar(val(linha, "status"));

    let reserva = porCodigo.get(codigo);
    if (!reserva) {
      reserva = {
        canal: origemOta ?? "PAYTOUR",
        codigoExterno: `PAYTOUR-${codigo}`,
        referencias: extrairReferenciasOta(obs),
        data,
        horario: val(linha, "horario") || null,
        produto: val(linha, "produto"),
        contatoNome: val(linha, "nome"),
        contatoTelefone: val(linha, "telefone") || null,
        contatoEmail: val(linha, "email") || null,
        pontoEmbarqueTexto: val(linha, "pontoEmbarque") || null,
        cancelada: /cancel/.test(statusTxt) || /estorn/.test(statusTxt),
        observacoes: obs || null,
        passageiros: [],
        avisos: origemOta ? [`Reserva espelho de ${origemOta} lançada na Paytour.`] : [],
      };
      porCodigo.set(codigo, reserva);
    }

    const categoriaTxt = val(linha, "categoria");
    const categoria = categoriaTxt ? categoriaPorRotulo(categoriaTxt.split(/[\s-]/)[0] ?? categoriaTxt) ?? categoriaPorRotulo(categoriaTxt) : "ADULTO";
    if (categoriaTxt && !categoria) reserva.avisos.push(`Linha ${n}: categoria "${categoriaTxt}" desconhecida, tratada como adulto.`);
    const pedida = Math.max(1, Number.parseInt(val(linha, "quantidade") || "1", 10) || 1);
    const qtd = Math.min(pedida, MAX_PASSAGEIROS_POR_RESERVA - reserva.passageiros.length);
    if (qtd < pedida) reserva.avisos.push(`Linha ${n}: quantidade ${pedida} acima do limite de ${MAX_PASSAGEIROS_POR_RESERVA} por reserva — conferir.`);
    for (let q = 0; q < qtd; q++) {
      reserva.passageiros.push({
        nome: q === 0 ? val(linha, "nome") : "",
        categoria: categoria ?? "ADULTO",
        documentoTipo: documentoBruto && !ehFicticio && q === 0 ? tipoDocumento(documentoBruto) : null,
        documento: documentoBruto && !ehFicticio && q === 0 ? documentoBruto : null,
      });
    }
  });

  return { reservas: [...porCodigo.values()], erros, colunasNaoEncontradas };
}
