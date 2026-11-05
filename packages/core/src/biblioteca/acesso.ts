import { caminhoDaPagina, type AcessoPagina } from "./arvore.js";

export type NivelPessoa = "VER" | "EDITAR";
export const NIVEIS_PESSOA = ["VER", "EDITAR"] as const;

export interface PaginaAcesso {
  id: string;
  paiId: string | null;
  acesso: AcessoPagina;
}
export interface AcessoPessoa {
  paginaId: string;
  usuarioId: string;
  nivel: NivelPessoa;
}

/**
 * Quem pode ver e editar uma página.
 * - Quem tem `biblioteca:editar` (editorGeral) vê e edita tudo.
 * - A lista de pessoas da página mais próxima (ela mesma ou a ancestral mais perto que tenha lista) vale para as subpáginas.
 * - Pessoa na lista: VER lê, EDITAR lê e edita (mesmo em página restrita).
 * - Fora da lista: lê se nenhuma página do caminho for restrita; nunca edita.
 * A permissão `biblioteca:ver` (ou `editar`) continua sendo exigida pela rota antes de chegar aqui.
 */
export function calcularAcesso(
  paginas: PaginaAcesso[],
  acessos: AcessoPessoa[],
  usuario: { id: string; editorGeral: boolean },
  paginaId: string,
): { ver: boolean; editar: boolean } {
  if (usuario.editorGeral) return { ver: true, editar: true };
  const cadeia = caminhoDaPagina(paginas.map((p) => ({ ...p, titulo: "", ordem: 0 })), paginaId).reverse(); // da página até a raiz
  if (cadeia.length === 0) return { ver: false, editar: false };
  const restrita = cadeia.some((p) => p.acesso === "RESTRITO");
  const comLista = cadeia.find((p) => acessos.some((a) => a.paginaId === p.id));
  const nivel = comLista ? acessos.find((a) => a.paginaId === comLista.id && a.usuarioId === usuario.id)?.nivel : undefined;
  return { ver: nivel !== undefined || !restrita, editar: nivel === "EDITAR" };
}

/** Onde soltar uma página arrastada sobre outra: terço de cima/baixo = ordem; meio = vira subpágina. */
export type ZonaSoltura = "antes" | "dentro" | "depois";
export function zonaDeSoltura(y: number, topo: number, altura: number): ZonaSoltura {
  const f = altura > 0 ? (y - topo) / altura : 0.5;
  return f < 0.28 ? "antes" : f > 0.72 ? "depois" : "dentro";
}

export interface NoPlano {
  id: string;
  paiId: string | null;
  ordem: number;
  titulo?: string;
}

/** Descendentes (filhos, netos…) de uma página. */
export function descendentes(paginas: Array<{ id: string; paiId: string | null }>, id: string): Set<string> {
  const fora = new Set<string>();
  for (let achou = true; achou; ) {
    achou = false;
    for (const p of paginas) if (p.paiId && (p.paiId === id || fora.has(p.paiId)) && !fora.has(p.id)) { fora.add(p.id); achou = true; }
  }
  return fora;
}

/**
 * Resultado de arrastar `ativoId` sobre `alvoId`: novo pai e a irmã que fica logo depois (null = fim).
 * Devolve null quando a soltura não é permitida (sobre ela mesma ou sobre uma subpágina dela).
 */
export function destinoDoArraste(paginas: NoPlano[], ativoId: string, alvoId: string, zona: ZonaSoltura): { paiId: string | null; antesDe: string | null } | null {
  if (ativoId === alvoId || descendentes(paginas, ativoId).has(alvoId)) return null;
  const alvo = paginas.find((p) => p.id === alvoId);
  if (!alvo) return null;
  if (zona === "dentro") return { paiId: alvo.id, antesDe: null };
  const irmas = ordenarIrmas(paginas, alvo.paiId).filter((p) => p.id !== ativoId);
  const i = irmas.findIndex((p) => p.id === alvo.id);
  return { paiId: alvo.paiId, antesDe: zona === "antes" ? alvo.id : (irmas[i + 1]?.id ?? null) };
}

export function ordenarIrmas<T extends NoPlano>(paginas: T[], paiId: string | null): T[] {
  return paginas.filter((p) => p.paiId === paiId).sort((a, b) => a.ordem - b.ordem || (a.titulo ?? "").localeCompare(b.titulo ?? "", "pt-BR"));
}

/**
 * Nova numeração (1, 2, 3…) das irmãs de `paiId` depois de colocar `id` antes de `antesDe` (ou no fim).
 * Inclui as irmãs que a pessoa não vê: elas só mudam de número, mantendo a posição relativa.
 * Devolve só o que mudou de ordem.
 */
export function renumerarIrmas(paginas: NoPlano[], id: string, paiId: string | null, antesDe: string | null): Array<{ id: string; ordem: number }> {
  const irmas = ordenarIrmas(paginas, paiId).filter((p) => p.id !== id);
  const alvo = antesDe ? irmas.findIndex((p) => p.id === antesDe) : -1;
  const lista = irmas.map((p) => p.id);
  lista.splice(alvo >= 0 ? alvo : lista.length, 0, id);
  const atual = new Map(paginas.map((p) => [p.id, p.ordem]));
  return lista.map((pid, i) => ({ id: pid, ordem: i + 1 })).filter((x) => atual.get(x.id) !== x.ordem || x.id === id);
}
