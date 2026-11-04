import { centavosParaTexto, diferencaDias } from "./dinheiro.js";
import { normalizarTexto } from "./extrato.js";
import type { TipoCategoria } from "./plano.js";

export interface LinhaParaConciliar {
  valorCentavos: number;
  data: string;
  descricao: string;
}

export interface LancamentoCandidato {
  id: string;
  tipo: "PAGAR" | "RECEBER";
  /** Valor devido (em aberto). */
  valorCentavos: number;
  vencimento: string;
  descricao: string;
  contraparte?: string | null;
}

export interface SugestaoConciliacao {
  lancamentoId: string;
  pontos: number;
  nivel: "ALTA" | "MEDIA" | "BAIXA";
  /** Valor da linha (absoluto) menos o valor do lançamento: positivo = pagou/recebeu a mais. */
  diferencaCentavos: number;
  motivos: string[];
}

const IGNORAR = new Set(["PIX", "TED", "DOC", "PAGAMENTO", "PAGTO", "COMPRA", "DEBITO", "CREDITO", "TRANSFERENCIA", "RECEBIDO", "ENVIADO", "BOLETO", "LTDA", "EIRELI", "COM", "DE", "DA", "DO", "DAS", "DOS", "CARTAO"]);

function palavras(s: string): Set<string> {
  return new Set(normalizarTexto(s).split(/[^A-Z0-9]+/).filter((p) => p.length >= 3 && !IGNORAR.has(p) && !/^\d+$/.test(p)));
}

/**
 * Sugere lançamentos em aberto para uma linha de extrato. SÓ SUGERE: nada é conciliado por aqui.
 * Saída (valor negativo) casa com contas a pagar; entrada, com contas a receber.
 * Pontos: valor exato 50 (aproximado até 10% de 5 a 35), data próxima até 30, nome parecido até 20. Mínimo para sugerir: 40.
 */
export function sugerirCorrespondencias(linha: LinhaParaConciliar, candidatos: LancamentoCandidato[], recusados: ReadonlySet<string> = new Set(), maximo = 5): SugestaoConciliacao[] {
  const valorLinha = Math.abs(linha.valorCentavos);
  const tipo = linha.valorCentavos < 0 ? "PAGAR" : "RECEBER";
  const nomeLinha = palavras(linha.descricao);
  const saida: SugestaoConciliacao[] = [];
  for (const c of candidatos) {
    if (c.tipo !== tipo || recusados.has(c.id)) continue;
    const motivos: string[] = [];
    let pontos = 0;
    const diferenca = valorLinha - c.valorCentavos;
    if (diferenca === 0) { pontos += 50; motivos.push("Valor exato"); }
    else {
      const rel = Math.abs(diferenca) / c.valorCentavos;
      if (rel > 0.1) continue;
      pontos += Math.round(35 - rel * 300); // 0% → 35; 10% → 5
      motivos.push(`Valor aproximado (${diferenca > 0 ? "+" : "−"}${centavosParaTexto(Math.abs(diferenca))})`);
    }
    const dias = Math.abs(diferencaDias(linha.data, c.vencimento));
    const ptsData = dias === 0 ? 30 : dias <= 3 ? 22 : dias <= 7 ? 14 : dias <= 15 ? 6 : dias <= 30 ? 2 : 0;
    if (ptsData > 0) { pontos += ptsData; motivos.push(dias === 0 ? "Mesma data do vencimento" : `Vencimento a ${dias} dia(s)`); }
    const nomeLanc = palavras(`${c.contraparte ?? ""} ${c.descricao}`);
    if (nomeLinha.size && nomeLanc.size) {
      const iguais = [...nomeLinha].filter((p) => nomeLanc.has(p)).length;
      if (iguais > 0) {
        pontos += Math.min(20, Math.round((iguais / Math.min(nomeLinha.size, nomeLanc.size)) * 20));
        motivos.push("Nome parecido");
      }
    }
    if (pontos < 40) continue;
    saida.push({ lancamentoId: c.id, pontos, nivel: pontos >= 80 ? "ALTA" : pontos >= 60 ? "MEDIA" : "BAIXA", diferencaCentavos: diferenca, motivos });
  }
  return saida.sort((a, b) => b.pontos - a.pontos || Math.abs(a.diferencaCentavos) - Math.abs(b.diferencaCentavos)).slice(0, maximo);
}

export interface RegraCategoria {
  id: string;
  /** Trecho que deve aparecer na descrição (sem diferenciar maiúsculas e acentos). */
  texto: string;
  tipo: TipoCategoria | null;
  categoriaId: string;
  prioridade: number;
}

/** Regra que casa com a descrição (a de texto mais longo vence; empate: maior prioridade). Só sugere, nunca aplica. */
export function sugerirCategoria(descricao: string, valorCentavos: number, regras: RegraCategoria[]): RegraCategoria | null {
  const d = normalizarTexto(descricao);
  const tipo: TipoCategoria = valorCentavos < 0 ? "DESPESA" : "RECEITA";
  let melhor: RegraCategoria | null = null;
  for (const r of regras) {
    const t = normalizarTexto(r.texto);
    if (!t || (r.tipo && r.tipo !== tipo) || !d.includes(t)) continue;
    if (!melhor || t.length > normalizarTexto(melhor.texto).length || (t.length === normalizarTexto(melhor.texto).length && r.prioridade > melhor.prioridade)) melhor = r;
  }
  return melhor;
}
