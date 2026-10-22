import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { CANAIS, CATEGORIAS, STATUS_EMBARQUE, TIPOS_DOCUMENTO, validarSequenciaTransfer } from "@bybus/core";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { passageiros, passeios, pontosEmbarque, reservas, saidas } from "../db/schema.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { camposDocumento, documentoMascarado } from "../servicos/passageiro.js";

const uuid = z.string().uuid();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");
const horario = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário no formato HH:MM");

const esquemaPassageiro = z.object({
  nome: z.string().trim().max(150).default(""),
  categoria: z.enum(CATEGORIAS),
  documentoTipo: z.enum(TIPOS_DOCUMENTO).nullish(),
  documento: z.string().trim().max(40).nullish(),
  documentoPais: z.string().trim().max(60).nullish(),
  pontoEmbarqueId: uuid.nullish(),
});

export async function rotasOperacao(app: FastifyInstance, { db, config, cofre }: Contexto) {
  const ver = { preHandler: exigir(config, "manifesto:ver") };
  const editar = { preHandler: exigir(config, "reservas:editar") };

  // ---------- Passeios e pontos ----------
  app.get("/api/passeios", ver, async () => db.select().from(passeios).where(eq(passeios.ativo, true)).orderBy(passeios.nome));

  app.get("/api/passeios/:id/pontos", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.select().from(pontosEmbarque).where(eq(pontosEmbarque.passeioId, id)).orderBy(asc(pontosEmbarque.ordem));
  });

  app.patch("/api/pontos/:id", { preHandler: exigir(config, "pontos:gerenciar") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = z.object({ nome: z.string().trim().min(2).max(150).optional(), endereco: z.string().max(300).nullish(), horario: horario.optional(), ativo: z.boolean().optional() }).parse(req.body);
    const [atual] = await db.select().from(pontosEmbarque).where(eq(pontosEmbarque.id, id));
    if (!atual) throw new ErroHttp(404, "NAO_ENCONTRADO", "Ponto não encontrado.");
    const todos = await db.select().from(pontosEmbarque).where(eq(pontosEmbarque.passeioId, atual.passeioId));
    const simulado = todos.map((p) => (p.id === id ? { ...p, ...corpo } : p)).filter((p) => p.ativo);
    const erros = validarSequenciaTransfer(simulado);
    if (erros.length) throw new ErroHttp(400, "ORDEM_TRANSFER", erros.join(" "));
    const [p] = await db.update(pontosEmbarque).set(corpo).where(eq(pontosEmbarque.id, id)).returning();
    await auditar(db, req, "PONTO_ALTERADO", { tipo: "ponto", id }, corpo);
    return p;
  });

  // ---------- Saídas ----------
  app.get("/api/saidas", ver, async (req) => {
    const q = z.object({ de: dataIso, ate: dataIso, passeioId: uuid.optional() }).parse(req.query);
    const filtros = [gte(saidas.data, q.de), lte(saidas.data, q.ate)];
    if (q.passeioId) filtros.push(eq(saidas.passeioId, q.passeioId));
    return db
      .select({
        id: saidas.id, data: saidas.data, status: saidas.status, capacidade: saidas.capacidade, veiculo: saidas.veiculo,
        guia: saidas.guia, motorista: saidas.motorista, passeio: passeios.nome, passeioId: passeios.id,
        reservas: sql<number>`(select count(*)::int from reservas r where r.saida_id = ${saidas.id} and r.status = 'CONFIRMADA')`,
        passageiros: sql<number>`(select count(*)::int from passageiros p join reservas r on r.id = p.reserva_id where r.saida_id = ${saidas.id} and r.status = 'CONFIRMADA')`,
        assentos: sql<number>`(select count(*)::int from passageiros p join reservas r on r.id = p.reserva_id where r.saida_id = ${saidas.id} and r.status = 'CONFIRMADA' and p.categoria <> 'COLO')`,
        pagantes: sql<number>`(select count(*)::int from passageiros p join reservas r on r.id = p.reserva_id where r.saida_id = ${saidas.id} and r.status = 'CONFIRMADA' and p.categoria not in ('COLO','CORTESIA'))`,
      })
      .from(saidas)
      .innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .where(and(...filtros))
      .orderBy(asc(saidas.data));
  });

  app.get("/api/saidas/:id", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [s] = await db
      .select({ saida: saidas, passeio: passeios })
      .from(saidas)
      .innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .where(eq(saidas.id, id));
    if (!s) throw new ErroHttp(404, "NAO_ENCONTRADO", "Saída não encontrada.");
    return s;
  });

  app.post("/api/saidas", { preHandler: exigir(config, "saidas:gerenciar") }, async (req) => {
    const corpo = z.object({ passeioId: uuid, data: dataIso, capacidade: z.number().int().min(1).max(200).optional(), veiculo: z.string().max(40).nullish() }).parse(req.body);
    const [passeio] = await db.select().from(passeios).where(eq(passeios.id, corpo.passeioId));
    if (!passeio) throw new ErroHttp(404, "NAO_ENCONTRADO", "Passeio não encontrado.");
    try {
      const [s] = await db.insert(saidas).values({ ...corpo, capacidade: corpo.capacidade ?? passeio.capacidadePadrao }).returning();
      await auditar(db, req, "SAIDA_CRIADA", { tipo: "saida", id: s!.id }, { data: corpo.data });
      return s;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErroHttp(409, "SAIDA_EXISTE", "Já existe saída deste passeio nesta data.");
      throw e;
    }
  });

  app.patch("/api/saidas/:id", { preHandler: exigir(config, "saidas:gerenciar") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = z.object({
      status: z.enum(["PREVISTA", "CONFIRMADA", "CANCELADA", "REALIZADA"]).optional(),
      capacidade: z.number().int().min(1).max(200).optional(),
      veiculo: z.string().max(40).nullish(), guia: z.string().max(120).nullish(), motorista: z.string().max(120).nullish(),
      observacoes: z.string().max(2000).nullish(),
    }).parse(req.body);
    if (corpo.status !== undefined && !pode(req.usuario!.perfil, "saidas:decidir")) {
      throw new ErroHttp(403, "SEM_PERMISSAO", "Mudar o status da saída é decisão do supervisor.");
    }
    const [s] = await db.update(saidas).set(corpo).where(eq(saidas.id, id)).returning();
    if (!s) throw new ErroHttp(404, "NAO_ENCONTRADO", "Saída não encontrada.");
    await auditar(db, req, "SAIDA_ALTERADA", { tipo: "saida", id }, corpo);
    return s;
  });

  // ---------- Reservas ----------
  app.get("/api/saidas/:id/reservas", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const verContatos = pode(req.usuario!.perfil, "manifesto:contatos");
    await auditar(db, req, "RESERVAS_VISUALIZADAS", { tipo: "saida", id });
    const lista = await db.select().from(reservas).where(eq(reservas.saidaId, id)).orderBy(asc(reservas.contatoNome));
    const pax = lista.length ? await db.select().from(passageiros).where(inArray(passageiros.reservaId, lista.map((r) => r.id))).orderBy(asc(passageiros.seq)) : [];
    return lista.map((r) => ({
      ...r,
      contatoTelefone: verContatos ? r.contatoTelefone : null,
      contatoEmail: verContatos ? r.contatoEmail : null,
      passageiros: pax.filter((p) => p.reservaId === r.id).map(({ documentoCifrado: _c, ...p }) => ({ ...p, documento: documentoMascarado(p.documentoFinal) })),
    }));
  });

  app.post("/api/saidas/:id/reservas", editar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = z.object({
      canal: z.enum(CANAIS),
      codigoExterno: z.string().trim().max(60).nullish(),
      contatoNome: z.string().trim().min(2).max(150),
      contatoTelefone: z.string().trim().max(40).nullish(),
      contatoEmail: z.string().trim().email().max(200).nullish().or(z.literal("")),
      pontoEmbarqueId: uuid.nullish(),
      observacoes: z.string().max(2000).nullish(),
      passageiros: z.array(esquemaPassageiro).min(1).max(80),
    }).parse(req.body);
    const [saida] = await db.select().from(saidas).where(eq(saidas.id, id));
    if (!saida) throw new ErroHttp(404, "NAO_ENCONTRADO", "Saída não encontrada.");
    const resultado = await db.transaction(async (tx) => {
      const [r] = await tx.insert(reservas).values({
        saidaId: id, canal: corpo.canal, canalOrigem: corpo.canal, codigoExterno: corpo.codigoExterno || null,
        contatoNome: corpo.contatoNome, contatoTelefone: corpo.contatoTelefone || null, contatoEmail: corpo.contatoEmail || null,
        pontoEmbarqueId: corpo.pontoEmbarqueId ?? null, observacoes: corpo.observacoes ?? null,
      }).returning();
      await tx.insert(passageiros).values(corpo.passageiros.map((p) => ({
        reservaId: r!.id, nome: p.nome, categoria: p.categoria, documentoPais: p.documentoPais ?? null,
        pontoEmbarqueId: p.pontoEmbarqueId ?? null, ...camposDocumento(cofre, p.documentoTipo, p.documento),
      })));
      return r!;
    }).catch((e) => {
      if ((e as { code?: string }).code === "23505") throw new ErroHttp(409, "RESERVA_EXISTE", "Já existe reserva com este canal e código.");
      throw e;
    });
    await auditar(db, req, "RESERVA_CRIADA", { tipo: "reserva", id: resultado.id }, { canal: corpo.canal, passageiros: corpo.passageiros.length });
    return resultado;
  });

  app.patch("/api/reservas/:id", editar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = z.object({
      contatoNome: z.string().trim().min(2).max(150).optional(),
      contatoTelefone: z.string().trim().max(40).nullish(),
      contatoEmail: z.string().trim().email().max(200).nullish().or(z.literal("")),
      pontoEmbarqueId: uuid.nullish(),
      observacoes: z.string().max(2000).nullish(),
      status: z.enum(["CONFIRMADA", "CANCELADA"]).optional(),
      saidaId: uuid.optional(),
    }).parse(req.body);
    const { contatoEmail, ...resto } = corpo;
    // Só altera o e-mail quando o campo vier na requisição ("" ou null limpam).
    const [r] = await db.update(reservas).set({ ...resto, ...(contatoEmail !== undefined ? { contatoEmail: contatoEmail || null } : {}), atualizadoEm: new Date() }).where(eq(reservas.id, id)).returning();
    if (!r) throw new ErroHttp(404, "NAO_ENCONTRADO", "Reserva não encontrada.");
    await auditar(db, req, corpo.status === "CANCELADA" ? "RESERVA_CANCELADA" : "RESERVA_ALTERADA", { tipo: "reserva", id }, { campos: Object.keys(corpo), status: corpo.status }); // sem dados pessoais na auditoria
    return r;
  });

  // ---------- Passageiros ----------
  app.post("/api/reservas/:id/passageiros", editar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const p = esquemaPassageiro.parse(req.body);
    const [r] = await db.select({ id: reservas.id }).from(reservas).where(eq(reservas.id, id));
    if (!r) throw new ErroHttp(404, "NAO_ENCONTRADO", "Reserva não encontrada.");
    const [novo] = await db.insert(passageiros).values({ reservaId: id, nome: p.nome, categoria: p.categoria, documentoPais: p.documentoPais ?? null, pontoEmbarqueId: p.pontoEmbarqueId ?? null, ...camposDocumento(cofre, p.documentoTipo, p.documento) }).returning({ id: passageiros.id });
    await auditar(db, req, "PASSAGEIRO_INCLUIDO", { tipo: "passageiro", id: novo!.id });
    return novo;
  });

  app.patch("/api/passageiros/:id", editar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const p = esquemaPassageiro.partial().parse(req.body);
    const mudancas: Partial<typeof passageiros.$inferInsert> = {};
    if (p.nome !== undefined) mudancas.nome = p.nome;
    if (p.categoria) mudancas.categoria = p.categoria;
    if (p.documentoPais !== undefined) mudancas.documentoPais = p.documentoPais ?? null;
    if (p.pontoEmbarqueId !== undefined) mudancas.pontoEmbarqueId = p.pontoEmbarqueId ?? null;
    if (p.documentoTipo !== undefined && p.documento === undefined) {
      throw new ErroHttp(400, "DOCUMENTO_INCOMPLETO", "Ao mudar o tipo de documento, informe também o número (ou null para remover).");
    }
    if (p.documento !== undefined) Object.assign(mudancas, camposDocumento(cofre, p.documentoTipo, p.documento));
    const [atualizado] = await db.update(passageiros).set(mudancas).where(eq(passageiros.id, id)).returning({ id: passageiros.id });
    if (!atualizado) throw new ErroHttp(404, "NAO_ENCONTRADO", "Passageiro não encontrado.");
    await auditar(db, req, "PASSAGEIRO_ALTERADO", { tipo: "passageiro", id }, { campos: Object.keys(mudancas).filter((k) => !k.startsWith("documento")) .concat(p.documento !== undefined ? ["documento"] : []) });
    return atualizado;
  });

  app.delete("/api/passageiros/:id", editar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [removido] = await db.delete(passageiros).where(eq(passageiros.id, id)).returning({ id: passageiros.id });
    if (!removido) throw new ErroHttp(404, "NAO_ENCONTRADO", "Passageiro não encontrado.");
    await auditar(db, req, "PASSAGEIRO_REMOVIDO", { tipo: "passageiro", id });
    return { ok: true };
  });

  app.post("/api/passageiros/:id/embarque", { preHandler: exigir(config, "embarque:registrar") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { status } = z.object({ status: z.enum(STATUS_EMBARQUE) }).parse(req.body);
    const [p] = await db.update(passageiros).set({
      embarque: status,
      embarqueEm: status === "PENDENTE" ? null : new Date(),
      embarquePor: status === "PENDENTE" ? null : req.usuario!.id,
    }).where(eq(passageiros.id, id)).returning({ id: passageiros.id, embarque: passageiros.embarque });
    if (!p) throw new ErroHttp(404, "NAO_ENCONTRADO", "Passageiro não encontrado.");
    await auditar(db, req, "EMBARQUE_REGISTRADO", { tipo: "passageiro", id }, { status });
    return p;
  });
}
