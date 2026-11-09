import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Contexto } from "../app.js";
import type { Config } from "../config.js";
import { cofreConfig, cofreItens, cofreMembros, cofreRegistro, cofreSetores, perfis, usuarios } from "../db/schema.js";
import { conferirSenha } from "../seguranca/senha.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";

/**
 * Cofre de senhas (pedido do dono, 09/11/2026: "copie o formato do Cofre de senhas da TOMA"). Segurança:
 * - usuário, senha e observações cifrados (AES-256-GCM) com COFRE_CHAVE, que fica só no .env do servidor (fora do banco e dos backups);
 * - só o gestor do Cofre cria setores e indica, pessoa por pessoa, quem vê e quem edita; cada setor só aparece para quem foi indicado,
 *   inclusive administradores e o próprio gestor;
 * - para entrar, a pessoa confirma a própria senha do sistema (vale 15 minutos, cookie só do Cofre); 5 erros travam 15 minutos;
 * - a senha só sai do servidor ao clicar em mostrar/copiar, e cada vez fica no registro (só o gestor vê);
 * - fora da busca geral, da IA, dos logs e das exportações.
 */
const MINUTOS = 15;
const COOKIE = "bybus_cofre";

function chave(c: Config) {
  return c.COFRE_CHAVE ? createHash("sha256").update(c.COFRE_CHAVE).digest() : null;
}
function cifrar(c: Config, texto: string | null | undefined, campo: string): string | null {
  if (texto == null || texto === "") return null;
  const k = chave(c);
  if (!k) throw new ErroHttp(503, "COFRE_NAO_CONFIGURADO", "O Cofre ainda não foi configurado (falta a chave no servidor).");
  const iv = randomBytes(12);
  const ci = createCipheriv("aes-256-gcm", k, iv);
  ci.setAAD(Buffer.from(`cofre:${campo}`));
  const dados = Buffer.concat([ci.update(texto, "utf8"), ci.final()]);
  return `v1:${Buffer.concat([iv, ci.getAuthTag(), dados]).toString("base64")}`;
}
function decifrar(c: Config, guardado: string | null, campo: string): string {
  if (!guardado) return "";
  const k = chave(c);
  if (!k) throw new ErroHttp(503, "COFRE_NAO_CONFIGURADO", "O Cofre ainda não foi configurado (falta a chave no servidor).");
  try {
    const b = Buffer.from(guardado.replace(/^v1:/, ""), "base64");
    const d = createDecipheriv("aes-256-gcm", k, b.subarray(0, 12));
    d.setAAD(Buffer.from(`cofre:${campo}`));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch {
    throw new ErroHttp(500, "COFRE_CHAVE_DIFERENTE", "Não foi possível abrir este item: a chave do Cofre não confere com a usada para guardá-lo.");
  }
}

// Tentativas erradas da senha de entrada, por pessoa (só na memória).
const erros = new Map<string, { n: number; desde: number }>();
const travado = (id: string) => { const t = erros.get(id); return !!t && t.n >= 5 && Date.now() - t.desde < MINUTOS * 60_000; };
const errou = (id: string) => { const t = erros.get(id); if (!t || Date.now() - t.desde > MINUTOS * 60_000) erros.set(id, { n: 1, desde: Date.now() }); else t.n++; };

export async function rotasCofre(app: FastifyInstance, { db, config }: Contexto) {
  const logado = { preHandler: exigir(config) };
  const segredo = createHash("sha256").update(`${config.CHAVE_CRIPTOGRAFIA}:cofre`).digest();
  const assinar = (id: string, exp: number) => createHmac("sha256", segredo).update(`${id}.${exp}`).digest("base64url");

  /** O Cofre está aberto para esta pessoa? (cookie próprio, 15 minutos; devolve até quando) */
  function abertoAte(req: FastifyRequest): number {
    const [id, exp, sig] = String(req.cookies?.[COOKIE] ?? "").split(".");
    if (!id || !exp || !sig || id !== req.usuario?.id || Number(exp) < Date.now()) return 0;
    const esperado = Buffer.from(assinar(id, Number(exp)));
    const recebido = Buffer.from(sig);
    return esperado.length === recebido.length && timingSafeEqual(esperado, recebido) ? Number(exp) : 0;
  }
  const exigirAberto = { preHandler: [exigir(config), async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    if (!abertoAte(req)) throw new ErroHttp(423, "COFRE_TRANCADO", "Confirme sua senha para abrir o Cofre.");
  }] };

  async function gestorId(): Promise<string | null> {
    const [c] = await db.select().from(cofreConfig).where(eq(cofreConfig.id, "padrao"));
    if (c?.gestorId) return c.gestorId;
    // Sem gestor (instalação nova): o primeiro administrador.
    const [a] = await db.select({ id: usuarios.id }).from(usuarios).innerJoin(perfis, eq(perfis.id, usuarios.perfilId)).where(eq(perfis.codigo, "ADMIN")).orderBy(asc(usuarios.criadoEm)).limit(1);
    if (!a) return null;
    await db.insert(cofreConfig).values({ id: "padrao", gestorId: a.id }).onConflictDoUpdate({ target: cofreConfig.id, set: { gestorId: a.id } });
    return a.id;
  }
  const ehGestor = async (req: FastifyRequest) => (await gestorId()) === req.usuario!.id;
  const soGestor = async (req: FastifyRequest) => {
    if (!(await ehGestor(req))) throw new ErroHttp(403, "SO_GESTOR", "Só o gestor do Cofre cria os setores, indica as pessoas e vê o registro.");
  };
  const meusSetores = (usuarioId: string) => db.select({ id: cofreSetores.id, nome: cofreSetores.nome, podeEditar: cofreMembros.podeEditar })
    .from(cofreSetores).innerJoin(cofreMembros, eq(cofreMembros.setorId, cofreSetores.id)).where(eq(cofreMembros.usuarioId, usuarioId)).orderBy(asc(cofreSetores.nome));
  async function exigirSetor(req: FastifyRequest, setorId: string, editar: boolean) {
    const s = (await meusSetores(req.usuario!.id)).find((x) => x.id === setorId);
    if (!s) throw new ErroHttp(403, "SEM_SETOR", "Você não tem acesso a este setor do Cofre.");
    if (editar && !s.podeEditar) throw new ErroHttp(403, "SO_VER", "Você só pode ver as senhas deste setor.");
    return s;
  }
  async function itemDoSetor(req: FastifyRequest, id: string, editar: boolean) {
    const [i] = await db.select().from(cofreItens).where(eq(cofreItens.id, id));
    if (!i) throw new ErroHttp(404, "NAO_ENCONTRADO", "Item não encontrado no Cofre.");
    await exigirSetor(req, i.setorId, editar);
    return i;
  }
  const registrar = (req: FastifyRequest, acao: string, item?: { id: string; titulo: string } | null, detalhe?: string, titulo?: string) =>
    db.insert(cofreRegistro).values({ itemId: item?.id ?? null, titulo: item?.titulo ?? titulo ?? null, usuarioId: req.usuario!.id, acao, detalhe: detalhe ?? null });

  const uuid = z.string().uuid();
  const txt = (n: number) => z.string().max(n).optional().nullable().transform((v) => (v ?? "").trim());

  // ---------- entrar / sair ----------
  app.get("/api/cofre/estado", logado, async (req) => {
    const ate = abertoAte(req);
    return { configurado: !!chave(config), aberto: !!ate, ate: ate ? new Date(ate).toISOString() : null, gestor: await ehGestor(req), temSetor: (await meusSetores(req.usuario!.id)).length > 0 };
  });

  app.post("/api/cofre/abrir", { ...logado, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const u = req.usuario!;
    if (travado(u.id)) throw new ErroHttp(429, "COFRE_TRAVADO", "Muitas tentativas. Aguarde 15 minutos e tente de novo.");
    const { senha } = z.object({ senha: z.string().max(200) }).parse(req.body);
    const [linha] = await db.select({ hash: usuarios.senhaHash }).from(usuarios).where(eq(usuarios.id, u.id));
    if (!linha || !(await conferirSenha(linha.hash, senha))) {
      errou(u.id);
      await registrar(req, "errou");
      throw new ErroHttp(400, "SENHA_INCORRETA", "Senha incorreta.");
    }
    erros.delete(u.id);
    await registrar(req, "entrar");
    const exp = Date.now() + MINUTOS * 60_000;
    reply.setCookie(COOKIE, `${u.id}.${exp}.${assinar(u.id, exp)}`, {
      httpOnly: true, sameSite: "strict", secure: config.AMBIENTE !== "desenvolvimento" && config.AMBIENTE !== "testes", path: "/api/cofre", maxAge: MINUTOS * 60,
    });
    return { ok: true, ate: new Date(exp).toISOString() };
  });

  app.post("/api/cofre/fechar", logado, async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: "/api/cofre" });
    return { ok: true };
  });

  // ---------- senhas ----------
  /** Lista sem senha nem observações (só saem por mostrar/copiar). */
  app.get("/api/cofre/itens", exigirAberto, async (req) => {
    const setores = await meusSetores(req.usuario!.id);
    const ids = setores.map((s) => s.id);
    const linhas = ids.length ? await db.select({
      id: cofreItens.id, setorId: cofreItens.setorId, titulo: cofreItens.titulo, categoria: cofreItens.categoria, url: cofreItens.url,
      usuarioCifrado: cofreItens.usuarioCifrado, temSenha: sql<boolean>`${cofreItens.senhaCifrada} is not null`, temNotas: sql<boolean>`${cofreItens.notasCifradas} is not null`,
      atualizadoEm: cofreItens.atualizadoEm, atualizadoPorNome: usuarios.nome,
    }).from(cofreItens).leftJoin(usuarios, eq(usuarios.id, cofreItens.atualizadoPor)).where(inArray(cofreItens.setorId, ids))
      .orderBy(sql`lower(coalesce(${cofreItens.categoria}, ''))`, sql`lower(${cofreItens.titulo})`) : [];
    return { setores, itens: linhas.map(({ usuarioCifrado, ...r }) => ({ ...r, usuario: decifrar(config, usuarioCifrado, "usuario") })) };
  });

  app.post("/api/cofre/itens/:id/revelar", { ...exigirAberto, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ campo: z.enum(["senha", "notas"]).default("senha"), acao: z.enum(["ver", "copiar"]).default("ver") }).parse(req.body ?? {});
    const i = await itemDoSetor(req, id, false);
    const valor = decifrar(config, b.campo === "notas" ? i.notasCifradas : i.senhaCifrada, b.campo);
    await registrar(req, b.acao, i);
    return { valor };
  });

  const corpoItem = z.object({ setorId: uuid, titulo: txt(200), categoria: txt(80), url: txt(500), usuario: txt(300), senha: txt(1000), notas: txt(5000) });
  app.post("/api/cofre/itens", exigirAberto, async (req) => {
    const b = corpoItem.parse(req.body);
    if (!b.titulo) throw new ErroHttp(400, "SEM_NOME", "Dê um nome ao item (ex.: Instagram da By Bus).");
    await exigirSetor(req, b.setorId, true);
    const [i] = await db.insert(cofreItens).values({
      setorId: b.setorId, titulo: b.titulo, categoria: b.categoria || null, url: b.url || null,
      usuarioCifrado: cifrar(config, b.usuario, "usuario"), senhaCifrada: cifrar(config, b.senha, "senha"), notasCifradas: cifrar(config, b.notas, "notas"),
      criadoPor: req.usuario!.id, atualizadoPor: req.usuario!.id,
    }).returning({ id: cofreItens.id, titulo: cofreItens.titulo });
    await registrar(req, "criar", i);
    return i;
  });

  app.patch("/api/cofre/itens/:id", exigirAberto, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = corpoItem.partial().parse(req.body);
    const i = await itemDoSetor(req, id, true);
    if (b.setorId && b.setorId !== i.setorId) await exigirSetor(req, b.setorId, true); // mover: precisa editar os dois
    if (b.titulo !== undefined && !b.titulo) throw new ErroHttp(400, "SEM_NOME", "O nome não pode ficar vazio.");
    const v: Partial<typeof cofreItens.$inferInsert> = { atualizadoPor: req.usuario!.id, atualizadoEm: new Date() };
    if (b.titulo !== undefined) v.titulo = b.titulo;
    if (b.categoria !== undefined) v.categoria = b.categoria || null;
    if (b.url !== undefined) v.url = b.url || null;
    if (b.setorId !== undefined) v.setorId = b.setorId;
    if (b.usuario !== undefined) v.usuarioCifrado = cifrar(config, b.usuario, "usuario");
    if (b.senha !== undefined) v.senhaCifrada = cifrar(config, b.senha, "senha");
    if (b.notas !== undefined) v.notasCifradas = cifrar(config, b.notas, "notas");
    await db.update(cofreItens).set(v).where(eq(cofreItens.id, id));
    await registrar(req, "editar", i);
    return { ok: true };
  });

  /** Importar da planilha: o navegador lê as linhas coladas e manda já separadas; aqui só cifra e grava (até 500). */
  app.post("/api/cofre/itens/importar", { ...exigirAberto, bodyLimit: 3 * 1024 * 1024 }, async (req) => {
    const b = z.object({ setorId: uuid, itens: z.array(corpoItem.omit({ setorId: true })).max(500) }).parse(req.body);
    const s = await exigirSetor(req, b.setorId, true);
    const itens = b.itens.filter((x) => x.titulo);
    if (!itens.length) throw new ErroHttp(400, "NADA", "Nenhuma linha com nome para importar.");
    await db.insert(cofreItens).values(itens.map((x) => ({
      setorId: b.setorId, titulo: x.titulo, categoria: x.categoria || null, url: x.url || null,
      usuarioCifrado: cifrar(config, x.usuario, "usuario"), senhaCifrada: cifrar(config, x.senha, "senha"), notasCifradas: cifrar(config, x.notas, "notas"),
      criadoPor: req.usuario!.id, atualizadoPor: req.usuario!.id,
    })));
    await registrar(req, "importar", null, `${itens.length} senha(s)`, s.nome);
    return { ok: true, n: itens.length };
  });

  app.post("/api/cofre/itens/excluir", exigirAberto, async (req) => {
    const { ids } = z.object({ ids: z.array(uuid).min(1).max(500) }).parse(req.body);
    const itens = [];
    for (const id of ids) itens.push(await itemDoSetor(req, id, true));
    for (const i of itens) await registrar(req, "excluir", null, undefined, i.titulo);
    await db.delete(cofreItens).where(inArray(cofreItens.id, ids));
    return { ok: true, n: ids.length };
  });

  // ---------- setores e pessoas (só o gestor) ----------
  const gestor = { preHandler: [...exigirAberto.preHandler, soGestor] };
  app.get("/api/cofre/setores", gestor, async () => {
    const setores = await db.select().from(cofreSetores).orderBy(asc(cofreSetores.nome));
    const membros = await db.select().from(cofreMembros);
    const contagem = await db.select({ setorId: cofreItens.setorId, n: sql<number>`count(*)::int` }).from(cofreItens).groupBy(cofreItens.setorId);
    const pessoas = await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(eq(usuarios.ativo, true)).orderBy(asc(usuarios.nome));
    return {
      setores: setores.map((s) => ({ ...s, itens: contagem.find((c) => c.setorId === s.id)?.n ?? 0, membros: membros.filter((m) => m.setorId === s.id).map((m) => ({ usuarioId: m.usuarioId, podeEditar: m.podeEditar })) })),
      pessoas,
    };
  });

  const corpoMembros = z.array(z.object({ usuarioId: uuid, podeEditar: z.boolean() })).max(500);
  const nivel = (m?: { podeEditar: boolean }) => (m ? (m.podeEditar ? "vê e edita" : "vê") : "sem acesso");
  async function salvarMembros(req: FastifyRequest, setorId: string, nomeSetor: string, membros: z.infer<typeof corpoMembros>) {
    const antes = await db.select().from(cofreMembros).where(eq(cofreMembros.setorId, setorId));
    await db.transaction(async (tx) => {
      await tx.delete(cofreMembros).where(eq(cofreMembros.setorId, setorId));
      if (membros.length) await tx.insert(cofreMembros).values(membros.map((m) => ({ setorId, ...m }))).onConflictDoNothing();
    });
    const ids = [...new Set([...antes.map((m) => m.usuarioId), ...membros.map((m) => m.usuarioId)])];
    const nomes = ids.length ? await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(inArray(usuarios.id, ids)) : [];
    for (const id of ids) {
      const a = antes.find((m) => m.usuarioId === id);
      const d = membros.find((m) => m.usuarioId === id);
      if (nivel(a) !== nivel(d)) await registrar(req, "pessoas", null, `${nomes.find((n) => n.id === id)?.nome ?? "alguém"}: ${nivel(d)}`, nomeSetor);
    }
  }

  app.post("/api/cofre/setores", gestor, async (req) => {
    const b = z.object({ nome: z.string().trim().min(1, "Dê um nome ao setor (ex.: Marketing).").max(80), membros: corpoMembros.optional() }).parse(req.body);
    const [s] = await db.insert(cofreSetores).values({ nome: b.nome }).returning();
    // Quem cria (o gestor) já entra como editor; pode se tirar depois.
    await salvarMembros(req, s!.id, s!.nome, b.membros ?? [{ usuarioId: req.usuario!.id, podeEditar: true }]);
    return s;
  });

  app.patch("/api/cofre/setores/:id", gestor, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ nome: z.string().trim().min(1).max(80).optional(), membros: corpoMembros.optional() }).parse(req.body);
    const [s] = await db.select().from(cofreSetores).where(eq(cofreSetores.id, id));
    if (!s) throw new ErroHttp(404, "NAO_ENCONTRADO", "Setor não encontrado.");
    if (b.nome) await db.update(cofreSetores).set({ nome: b.nome }).where(eq(cofreSetores.id, id));
    if (b.membros) await salvarMembros(req, id, b.nome ?? s.nome, b.membros);
    return { ok: true };
  });

  app.delete("/api/cofre/setores/:id", gestor, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [s] = await db.delete(cofreSetores).where(eq(cofreSetores.id, id)).returning();
    if (!s) throw new ErroHttp(404, "NAO_ENCONTRADO", "Setor não encontrado.");
    await registrar(req, "excluir", null, "setor inteiro, com as senhas", s.nome);
    return { ok: true };
  });

  app.get("/api/cofre/registro", gestor, async () => db.select({
    id: cofreRegistro.id, acao: cofreRegistro.acao, em: cofreRegistro.em, detalhe: cofreRegistro.detalhe,
    titulo: sql<string | null>`coalesce(${cofreItens.titulo}, ${cofreRegistro.titulo})`, pessoa: usuarios.nome,
  }).from(cofreRegistro).leftJoin(cofreItens, eq(cofreItens.id, cofreRegistro.itemId)).leftJoin(usuarios, eq(usuarios.id, cofreRegistro.usuarioId))
    .orderBy(desc(cofreRegistro.em)).limit(500));

}
