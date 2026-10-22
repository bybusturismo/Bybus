import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { CANAIS, CATEGORIAS, STATUS_EMBARQUE, TIPOS_DOCUMENTO, validarSequenciaTransfer } from "@bybus/core";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { LINHAS_NEGOCIO, passageiros, passeios, pessoas, pontosEmbarque, reservas, saidas, unidades } from "../db/schema.js";
import { filtroUnidade, garantirPassageiro, garantirPasseio, garantirPonto, garantirReserva, garantirSaida, garantirUnidadeAtiva } from "../seguranca/escopo.js";
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

const { padraoProduto: _p, ...passeiosColunas } = {
  id: passeios.id, codigo: passeios.codigo, nome: passeios.nome, cidade: passeios.cidade, unidadeId: passeios.unidadeId, linha: passeios.linha,
  capacidadePadrao: passeios.capacidadePadrao, minimoConfirmacao: passeios.minimoConfirmacao, minimoSupervisor: passeios.minimoSupervisor,
  ativo: passeios.ativo, padraoProduto: passeios.padraoProduto,
};

export async function rotasOperacao(app: FastifyInstance, { db, config, cofre }: Contexto) {
  /** Ponto de embarque precisa ser do mesmo passeio da saída (evita misturar roteiros). */
  async function validarPontoDaSaida(saidaId: string, pontoId: string | null | undefined) {
    if (!pontoId) return;
    const [ok] = await db.select({ id: pontosEmbarque.id }).from(pontosEmbarque)
      .innerJoin(saidas, eq(saidas.passeioId, pontosEmbarque.passeioId))
      .where(and(eq(pontosEmbarque.id, pontoId), eq(saidas.id, saidaId)));
    if (!ok) throw new ErroHttp(400, "PONTO_INVALIDO", "Ponto de embarque não pertence a este passeio.");
  }

  /** Guia/motorista precisa existir, estar ativo, ter o papel e ser da mesma praça (ou sem praça). */
  async function validarPessoa(id: string | null | undefined, papel: "GUIA" | "MOTORISTA", unidadeId: string) {
    if (!id) return null;
    const [p] = await db.select().from(pessoas).where(eq(pessoas.id, id));
    if (!p || !p.ativo || !p.papeis.includes(papel) || (p.unidadeId && p.unidadeId !== unidadeId)) {
      throw new ErroHttp(400, "PESSOA_INVALIDA", papel === "GUIA" ? "Guia inválido(a) para esta praça." : "Motorista inválido(a) para esta praça.");
    }
    return p;
  }

  const ver = { preHandler: exigir(config, "manifesto:ver") };
  const editar = { preHandler: exigir(config, "reservas:editar") };

  // ---------- Passeios e pontos ----------
  app.get("/api/passeios", ver, async (req) =>
    db.select({ ...passeiosColunas, unidade: unidades.nome, unidadeCodigo: unidades.codigo })
      .from(passeios).innerJoin(unidades, eq(unidades.id, passeios.unidadeId))
      .where(and(eq(passeios.ativo, true), filtroUnidade(req.usuario!)))
      .orderBy(passeios.nome));

  const esquemaPasseio = z.object({
    codigo: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_]+$/),
    nome: z.string().trim().min(2).max(150),
    cidade: z.string().trim().min(2).max(120),
    unidadeId: uuid,
    linha: z.enum(LINHAS_NEGOCIO),
    capacidadePadrao: z.number().int().min(1).max(200),
    minimoConfirmacao: z.number().int().min(0).max(200).default(0),
    minimoSupervisor: z.number().int().min(0).max(200).default(0),
    ativo: z.boolean().default(true),
  });

  app.post("/api/passeios", { preHandler: exigir(config, "produtos:gerenciar") }, async (req) => {
    const corpo = esquemaPasseio.parse(req.body);
    if (!req.usuario!.todasUnidades && !req.usuario!.unidadeIds.includes(corpo.unidadeId)) throw new ErroHttp(403, "SEM_PERMISSAO", "Você só pode cadastrar passeios das suas praças.");
    await garantirUnidadeAtiva(db, corpo.unidadeId);
    try {
      const [p] = await db.insert(passeios).values({ ...corpo, codigo: corpo.codigo.toUpperCase() }).returning();
      await auditar(db, req, "PASSEIO_CRIADO", { tipo: "passeio", id: p!.id }, { codigo: p!.codigo, linha: p!.linha });
      return p;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErroHttp(409, "PASSEIO_EXISTE", "Já existe passeio com este código.");
      throw e;
    }
  });

  app.patch("/api/passeios/:id", { preHandler: exigir(config, "produtos:gerenciar") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = esquemaPasseio.omit({ codigo: true, unidadeId: true }).partial().parse(req.body);
    await garantirPasseio(db, req.usuario!, id);
    const [p] = await db.update(passeios).set(corpo).where(eq(passeios.id, id)).returning();
    await auditar(db, req, "PASSEIO_ALTERADO", { tipo: "passeio", id }, corpo);
    return p;
  });

  app.get("/api/passeios/:id/pontos", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await garantirPasseio(db, req.usuario!, id);
    return db.select().from(pontosEmbarque).where(eq(pontosEmbarque.passeioId, id)).orderBy(asc(pontosEmbarque.ordem));
  });

  app.patch("/api/pontos/:id", { preHandler: exigir(config, "pontos:gerenciar") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = z.object({ nome: z.string().trim().min(2).max(150).optional(), endereco: z.string().max(300).nullish(), horario: horario.optional(), ativo: z.boolean().optional() }).parse(req.body);
    await garantirPonto(db, req.usuario!, id);
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
    const q = z.object({ de: dataIso, ate: dataIso, passeioId: uuid.optional(), unidadeId: uuid.optional() }).parse(req.query);
    const filtros = [gte(saidas.data, q.de), lte(saidas.data, q.ate)];
    if (q.passeioId) filtros.push(eq(saidas.passeioId, q.passeioId));
    if (q.unidadeId) filtros.push(eq(passeios.unidadeId, q.unidadeId));
    const escopo = filtroUnidade(req.usuario!);
    if (escopo) filtros.push(escopo);
    return db
      .select({
        id: saidas.id, data: saidas.data, status: saidas.status, capacidade: saidas.capacidade, veiculo: saidas.veiculo,
        guia: saidas.guia, motorista: saidas.motorista, guiaId: saidas.guiaId, motoristaId: saidas.motoristaId,
        passeio: passeios.nome, passeioId: passeios.id, linha: passeios.linha, unidadeId: passeios.unidadeId,
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
    await garantirSaida(db, req.usuario!, id);
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
    await garantirUnidadeAtiva(db, await garantirPasseio(db, req.usuario!, corpo.passeioId));
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
      veiculo: z.string().max(40).nullish(),
      // Guia e motorista vêm do cadastro de pessoas (o nome em texto é preenchido pelo sistema).
      guiaId: uuid.nullish(), motoristaId: uuid.nullish(),
      observacoes: z.string().max(2000).nullish(),
    }).parse(req.body);
    const unidadeId = await garantirSaida(db, req.usuario!, id);
    // Guia/motorista do cadastro: valida e mantém o nome em texto (compatibilidade com telas atuais).
    const extras: { guia?: string | null; motorista?: string | null } = {};
    if (corpo.guiaId !== undefined) extras.guia = (await validarPessoa(corpo.guiaId, "GUIA", unidadeId))?.nome ?? null;
    if (corpo.motoristaId !== undefined) extras.motorista = (await validarPessoa(corpo.motoristaId, "MOTORISTA", unidadeId))?.nome ?? null;
    if (corpo.status !== undefined && !pode(req.usuario!, "saidas:decidir")) {
      throw new ErroHttp(403, "SEM_PERMISSAO", "Mudar o status da saída é decisão do supervisor.");
    }
    const [s] = await db.update(saidas).set({ ...corpo, ...extras }).where(eq(saidas.id, id)).returning();
    if (!s) throw new ErroHttp(404, "NAO_ENCONTRADO", "Saída não encontrada.");
    await auditar(db, req, "SAIDA_ALTERADA", { tipo: "saida", id }, { campos: Object.keys(corpo), status: corpo.status });
    return s;
  });

  // ---------- Reservas ----------
  app.get("/api/saidas/:id/reservas", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await garantirSaida(db, req.usuario!, id);
    const verContatos = pode(req.usuario!, "manifesto:contatos");
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
    await garantirSaida(db, req.usuario!, id);
    await validarPontoDaSaida(id, corpo.pontoEmbarqueId);
    for (const p of corpo.passageiros) await validarPontoDaSaida(id, p.pontoEmbarqueId);
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
    const saidaAtual = await garantirReserva(db, req.usuario!, id);
    if (corpo.saidaId && corpo.saidaId !== saidaAtual) {
      const destino = await garantirSaida(db, req.usuario!, corpo.saidaId);
      const origem = await garantirSaida(db, req.usuario!, saidaAtual);
      if (destino !== origem) throw new ErroHttp(400, "PRACA_DIFERENTE", "Não é possível mover a reserva para outra praça.");
    }
    await validarPontoDaSaida(corpo.saidaId ?? saidaAtual, corpo.pontoEmbarqueId);
    const mudouSaida = !!corpo.saidaId && corpo.saidaId !== saidaAtual;
    if (mudouSaida) {
      // Pontos antigos podem ser de outro roteiro: mantém só se forem do passeio da nova saída.
      if (corpo.pontoEmbarqueId === undefined) corpo.pontoEmbarqueId = null;
      const novos = await db.select({ id: pontosEmbarque.id }).from(pontosEmbarque).innerJoin(saidas, eq(saidas.passeioId, pontosEmbarque.passeioId)).where(eq(saidas.id, corpo.saidaId!));
      const validos = novos.map((x) => x.id);
      const pax = await db.select({ id: passageiros.id, ponto: passageiros.pontoEmbarqueId }).from(passageiros).where(eq(passageiros.reservaId, id));
      for (const p of pax) if (p.ponto && !validos.includes(p.ponto)) await db.update(passageiros).set({ pontoEmbarqueId: null }).where(eq(passageiros.id, p.id));
    }
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
    const saidaId = await garantirReserva(db, req.usuario!, id);
    await validarPontoDaSaida(saidaId, p.pontoEmbarqueId);
    const [novo] = await db.insert(passageiros).values({ reservaId: id, nome: p.nome, categoria: p.categoria, documentoPais: p.documentoPais ?? null, pontoEmbarqueId: p.pontoEmbarqueId ?? null, ...camposDocumento(cofre, p.documentoTipo, p.documento) }).returning({ id: passageiros.id });
    await auditar(db, req, "PASSAGEIRO_INCLUIDO", { tipo: "passageiro", id: novo!.id });
    return novo;
  });

  app.patch("/api/passageiros/:id", editar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const p = esquemaPassageiro.partial().parse(req.body);
    await garantirPassageiro(db, req.usuario!, id);
    if (p.pontoEmbarqueId) {
      const [r] = await db.select({ saidaId: reservas.saidaId }).from(passageiros).innerJoin(reservas, eq(reservas.id, passageiros.reservaId)).where(eq(passageiros.id, id));
      await validarPontoDaSaida(r!.saidaId, p.pontoEmbarqueId);
    }
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
    await garantirPassageiro(db, req.usuario!, id);
    const [removido] = await db.delete(passageiros).where(eq(passageiros.id, id)).returning({ id: passageiros.id });
    if (!removido) throw new ErroHttp(404, "NAO_ENCONTRADO", "Passageiro não encontrado.");
    await auditar(db, req, "PASSAGEIRO_REMOVIDO", { tipo: "passageiro", id });
    return { ok: true };
  });

  app.post("/api/passageiros/:id/embarque", { preHandler: exigir(config, "embarque:registrar") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { status } = z.object({ status: z.enum(STATUS_EMBARQUE) }).parse(req.body);
    await garantirPassageiro(db, req.usuario!, id);
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
