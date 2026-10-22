import { and, asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { TIPOS_DOCUMENTO } from "@bybus/core";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { PAPEIS_PESSOA, pessoas } from "../db/schema.js";
import { filtroUnidade, garantirUnidadeAtiva, podeUnidade } from "../seguranca/escopo.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { camposDocumento, documentoMascarado } from "../servicos/passageiro.js";

const uuid = z.string().uuid();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const esquema = z.object({
  nome: z.string().trim().min(2).max(150),
  papeis: z.array(z.enum(PAPEIS_PESSOA)).min(1).max(4),
  unidadeId: uuid.nullish(),
  telefone: z.string().trim().max(40).nullish(),
  email: z.string().trim().email().max(200).nullish().or(z.literal("")),
  documentoTipo: z.enum(TIPOS_DOCUMENTO).nullish(),
  documento: z.string().trim().max(40).nullish(),
  cnhCategoria: z.string().trim().max(5).nullish(),
  cnhValidade: data.nullish(),
  cadasturNumero: z.string().trim().max(40).nullish(),
  cadasturValidade: data.nullish(),
  idiomas: z.array(z.string().trim().min(2).max(30)).max(10).default([]),
  diariaCentavos: z.number().int().min(0).max(10_000_00).nullish(),
  observacoes: z.string().max(2000).nullish(),
  ativo: z.boolean().default(true),
});

/**
 * Cadastro único de pessoas (guias, motoristas, colaboradores, parceiros).
 * Documento cifrado; quem só tem "pessoas:ver" (ex.: atendente escalando guia) não vê documento nem contato.
 */
export async function rotasPessoas(app: FastifyInstance, { db, config, cofre }: Contexto) {
  const gerenciar = { preHandler: exigir(config, "pessoas:gerenciar") };

  function publico(p: typeof pessoas.$inferSelect, completo: boolean) {
    const { documentoCifrado: _c, ...resto } = p;
    const base = { ...resto, documento: documentoMascarado(p.documentoFinal) };
    if (completo) return base;
    return { id: p.id, nome: p.nome, papeis: p.papeis, unidadeId: p.unidadeId, idiomas: p.idiomas, ativo: p.ativo };
  }

  app.get("/api/pessoas", { preHandler: exigir(config, "pessoas:ver") }, async (req) => {
    const q = z.object({ papel: z.enum(PAPEIS_PESSOA).optional(), unidadeId: uuid.optional(), ativos: z.enum(["true", "false"]).optional() }).parse(req.query);
    const u = req.usuario!;
    const filtros = [];
    if (q.papel) filtros.push(sql`${q.papel} = ANY(${pessoas.papeis})`);
    if (q.unidadeId) filtros.push(eq(pessoas.unidadeId, q.unidadeId));
    if (q.ativos !== "false") filtros.push(eq(pessoas.ativo, true));
    // Pessoa sem praça (atende várias) aparece para todos; com praça, só para quem tem acesso a ela.
    const escopo = filtroUnidade(u, pessoas.unidadeId as never);
    if (escopo) filtros.push(sql`(${pessoas.unidadeId} IS NULL OR ${escopo})`);
    const lista = await db.select().from(pessoas).where(and(...filtros)).orderBy(asc(pessoas.nome));
    // Completo só para quem pode editar aquela pessoa (praça dele; sem praça = só quem acessa todas).
    const gerencia = pode(u, "pessoas:gerenciar");
    return lista.map((p) => publico(p, gerencia && (p.unidadeId ? podeUnidade(u, p.unidadeId) : u.todasUnidades)));
  });

  app.get("/api/pessoas/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [p] = await db.select().from(pessoas).where(eq(pessoas.id, id));
    if (!p || (p.unidadeId ? !podeUnidade(req.usuario!, p.unidadeId) : !req.usuario!.todasUnidades)) throw new ErroHttp(404, "NAO_ENCONTRADO", "Pessoa não encontrada.");
    return publico(p, true);
  });

  app.post("/api/pessoas", gerenciar, async (req) => {
    const corpo = esquema.parse(req.body);
    if (corpo.unidadeId ? !podeUnidade(req.usuario!, corpo.unidadeId) : !req.usuario!.todasUnidades) {
      throw new ErroHttp(403, "SEM_PERMISSAO", "Você só pode cadastrar pessoas das suas praças.");
    }
    if (corpo.unidadeId) await garantirUnidadeAtiva(db, corpo.unidadeId);
    const { documento, documentoTipo, email, ...resto } = corpo;
    const [p] = await db.insert(pessoas).values({
      ...resto, email: email || null, papeis: [...new Set(corpo.papeis)], ...camposDocumentoPessoa(documentoTipo, documento),
    }).returning();
    await auditar(db, req, "PESSOA_CRIADA", { tipo: "pessoa", id: p!.id }, { papeis: p!.papeis });
    return publico(p!, true);
  });

  app.patch("/api/pessoas/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = esquema.partial().parse(req.body);
    const [atual] = await db.select().from(pessoas).where(eq(pessoas.id, id));
    const u = req.usuario!;
    if (!atual || (atual.unidadeId ? !podeUnidade(u, atual.unidadeId) : !u.todasUnidades)) throw new ErroHttp(404, "NAO_ENCONTRADO", "Pessoa não encontrada.");
    if (corpo.unidadeId !== undefined && (corpo.unidadeId ? !podeUnidade(u, corpo.unidadeId) : !u.todasUnidades)) {
      throw new ErroHttp(403, "SEM_PERMISSAO", "Você só pode mover pessoas entre as suas praças.");
    }
    if (corpo.documentoTipo !== undefined && corpo.documento === undefined) {
      throw new ErroHttp(400, "DOCUMENTO_INCOMPLETO", "Ao mudar o tipo de documento, informe também o número (ou null para remover).");
    }
    const { documento, documentoTipo, email, ...resto } = corpo;
    const mudancas: Partial<typeof pessoas.$inferInsert> = { ...resto };
    if (email !== undefined) mudancas.email = email || null;
    if (corpo.papeis) mudancas.papeis = [...new Set(corpo.papeis)];
    if (documento !== undefined) Object.assign(mudancas, camposDocumentoPessoa(documentoTipo ?? (atual.documentoTipo as never), documento));
    const [p] = await db.update(pessoas).set(mudancas).where(eq(pessoas.id, id)).returning();
    await auditar(db, req, "PESSOA_ALTERADA", { tipo: "pessoa", id }, { campos: Object.keys(corpo) });
    return publico(p!, true);
  });

  function camposDocumentoPessoa(tipo: (typeof TIPOS_DOCUMENTO)[number] | null | undefined, valor: string | null | undefined) {
    const c = camposDocumento(cofre, tipo, valor);
    return { documentoTipo: c.documentoTipo, documentoCifrado: c.documentoCifrado, documentoFinal: c.documentoFinal };
  }
}
