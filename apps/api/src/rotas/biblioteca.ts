import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ACESSOS_PAGINA, NIVEIS_PESSOA, acessoEfetivo, calcularAcesso, caminhoDaPagina, criaCiclo, descendentes, escaparLike, htmlDoConteudo,
  markdownParaHtml, renumerarIrmas, textoDaPagina, trechoDaBusca, type AcessoPessoa,
} from "@bybus/core";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { bibliotecaAcessos, bibliotecaAnexos, bibliotecaColaboradores, bibliotecaPaginas, usuarios } from "../db/schema.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir, nomeCookie, type UsuarioSessao } from "../seguranca/sessao.js";
import { MAIOR_LIMITE, LIMITES, MAX_ANEXOS_POR_PAGINA, detectarTipo, disposicao, limiteDoTipoDeclarado, nomeSeguro } from "../servicos/bibliotecaAnexos.js";
import { gerarPdfDaPagina } from "../servicos/bibliotecaPdf.js";
import { anexosDoHtml, htmlParaGuardar, limparHtml, removerAnexoDoHtml, trocarAnexosNoHtml } from "../servicos/htmlSeguro.js";

const uuid = z.string().uuid();
const MAX_CONTEUDO = 300_000;
const naoEncontrada = () => new ErroHttp(404, "NAO_ENCONTRADO", "Página não encontrada.");
const icone = z.string().trim().max(16).refine((s) => !/[<>&"']/.test(s), "Ícone inválido").nullable();

/** Texto novo → o que é guardado: Markdown vira HTML; tudo passa pelo limpador (DOMPurify). */
function paraGuardar(conteudo: string, formato: "html" | "markdown"): string {
  return htmlParaGuardar(formato === "markdown" ? markdownParaHtml(conteudo) : conteudo);
}

export async function rotasBiblioteca(app: FastifyInstance, { db, config }: Contexto) {
  const ver = { preHandler: exigir(config, "biblioteca:ver") };
  const editarGeral = { preHandler: exigir(config, "biblioteca:editar") };
  const editorGeral = (u: UsuarioSessao) => pode(u, "biblioteca:editar");

  type Meta = { id: string; paiId: string | null; titulo: string; icone: string | null; acesso: "EQUIPE" | "RESTRITO"; ordem: number; atualizadoEm: Date; criadoPor: string | null; atualizadoPor: string | null };
  /** Todas as páginas ativas (sem o texto) e as listas de pessoas: são poucas e permitem calcular caminho e acesso. */
  async function carregar() {
    const paginas = (await db.select({
      id: bibliotecaPaginas.id, paiId: bibliotecaPaginas.paiId, titulo: bibliotecaPaginas.titulo, icone: bibliotecaPaginas.icone, acesso: bibliotecaPaginas.acesso,
      ordem: bibliotecaPaginas.ordem, atualizadoEm: bibliotecaPaginas.atualizadoEm, criadoPor: bibliotecaPaginas.criadoPor, atualizadoPor: bibliotecaPaginas.atualizadoPor,
    }).from(bibliotecaPaginas).where(isNull(bibliotecaPaginas.excluidaEm)).orderBy(asc(bibliotecaPaginas.ordem), asc(bibliotecaPaginas.titulo))) as Meta[];
    const acessos = (await db.select({ paginaId: bibliotecaAcessos.paginaId, usuarioId: bibliotecaAcessos.usuarioId, nivel: bibliotecaAcessos.nivel }).from(bibliotecaAcessos)) as AcessoPessoa[];
    return { paginas, acessos };
  }
  type Base = Awaited<ReturnType<typeof carregar>>;
  const acessoDe = (b: Base, u: UsuarioSessao, id: string) => calcularAcesso(b.paginas, b.acessos, { id: u.id, editorGeral: editorGeral(u) }, id);
  function exigirVer(b: Base, u: UsuarioSessao, id: string) {
    if (!b.paginas.some((p) => p.id === id) || !acessoDe(b, u, id).ver) throw naoEncontrada();
  }
  function exigirEditar(b: Base, u: UsuarioSessao, id: string) {
    exigirVer(b, u, id);
    if (!acessoDe(b, u, id).editar) throw new ErroHttp(403, "SEM_PERMISSAO", "Você não tem permissão para editar esta página.");
  }
  const existe = (b: Base, id: string) => {
    if (!b.paginas.some((p) => p.id === id)) throw naoEncontrada();
  };
  async function nomes(ids: Array<string | null>) {
    const lista = [...new Set(ids.filter((x): x is string => !!x))];
    const linhas = lista.length ? await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(inArray(usuarios.id, lista)) : [];
    return new Map(linhas.map((l) => [l.id, l.nome]));
  }
  async function registrarColaborador(paginaId: string, usuarioId: string) {
    await db.insert(bibliotecaColaboradores).values({ paginaId, usuarioId }).onConflictDoUpdate({ target: [bibliotecaColaboradores.paginaId, bibliotecaColaboradores.usuarioId], set: { ultimaEdicaoEm: new Date() } });
  }
  /** Renumera as irmãs 1, 2, 3… com `id` antes de `antesDe` (sem `antesDe`, no fim). */
  async function posicionar(b: Base, id: string, paiId: string | null, antesDe: string | null) {
    if (antesDe && b.paginas.find((p) => p.id === antesDe)?.paiId !== paiId) throw new ErroHttp(400, "IRMA_INVALIDA", "A página de referência não está no mesmo lugar do destino.");
    const novas = renumerarIrmas(b.paginas, id, paiId, antesDe);
    for (const n of novas) await db.update(bibliotecaPaginas).set({ ordem: n.ordem }).where(eq(bibliotecaPaginas.id, n.id));
  }

  // ───────────── Leitura ─────────────

  app.get("/api/biblioteca/paginas", ver, async (req) => {
    const u = req.usuario!;
    const b = await carregar();
    const visiveis = b.paginas.filter((p) => acessoDe(b, u, p.id).ver);
    return {
      podeEditar: editorGeral(u),
      paginas: visiveis.map((p) => ({
        id: p.id, paiId: p.paiId, titulo: p.titulo, icone: p.icone, acesso: p.acesso, acessoEfetivo: acessoEfetivo(b.paginas, p.id), ordem: p.ordem,
        atualizadoEm: p.atualizadoEm, podeEditar: acessoDe(b, u, p.id).editar,
      })),
    };
  });

  app.get("/api/biblioteca/paginas/:id", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const u = req.usuario!;
    const b = await carregar();
    exigirVer(b, u, id);
    const [p] = await db.select().from(bibliotecaPaginas).where(eq(bibliotecaPaginas.id, id));
    const filhas = b.paginas.filter((x) => x.paiId === id && acessoDe(b, u, x.id).ver);
    const ids = [id, ...filhas.map((f) => f.id)];
    const colabs = await db.select({ paginaId: bibliotecaColaboradores.paginaId, usuarioId: bibliotecaColaboradores.usuarioId, em: bibliotecaColaboradores.ultimaEdicaoEm })
      .from(bibliotecaColaboradores).where(inArray(bibliotecaColaboradores.paginaId, ids)).orderBy(desc(bibliotecaColaboradores.ultimaEdicaoEm));
    const nome = await nomes([p!.criadoPor, p!.atualizadoPor, ...filhas.map((f) => f.criadoPor), ...colabs.map((c) => c.usuarioId)]);
    const colaboradoresDe = (pid: string) => colabs.filter((c) => c.paginaId === pid).map((c) => nome.get(c.usuarioId)).filter((x): x is string => !!x);
    const anexos = await db.select({ id: bibliotecaAnexos.id, nome: bibliotecaAnexos.nome, tipo: bibliotecaAnexos.tipo, uso: bibliotecaAnexos.uso, tamanho: bibliotecaAnexos.tamanho, criadoEm: bibliotecaAnexos.criadoEm })
      .from(bibliotecaAnexos).where(eq(bibliotecaAnexos.paginaId, id)).orderBy(asc(bibliotecaAnexos.criadoEm));
    const a = acessoDe(b, u, id);
    return {
      id: p!.id, paiId: p!.paiId, titulo: p!.titulo, icone: p!.icone, conteudo: p!.conteudo, formato: p!.conteudo.startsWith("<!--html-->") ? "html" : "markdown",
      acesso: p!.acesso, ordem: p!.ordem, acessoEfetivo: acessoEfetivo(b.paginas, id), atualizadoEm: p!.atualizadoEm, criadoEm: p!.criadoEm,
      autor: p!.criadoPor ? nome.get(p!.criadoPor) ?? null : null, atualizadoPor: p!.atualizadoPor ? nome.get(p!.atualizadoPor) ?? null : null,
      colaboradores: colaboradoresDe(id), podeEditar: a.editar, podeGerenciarAcesso: editorGeral(u),
      caminho: caminhoDaPagina(b.paginas.filter((x) => acessoDe(b, u, x.id).ver).map((x) => ({ ...x })), id).map((x) => ({ id: x.id, titulo: x.titulo, icone: x.icone })),
      subpaginas: filhas.map((f) => ({ id: f.id, titulo: f.titulo, icone: f.icone, proprietario: f.criadoPor ? nome.get(f.criadoPor) ?? null : null, colaboradores: colaboradoresDe(f.id) })),
      anexos,
    };
  });

  /** Busca por título e texto (coluna de texto puro), só nas páginas que o usuário pode ler. */
  app.get("/api/biblioteca/busca", ver, async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2, "Digite ao menos 2 letras.").max(80) }).parse(req.query);
    const u = req.usuario!;
    const padrao = `%${escaparLike(q)}%`;
    const achadas = await db.select({ id: bibliotecaPaginas.id, titulo: bibliotecaPaginas.titulo, texto: sql<string>`coalesce(${bibliotecaPaginas.textoBusca}, ${bibliotecaPaginas.conteudo})` }).from(bibliotecaPaginas)
      .where(and(isNull(bibliotecaPaginas.excluidaEm), or(ilike(bibliotecaPaginas.titulo, padrao), ilike(sql`coalesce(${bibliotecaPaginas.textoBusca}, ${bibliotecaPaginas.conteudo})`, padrao)))).limit(200);
    const b = await carregar();
    const minusculo = (t: string) => t.toLocaleLowerCase("pt-BR");
    const noTitulo = (t: string) => minusculo(t).includes(minusculo(q));
    return achadas.filter((a) => acessoDe(b, u, a.id).ver).sort((x, y) => Number(noTitulo(y.titulo)) - Number(noTitulo(x.titulo))).slice(0, 30).map((a) => ({
      id: a.id, titulo: a.titulo, noTitulo: noTitulo(a.titulo), trecho: trechoDaBusca(a.texto, q),
      caminho: caminhoDaPagina(b.paginas.filter((x) => acessoDe(b, u, x.id).ver), a.id).slice(0, -1).map((p) => p.titulo),
    }));
  });

  // ───────────── Criar, editar, mover ─────────────

  const criar = z.object({
    paiId: uuid.nullable().default(null),
    titulo: z.string().trim().min(2, "Dê um título à página.").max(160),
    icone: icone.optional(),
    conteudo: z.string().max(MAX_CONTEUDO, "Conteúdo grande demais.").default(""),
    formato: z.enum(["html", "markdown"]).default("html"),
    acesso: z.enum(ACESSOS_PAGINA).default("EQUIPE"),
  });

  app.post("/api/biblioteca/paginas", ver, async (req) => {
    const u = req.usuario!;
    const c = criar.parse(req.body);
    const b = await carregar();
    if (c.paiId) {
      existe(b, c.paiId);
      exigirEditar(b, u, c.paiId);
    } else if (!editorGeral(u)) throw new ErroHttp(403, "SEM_PERMISSAO", "Só quem edita a Biblioteca cria páginas na raiz.");
    if (c.acesso === "RESTRITO" && !editorGeral(u)) throw new ErroHttp(403, "SEM_PERMISSAO", "Só quem edita a Biblioteca restringe páginas.");
    const conteudo = paraGuardar(c.conteudo, c.formato);
    const irmas = b.paginas.filter((p) => p.paiId === c.paiId);
    const [nova] = await db.insert(bibliotecaPaginas).values({
      paiId: c.paiId, titulo: c.titulo, icone: c.icone ?? null, conteudo, textoBusca: textoDaPagina(conteudo), acesso: c.acesso,
      ordem: Math.max(0, ...irmas.map((p) => p.ordem)) + 1, criadoPor: u.id, atualizadoPor: u.id,
    }).returning({ id: bibliotecaPaginas.id });
    await registrarColaborador(nova!.id, u.id);
    await auditar(db, req, "BIBLIOTECA_PAGINA_CRIADA", { tipo: "biblioteca_pagina", id: nova!.id }, { titulo: c.titulo, acesso: c.acesso });
    return { id: nova!.id };
  });

  const editar = z.object({
    titulo: z.string().trim().min(2, "Dê um título à página.").max(160),
    icone,
    conteudo: z.string().max(MAX_CONTEUDO, "Conteúdo grande demais."),
    formato: z.enum(["html", "markdown"]).default("html"),
    acesso: z.enum(ACESSOS_PAGINA),
    paiId: uuid.nullable(),
    antesDe: uuid.nullable(),
  }).partial().strict();

  app.patch("/api/biblioteca/paginas/:id", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const u = req.usuario!;
    const d = editar.parse(req.body);
    const b = await carregar();
    existe(b, id);
    exigirEditar(b, u, id);
    const campos: Record<string, unknown> = {};
    if (d.titulo !== undefined) campos.titulo = d.titulo;
    if (d.icone !== undefined) campos.icone = d.icone || null;
    if (d.conteudo !== undefined) {
      const conteudo = paraGuardar(d.conteudo, d.formato ?? "html");
      campos.conteudo = conteudo;
      campos.textoBusca = textoDaPagina(conteudo);
    }
    if (d.acesso !== undefined) {
      if (!editorGeral(u)) throw new ErroHttp(403, "SEM_PERMISSAO", "Só quem edita a Biblioteca muda o acesso da página.");
      campos.acesso = d.acesso;
    }
    // Mover/ordenar: precisa editar a página e o destino (a raiz só para quem edita a Biblioteca).
    const mover = d.paiId !== undefined || d.antesDe !== undefined;
    let novoPai: string | null = null;
    if (mover) {
      const atual = b.paginas.find((p) => p.id === id)!;
      novoPai = d.paiId !== undefined ? d.paiId : atual.paiId;
      if (novoPai) {
        existe(b, novoPai);
        if (novoPai === id || criaCiclo(b.paginas.map((p) => ({ ...p })), id, novoPai)) throw new ErroHttp(400, "CICLO", "Uma página não pode ficar dentro dela mesma ou de uma subpágina sua.");
        exigirEditar(b, u, novoPai);
      } else if (!editorGeral(u)) throw new ErroHttp(403, "SEM_PERMISSAO", "Só quem edita a Biblioteca move páginas para a raiz.");
      if (d.antesDe === id) throw new ErroHttp(400, "IRMA_INVALIDA", "Página de referência inválida.");
      campos.paiId = novoPai;
    }
    const conteudoMudou = d.titulo !== undefined || d.conteudo !== undefined;
    if (Object.keys(campos).length > 0) {
      await db.update(bibliotecaPaginas).set({ ...campos, ...(conteudoMudou || mover ? { atualizadoPor: u.id, atualizadoEm: new Date() } : {}) }).where(eq(bibliotecaPaginas.id, id));
    }
    if (mover) await posicionar(b, id, novoPai, d.antesDe ?? null);
    if (conteudoMudou) await registrarColaborador(id, u.id);
    // O conteúdo não vai para a auditoria: só o que mudou e o tamanho.
    await auditar(db, req, mover ? "BIBLIOTECA_PAGINA_MOVIDA" : "BIBLIOTECA_PAGINA_EDITADA", { tipo: "biblioteca_pagina", id }, { campos: Object.keys(d), acesso: d.acesso, tamanho: d.conteudo?.length });
    return { ok: true };
  });

  // ───────────── Lixeira ─────────────

  app.delete("/api/biblioteca/paginas/:id", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const u = req.usuario!;
    const b = await carregar();
    existe(b, id);
    exigirEditar(b, u, id);
    const atual = b.paginas.find((p) => p.id === id)!;
    if (!atual.paiId && !editorGeral(u)) throw new ErroHttp(403, "SEM_PERMISSAO", "Só quem edita a Biblioteca exclui páginas da raiz.");
    const ids = [id, ...descendentes(b.paginas, id)];
    const instante = new Date();
    await db.update(bibliotecaPaginas).set({ excluidaEm: instante }).where(inArray(bibliotecaPaginas.id, ids));
    await auditar(db, req, "BIBLIOTECA_PAGINA_EXCLUIDA", { tipo: "biblioteca_pagina", id }, { titulo: atual.titulo, paginas: ids.length });
    return { ok: true, paginas: ids.length };
  });

  app.get("/api/biblioteca/lixeira", editarGeral, async () => {
    const mortas = await db.select({ id: bibliotecaPaginas.id, paiId: bibliotecaPaginas.paiId, titulo: bibliotecaPaginas.titulo, icone: bibliotecaPaginas.icone, excluidaEm: bibliotecaPaginas.excluidaEm })
      .from(bibliotecaPaginas).where(isNotNull(bibliotecaPaginas.excluidaEm)).orderBy(desc(bibliotecaPaginas.excluidaEm));
    const raizes = mortas.filter((m) => !mortas.some((x) => x.id === m.paiId && x.excluidaEm?.getTime() === m.excluidaEm?.getTime()));
    return raizes.map((r) => ({ id: r.id, titulo: r.titulo, icone: r.icone, excluidaEm: r.excluidaEm, paginas: mortas.filter((x) => x.excluidaEm?.getTime() === r.excluidaEm?.getTime()).length }));
  });

  async function lixoDe(id: string) {
    const [p] = await db.select({ id: bibliotecaPaginas.id, paiId: bibliotecaPaginas.paiId, excluidaEm: bibliotecaPaginas.excluidaEm, titulo: bibliotecaPaginas.titulo }).from(bibliotecaPaginas).where(eq(bibliotecaPaginas.id, id));
    if (!p?.excluidaEm) throw naoEncontrada();
    const mesmas = await db.select({ id: bibliotecaPaginas.id }).from(bibliotecaPaginas).where(eq(bibliotecaPaginas.excluidaEm, p.excluidaEm));
    return { p, ids: mesmas.map((m) => m.id) };
  }

  app.post("/api/biblioteca/lixeira/:id/restaurar", editarGeral, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { p, ids } = await lixoDe(id);
    // Se a página de cima também está na lixeira (de outra exclusão), volta para a raiz.
    let paiId = p.paiId;
    if (paiId) {
      const [pai] = await db.select({ excluidaEm: bibliotecaPaginas.excluidaEm }).from(bibliotecaPaginas).where(eq(bibliotecaPaginas.id, paiId));
      if (!pai || pai.excluidaEm) paiId = null;
    }
    await db.update(bibliotecaPaginas).set({ excluidaEm: null }).where(inArray(bibliotecaPaginas.id, ids));
    if (paiId !== p.paiId) await db.update(bibliotecaPaginas).set({ paiId }).where(eq(bibliotecaPaginas.id, id));
    await auditar(db, req, "BIBLIOTECA_PAGINA_RESTAURADA", { tipo: "biblioteca_pagina", id }, { titulo: p.titulo, paginas: ids.length });
    return { id, paginas: ids.length };
  });

  app.delete("/api/biblioteca/lixeira/:id", editarGeral, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { p, ids } = await lixoDe(id);
    await db.delete(bibliotecaPaginas).where(inArray(bibliotecaPaginas.id, ids));
    await auditar(db, req, "BIBLIOTECA_PAGINA_APAGADA_DE_VEZ", { tipo: "biblioteca_pagina", id }, { titulo: p.titulo, paginas: ids.length });
    return { ok: true };
  });

  // ───────────── Duplicar ─────────────

  app.post("/api/biblioteca/paginas/:id/duplicar", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const u = req.usuario!;
    const b = await carregar();
    existe(b, id);
    exigirVer(b, u, id);
    const origem = b.paginas.find((p) => p.id === id)!;
    // A cópia fica ao lado da original: precisa poder criar ali (editar o pai ou, na raiz, editar a Biblioteca).
    if (origem.paiId) exigirEditar(b, u, origem.paiId);
    else if (!editorGeral(u)) throw new ErroHttp(403, "SEM_PERMISSAO", "Só quem edita a Biblioteca duplica páginas da raiz.");
    const subarvore = [id, ...descendentes(b.paginas, id)].filter((x) => acessoDe(b, u, x).ver);
    const linhas = await db.select().from(bibliotecaPaginas).where(inArray(bibliotecaPaginas.id, subarvore));
    const anexos = await db.select().from(bibliotecaAnexos).where(inArray(bibliotecaAnexos.paginaId, subarvore));
    const acessos = await db.select().from(bibliotecaAcessos).where(inArray(bibliotecaAcessos.paginaId, subarvore));
    const novos = new Map<string, string>(); // id antigo → id novo (páginas)
    const novosAnexos = new Map<string, string>();
    await db.transaction(async (tx) => {
      // pais antes dos filhos
      const profundidade = (l: (typeof linhas)[number]) => {
        let n = 0;
        for (let x: (typeof linhas)[number] | undefined = l; x && x.id !== id && n < 50; x = linhas.find((y) => y.id === x!.paiId)) n++;
        return n;
      };
      const fila = linhas.slice().sort((a, c) => profundidade(a) - profundidade(c));
      for (const l of fila) {
        const [nova] = await tx.insert(bibliotecaPaginas).values({
          paiId: l.id === id ? l.paiId : novos.get(l.paiId!) ?? null, titulo: l.id === id ? `Cópia de ${l.titulo}`.slice(0, 160) : l.titulo, icone: l.icone, conteudo: l.conteudo,
          textoBusca: l.textoBusca, acesso: l.acesso, ordem: l.ordem, criadoPor: u.id, atualizadoPor: u.id,
        }).returning({ id: bibliotecaPaginas.id });
        novos.set(l.id, nova!.id);
        for (const a of anexos.filter((x) => x.paginaId === l.id)) {
          const [na] = await tx.insert(bibliotecaAnexos).values({ paginaId: nova!.id, nome: a.nome, tipo: a.tipo, uso: a.uso, tamanho: a.tamanho, dados: a.dados, criadoPor: u.id }).returning({ id: bibliotecaAnexos.id });
          novosAnexos.set(a.id, na!.id);
        }
        for (const ac of acessos.filter((x) => x.paginaId === l.id)) await tx.insert(bibliotecaAcessos).values({ paginaId: nova!.id, usuarioId: ac.usuarioId, nivel: ac.nivel });
        await tx.insert(bibliotecaColaboradores).values({ paginaId: nova!.id, usuarioId: u.id });
      }
      // imagens e vídeos do texto passam a apontar para as cópias dos anexos
      for (const novoId of novos.values()) {
        const [pg] = await tx.select({ conteudo: bibliotecaPaginas.conteudo }).from(bibliotecaPaginas).where(eq(bibliotecaPaginas.id, novoId));
        if (pg && anexosDoHtml(pg.conteudo).length) await tx.update(bibliotecaPaginas).set({ conteudo: trocarAnexosNoHtml(pg.conteudo, novosAnexos) }).where(eq(bibliotecaPaginas.id, novoId));
      }
    });
    const copia = novos.get(id)!;
    // a cópia entra logo depois da original
    const b2 = await carregar();
    const irmas = b2.paginas.filter((p) => p.paiId === origem.paiId && p.id !== copia).sort((a, c) => a.ordem - c.ordem);
    const i = irmas.findIndex((p) => p.id === id);
    await posicionar(b2, copia, origem.paiId, irmas[i + 1]?.id ?? null);
    await auditar(db, req, "BIBLIOTECA_PAGINA_DUPLICADA", { tipo: "biblioteca_pagina", id: copia }, { origem: id, paginas: novos.size });
    return { id: copia, paginas: novos.size };
  });

  // ───────────── Acesso por pessoa ─────────────

  app.get("/api/biblioteca/usuarios", editarGeral, async () =>
    db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(eq(usuarios.ativo, true)).orderBy(asc(usuarios.nome)));

  app.get("/api/biblioteca/paginas/:id/pessoas", editarGeral, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    existe(await carregar(), id);
    const linhas = await db.select({ usuarioId: bibliotecaAcessos.usuarioId, nivel: bibliotecaAcessos.nivel, nome: usuarios.nome }).from(bibliotecaAcessos)
      .innerJoin(usuarios, eq(usuarios.id, bibliotecaAcessos.usuarioId)).where(eq(bibliotecaAcessos.paginaId, id)).orderBy(asc(usuarios.nome));
    return linhas;
  });

  /** Troca a lista de pessoas da página (quem edita a Biblioteca). A lista vale também para as subpáginas. */
  app.put("/api/biblioteca/paginas/:id/pessoas", editarGeral, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { pessoas } = z.object({ pessoas: z.array(z.object({ usuarioId: uuid, nivel: z.enum(NIVEIS_PESSOA) })).max(100) }).parse(req.body);
    existe(await carregar(), id);
    const ids = [...new Set(pessoas.map((p) => p.usuarioId))];
    const validos = ids.length ? await db.select({ id: usuarios.id }).from(usuarios).where(and(inArray(usuarios.id, ids), eq(usuarios.ativo, true))) : [];
    if (validos.length !== ids.length) throw new ErroHttp(400, "PESSOA_INVALIDA", "Há pessoa inexistente ou inativa na lista.");
    await db.transaction(async (tx) => {
      await tx.delete(bibliotecaAcessos).where(eq(bibliotecaAcessos.paginaId, id));
      const unicas = new Map(pessoas.map((p) => [p.usuarioId, p.nivel]));
      for (const [usuarioId, nivel] of unicas) await tx.insert(bibliotecaAcessos).values({ paginaId: id, usuarioId, nivel });
    });
    await auditar(db, req, "BIBLIOTECA_ACESSO_PESSOAS", { tipo: "biblioteca_pagina", id }, { pessoas: ids.length });
    return { ok: true, pessoas: ids.length };
  });

  // ───────────── Anexos ─────────────

  // Envio do arquivo no corpo da requisição (sem pacote de upload): o Content-Type é o do próprio arquivo.
  await app.register(async (envio) => {
    envio.removeContentTypeParser("text/plain"); // o padrão do Fastify lê texto como string; aqui precisamos dos bytes
    envio.addContentTypeParser(/^(image|video|application|text)\//, { parseAs: "buffer", bodyLimit: MAIOR_LIMITE }, (_req, corpo, feito) => feito(null, corpo));
    envio.post("/api/biblioteca/paginas/:id/anexos", {
      bodyLimit: MAIOR_LIMITE,
      // Antes de ler o corpo: exige login e recusa tipo/tamanho fora do limite (evita encher a memória à toa).
      onRequest: async (req) => {
        if (!req.cookies[nomeCookie(config)]) throw new ErroHttp(401, "NAO_AUTENTICADO", "Faça login para continuar.");
        const tipo = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
        const limite = limiteDoTipoDeclarado(tipo);
        if (!limite) throw new ErroHttp(400, "TIPO_INVALIDO", "Tipo de arquivo não permitido.");
        if (Number(req.headers["content-length"] ?? 0) > limite) throw new ErroHttp(413, "ARQUIVO_GRANDE", "Arquivo grande demais para este tipo.");
      },
      preHandler: exigir(config, "biblioteca:ver"),
    }, async (req) => {
      const { id } = z.object({ id: uuid }).parse(req.params);
      const { nome } = z.object({ nome: z.string().trim().min(1).max(200) }).parse(req.query);
      const u = req.usuario!;
      const b = await carregar();
      existe(b, id);
      exigirEditar(b, u, id);
      const dados = req.body as Buffer;
      if (!Buffer.isBuffer(dados) || dados.length === 0) throw new ErroHttp(400, "ARQUIVO_VAZIO", "Arquivo vazio.");
      const declarado = String(req.headers["content-type"]).split(";")[0]!.trim().toLowerCase();
      const real = detectarTipo(dados, nome);
      if (!real || real.tipo !== declarado) throw new ErroHttp(400, "TIPO_INVALIDO", "O conteúdo do arquivo não confere com o tipo informado, ou o tipo não é permitido.");
      if (dados.length > LIMITES[real.uso]) throw new ErroHttp(413, "ARQUIVO_GRANDE", "Arquivo grande demais para este tipo.");
      const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(bibliotecaAnexos).where(eq(bibliotecaAnexos.paginaId, id));
      if (n >= MAX_ANEXOS_POR_PAGINA) throw new ErroHttp(400, "MUITOS_ANEXOS", "Esta página já tem anexos demais.");
      const nomeFinal = nomeSeguro(nome);
      const [novo] = await db.insert(bibliotecaAnexos).values({ paginaId: id, nome: nomeFinal, tipo: real.tipo, uso: real.uso, tamanho: dados.length, dados, criadoPor: u.id }).returning({ id: bibliotecaAnexos.id });
      await auditar(db, req, "BIBLIOTECA_ANEXO_ENVIADO", { tipo: "biblioteca_pagina", id }, { anexo: novo!.id, tipo: real.tipo, tamanho: dados.length });
      return { id: novo!.id, nome: nomeFinal, tipo: real.tipo, uso: real.uso, tamanho: dados.length, url: `/api/biblioteca/anexos/${novo!.id}` };
    });
  });

  /** Entrega o anexo (com suporte a Range, para o vídeo permitir avançar). Só quem pode ler a página. */
  app.get("/api/biblioteca/anexos/:id", ver, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [a] = await db.select().from(bibliotecaAnexos).where(eq(bibliotecaAnexos.id, id));
    if (!a) throw naoEncontrada();
    exigirVer(await carregar(), req.usuario!, a.paginaId);
    reply.header("Content-Type", a.tipo).header("Content-Disposition", disposicao(a.uso as "IMAGEM", a.nome)).header("Accept-Ranges", "bytes")
      .header("Cache-Control", "private, max-age=3600").header("X-Content-Type-Options", "nosniff").header("Content-Security-Policy", "sandbox; default-src 'none'");
    const faixa = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (faixa && (faixa[1] || faixa[2])) {
      const total = a.dados.length;
      const ini = faixa[1] ? Number(faixa[1]) : Math.max(0, total - Number(faixa[2]));
      const fim = faixa[1] && faixa[2] ? Math.min(Number(faixa[2]), total - 1) : total - 1;
      if (ini >= total || ini > fim) return reply.status(416).header("Content-Range", `bytes */${total}`).send();
      return reply.status(206).header("Content-Range", `bytes ${ini}-${fim}/${total}`).header("Content-Length", fim - ini + 1).send(a.dados.subarray(ini, fim + 1));
    }
    return reply.header("Content-Length", a.dados.length).send(a.dados);
  });

  app.delete("/api/biblioteca/anexos/:id", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [a] = await db.select({ id: bibliotecaAnexos.id, paginaId: bibliotecaAnexos.paginaId, nome: bibliotecaAnexos.nome }).from(bibliotecaAnexos).where(eq(bibliotecaAnexos.id, id));
    if (!a) throw naoEncontrada();
    exigirEditar(await carregar(), req.usuario!, a.paginaId);
    const [p] = await db.select({ conteudo: bibliotecaPaginas.conteudo }).from(bibliotecaPaginas).where(eq(bibliotecaPaginas.id, a.paginaId));
    await db.transaction(async (tx) => {
      // tira do texto as imagens e vídeos que apontavam para ele
      if (p && p.conteudo.startsWith("<!--html-->") && anexosDoHtml(p.conteudo).includes(id)) {
        const novo = `<!--html-->${removerAnexoDoHtml(p.conteudo.slice("<!--html-->".length), id)}`;
        await tx.update(bibliotecaPaginas).set({ conteudo: novo, textoBusca: textoDaPagina(novo) }).where(eq(bibliotecaPaginas.id, a.paginaId));
      }
      await tx.delete(bibliotecaAnexos).where(eq(bibliotecaAnexos.id, id));
    });
    await auditar(db, req, "BIBLIOTECA_ANEXO_EXCLUIDO", { tipo: "biblioteca_pagina", id: a.paginaId }, { anexo: id, nome: a.nome });
    return { ok: true };
  });

  // ───────────── PDF ─────────────

  app.get("/api/biblioteca/paginas/:id/pdf", ver, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const u = req.usuario!;
    exigirVer(await carregar(), u, id);
    const [p] = await db.select().from(bibliotecaPaginas).where(and(eq(bibliotecaPaginas.id, id), isNull(bibliotecaPaginas.excluidaEm)));
    if (!p) throw naoEncontrada();
    const autor = p.atualizadoPor ? (await nomes([p.atualizadoPor])).get(p.atualizadoPor) ?? null : null;
    const pdf = await gerarPdfDaPagina({
      titulo: p.titulo, autor, atualizadoEm: p.atualizadoEm, html: limparHtml(htmlDoConteudo(p.conteudo)),
      buscarImagem: async (anexoId) => {
        const [a] = await db.select({ dados: bibliotecaAnexos.dados }).from(bibliotecaAnexos).where(and(eq(bibliotecaAnexos.id, anexoId), eq(bibliotecaAnexos.paginaId, id), eq(bibliotecaAnexos.uso, "IMAGEM")));
        return a?.dados ?? null;
      },
    });
    await auditar(db, req, "BIBLIOTECA_PDF_GERADO", { tipo: "biblioteca_pagina", id });
    const arquivo = `${p.titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "pagina"}.pdf`;
    return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="${arquivo}"`).header("Content-Length", pdf.length).send(pdf);
  });
}
