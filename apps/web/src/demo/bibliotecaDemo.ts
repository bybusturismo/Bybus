/** Biblioteca da demonstração: as páginas iniciais (mesmo conteúdo da semente da API), editáveis em memória. */
import semente from "./bibliotecaPaginas.json";
import { NAO, achar, aplicar, type Rotear } from "./comum";

type Acesso = "EQUIPE" | "RESTRITO";
interface Pag { id: string; paiId: string | null; titulo: string; conteudo: string; acesso: Acesso; ordem: number; atualizadoEm: string }

let semeado = false;
const paginas: Pag[] = [];

function semear(agora: string) {
  if (semeado) return;
  semeado = true;
  const itens = semente as Array<{ chave: string; paiChave?: string; titulo: string; ordem: number; conteudo: string }>;
  for (const p of itens) paginas.push({ id: p.chave, paiId: p.paiChave ?? null, titulo: p.titulo, conteudo: p.conteudo, acesso: "EQUIPE", ordem: p.ordem, atualizadoEm: agora });
}

const porId = (id: string) => paginas.find((p) => p.id === id);
function acessoEfetivo(p: Pag): Acesso {
  for (let x: Pag | undefined = p, n = 0; x && n < 30; x = x.paiId ? porId(x.paiId) : undefined, n++) if (x.acesso === "RESTRITO") return "RESTRITO";
  return "EQUIPE";
}
const meta = (p: Pag) => ({ id: p.id, paiId: p.paiId, titulo: p.titulo, acesso: p.acesso, acessoEfetivo: acessoEfetivo(p), ordem: p.ordem, atualizadoEm: p.atualizadoEm });
function caminhoDe(p: Pag): Pag[] {
  const c: Pag[] = [];
  for (let x: Pag | undefined = p, n = 0; x && n < 30; x = x.paiId ? porId(x.paiId) : undefined, n++) c.unshift(x);
  return c;
}
const minusculo = (t: string) => t.toLocaleLowerCase("pt-BR");
function trecho(conteudo: string, termo: string): string {
  const limpo = conteudo.replace(/[#*>|`-]+/g, " ").replace(/\s+/g, " ").trim();
  const i = minusculo(limpo).indexOf(minusculo(termo));
  if (i < 0) return limpo.slice(0, 120);
  const ini = Math.max(0, i - 50);
  return `${ini > 0 ? "…" : ""}${limpo.slice(ini, i + termo.length + 70)}…`;
}

export const rotearBiblioteca: Rotear = (ctx, metodo, caminho, q, c) => {
  if (!caminho.startsWith("/api/biblioteca/")) return NAO;
  semear(ctx.agoraIso());
  let m: RegExpMatchArray | null;
  const r = (re: RegExp) => (m = caminho.match(re));
  const ver = () => ctx.exigir("biblioteca:ver");
  const editar = () => ctx.exigir("biblioteca:editar");
  const podeEditar = () => { try { ctx.exigir("biblioteca:editar"); return true; } catch { return false; } };
  const visiveis = () => (podeEditar() ? paginas : paginas.filter((p) => acessoEfetivo(p) === "EQUIPE"));

  if (metodo === "GET" && caminho === "/api/biblioteca/paginas") {
    ver();
    return { podeEditar: podeEditar(), paginas: visiveis().map(meta) };
  }
  if (metodo === "GET" && caminho === "/api/biblioteca/busca") {
    ver();
    const termo = (q.get("q") ?? "").trim();
    if (termo.length < 2) throw ctx.erro(400, "VALIDACAO", "Digite ao menos 2 letras.");
    const noTitulo = (p: Pag) => minusculo(p.titulo).includes(minusculo(termo));
    return visiveis().filter((p) => noTitulo(p) || minusculo(p.conteudo).includes(minusculo(termo))).sort((a, b) => Number(noTitulo(b)) - Number(noTitulo(a))).slice(0, 30)
      .map((p) => ({ id: p.id, titulo: p.titulo, noTitulo: noTitulo(p), trecho: trecho(p.conteudo, termo), caminho: caminhoDe(p).slice(0, -1).map((x) => x.titulo) }));
  }
  if (metodo === "POST" && caminho === "/api/biblioteca/paginas") {
    editar();
    const p: Pag = { id: ctx.id("bib"), paiId: c.paiId ?? null, titulo: c.titulo, conteudo: c.conteudo ?? "", acesso: c.acesso ?? "EQUIPE", ordem: c.ordem ?? 0, atualizadoEm: ctx.agoraIso() };
    paginas.push(p);
    ctx.auditar("BIBLIOTECA_PAGINA_CRIADA", "biblioteca_pagina", p.id, { titulo: p.titulo });
    return { id: p.id };
  }
  if (r(/^\/api\/biblioteca\/paginas\/([^/]+)$/)) {
    const p = achar(paginas, m![1]!, ctx, "Página");
    if (metodo === "GET") {
      ver();
      if (!visiveis().includes(p)) throw ctx.erro(404, "NAO_ENCONTRADO", "Página não encontrada.");
      return { ...meta(p), conteudo: p.conteudo, podeEditar: podeEditar(), caminho: caminhoDe(p).map((x) => ({ id: x.id, titulo: x.titulo })), subpaginas: visiveis().filter((x) => x.paiId === p.id).map((x) => ({ id: x.id, titulo: x.titulo })) };
    }
    editar();
    if (metodo === "PATCH") {
      aplicar(p, c, ["paiId", "titulo", "conteudo", "acesso", "ordem"]);
      p.atualizadoEm = ctx.agoraIso();
      return { ok: true };
    }
    if (metodo === "DELETE") {
      const remover = new Set([p.id]);
      for (let mudou = true; mudou;) { mudou = false; for (const x of paginas) if (x.paiId && remover.has(x.paiId) && !remover.has(x.id)) { remover.add(x.id); mudou = true; } }
      for (let i = paginas.length - 1; i >= 0; i--) if (remover.has(paginas[i]!.id)) paginas.splice(i, 1);
      return { ok: true };
    }
  }
  throw ctx.erro(404, "NAO_ENCONTRADO", "Função não disponível na demonstração.");
};
