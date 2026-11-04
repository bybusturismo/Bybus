export type AcessoPagina = "EQUIPE" | "RESTRITO";
export const ACESSOS_PAGINA = ["EQUIPE", "RESTRITO"] as const;

export interface PaginaBase {
  id: string;
  paiId: string | null;
  titulo: string;
  acesso: AcessoPagina;
  ordem: number;
}

export interface NoArvore<T extends PaginaBase> {
  pagina: T;
  filhos: NoArvore<T>[];
}

const porOrdem = (a: PaginaBase, b: PaginaBase) => a.ordem - b.ordem || a.titulo.localeCompare(b.titulo, "pt-BR");

/** Monta a árvore (raízes e filhos ordenados). Página cujo pai não está na lista vira raiz. */
export function montarArvore<T extends PaginaBase>(paginas: T[]): NoArvore<T>[] {
  const nos = new Map(paginas.map((p) => [p.id, { pagina: p, filhos: [] as NoArvore<T>[] }]));
  const raizes: NoArvore<T>[] = [];
  for (const p of [...paginas].sort(porOrdem)) {
    const no = nos.get(p.id)!;
    const pai = p.paiId ? nos.get(p.paiId) : undefined;
    (pai ? pai.filhos : raizes).push(no);
  }
  return raizes;
}

/** Cadeia do topo até a página (inclusive). Protegida contra ciclo. */
export function caminhoDaPagina<T extends PaginaBase>(paginas: T[], id: string): T[] {
  const mapa = new Map(paginas.map((p) => [p.id, p]));
  const cadeia: T[] = [];
  const vistos = new Set<string>();
  let atual = mapa.get(id);
  while (atual && !vistos.has(atual.id)) {
    vistos.add(atual.id);
    cadeia.unshift(atual);
    atual = atual.paiId ? mapa.get(atual.paiId) : undefined;
  }
  return cadeia;
}

/** Mover `id` para dentro de `novoPaiId` criaria um ciclo (o novo pai é a própria página ou descende dela)? */
export function criaCiclo(paginas: PaginaBase[], id: string, novoPaiId: string | null): boolean {
  if (!novoPaiId) return false;
  return caminhoDaPagina(paginas, novoPaiId).some((p) => p.id === id);
}

/** Acesso efetivo: basta uma página restrita no caminho para a página (e suas subpáginas) ficar restrita. */
export function acessoEfetivo(paginas: PaginaBase[], id: string): AcessoPagina {
  return caminhoDaPagina(paginas, id).some((p) => p.acesso === "RESTRITO") ? "RESTRITO" : "EQUIPE";
}

/** Trecho do texto em volta da primeira ocorrência do termo (sem a pontuação do Markdown). */
export function trechoDaBusca(texto: string, termo: string, tamanho = 140): string {
  const limpo = texto.replace(/[#>*_`|]/g, " ").replace(/\s+/g, " ").trim();
  const pos = limpo.toLocaleLowerCase("pt-BR").indexOf(termo.toLocaleLowerCase("pt-BR"));
  if (pos < 0) return limpo.slice(0, tamanho) + (limpo.length > tamanho ? "…" : "");
  const ini = Math.max(0, pos - Math.floor(tamanho / 3));
  return (ini > 0 ? "…" : "") + limpo.slice(ini, ini + tamanho) + (ini + tamanho < limpo.length ? "…" : "");
}

/** Escapa curingas do LIKE/ILIKE para busca literal. */
export function escaparLike(termo: string): string {
  return termo.replace(/[\\%_]/g, (c) => `\\${c}`);
}
