/** Peças comuns dos módulos novos da demonstração (financeiro, frota, marketing, biblioteca, IA). Tudo fictício. */

export const NAO = Symbol("rota-nao-tratada");
export type Corpo = Record<string, any>;

export interface Ctx {
  exigir(permissao?: string): void;
  /** O usuário logado tem a permissão? */
  pode(permissao: string): boolean;
  /** Praças do usuário (null = todas). */
  escopo(): string[] | null;
  erro(status: number, codigo: string, mensagem: string): Error;
  id(prefixo: string): string;
  auditar(acao: string, entidade?: string, entidadeId?: string, dados?: Record<string, unknown>): void;
  dataMais(dias: number): string;
  agoraIso(): string;
}

export type Rotear = (ctx: Ctx, metodo: string, caminho: string, q: URLSearchParams, c: Corpo) => unknown;

export const UN_FLN = "un-fln";
export const UN_BC = "un-bc";

export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}
export function fimDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}
export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7);
}
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}
export function inicioDaSemana(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return somarDias(iso, -((dow + 6) % 7));
}
export const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function achar<T extends { id: string }>(lista: T[], id: string, ctx: Ctx, nome: string): T {
  const x = lista.find((i) => i.id === id);
  if (!x) throw ctx.erro(404, "NAO_ENCONTRADO", `${nome} não encontrado(a).`);
  return x;
}
/** Copia só os campos permitidos do corpo para o registro. */
export function aplicar<T extends object>(alvo: T, c: Corpo, campos: string[]): T {
  for (const k of campos) if (k in c) (alvo as any)[k] = c[k];
  return alvo;
}
