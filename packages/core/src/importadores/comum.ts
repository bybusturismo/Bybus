import type { Canal, Categoria, TipoDocumento } from "../tipos.js";

/** Formato intermediário de toda importação, independente do canal. */
export interface ReservaImportada {
  canal: Canal;
  /** Código no canal de origem (ex.: VIA-107216084, código Paytour). Chave de idempotência. */
  codigoExterno: string;
  /** Outros códigos citados (ex.: BYB-T150688831, ref. externa da Viator). */
  referencias: string[];
  /** Data do passeio "AAAA-MM-DD". */
  data: string;
  /** Horário do passeio "HH:MM", se informado. */
  horario: string | null;
  produto: string;
  contatoNome: string;
  contatoTelefone: string | null;
  contatoEmail: string | null;
  /** Nome do ponto de embarque como veio no canal (será casado com a tabela de pontos). */
  pontoEmbarqueTexto: string | null;
  cancelada: boolean;
  observacoes: string | null;
  passageiros: Array<{
    nome: string;
    categoria: Categoria;
    documentoTipo: TipoDocumento | null;
    documento: string | null;
  }>;
  avisos: string[];
}

/** Converte rótulos de categoria (pt/en/es) para a categoria interna. */
export function categoriaPorRotulo(rotulo: string): Categoria | null {
  const r = rotulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  if (/^(adult|adulto|adultos|adults)$/.test(r)) return "ADULTO";
  if (/^(senior|seniors|idoso|idosos|melhor idade|terceira idade)$/.test(r)) return "SENIOR";
  if (/^(child|children|crianca|criancas|infantil|nino|ninos|youth|jovem)$/.test(r)) return "INFANTIL";
  if (/^(infant|infants|colo|bebe|bebes)$/.test(r)) return "COLO";
  if (/^(cortesia|free|gratuito|gratis)$/.test(r)) return "CORTESIA";
  return null;
}
