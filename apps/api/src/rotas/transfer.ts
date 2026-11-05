import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { escolherBairro, inserirNaOrdem, SITUACOES_BUSCA, type BairroTransfer } from "@bybus/core";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { passeios, pessoas, pontosEmbarque, reservas, saidas, transferBairros, transferConfig, transferDias, transferReservas, veiculos } from "../db/schema.js";
import { filtroUnidade, garantirPasseio, garantirSaida, podeUnidade } from "../seguranca/escopo.js";
import { pode, type Permissao } from "../seguranca/permissoes.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { validarPessoaDaPraca } from "../servicos/escala.js";
import { agoraSp } from "../servicos/fechamento.js";
import {
  aplicarOrdem, bairrosDoPasseio, carregarTransfer, configDoPasseio, moverParada, recalcularOrdem, sincronizarTransfer, textoDoTransfer,
} from "../servicos/transfer.js";

const uuid = z.string().uuid();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário no formato HH:MM");
const naoEncontrado = (o: string) => new ErroHttp(404, "NAO_ENCONTRADO", `${o} não encontrado(a).`);

export async function rotasTransfer(app: FastifyInstance, { db, config }: Contexto) {
  const ver = { preHandler: exigir(config, "manifesto:ver") };
  const gerenciar = { preHandler: exigir(config, "transfer:gerenciar") };
  const operar = {
    preHandler: async (req: FastifyRequest) => {
      await exigir(config)(req);
      const u = req.usuario!;
      if (!(["transfer:gerenciar", "transfer:operar"] as Permissao[]).some((p) => pode(u, p))) throw new ErroHttp(403, "SEM_PERMISSAO", "Seu perfil não tem acesso a esta função.");
    },
  };

  /** Parada do transfer + escopo da praça. Quem só opera precisa ser o motorista do transfer daquele dia. */
  async function paradaDoUsuario(req: FastifyRequest, id: string, exigirGestao = false) {
    const [r] = await db.select({ tr: transferReservas, dia: transferDias, saida: saidas, motoristaUsuarioId: pessoas.usuarioId })
      .from(transferReservas).innerJoin(transferDias, eq(transferDias.id, transferReservas.transferDiaId))
      .innerJoin(saidas, eq(saidas.id, transferDias.saidaId)).leftJoin(pessoas, eq(pessoas.id, transferDias.motoristaId))
      .where(eq(transferReservas.id, id));
    if (!r) throw naoEncontrado("Parada do transfer");
    await garantirSaida(db, req.usuario!, r.saida.id).catch(() => { throw naoEncontrado("Parada do transfer"); });
    const u = req.usuario!;
    const gestor = pode(u, "transfer:gerenciar");
    if (exigirGestao && !gestor) throw new ErroHttp(403, "SEM_PERMISSAO", "Seu perfil não tem acesso a esta função.");
    if (!gestor && !(pode(u, "transfer:operar") && r.motoristaUsuarioId === u.id)) throw new ErroHttp(403, "NAO_E_O_MOTORISTA", "Só o motorista escalado no transfer deste dia pode registrar a busca e a taxa.");
    if (!r.tr.ativo) throw new ErroHttp(409, "FORA_DO_TRANSFER", "Esta reserva não está mais no transfer.");
    return r;
  }
  async function diaDoUsuario(req: FastifyRequest, id: string) {
    const [d] = await db.select().from(transferDias).where(eq(transferDias.id, id));
    if (!d) throw naoEncontrado("Transfer");
    await garantirSaida(db, req.usuario!, d.saidaId).catch(() => { throw naoEncontrado("Transfer"); });
    return d;
  }
  const dto = (req: FastifyRequest, saidaId: string) => carregarTransfer(db, saidaId, { verContatos: pode(req.usuario!, "manifesto:contatos"), comOpcoes: pode(req.usuario!, "transfer:gerenciar") });

  // ---------- Leitura ----------
  /** Passeios (da praça do usuário) que têm bairros de transfer configurados. */
  app.get("/api/transfer/passeios", ver, async (req) => {
    const lista = await db.selectDistinct({ id: passeios.id, nome: passeios.nome, unidadeId: passeios.unidadeId }).from(passeios)
      .innerJoin(transferBairros, and(eq(transferBairros.passeioId, passeios.id), eq(transferBairros.ativo, true)))
      .where(and(eq(passeios.ativo, true), filtroUnidade(req.usuario!))).orderBy(asc(passeios.nome));
    return lista;
  });

  /** Transfer de um passeio numa data (padrão: amanhã). Sem saída ou sem transfer montado, devolve o que falta. */
  app.get("/api/transfer", ver, async (req) => {
    const q = z.object({ passeioId: uuid, data: dataIso.optional() }).parse(req.query);
    await garantirPasseio(db, req.usuario!, q.passeioId);
    const data = q.data ?? agoraSp().amanha;
    const [s] = await db.select({ id: saidas.id }).from(saidas).where(and(eq(saidas.passeioId, q.passeioId), eq(saidas.data, data), ne(saidas.status, "CANCELADA")));
    if (!s) return { habilitado: (await bairrosDoPasseio(db, q.passeioId)).length > 0, saida: null, data };
    return { ...(await dto(req, s.id)), data };
  });

  app.get("/api/transfer/texto", ver, async (req) => {
    const q = z.object({ saidaId: uuid }).parse(req.query);
    await garantirSaida(db, req.usuario!, q.saidaId);
    const texto = await textoDoTransfer(db, q.saidaId, pode(req.usuario!, "manifesto:contatos"));
    if (!texto) throw new ErroHttp(404, "SEM_TRANSFER", "Não há transfer montado para esta saída.");
    return { texto };
  });

  /** Tela do motorista: o transfer de hoje e de amanhã em que ele é o motorista. */
  app.get("/api/transfer/motorista", { preHandler: exigir(config, "transfer:operar") }, async (req) => {
    const { hoje, amanha } = agoraSp();
    const lista = await db.select({ saidaId: saidas.id }).from(transferDias)
      .innerJoin(saidas, eq(saidas.id, transferDias.saidaId)).innerJoin(pessoas, eq(pessoas.id, transferDias.motoristaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .where(and(eq(pessoas.usuarioId, req.usuario!.id), inArray(saidas.data, [hoje, amanha]), ne(saidas.status, "CANCELADA"))).orderBy(asc(saidas.data), asc(passeios.nome));
    const resultado = [];
    for (const { saidaId } of lista) {
      if (!podeUnidade(req.usuario!, await unidadeDe(saidaId))) continue;
      const t = await dto(req, saidaId);
      if (t) resultado.push({ ...t, opcoes: null });
    }
    return { hoje, amanha, transfers: resultado };
  });
  const unidadeDe = async (saidaId: string) => (await db.select({ u: passeios.unidadeId }).from(saidas).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).where(eq(saidas.id, saidaId)))[0]?.u ?? null;

  // ---------- Gestão ----------
  app.post("/api/transfer/montar", gerenciar, async (req) => {
    const { saidaId } = z.object({ saidaId: uuid }).parse(req.body);
    await garantirSaida(db, req.usuario!, saidaId);
    const r = await sincronizarTransfer(db, saidaId, "sempre");
    if (!r) throw new ErroHttp(409, "SEM_BAIRROS_TRANSFER", "Este passeio não tem bairros de transfer configurados (Passeios e pontos).");
    await auditar(db, req, "TRANSFER_MONTADO", { tipo: "saida", id: saidaId }, { novo: r.novo, criadas: r.criadas, atualizadas: r.atualizadas, removidas: r.removidas });
    return dto(req, saidaId);
  });

  app.patch("/api/transfer/dias/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = z.object({
      veiculoId: uuid.nullable().optional(),
      veiculoTexto: z.string().trim().max(60).nullable().optional(),
      motoristaId: uuid.nullable().optional(),
      lugares: z.number().int().min(1).max(100).nullable().optional(),
      pontoEncontroId: uuid.nullable().optional(),
      chegadaPrevista: hora.nullable().optional(),
      observacoes: z.string().trim().max(500).nullable().optional(),
    }).parse(req.body);
    const dia = await diaDoUsuario(req, id);
    const [s] = await db.select({ passeioId: saidas.passeioId, unidadeId: passeios.unidadeId }).from(saidas).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).where(eq(saidas.id, dia.saidaId));
    await validarPessoaDaPraca(db, c.motoristaId, "MOTORISTA", s!.unidadeId);
    if (c.veiculoId) {
      const [v] = await db.select({ unidadeId: veiculos.unidadeId }).from(veiculos).where(eq(veiculos.id, c.veiculoId));
      if (!v || v.unidadeId !== s!.unidadeId) throw new ErroHttp(400, "VEICULO_INVALIDO", "Veículo inválido para esta praça.");
    }
    if (c.pontoEncontroId) {
      const [p] = await db.select({ ehTransfer: pontosEmbarque.ehTransfer }).from(pontosEmbarque).where(and(eq(pontosEmbarque.id, c.pontoEncontroId), eq(pontosEmbarque.passeioId, s!.passeioId), eq(pontosEmbarque.ativo, true)));
      if (!p || p.ehTransfer) throw new ErroHttp(400, "PONTO_INVALIDO", "O ponto de encontro precisa ser um ponto de embarque do passeio (não um bairro de transfer).");
    }
    await db.update(transferDias).set({ ...c, atualizadoEm: new Date() }).where(eq(transferDias.id, id));
    await auditar(db, req, "TRANSFER_DIA_ALTERADO", { tipo: "transfer", id }, {
      campos: Object.keys(c),
      motoristaAntes: dia.motoristaId, motoristaDepois: c.motoristaId === undefined ? dia.motoristaId : c.motoristaId,
      veiculoAntes: dia.veiculoId, veiculoDepois: c.veiculoId === undefined ? dia.veiculoId : c.veiculoId,
    });
    return dto(req, dia.saidaId);
  });

  app.post("/api/transfer/dias/:id/recalcular-ordem", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const dia = await diaDoUsuario(req, id);
    await recalcularOrdem(db, id);
    await auditar(db, req, "TRANSFER_ORDEM_RECALCULADA", { tipo: "transfer", id });
    return dto(req, dia.saidaId);
  });

  app.post("/api/transfer/reservas/:id/mover", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { posicao } = z.object({ posicao: z.number().int().min(0).max(500) }).parse(req.body);
    const { tr, dia, saida } = await paradaDoUsuario(req, id, true);
    await moverParada(db, dia.id, tr.id, posicao);
    await auditar(db, req, "TRANSFER_ORDEM_ALTERADA", { tipo: "transfer", id: dia.id }, { reservaId: tr.reservaId, de: tr.ordem, para: posicao });
    return dto(req, saida.id);
  });

  app.patch("/api/transfer/reservas/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = z.object({
      enderecoBusca: z.string().trim().max(300).nullable().optional(),
      horarioBusca: hora.nullable().optional(),
      bairroId: uuid.nullable().optional(),
      taxaCentavos: z.number().int().min(0).max(1_000_000).optional(),
      incluidoNoPasseio: z.boolean().optional(),
    }).parse(req.body);
    const { tr, dia, saida } = await paradaDoUsuario(req, id, true);
    const [res] = await db.select().from(reservas).where(eq(reservas.id, tr.reservaId));
    const mud: Partial<typeof transferReservas.$inferInsert> = {};
    let editados = [...tr.editados];
    const marcar = (k: string, ligado: boolean) => { editados = ligado ? [...new Set([...editados, k])] : editados.filter((x) => x !== k); };
    let reordenar = false;
    const auditoriaDados: Record<string, unknown> = {};

    if (c.enderecoBusca !== undefined) {
      mud.enderecoBusca = c.enderecoBusca || res!.hospedagemInformada || null;
      marcar("endereco", !!c.enderecoBusca);
    }
    if (c.horarioBusca !== undefined) {
      marcar("horario", c.horarioBusca !== null);
      if (c.horarioBusca) mud.horarioBusca = c.horarioBusca;
      reordenar = true;
    }
    if (c.bairroId !== undefined) {
      const bairros = await bairrosDoPasseio(db, saida.passeioId);
      if (c.bairroId && !bairros.some((b) => b.id === c.bairroId)) throw new ErroHttp(400, "BAIRRO_INVALIDO", "Bairro inválido para este passeio.");
      const automatico = escolherBairro(bairros.map((b): BairroTransfer => ({ id: b.id, nome: b.nome, ordemBusca: b.ordemBusca, horarioReferencia: b.horarioReferencia, pontoEmbarqueId: b.pontoEmbarqueId })), { pontoEmbarqueId: res!.pontoEmbarqueId, hospedagem: res!.hospedagemInformada });
      mud.bairroId = c.bairroId ?? automatico?.id ?? null;
      marcar("bairro", c.bairroId !== null);
      reordenar = true;
    }
    if (c.taxaCentavos !== undefined) {
      if (tr.taxaSituacao === "RECEBIDO") throw new ErroHttp(409, "TAXA_JA_RECEBIDA", "A taxa já foi recebida: desfaça o recebimento antes de alterar o valor.");
      mud.taxaCentavos = c.taxaCentavos;
      marcar("taxa", true);
      auditoriaDados.taxaAntes = tr.taxaCentavos;
      auditoriaDados.taxaDepois = c.taxaCentavos;
    }
    if (c.incluidoNoPasseio !== undefined) {
      if (c.incluidoNoPasseio) {
        if (tr.taxaSituacao === "RECEBIDO" && tr.taxaForma !== "INCLUIDO_NO_PASSEIO") throw new ErroHttp(409, "TAXA_JA_RECEBIDA", "A taxa já foi recebida pelo motorista: desfaça o recebimento antes.");
        Object.assign(mud, { taxaForma: "INCLUIDO_NO_PASSEIO", taxaSituacao: "RECEBIDO", recebidoPor: null, recebidoEm: new Date() });
      } else if (tr.taxaForma === "INCLUIDO_NO_PASSEIO") {
        Object.assign(mud, { taxaForma: null, taxaSituacao: "A_RECEBER", recebidoPor: null, recebidoEm: null });
      }
      auditoriaDados.formaAntes = tr.taxaForma;
      auditoriaDados.formaDepois = "taxaForma" in mud ? mud.taxaForma : tr.taxaForma;
      auditoriaDados.situacaoTaxaAntes = tr.taxaSituacao;
      auditoriaDados.situacaoTaxaDepois = "taxaSituacao" in mud ? mud.taxaSituacao : tr.taxaSituacao;
    }
    await db.update(transferReservas).set({ ...mud, editados, atualizadoEm: new Date() }).where(eq(transferReservas.id, id));
    if (reordenar) await reposicionar(dia.id, id, "bairroId" in mud);
    // Sem hotel/telefone no log: só os campos alterados e os valores da cobrança.
    await auditar(db, req, auditoriaDados.taxaAntes !== undefined || auditoriaDados.formaAntes !== undefined ? "TRANSFER_COBRANCA_ALTERADA" : "TRANSFER_PARADA_ALTERADA", { tipo: "transfer", id: dia.id }, { reservaId: tr.reservaId, campos: Object.keys(c), ...auditoriaDados });
    return dto(req, saida.id);
  });

  /** Depois de mudar bairro ou horário: o bairro novo pede nova posição; o horário só recalcula. */
  async function reposicionar(diaId: string, trId: string, mudouBairro: boolean) {
    const linhas = await db.select({ id: transferReservas.id, bairroId: transferReservas.bairroId, titular: reservas.contatoNome }).from(transferReservas)
      .innerJoin(reservas, eq(reservas.id, transferReservas.reservaId))
      .where(and(eq(transferReservas.transferDiaId, diaId), eq(transferReservas.ativo, true))).orderBy(asc(transferReservas.ordem));
    if (!mudouBairro) return aplicarOrdem(db, diaId, linhas.map((l) => l.id));
    const bairros = await db.select({ id: transferBairros.id, ordem: transferBairros.ordemBusca }).from(transferBairros);
    const item = (l: (typeof linhas)[number]) => ({ id: l.id, bairroOrdem: bairros.find((b) => b.id === l.bairroId)?.ordem ?? null, titular: l.titular });
    const alvo = linhas.find((l) => l.id === trId)!;
    const lista = inserirNaOrdem(linhas.filter((l) => l.id !== trId).map(item), item(alvo));
    await aplicarOrdem(db, diaId, lista.map((l) => l.id));
  }

  // ---------- Operação (motorista pelo celular ou gestão) ----------
  app.post("/api/transfer/reservas/:id/situacao", operar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { situacao } = z.object({ situacao: z.enum(SITUACOES_BUSCA) }).parse(req.body);
    const { tr, saida } = await paradaDoUsuario(req, id);
    // O motorista só marca o que acontece na rua (buscado / não apareceu) e desfaz voltando para "confirmado".
    if (!pode(req.usuario!, "transfer:gerenciar") && !["BUSCADO", "NAO_APARECEU", "CONFIRMADO"].includes(situacao)) {
      throw new ErroHttp(403, "SEM_PERMISSAO", "O motorista só pode marcar buscado, não apareceu ou desfazer.");
    }
    if (tr.situacao === situacao) return dto(req, saida.id);
    await db.update(transferReservas).set({ situacao, situacaoEm: new Date(), situacaoPor: req.usuario!.id, atualizadoEm: new Date() }).where(eq(transferReservas.id, id));
    await auditar(db, req, "TRANSFER_SITUACAO_ALTERADA", { tipo: "transfer", id: tr.transferDiaId }, { reservaId: tr.reservaId, antes: tr.situacao, depois: situacao });
    return dto(req, saida.id);
  });

  app.post("/api/transfer/reservas/:id/recebimento", operar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = z.object({ forma: z.enum(["PIX", "DINHEIRO"]), valorCentavos: z.number().int().min(0).optional() }).parse(req.body);
    const { tr, saida } = await paradaDoUsuario(req, id);
    if (tr.taxaSituacao === "RECEBIDO") throw new ErroHttp(409, "JA_RECEBIDA", "A taxa desta reserva já foi registrada como recebida.");
    if (tr.taxaCentavos <= 0) throw new ErroHttp(400, "SEM_TAXA", "Esta reserva não tem taxa a receber.");
    if (c.valorCentavos !== undefined && c.valorCentavos !== tr.taxaCentavos) throw new ErroHttp(400, "VALOR_DIFERENTE", "O valor informado é diferente da taxa da reserva. Peça à supervisão para ajustar o valor.");
    await db.update(transferReservas).set({ taxaSituacao: "RECEBIDO", taxaForma: c.forma, recebidoPor: req.usuario!.id, recebidoEm: new Date(), atualizadoEm: new Date() }).where(eq(transferReservas.id, id));
    await auditar(db, req, "TRANSFER_TAXA_RECEBIDA", { tipo: "transfer", id: tr.transferDiaId }, { reservaId: tr.reservaId, valorCentavos: tr.taxaCentavos, forma: c.forma });
    return dto(req, saida.id);
  });

  /** Desfaz um recebimento lançado por engano (só a gestão). */
  app.post("/api/transfer/reservas/:id/estornar", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { tr, saida } = await paradaDoUsuario(req, id, true);
    if (tr.taxaSituacao !== "RECEBIDO") throw new ErroHttp(409, "NAO_RECEBIDA", "Esta taxa ainda não foi recebida.");
    await db.update(transferReservas).set({ taxaSituacao: "A_RECEBER", taxaForma: null, recebidoPor: null, recebidoEm: null, atualizadoEm: new Date() }).where(eq(transferReservas.id, id));
    await auditar(db, req, "TRANSFER_TAXA_ESTORNADA", { tipo: "transfer", id: tr.transferDiaId }, { reservaId: tr.reservaId, valorCentavos: tr.taxaCentavos, formaAntes: tr.taxaForma, recebidoPorAntes: tr.recebidoPor });
    return dto(req, saida.id);
  });

  // ---------- Configuração do passeio (bairros, taxa, padrões) ----------
  app.get("/api/passeios/:id/transfer", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await garantirPasseio(db, req.usuario!, id);
    const unidadeId = (await db.select({ u: passeios.unidadeId }).from(passeios).where(eq(passeios.id, id)))[0]!.u;
    const cfg = await configDoPasseio(db, id);
    const pontos = await db.select({ id: pontosEmbarque.id, nome: pontosEmbarque.nome, horario: pontosEmbarque.horario, ehTransfer: pontosEmbarque.ehTransfer }).from(pontosEmbarque)
      .where(and(eq(pontosEmbarque.passeioId, id), eq(pontosEmbarque.ativo, true))).orderBy(asc(pontosEmbarque.horario), asc(pontosEmbarque.ordem));
    const pes = await db.select({ id: pessoas.id, nome: pessoas.nome, papeis: pessoas.papeis, unidadeId: pessoas.unidadeId }).from(pessoas).where(eq(pessoas.ativo, true)).orderBy(asc(pessoas.nome));
    const veic = await db.select({ id: veiculos.id, placa: veiculos.placa, apelido: veiculos.apelido, capacidade: veiculos.capacidade }).from(veiculos).where(and(eq(veiculos.unidadeId, unidadeId), eq(veiculos.situacao, "ATIVO"))).orderBy(asc(veiculos.placa));
    return {
      config: {
        taxaPorPassageiroCentavos: cfg.taxaPorPassageiroCentavos, taxaAConfirmar: cfg.taxaAConfirmar, intervaloMinutos: cfg.intervaloMinutos, pontoEncontroId: cfg.pontoEncontroId,
        chegadaPrevista: cfg.chegadaPrevista, motoristaPadraoId: cfg.motoristaPadraoId, veiculoPadraoId: cfg.veiculoPadraoId, veiculoPadraoTexto: cfg.veiculoPadraoTexto, lugaresPadrao: cfg.lugaresPadrao,
      },
      bairros: (await bairrosDoPasseio(db, id, false)).map((b) => ({ id: b.id, nome: b.nome, ordemBusca: b.ordemBusca, horarioReferencia: b.horarioReferencia, horarioAConfirmar: b.horarioAConfirmar, pontoEmbarqueId: b.pontoEmbarqueId, ativo: b.ativo })),
      pontos,
      motoristas: pes.filter((p) => p.papeis.includes("MOTORISTA") && (!p.unidadeId || p.unidadeId === unidadeId)).map(({ id: i, nome }) => ({ id: i, nome })),
      veiculos: veic,
    };
  });

  app.put("/api/passeios/:id/transfer", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = z.object({
      config: z.object({
        taxaPorPassageiroCentavos: z.number().int().min(0).max(100_000),
        taxaAConfirmar: z.boolean(),
        intervaloMinutos: z.number().int().min(0).max(60),
        pontoEncontroId: uuid.nullable(),
        chegadaPrevista: hora.nullable(),
        motoristaPadraoId: uuid.nullable(),
        veiculoPadraoId: uuid.nullable(),
        veiculoPadraoTexto: z.string().trim().max(60).nullable(),
        lugaresPadrao: z.number().int().min(1).max(100).nullable(),
      }),
      bairros: z.array(z.object({
        id: uuid.optional(),
        nome: z.string().trim().min(2, "Informe o nome do bairro.").max(80),
        horarioReferencia: hora.nullable(),
        horarioAConfirmar: z.boolean().default(false),
        pontoEmbarqueId: uuid.nullable(),
        ativo: z.boolean().default(true),
      })).max(30),
    }).parse(req.body);
    const unidadeId = await garantirPasseio(db, req.usuario!, id);
    const nomes = c.bairros.map((b) => b.nome.toLowerCase());
    if (new Set(nomes).size !== nomes.length) throw new ErroHttp(400, "BAIRRO_DUPLICADO", "Há bairros com o mesmo nome.");
    const pontos = await db.select({ id: pontosEmbarque.id, ehTransfer: pontosEmbarque.ehTransfer }).from(pontosEmbarque).where(eq(pontosEmbarque.passeioId, id));
    const ponto = (pid: string) => pontos.find((p) => p.id === pid);
    if (c.config.pontoEncontroId && (!ponto(c.config.pontoEncontroId) || ponto(c.config.pontoEncontroId)!.ehTransfer)) throw new ErroHttp(400, "PONTO_INVALIDO", "O ponto de encontro precisa ser um ponto de embarque do passeio (não um bairro de transfer).");
    for (const b of c.bairros) if (b.pontoEmbarqueId && !ponto(b.pontoEmbarqueId)?.ehTransfer) throw new ErroHttp(400, "PONTO_INVALIDO", `O ponto de transfer de ${b.nome} precisa ser um ponto de transfer deste passeio.`);
    await validarPessoaDaPraca(db, c.config.motoristaPadraoId, "MOTORISTA", unidadeId);
    if (c.config.veiculoPadraoId) {
      const [v] = await db.select({ unidadeId: veiculos.unidadeId }).from(veiculos).where(eq(veiculos.id, c.config.veiculoPadraoId));
      if (!v || v.unidadeId !== unidadeId) throw new ErroHttp(400, "VEICULO_INVALIDO", "Veículo inválido para esta praça.");
    }
    const antes = { config: await configDoPasseio(db, id), bairros: (await bairrosDoPasseio(db, id, false)).map((b) => ({ nome: b.nome, ordem: b.ordemBusca, horario: b.horarioReferencia, ativo: b.ativo })) };
    const atuais = await bairrosDoPasseio(db, id, false);
    await db.transaction(async (tx) => {
      await tx.insert(transferConfig).values({ passeioId: id, ...c.config }).onConflictDoUpdate({ target: transferConfig.passeioId, set: { ...c.config, atualizadoEm: new Date() } });
      const mantidos = new Set<string>();
      // Ordem de busca = ordem da lista enviada. Para não esbarrar em nomes trocados, atualiza por id e insere os novos.
      for (const [i, b] of c.bairros.entries()) {
        const valores = { nome: b.nome, ordemBusca: i + 1, horarioReferencia: b.horarioReferencia, horarioAConfirmar: b.horarioAConfirmar || !b.horarioReferencia, pontoEmbarqueId: b.pontoEmbarqueId, ativo: b.ativo };
        if (b.id && atuais.some((a) => a.id === b.id)) {
          await tx.update(transferBairros).set(valores).where(eq(transferBairros.id, b.id));
          mantidos.add(b.id);
        } else {
          const [n] = await tx.insert(transferBairros).values({ passeioId: id, ...valores }).returning({ id: transferBairros.id });
          mantidos.add(n!.id);
        }
      }
      // Bairro tirado da lista só é desativado (reservas antigas continuam apontando para ele).
      const removidos = atuais.filter((a) => !mantidos.has(a.id)).map((a) => a.id);
      if (removidos.length) await tx.update(transferBairros).set({ ativo: false }).where(inArray(transferBairros.id, removidos));
    });
    await auditar(db, req, "TRANSFER_CONFIG_ALTERADA", { tipo: "passeio", id }, {
      antes: { taxaPorPassageiroCentavos: antes.config.taxaPorPassageiroCentavos, bairros: antes.bairros },
      depois: { taxaPorPassageiroCentavos: c.config.taxaPorPassageiroCentavos, bairros: c.bairros.map((b, i) => ({ nome: b.nome, ordem: i + 1, horario: b.horarioReferencia, ativo: b.ativo })) },
    });
    return { ok: true };
  });
}
