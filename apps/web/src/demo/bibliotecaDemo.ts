/**
 * Biblioteca da demonstração: as páginas iniciais (mesmo conteúdo da semente da API), editáveis em memória.
 * Árvore, arrastar, duplicar, lixeira, ícone, acesso por pessoa e editor funcionam; envio de arquivos e PDF não (não há servidor).
 */
import { acessoEfetivo, caminhoDaPagina, criaCiclo, descendentes, escaparLike, renumerarIrmas, textoDaPagina, trechoDaBusca, MARCA_HTML } from "@bybus/core";
import semente from "./bibliotecaPaginas.json";
import { NAO, achar, type Rotear } from "./comum";

type Acesso = "EQUIPE" | "RESTRITO";
interface Pag {
  id: string; paiId: string | null; titulo: string; icone: string | null; conteudo: string; acesso: Acesso; ordem: number;
  criadoEm: string; atualizadoEm: string; autor: string; atualizadoPor: string; colaboradores: string[]; excluidaEm: string | null;
}
interface Acc { paginaId: string; usuarioId: string; nivel: "VER" | "EDITAR" }

const PESSOAS = [
  { id: "u-admin", nome: "Admin Demo" }, { id: "u-sup", nome: "Supervisora Demo" }, { id: "u-aten", nome: "Atendente Demo" }, { id: "u-guia", nome: "Guia Demo" },
];
const ICONES: Record<string, string> = { "manuais-operacionais": "📘", "manual-city-tour-floripa": "🚌", "manual-bc-by-bus": "🏖️", "regras-embarque-confirmacao": "✅", "fluxo-lista-21h": "⏰", "reservas-otas": "🎫", "quiosque-villa-romana": "🏪" };

let semeado = false;
const paginas: Pag[] = [];
const acessos: Acc[] = [];

function semear(agora: string) {
  if (semeado) return;
  semeado = true;
  const itens = semente as Array<{ chave: string; paiChave?: string; titulo: string; ordem: number; conteudo: string }>;
  for (const p of itens) paginas.push({ id: p.chave, paiId: p.paiChave ?? null, titulo: p.titulo, icone: ICONES[p.chave] ?? null, conteudo: p.conteudo, acesso: "EQUIPE", ordem: p.ordem, criadoEm: agora, atualizadoEm: agora, autor: "Admin Demo", atualizadoPor: "Admin Demo", colaboradores: ["Admin Demo"], excluidaEm: null });
}

const ativas = () => paginas.filter((p) => !p.excluidaEm);
const nos = () => ativas().map((p) => ({ id: p.id, paiId: p.paiId, acesso: p.acesso, ordem: p.ordem, titulo: p.titulo }));
const formato = (p: Pag) => (p.conteudo.startsWith(MARCA_HTML) ? "html" : "markdown");

