import { dataSaoPaulo } from "@bybus/core";
import { and, between, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { Db } from "../../db/cliente.js";
import { iaAvaliacoes, passageiros, passeios, pessoas, reservas, saidas, unidades } from "../../db/schema.js";
import { filtroUnidade } from "../../seguranca/escopo.js";
import { pode, type Permissao } from "../../seguranca/permissoes.js";
import type { UsuarioSessao } from "../../seguranca/sessao.js";
import type { FerramentaIA } from "./cliente.js";
import { montarRetratos, somarDias } from "./retratos.js";

/**
 * Ferramentas de CONSULTA do assistente: somente leitura, só agregados (sem nomes, documentos, telefones, e-mails)
 * e sempre dentro do que o usuário pode ver (permissão da ferramenta + praças do usuário). A permissão é conferida
 * de novo na execução, não só ao oferecer a ferramenta ao modelo.
 */

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");
const periodo = z
  .object({ de: dataIso, ate: dataIso })
  .refine((p) => p.de <= p.ate, "A data inicial deve ser anterior à final.")
  .refine((p) => p.ate <= somarDias(p.de, 92), "Período máximo de 92 dias.");

export interface ContextoConsulta {
  db: Db;
  config: Config;
  usuario: UsuarioSessao;
}

export interface FerramentaConsulta {
  def: FerramentaIA;
  permissao: Permissao;
  /** Exige acesso a todas as praças (dados da empresa inteira). */
  empresaInteira?: boolean;
  executar(ctx: ContextoConsulta, entrada: unknown): Promise<unknown>;
}

const schemaPeriodo = {
  de: { type: "string", description: "Data inicial AAAA-MM-DD" },
  ate: { type: "string", description: "Data final AAAA-MM-DD (máximo 92 dias depois da inicial)" },
};

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

function escopoSaidas(u: UsuarioSessao, extra: SQL[]): SQL | undefined {
  return and(...extra, filtroUnidade(u));
}

const resumoSaidas: FerramentaConsulta = {
  permissao: "manifesto:ver",
  def: {
    name: "resumo_saidas",
    description: "Lista as saídas (passeios) de um período com passageiros confirmados, capacidade, ocupação e se têm guia, motorista, veículo e lista fechada. Até 80 saídas. Sem dados pessoais.",
    input_schema: { type: "object", properties: { ...schemaPeriodo, passeio: { type: "string", description: "Código do passeio (ex.: TODA_ILHA) ou vazio para todos" } }, required: ["de", "ate", "passeio"], additionalProperties: false },
  },
  async executar({ db, usuario }, entrada) {
    const q = z.intersection(periodo, z.object({ passeio: z.string().max(60) })).parse(entrada);
    const filtros: SQL[] = [between(saidas.data, q.de, q.ate)];
    if (q.passeio.trim()) filtros.push(eq(passeios.codigo, q.passeio.trim()));
    const lista = await db
      .select({
        id: saidas.id, data: saidas.data, status: saidas.status, capacidade: saidas.capacidade, veiculo: saidas.veiculo, guia: saidas.guia, motorista: saidas.motorista,
        guiaId: saidas.guiaId, motoristaId: saidas.motoristaId, fechada: saidas.listaFechadaEm, passeio: passeios.codigo, praca: unidades.codigo,
      })
      .from(saidas)
      .innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .innerJoin(unidades, eq(unidades.id, passeios.unidadeId))
      .where(escopoSaidas(usuario, filtros))
      .orderBy(saidas.data)
      .limit(80);
    const pax = lista.length
      ? await db
          .select({ saidaId: reservas.saidaId, n: sql<number>`count(*)::int` })
          .from(passageiros)
          .innerJoin(reservas, eq(reservas.id, passageiros.reservaId))
          .innerJoin(saidas, eq(saidas.id, reservas.saidaId))
          .innerJoin(passeios, eq(passeios.id, saidas.passeioId))
          .where(and(escopoSaidas(usuario, filtros), eq(reservas.status, "CONFIRMADA")))
          .groupBy(reservas.saidaId)
      : [];
    const por = new Map(pax.map((p) => [p.saidaId, p.n]));
    return {
      periodo: { de: q.de, ate: q.ate },
      saidas: lista.map((s) => {
        const n = por.get(s.id) ?? 0;
        return { data: s.data, passeio: s.passeio, praca: s.praca, status: s.status, passageirosConfirmados: n, capacidade: s.capacidade, ocupacaoPct: pct(n, s.capacidade), temGuia: !!(s.guiaId || s.guia?.trim()), temMotorista: !!(s.motoristaId || s.motorista?.trim()), temVeiculo: !!s.veiculo?.trim(), listaFechada: !!s.fechada };
      }),
      truncado: lista.length === 80,
    };
  },
};

const ocupacaoPorPasseio: FerramentaConsulta = {
  permissao: "manifesto:ver",
  def: {
    name: "ocupacao_por_passeio",
    description: "Ocupação agregada por passeio no período: saídas, passageiros confirmados, capacidade, ocupação %, saídas sem passageiros e reservas canceladas.",
    input_schema: { type: "object", properties: schemaPeriodo, required: ["de", "ate"], additionalProperties: false },
  },
  async executar({ db, usuario }, entrada) {
    const q = periodo.parse(entrada);
    const filtros: SQL[] = [between(saidas.data, q.de, q.ate), sql`${saidas.status} <> 'CANCELADA'`];
    const linhas = await db
      .select({ passeio: passeios.codigo, saidas: sql<number>`count(distinct ${saidas.id})::int` })
      .from(saidas)
      .innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .where(escopoSaidas(usuario, filtros))
      .groupBy(passeios.codigo);
    const caps = await db
      .select({ passeio: passeios.codigo, capacidade: sql<number>`coalesce(sum(${saidas.capacidade}), 0)::int` })
      .from(saidas)
      .innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .where(escopoSaidas(usuario, filtros))
      .groupBy(passeios.codigo);
    const pax = await db
      .select({ passeio: passeios.codigo, status: reservas.status, n: sql<number>`count(*)::int` })
      .from(passageiros)
      .innerJoin(reservas, eq(reservas.id, passageiros.reservaId))
      .innerJoin(saidas, eq(saidas.id, reservas.saidaId))
      .innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .where(escopoSaidas(usuario, [between(saidas.data, q.de, q.ate)]))
      .groupBy(passeios.codigo, reservas.status);
    return {
      periodo: q,
      passeios: linhas.map((l) => {
        const cap = caps.find((c) => c.passeio === l.passeio)?.capacidade ?? 0;
        const conf = pax.find((p) => p.passeio === l.passeio && p.status === "CONFIRMADA")?.n ?? 0;
        const canc = pax.find((p) => p.passeio === l.passeio && p.status === "CANCELADA")?.n ?? 0;
        return { passeio: l.passeio, saidas: l.saidas, passageirosConfirmados: conf, passageirosEmReservasCanceladas: canc, capacidade: cap, ocupacaoPct: pct(conf, cap) };
      }),
    };
  },
};

const reservasPorCanal: FerramentaConsulta = {
  permissao: "manifesto:ver",
  def: {
    name: "reservas_por_canal",
    description: "Reservas e passageiros por canal de venda (Paytour, Viator, Decolar, Civitatis, balcão…) no período, confirmados e cancelados.",
    input_schema: { type: "object", properties: schemaPeriodo, required: ["de", "ate"], additionalProperties: false },
  },
  async executar({ db, usuario }, entrada) {
    const q = periodo.parse(entrada);
    const canal = sql<string>`coalesce(${reservas.canalOrigem}, ${reservas.canal})`;
    const linhas = await db
      .select({ canal, status: reservas.status, reservas: sql<number>`count(distinct ${reservas.id})::int`, passageiros: sql<number>`count(${passageiros.id})::int` })
      .from(reservas)
      .leftJoin(passageiros, eq(passageiros.reservaId, reservas.id))
      .innerJoin(saidas, eq(saidas.id, reservas.saidaId))
      .innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .where(escopoSaidas(usuario, [between(saidas.data, q.de, q.ate)]))
      .groupBy(canal, reservas.status);
    return { periodo: q, porCanal: linhas.map((l) => ({ canal: String(l.canal), status: l.status, reservas: l.reservas, passageiros: l.passageiros })) };
  },
};

const documentosVencendo: FerramentaConsulta = {
  permissao: "pessoas:ver",
  def: {
    name: "documentos_vencendo",
    description: "Quantidade (sem nomes) de guias com Cadastur e de motoristas com CNH vencidos ou vencendo nos próximos N dias, e ativos sem validade cadastrada.",
    input_schema: { type: "object", properties: { dias: { type: "integer", description: "Janela em dias (1 a 180)" } }, required: ["dias"], additionalProperties: false },
  },
  async executar({ db, usuario }, entrada) {
    const { dias } = z.object({ dias: z.number().int().min(1).max(180) }).parse(entrada);
    const hoje = dataSaoPaulo(new Date());
    const limite = somarDias(hoje, dias);
    const escopo = filtroUnidade(usuario, pessoas.unidadeId as never);
    const lista = await db
      .select({ papeis: pessoas.papeis, cadastur: pessoas.cadasturValidade, cnh: pessoas.cnhValidade })
      .from(pessoas)
      .where(and(eq(pessoas.ativo, true), escopo ? sql`(${pessoas.unidadeId} IS NULL OR ${escopo})` : undefined));
    const resumo = (papel: string, campo: "cadastur" | "cnh") => {
      const g = lista.filter((p) => p.papeis.includes(papel));
      return {
        ativos: g.length,
        semValidadeCadastrada: g.filter((p) => !p[campo]).length,
        vencidos: g.filter((p) => p[campo] && p[campo]! < hoje).length,
        vencendoNaJanela: g.filter((p) => p[campo] && p[campo]! >= hoje && p[campo]! <= limite).length,
      };
    };
    return { hoje, janelaDias: dias, cadasturDosGuias: resumo("GUIA", "cadastur"), cnhDosMotoristas: resumo("MOTORISTA", "cnh") };
  },
};

const saudeDoSistema: FerramentaConsulta = {
  permissao: "auditoria:ver",
  empresaInteira: true,
  def: {
    name: "saude_do_sistema",
    description: "Retrato de segurança e saúde do sistema: usuários sem MFA, bloqueios, sessões, falhas de login, integrações e mensagens com falha.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  async executar({ db, config }) {
    const hoje = dataSaoPaulo(new Date());
    const r = await montarRetratos(db, hoje, { limiteMesUsd: config.IA_LIMITE_MES_USD });
    return r.tecnologia;
  },
};

const ultimaSintese: FerramentaConsulta = {
  permissao: "ia:gestores",
  empresaInteira: true,
  def: {
    name: "ultima_sintese",
    description: "Resumo, vulnerabilidades, oportunidades e ações sugeridas da última avaliação concluída da diretoria virtual (gestores de IA).",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  async executar({ db }) {
    const [a] = await db
      .select({ dataRef: iaAvaliacoes.dataRef, status: iaAvaliacoes.status, sintese: iaAvaliacoes.sintese })
      .from(iaAvaliacoes)
      .where(sql`${iaAvaliacoes.sintese} is not null`)
      .orderBy(desc(iaAvaliacoes.iniciadaEm))
      .limit(1);
    return a ?? { mensagem: "Ainda não há avaliação concluída." };
  },
};

export const CONSULTAS: readonly FerramentaConsulta[] = [resumoSaidas, ocupacaoPorPasseio, reservasPorCanal, documentosVencendo, saudeDoSistema, ultimaSintese];

/** Ferramentas que o usuário pode usar (permissão e, quando exigido, acesso a todas as praças). */
export function consultasDoUsuario(u: UsuarioSessao): FerramentaConsulta[] {
  return CONSULTAS.filter((c) => pode(u, c.permissao) && (!c.empresaInteira || u.todasUnidades));
}

export async function executarConsulta(ctx: ContextoConsulta, nome: string, entrada: unknown): Promise<{ ok: true; dados: unknown } | { ok: false; erro: string }> {
  const c = consultasDoUsuario(ctx.usuario).find((x) => x.def.name === nome);
  if (!c) return { ok: false, erro: "Ferramenta indisponível para o perfil desta pessoa." };
  try {
    return { ok: true, dados: await c.executar(ctx, entrada) };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, erro: `Parâmetros inválidos: ${e.issues.map((i) => i.message).join("; ")}` };
    return { ok: false, erro: "Não foi possível consultar agora." };
  }
}
