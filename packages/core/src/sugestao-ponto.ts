/**
 * Sugestão do ponto de embarque pelo que o passageiro informa (hotel, pousada, bairro ou endereço).
 * Usa só o que está na descrição oficial de cada ponto (nome + "próximo aos hotéis …" + bairros dos transfers).
 * Sem coordenadas confirmadas dos pontos, não calcula distância: se nada combinar, devolve vazio
 * e o passageiro escolhe na lista (um colaborador confere depois).
 */

export interface PontoParaSugestao {
  id: string;
  nome: string;
  endereco: string | null;
  horario: string;
  ehTransfer: boolean;
}

export interface SugestaoPonto {
  pontoId: string;
  /** Termo da descrição oficial que combinou (ex.: "Mercure Convention"). */
  porque: string;
  pontuacao: number;
}

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Palavras genéricas que não identificam um lugar. */
const GENERICAS = new Set(["hotel", "hoteis", "pousada", "hostel", "proximo", "proximos", "aos", "ao", "dos", "das", "de", "da", "do", "e", "em", "frente", "rua", "av", "avenida", "praca", "praia", "fundos", "esquina", "com", "parte", "centro", "transfer", "custo", "adicional", "ponto", "taxi", "escola", "shopping", "metropolitana"]);

/** Nomes de lugar citados na descrição: o nome do ponto e cada item das listas "próximo aos hotéis A, B e C". */
export function lugaresDoPonto(p: Pick<PontoParaSugestao, "nome" | "endereco">): string[] {
  const texto = `${p.nome} — ${p.endereco ?? ""}`.replace(/\([^)]*\)/g, (m) => `, ${m.slice(1, -1)},`);
  return texto
    .split(/[,;—–()]| e | próximo aos? | proximo aos? | perto d[oae]s? | ao lado d[oae]s? /i)
    .map((t) => t.replace(/^(hot[eé]is|hotel|pousada)\s+/i, "").trim())
    .filter((t) => t.length >= 3 && !/^\d/.test(t) && !/^\d{1,2}h/.test(t));
}

export function sugerirPontos(consulta: string, pontos: PontoParaSugestao[], limite = 3): SugestaoPonto[] {
  const alvo = ` ${normalizar(consulta.slice(0, 200))} `;
  if (alvo.trim().length < 3) return [];
  const resultado: SugestaoPonto[] = [];
  for (const p of pontos) {
    let melhor: SugestaoPonto | null = null;
    for (const lugar of lugaresDoPonto(p)) {
      const palavras = normalizar(lugar).split(" ").filter((w) => w.length >= 3 && !GENERICAS.has(w));
      if (palavras.length === 0) continue;
      const achadas = palavras.filter((w) => alvo.includes(` ${w} `));
      if (achadas.length === 0) continue;
      // Todas as palavras do nome do lugar valem mais; nomes com mais palavras (mais específicos) desempatam.
      const pontuacao = achadas.length / palavras.length + achadas.length * 0.1;
      if (!melhor || pontuacao > melhor.pontuacao) melhor = { pontoId: p.id, porque: lugar, pontuacao };
    }
    if (melhor && melhor.pontuacao >= 0.5) resultado.push(melhor);
  }
  return resultado.sort((a, b) => b.pontuacao - a.pontuacao).slice(0, limite);
}
