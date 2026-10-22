import type { Canal, Categoria } from "./tipos.js";

export interface ReservaParaDedupe {
  id: string;
  canal: Canal;
  codigoExterno?: string | null;
  /** Códigos de OTA citados em observação/voucher de uma reserva espelho da Paytour. */
  referencias?: string[];
  /** Canal de origem inferido (ex.: Paytour com documento fictício 1111 → VIATOR). */
  canalOrigem?: Canal | null;
  contatoNome: string;
  categorias: Categoria[];
}

function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function assinaturaCategorias(c: Categoria[]): string {
  return [...c].sort().join(",");
}

/**
 * Detecta possíveis duplicatas na mesma saída. Nunca junta sozinho — só sugere.
 * 1) Mesmo código externo citado em duas reservas (ex.: VIA-123 no Bokun e na observação da Paytour).
 * 2) Mesmo canal de origem, mesmo titular (nome normalizado) e mesma composição de categorias.
 */
export function detectarDuplicatas(reservas: ReservaParaDedupe[]): string[][] {
  const grupos: string[][] = [];
  const jaAgrupado = new Set<string>();

  const porCodigo = new Map<string, Set<string>>();
  for (const r of reservas) {
    const codigos = [r.codigoExterno, ...(r.referencias ?? [])].filter((c): c is string => !!c).map((c) => c.trim().toUpperCase());
    for (const c of codigos) {
      if (!porCodigo.has(c)) porCodigo.set(c, new Set());
      porCodigo.get(c)!.add(r.id);
    }
  }
  for (const ids of porCodigo.values()) {
    if (ids.size > 1) {
      const lista = [...ids].sort();
      if (lista.some((id) => !jaAgrupado.has(id))) {
        grupos.push(lista);
        lista.forEach((id) => jaAgrupado.add(id));
      }
    }
  }

  const porAssinatura = new Map<string, string[]>();
  for (const r of reservas) {
    if (jaAgrupado.has(r.id)) continue;
    const origem = r.canalOrigem ?? r.canal;
    if (origem === "PAYTOUR" || origem === "BALCAO") continue; // vendas diretas: famílias homônimas são comuns
    const chave = `${origem}|${normalizarNome(r.contatoNome)}|${assinaturaCategorias(r.categorias)}`;
    porAssinatura.set(chave, [...(porAssinatura.get(chave) ?? []), r.id]);
  }
  for (const ids of porAssinatura.values()) if (ids.length > 1) grupos.push(ids.sort());

  return grupos;
}

/** Extrai códigos de reserva de OTA citados em texto livre (ex.: "VIA-107216084", "BYB-T150688831"). */
export function extrairReferenciasOta(texto: string | null | undefined): string[] {
  if (!texto) return [];
  const encontrados = texto.toUpperCase().match(/\b(?:VIA|BYB|GYG|CIV|DEC)-?[A-Z]?\d{5,}\b/g) ?? [];
  return [...new Set(encontrados)];
}
