import { asc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ACESSOS_PAGINA, acessoEfetivo, caminhoDaPagina, criaCiclo, escaparLike, trechoDaBusca } from "@bybus/core";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { bibliotecaPaginas } from "../db/schema.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir, type UsuarioSessao } from "../seguranca/sessao.js";

const uuid = z.string().uuid();
const MAX_CONTEUDO = 100_000;

export async function rotasBiblioteca(app: FastifyInstance, { db, config }: Contexto) {
  const ver = { preHandler: exigir(config, "biblioteca:ver") };
  const editar = { preHandler: exigir(config, "biblioteca:editar") };
  const editor = (u: UsuarioSessao) => pode(u, "biblioteca:editar");

  /** Metadados de todas as páginas (sem o texto): são poucas e permitem calcular herança de acesso e caminhos. */
  const todas = () => db.select({
    id: bibliotecaPaginas.id, paiId: bibliotecaPaginas.paiId, titulo: bibliotecaPaginas.titulo, acesso: bibliotecaPaginas.acesso,
    ordem: bibliotecaPaginas.ordem, atualizadoEm: bibliotecaPaginas.atualizadoEm,
  }).from(bibliotecaPaginas).orderBy(asc(bibliotecaPaginas.ordem), asc(bibliotecaPaginas.titulo));
  type Meta = Omit<Awaited<ReturnType<typeof todas>>[number], "acesso"> & { acesso: "EQUIPE" | "RESTRITO" };

  /** Quem só lê não enxerga páginas restritas nem as que estão dentro de uma restrita. */
  async function visiveis(u: UsuarioSessao) {
    const lista = (await todas()) as Meta[];
    if (editor(u)) return { lista, tudo: lista };
    return { lista: lista.filter((p) => acessoEfetivo(lista, p.id) === "EQUIPE"), tudo: lista };
  }

  app.get("/api/biblioteca/paginas", ver, async (req) => {
    const u = req.usuario!;
    const { lista, tudo } = await visiveis(u);
    return { podeEditar: editor(u), paginas: lista.map((p) => ({ ...p, acessoEfetivo: acessoEfetivo(tudo, p.id) })) };
  });

  app.get("/api/biblioteca/paginas/:id", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const u = req.usuario!;
    const { lista, tudo } = await visiveis(u);
    if (!lista.some((p) => p.id === id)) throw new ErroHttp(404, "NAO_ENCONTRADO", "Página não encontrada.");
    const [pagina] = await db.select().from(bibliotecaPaginas).where(eq(bibliotecaPaginas.id, id));
    return {
      id: pagina!.id, paiId: pagina!.paiId, titulo: pagina!.titulo, conteudo: pagina!.conteudo, acesso: pagina!.acesso, ordem: pagina!.ordem,
      acessoEfetivo: acessoEfetivo(tudo, id), atualizadoEm: pagina!.atualizadoEm, podeEditar: editor(u),
      caminho: caminhoDaPagina(lista, id).map((p) => ({ id: p.id, titulo: p.titulo })),
      subpaginas: lista.filter((p) => p.paiId === id).map((p) => ({ id: p.id, titulo: p.titulo })),
    };
  });

  /** Busca por título e texto, só nas páginas que o usuário pode ler. */
  app.get("/api/biblioteca/busca", ver, async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2, "Digite ao menos 2 letras.").max(80) }).parse(req.query);
    const u = req.usuario!;
    const padrao = `%${escaparLike(q)}%`;
    const achadas = await db.select({ id: bibliotecaPaginas.id, titulo: bibliotecaPaginas.titulo, conteudo: bibliotecaPaginas.conteudo }).from(bibliotecaPaginas)
      .where(or(ilike(bibliotecaPaginas.titulo, padrao), ilike(bibliotecaPaginas.conteudo, padrao))).limit(200);
    const { lista } = await visiveis(u);
    const liberadas = new Set(lista.map((p) => p.id));
    const minusculo = (t: string) => t.toLocaleLowerCase("pt-BR");
    const noTitulo = (t: string) => minusculo(t).includes(minusculo(q));
    // Quem tem o termo no título vem primeiro.
    return achadas.filter((a) => liberadas.has(a.id)).sort((x, y) => Number(noTitulo(y.titulo)) - Number(noTitulo(x.titulo))).slice(0, 30).map((a) => ({
      id: a.id, titulo: a.titulo,
      noTitulo: noTitulo(a.titulo),
      trecho: trechoDaBusca(a.conteudo, q),
      caminho: caminhoDaPagina(lista, a.id).slice(0, -1).map((p) => p.titulo),
    }));
  });

  const campos = z.object({
    paiId: uuid.nullable(),
    titulo: z.string().trim().min(2, "Dê um título à página.").max(160),
    conteudo: z.string().max(MAX_CONTEUDO, "Conteúdo grande demais.").default(""),
    acesso: z.enum(ACESSOS_PAGINA).default("EQUIPE"),
    ordem: z.number().int().min(0).max(100_000).default(0),
  });

  app.post("/api/biblioteca/paginas", editar, async (req) => {
    const c = campos.partial({ paiId: true }).parse(req.body);
    const paiId = c.paiId ?? null;
    if (paiId) {
      const [pai] = await db.select({ id: bibliotecaPaginas.id }).from(bibliotecaPaginas).where(eq(bibliotecaPaginas.id, paiId));
      if (!pai) throw new ErroHttp(400, "PAI_INVALIDO", "A página de origem não existe.");
    }
    const [nova] = await db.insert(bibliotecaPaginas).values({ ...c, paiId, criadoPor: req.usuario!.id, atualizadoPor: req.usuario!.id }).returning();
    await auditar(db, req, "BIBLIOTECA_PAGINA_CRIADA", { tipo: "biblioteca_pagina", id: nova!.id }, { titulo: c.titulo, acesso: c.acesso });
    return { id: nova!.id };
  });

  app.patch("/api/biblioteca/paginas/:id", editar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const dados = campos.partial().parse(req.body);
    const lista = (await todas()) as Meta[];
    const atual = lista.find((p) => p.id === id);
    if (!atual) throw new ErroHttp(404, "NAO_ENCONTRADO", "Página não encontrada.");
    if (dados.paiId !== undefined) {
      if (dados.paiId && !lista.some((p) => p.id === dados.paiId)) throw new ErroHttp(400, "PAI_INVALIDO", "A página de destino não existe.");
      if (criaCiclo(lista, id, dados.paiId)) throw new ErroHttp(400, "CICLO", "Uma página não pode ficar dentro dela mesma ou de uma subpágina sua.");
    }
    await db.update(bibliotecaPaginas).set({ ...dados, atualizadoPor: req.usuario!.id, atualizadoEm: new Date() }).where(eq(bibliotecaPaginas.id, id));
    // O conteúdo não vai para a auditoria: só o que mudou e o tamanho.
    await auditar(db, req, "BIBLIOTECA_PAGINA_EDITADA", { tipo: "biblioteca_pagina", id }, { campos: Object.keys(dados), acesso: dados.acesso, tamanho: dados.conteudo?.length });
    return { ok: true };
  });

  app.delete("/api/biblioteca/paginas/:id", editar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [pagina] = await db.select({ titulo: bibliotecaPaginas.titulo }).from(bibliotecaPaginas).where(eq(bibliotecaPaginas.id, id));
    if (!pagina) throw new ErroHttp(404, "NAO_ENCONTRADO", "Página não encontrada.");
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(bibliotecaPaginas).where(eq(bibliotecaPaginas.paiId, id));
    if (n > 0) throw new ErroHttp(409, "TEM_SUBPAGINAS", "Mova ou exclua as subpáginas antes de excluir esta página.");
    await db.delete(bibliotecaPaginas).where(eq(bibliotecaPaginas.id, id));
    await auditar(db, req, "BIBLIOTECA_PAGINA_EXCLUIDA", { tipo: "biblioteca_pagina", id }, { titulo: pagina.titulo });
    return { ok: true };
  });
}
