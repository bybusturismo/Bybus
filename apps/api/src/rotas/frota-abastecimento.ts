import { faltasAbastecimento, FORMAS_PAGAMENTO_COMBUSTIVEL, TIPOS_FOTO_ABASTECIMENTO } from "@bybus/core";
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { finLancamentos, pessoas, veiculos, veiculosAbastecimentos, veiculosAbastecimentosFotos } from "../db/schema.js";
import { podeUnidade } from "../seguranca/escopo.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, type UsuarioSessao } from "../seguranca/sessao.js";
import {
  aplicarLeitura, configPagamentoPorPraca, conferirAbastecimento, criarPendente, guardarFotos, lerFotosComIa, salvarConfigPagamento, zConferencia,
} from "../servicos/abastecimentoFoto.js";
import { iaConfigurada } from "../servicos/ia/cliente.js";
import { garantirVeiculo } from "./frota.js";

interface Guarda { preHandler: (req: FastifyRequest) => Promise<void> }
const uuid = z.string().uuid();
const naoEncontrado = () => new ErroHttp(404, "NAO_ENCONTRADO", "Abastecimento não encontrado.");
const fotoCorpo = z.object({ nome: z.string().trim().min(1).max(160), base64: z.string().min(8), tipo: z.enum(TIPOS_FOTO_ABASTECIMENTO).default("CUPOM") });

/**
 * Abastecimento pela foto do cupom (dono, 18/11/2026). Motorista (frota:checklist) ou quem gerencia manda a foto pelo app; o
 * WhatsApp usa o mesmo serviço (servicos/abastecimentoWhatsapp.ts). Quem gerencia confere: vira CONFERIDO e gera a conta a
 * pagar no Financeiro. O motorista vê e corrige só os pendentes que ele mandou.
 */