export const rotearBiblioteca: Rotear = (ctx, metodo, caminho, q, c) => {
  if (!caminho.startsWith("/api/biblioteca/")) return NAO;
  semear(ctx.agoraIso());
  let m: RegExpMatchArray | null;
  const r = (re: RegExp) => (m = caminho.match(re));
  const ver = () => ctx.exigir("biblioteca:ver");
  const editorGeral = () => { try { ctx.exigir("biblioteca:editar"); return true; } catch { return false; } };
  const exigirEditor = () => ctx.exigir("biblioteca:editar");
  // Na demonstração, a pessoa logada é "Admin Demo" (u-admin) ou outra da lista; só distinguimos quem edita a Biblioteca.
  const visivel = (p: Pag) => editorGeral() || acessoEfetivo(nos(), p.id) === "EQUIPE" || acessos.some((a) => a.paginaId === p.id);
  const doId = (id: string) => { const p = ativas().find((x) => x.id === id); if (!p || !visivel(p)) throw ctx.erro(404, "NAO_ENCONTRADO", "Página não encontrada."); return p; };
  const podeEditar = (p: Pag) => editorGeral() || acessos.some((a) => a.paginaId === p.id && a.nivel === "EDITAR");
  const exigirEditar = (p: Pag) => { if (!podeEditar(p)) throw ctx.erro(403, "SEM_PERMISSAO", "Você não tem permissão para editar esta página."); };
  const registrar = (p: Pag) => { p.atualizadoEm = ctx.agoraIso(); p.atualizadoPor = "Admin Demo"; if (!p.colaboradores.includes("Admin Demo")) p.colaboradores.push("Admin Demo"); };
  const posicionar = (id: string, paiId: string | null, antesDe: string | null) => {
    for (const n of renumerarIrmas(nos(), id, paiId, antesDe)) achar(paginas, n.id, ctx, "Página").ordem = n.ordem;
  };
  const meta = (p: Pag) => ({ id: p.id, paiId: p.paiId, titulo: p.titulo, icone: p.icone, acesso: p.acesso, acessoEfetivo: acessoEfetivo(nos(), p.id), ordem: p.ordem, atualizadoEm: p.atualizadoEm, podeEditar: podeEditar(p) });

  if (metodo === "GET" && caminho === "/api/biblioteca/paginas") {
    ver();
    return { podeEditar: editorGeral(), paginas: ativas().filter(visivel).sort((a, b) => a.ordem - b.ordem).map(meta) };
  }
  if (metodo === "GET" && caminho === "/api/biblioteca/busca") {
    ver();
    const termo = (q.get("q") ?? "").trim();
    if (termo.length < 2) throw ctx.erro(400, "VALIDACAO", "Digite ao menos 2 letras.");
    void escaparLike;
    const baixo = (t: string) => t.toLocaleLowerCase("pt-BR");
    const noTitulo = (p: Pag) => baixo(p.titulo).includes(baixo(termo));
    const texto = (p: Pag) => textoDaPagina(p.conteudo);
    return ativas().filter(visivel).filter((p) => noTitulo(p) || baixo(texto(p)).includes(baixo(termo))).sort((a, b) => Number(noTitulo(b)) - Number(noTitulo(a))).slice(0, 30)
      .map((p) => ({ id: p.id, titulo: p.titulo, noTitulo: noTitulo(p), trecho: trechoDaBusca(texto(p), termo), caminho: caminhoDaPagina(nos(), p.id).slice(0, -1).map((x) => x.titulo) }));
  }
  if (metodo === "POST" && caminho === "/api/biblioteca/paginas") {
    ver();
    const pai = c.paiId ? doId(c.paiId) : null;
    if (pai) exigirEditar(pai); else exigirEditor();
    const p: Pag = {
      id: ctx.id("bib"), paiId: pai?.id ?? null, titulo: c.titulo, icone: c.icone ?? null, conteudo: c.conteudo ? `${MARCA_HTML}${c.conteudo}` : "", acesso: c.acesso ?? "EQUIPE",
      ordem: Math.max(0, ...ativas().filter((x) => x.paiId === (pai?.id ?? null)).map((x) => x.ordem)) + 1, criadoEm: ctx.agoraIso(), atualizadoEm: ctx.agoraIso(), autor: "Admin Demo", atualizadoPor: "Admin Demo", colaboradores: ["Admin Demo"], excluidaEm: null,
    };
    paginas.push(p);
    ctx.auditar("BIBLIOTECA_PAGINA_CRIADA", "biblioteca_pagina", p.id, { titulo: p.titulo });
    return { id: p.id };
  }
  if (metodo === "GET" && caminho === "/api/biblioteca/lixeira") {
    exigirEditor();
    const mortas = paginas.filter((p) => p.excluidaEm);
    return mortas.filter((p) => !mortas.some((x) => x.id === p.paiId && x.excluidaEm === p.excluidaEm)).map((p) => ({ id: p.id, titulo: p.titulo, icone: p.icone, excluidaEm: p.excluidaEm, paginas: mortas.filter((x) => x.excluidaEm === p.excluidaEm).length }));
  }
  if (metodo === "GET" && caminho === "/api/biblioteca/usuarios") { exigirEditor(); return PESSOAS; }
  if (r(/^\/api\/biblioteca\/lixeira\/([^/]+)(\/restaurar)?$/)) {
    exigirEditor();
    const p = paginas.find((x) => x.id === m![1] && x.excluidaEm);
    if (!p) throw ctx.erro(404, "NAO_ENCONTRADO", "Página não encontrada.");
    const grupo = paginas.filter((x) => x.excluidaEm === p.excluidaEm);
    if (m![2] && metodo === "POST") {
      const pai = p.paiId ? paginas.find((x) => x.id === p.paiId) : null;
      if (!pai || pai.excluidaEm) p.paiId = null;
      grupo.forEach((x) => { x.excluidaEm = null; });
      return { id: p.id, paginas: grupo.length };
    }
    if (!m![2] && metodo === "DELETE") {
      for (const x of grupo) paginas.splice(paginas.indexOf(x), 1);
      return { ok: true };
    }
  }
  if (r(/^\/api\/biblioteca\/paginas\/([^/]+)\/duplicar$/) && metodo === "POST") {
    const p = doId(m![1]!);
    if (p.paiId) exigirEditar(doId(p.paiId)); else exigirEditor();
    const grupo = [p.id, ...descendentes(nos(), p.id)].map((i) => ativas().find((x) => x.id === i)!).filter(Boolean);
    const novos = new Map<string, string>();
    const prof = (x: Pag) => { let n = 0; for (let y: Pag | undefined = x; y && y.id !== p.id; y = grupo.find((z) => z.id === y!.paiId)) n++; return n; };
    for (const x of grupo.slice().sort((a, b) => prof(a) - prof(b))) {
      const copia: Pag = { ...x, id: ctx.id("bib"), titulo: x.id === p.id ? `Cópia de ${x.titulo}` : x.titulo, paiId: x.id === p.id ? x.paiId : (novos.get(x.paiId!) ?? null), colaboradores: ["Admin Demo"], autor: "Admin Demo", criadoEm: ctx.agoraIso(), atualizadoEm: ctx.agoraIso() };
      novos.set(x.id, copia.id);
      paginas.push(copia);
    }
    const copiaId = novos.get(p.id)!;
    const irmas = ativas().filter((x) => x.paiId === p.paiId && x.id !== copiaId).sort((a, b) => a.ordem - b.ordem);
    posicionar(copiaId, p.paiId, irmas[irmas.findIndex((x) => x.id === p.id) + 1]?.id ?? null);
    return { id: copiaId, paginas: novos.size };
  }
  if (r(/^\/api\/biblioteca\/paginas\/([^/]+)\/pessoas$/)) {
    exigirEditor();
    const p = doId(m![1]!);
    if (metodo === "GET") return acessos.filter((a) => a.paginaId === p.id).map((a) => ({ usuarioId: a.usuarioId, nivel: a.nivel, nome: PESSOAS.find((u) => u.id === a.usuarioId)?.nome ?? "—" }));
    if (metodo === "PUT") {
      for (let i = acessos.length - 1; i >= 0; i--) if (acessos[i]!.paginaId === p.id) acessos.splice(i, 1);
      for (const x of c.pessoas as Array<{ usuarioId: string; nivel: "VER" | "EDITAR" }>) acessos.push({ paginaId: p.id, usuarioId: x.usuarioId, nivel: x.nivel });
      return { ok: true, pessoas: c.pessoas.length };
    }
  }
  if (r(/^\/api\/biblioteca\/paginas\/([^/]+)\/(anexos|pdf)$/)) {
    doId(m![1]!);
    throw ctx.erro(400, "DEMONSTRACAO", m![2] === "pdf" ? "Na demonstração o PDF não é gerado." : "Na demonstração o envio de arquivos não funciona.");
  }
  if (r(/^\/api\/biblioteca\/anexos\/([^/]+)$/)) throw ctx.erro(404, "NAO_ENCONTRADO", "Na demonstração não há arquivos anexados.");
  if (r(/^\/api\/biblioteca\/paginas\/([^/]+)$/)) {
    const p = doId(m![1]!);
    if (metodo === "GET") {
      ver();
      const filhas = ativas().filter((x) => x.paiId === p.id && visivel(x)).sort((a, b) => a.ordem - b.ordem);
      return {
        ...meta(p), conteudo: p.conteudo, formato: formato(p), criadoEm: p.criadoEm, autor: p.autor, atualizadoPor: p.atualizadoPor, colaboradores: p.colaboradores, podeGerenciarAcesso: editorGeral(),
        caminho: caminhoDaPagina(ativas().filter(visivel).map((x) => ({ id: x.id, paiId: x.paiId, titulo: x.titulo, icone: x.icone, acesso: x.acesso, ordem: x.ordem })), p.id).map((x) => ({ id: x.id, titulo: x.titulo, icone: x.icone })),
        subpaginas: filhas.map((x) => ({ id: x.id, titulo: x.titulo, icone: x.icone, proprietario: x.autor, colaboradores: x.colaboradores })), anexos: [],
      };
    }
    exigirEditar(p);
    if (metodo === "PATCH") {
      if ("acesso" in c) { exigirEditor(); p.acesso = c.acesso; }
      if ("titulo" in c) { p.titulo = c.titulo; registrar(p); }
      if ("icone" in c) p.icone = c.icone || null;
      if ("conteudo" in c) { p.conteudo = c.conteudo.startsWith(MARCA_HTML) || !c.conteudo ? c.conteudo : `${MARCA_HTML}${c.conteudo}`; registrar(p); }
      if ("paiId" in c || "antesDe" in c) {
        const novoPai: string | null = "paiId" in c ? c.paiId : p.paiId;
        if (novoPai) {
          const alvo = doId(novoPai);
          if (alvo.id === p.id || criaCiclo(nos(), p.id, alvo.id)) throw ctx.erro(400, "CICLO", "Uma página não pode ficar dentro dela mesma ou de uma subpágina sua.");
        } else exigirEditor();
        if (c.antesDe && ativas().find((x) => x.id === c.antesDe)?.paiId !== novoPai) throw ctx.erro(400, "IRMA_INVALIDA", "A página de referência não está no mesmo lugar do destino.");
        p.paiId = novoPai;
        posicionar(p.id, novoPai, c.antesDe ?? null);
      }
      return { ok: true };
    }
    if (metodo === "DELETE") {
      const ids = [p.id, ...descendentes(nos(), p.id)];
      const instante = ctx.agoraIso();
      for (const x of paginas) if (ids.includes(x.id)) x.excluidaEm = instante;
      return { ok: true, paginas: ids.length };
    }
  }
  throw ctx.erro(404, "NAO_ENCONTRADO", "Função não disponível na demonstração.");
};