export async function rotasFrotaAbastecimentoFoto(app: FastifyInstance, { db, config, cofre }: Contexto, { ler, lancar, gerenciar }: { ler: Guarda; lancar: Guarda; gerenciar: Guarda }) {
  const gerente = (u: UsuarioSessao) => pode(u, "frota:gerenciar");

  /** Pessoa do cadastro da equipe ligada ao usuário (o motorista), se houver. */
  async function pessoaDoUsuario(u: UsuarioSessao) {
    const [p] = await db.select({ id: pessoas.id }).from(pessoas).where(eq(pessoas.usuarioId, u.id));
    return p?.id ?? null;
  }

  /** O abastecimento é visível: veículo da praça do usuário; sem veículo, a praça do motorista; ou foi o próprio usuário quem mandou. */
  async function visivel(u: UsuarioSessao, id: string) {
    const [a] = await db.select().from(veiculosAbastecimentos).where(eq(veiculosAbastecimentos.id, id));
    if (!a) throw naoEncontrado();
    if (a.criadoPor === u.id) return a;
    if (!gerente(u) && !pode(u, "frota:ver")) throw naoEncontrado();
    if (a.veiculoId) { await garantirVeiculo(db, u, a.veiculoId).catch(() => { throw naoEncontrado(); }); return a; }
    const [p] = a.pessoaId ? await db.select({ unidadeId: pessoas.unidadeId }).from(pessoas).where(eq(pessoas.id, a.pessoaId)) : [];
    if (u.todasUnidades || (p?.unidadeId && podeUnidade(u, p.unidadeId))) return a;
    throw naoEncontrado();
  }
  /** Pode mexer no pendente: quem gerencia, ou o motorista que mandou. */
  function podeEditarPendente(u: UsuarioSessao, a: typeof veiculosAbastecimentos.$inferSelect) {
    if (a.situacao !== "PENDENTE") throw new ErroHttp(409, "JA_CONFERIDO", "Este abastecimento já foi conferido: só quem gerencia a frota corrige.");
    if (!gerente(u) && a.criadoPor !== u.id) throw new ErroHttp(403, "SEM_PERMISSAO", "Só quem mandou ou quem gerencia a frota muda este abastecimento.");
  }
  const decodificar = (fotos: Array<z.infer<typeof fotoCorpo>>) => fotos.map((f) => ({ nome: f.nome, tipo: f.tipo, bytes: Buffer.from(f.base64, "base64") }));

  async function completo(id: string) {
    const [a] = await db.select({ a: veiculosAbastecimentos, placa: veiculos.placa, apelido: veiculos.apelido, pessoaNome: pessoas.nome })
      .from(veiculosAbastecimentos).leftJoin(veiculos, eq(veiculos.id, veiculosAbastecimentos.veiculoId)).leftJoin(pessoas, eq(pessoas.id, veiculosAbastecimentos.pessoaId))
      .where(eq(veiculosAbastecimentos.id, id));
    const fotos = await db.select({ id: veiculosAbastecimentosFotos.id, tipo: veiculosAbastecimentosFotos.tipo, nomeArquivo: veiculosAbastecimentosFotos.nomeArquivo, mime: veiculosAbastecimentosFotos.mime })
      .from(veiculosAbastecimentosFotos).where(eq(veiculosAbastecimentosFotos.abastecimentoId, id));
    return { ...a!.a, placa: a!.placa, apelido: a!.apelido, pessoaNome: a!.pessoaNome, fotos, faltas: faltasAbastecimento(a!.a) };
  }

  // ---------- configuração de pagamento por praça ----------
  app.get("/api/frota/pagamento-combustivel", ler, async () => configPagamentoPorPraca(db));
  app.put("/api/frota/pagamento-combustivel", gerenciar, async (req) => {
    const c = z.record(uuid, z.object({ forma: z.enum(FORMAS_PAGAMENTO_COMBUSTIVEL), prazoDias: z.number().int().min(0).max(120) })).parse(req.body);
    await salvarConfigPagamento(db, c, req.usuario!.id);
    await auditar(db, req, "FROTA_PAGAMENTO_COMBUSTIVEL_CONFIGURADO", { tipo: "configuracao" }, c);
    return configPagamentoPorPraca(db);
  });

  // ---------- pendentes ----------
  app.get("/api/frota/abastecimentos/pendentes", ler, async (req) => {
    const u = req.usuario!;
    const escopo: SQL | undefined = u.todasUnidades ? undefined : u.unidadeIds.length
      ? or(inArray(veiculos.unidadeId, u.unidadeIds), and(isNull(veiculosAbastecimentos.veiculoId), inArray(pessoas.unidadeId, u.unidadeIds)))
      : sql`false`;
    const visao = gerente(u) || pode(u, "frota:ver") ? escopo : eq(veiculosAbastecimentos.criadoPor, u.id); // motorista: só os dele
    const linhas = await db.select({ id: veiculosAbastecimentos.id }).from(veiculosAbastecimentos)
      .leftJoin(veiculos, eq(veiculos.id, veiculosAbastecimentos.veiculoId)).leftJoin(pessoas, eq(pessoas.id, veiculosAbastecimentos.pessoaId))
      .where(and(eq(veiculosAbastecimentos.situacao, "PENDENTE"), visao)).orderBy(desc(veiculosAbastecimentos.criadoEm)).limit(200);
    return { iaLigada: iaConfigurada(config), itens: await Promise.all(linhas.map((l) => completo(l.id))) };
  });

  /** Motorista (ou quem gerencia) manda a foto do cupom pelo app: abre o pendente e a IA lê o que der. */
  app.post("/api/frota/abastecimentos/foto", { ...lancar, bodyLimit: 40 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const u = req.usuario!;
    const c = z.object({
      veiculoId: uuid.nullish(), km: z.number().int().min(0).max(5_000_000).nullish(), litros: z.number().positive().max(2000).nullish(),
      valorCentavos: z.number().int().min(0).max(100_000_000).nullish(), tanqueCheio: z.boolean().default(true), observacao: z.string().trim().max(300).nullish(),
      fotos: z.array(fotoCorpo).min(1).max(3),
    }).parse(req.body);
    if (c.veiculoId) await garantirVeiculo(db, u, c.veiculoId);
    const a = await criarPendente(db, config, cofre, {
      origem: "APP", fotos: decodificar(c.fotos), veiculoId: c.veiculoId ?? null, km: c.km ?? null, litros: c.litros ?? null, valorCentavos: c.valorCentavos ?? null,
      tanqueCheio: c.tanqueCheio, observacao: c.observacao ?? null, pessoaId: await pessoaDoUsuario(u), usuarioId: u.id,
    });
    await auditar(db, req, "VEICULO_ABASTECIMENTO_FOTO_ENVIADA", { tipo: "veiculo_abastecimento", id: a.id }, { fotos: c.fotos.length, lidoPelaIa: !!a.leituraIa, origem: "APP" });
    reply.code(201);
    return { ...(await completo(a.id)), iaLigada: iaConfigurada(config) };
  });

  /** Corrige um pendente (o motorista que mandou ou quem gerencia). */
  app.patch("/api/frota/abastecimentos/:id", lancar, async (req) => {
    const u = req.usuario!;
    const { id } = z.object({ id: uuid }).parse(req.params);
    const a = await visivel(u, id);
    podeEditarPendente(u, a);
    const c = z.object({
      veiculoId: uuid.nullish(), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), km: z.number().int().min(0).max(5_000_000).nullish(),
      litros: z.number().positive().max(2000).nullish(), valorCentavos: z.number().int().min(0).max(100_000_000).nullish(), posto: z.string().trim().max(120).nullish(),
      tanqueCheio: z.boolean().optional(), observacao: z.string().trim().max(300).nullish(),
    }).parse(req.body);
    if (c.veiculoId) await garantirVeiculo(db, u, c.veiculoId);
    const muda = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined));
    if (Object.keys(muda).length) await db.update(veiculosAbastecimentos).set(muda).where(and(eq(veiculosAbastecimentos.id, id), eq(veiculosAbastecimentos.situacao, "PENDENTE")));
    return completo(id);
  });

  /** Mais uma foto no pendente (ex.: a do painel); a IA lê de novo e completa o que estiver vazio. */
  app.post("/api/frota/abastecimentos/:id/fotos", { ...lancar, bodyLimit: 22 * 1024 * 1024 }, async (req, reply) => {
    const u = req.usuario!;
    const { id } = z.object({ id: uuid }).parse(req.params);
    const a = await visivel(u, id);
    podeEditarPendente(u, a);
    const f = fotoCorpo.parse(req.body);
    const guardadas = await guardarFotos(db, cofre, id, decodificar([f]), u.id);
    const leitura = await lerFotosComIa(db, config, guardadas, u.id);
    if (leitura) await aplicarLeitura(db, a, leitura);
    reply.code(201);
    return completo(id);
  });

  app.get("/api/frota/abastecimentos/fotos/:fotoId", ler, async (req, reply) => {
    const { fotoId } = z.object({ fotoId: uuid }).parse(req.params);
    const { baixar } = z.object({ baixar: z.string().optional() }).parse(req.query);
    const [f] = await db.select().from(veiculosAbastecimentosFotos).where(eq(veiculosAbastecimentosFotos.id, fotoId));
    if (!f) throw new ErroHttp(404, "NAO_ENCONTRADO", "Foto não encontrada.");
    await visivel(req.usuario!, f.abastecimentoId);
    const bytes = Buffer.from(cofre.decifrar(f.dadosCifrados), "base64");
    const exibir = !baixar && /^(application\/pdf|image\/(jpeg|png|webp))$/.test(f.mime);
    return reply.header("Content-Type", f.mime).header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `${exibir ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.nomeArquivo)}`).send(bytes);
  });

  /** Quem gerencia confere: grava os dados finais, sobe o km do veículo e gera a conta a pagar no Financeiro. */
  app.post("/api/frota/abastecimentos/:id/conferir", gerenciar, async (req) => {
    const u = req.usuario!;
    const { id } = z.object({ id: uuid }).parse(req.params);
    await visivel(u, id);
    const c = zConferencia.parse(req.body);
    await garantirVeiculo(db, u, c.veiculoId);
    const a = await conferirAbastecimento(db, id, c, u.id);
    await auditar(db, req, "VEICULO_ABASTECIMENTO_CONFERIDO", { tipo: "veiculo_abastecimento", id }, { veiculoId: c.veiculoId, litros: c.litros, valorCentavos: c.valorCentavos, contaGerada: !!a.lancamentoId });
    return completo(id);
  });

  /**
   * Excluir: o pendente pode sair pelo motorista que mandou ou por quem gerencia; o conferido só por quem gerencia. A conta a pagar
   * gerada sai junto se ainda estiver em aberto; se já foi paga, o abastecimento não sai (desfaça o pagamento no Financeiro antes).
   */
  app.delete("/api/frota/abastecimentos/:id", lancar, async (req) => {
    const u = req.usuario!;
    const { id } = z.object({ id: uuid }).parse(req.params);
    const a = await visivel(u, id);
    if (a.situacao === "PENDENTE") podeEditarPendente(u, a);
    else if (!gerente(u)) throw new ErroHttp(403, "SEM_PERMISSAO", "Só quem gerencia a frota exclui um abastecimento conferido.");
    let contaExcluida = false;
    await db.transaction(async (tx) => {
      if (a.lancamentoId) {
        const [l] = await tx.select({ situacao: finLancamentos.situacao }).from(finLancamentos).where(eq(finLancamentos.id, a.lancamentoId));
        if (l?.situacao === "REALIZADO") throw new ErroHttp(409, "CONTA_PAGA", "A conta a pagar deste abastecimento já foi paga no Financeiro. Desfaça o pagamento lá antes de excluir.");
        const conc = await tx.execute(sql`select 1 from fin_extrato_linhas where lancamento_id = ${a.lancamentoId} limit 1`);
        if (conc.rows.length) throw new ErroHttp(409, "CONTA_CONCILIADA", "A conta deste abastecimento está conciliada com o extrato. Desfaça a conciliação antes.");
        await tx.update(veiculosAbastecimentos).set({ lancamentoId: null }).where(eq(veiculosAbastecimentos.id, id));
        await tx.delete(finLancamentos).where(eq(finLancamentos.id, a.lancamentoId));
        contaExcluida = true;
      }
      await tx.delete(veiculosAbastecimentos).where(eq(veiculosAbastecimentos.id, id));
    });
    await auditar(db, req, "VEICULO_ABASTECIMENTO_EXCLUIDO", { tipo: "veiculo_abastecimento", id }, { veiculoId: a.veiculoId, litros: a.litros, situacao: a.situacao, contaExcluida });
    return { ok: true, contaExcluida };
  });
}
