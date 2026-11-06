import { createHash, randomBytes } from "node:crypto";
import { esperaTentativaMinutos, erroTransitorio, TENTATIVAS_PUBLICACAO, validarAgendamento, type TipoPostInstagram } from "@bybus/core";
import { and, asc, eq, inArray, isNotNull, lt, or, isNull, lte, sql } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Db } from "../../db/cliente.js";
import { auditar } from "../../auditoria.js";
import { conteudoMidias, conteudos, igMidiaTokens } from "../../db/schema.js";
import { criarContainer, instagramReal, lerLink, publicarContainer, statusContainer, type RespostaGraph } from "./cliente.js";

/**
 * Publicação dos posts agendados pelo fluxo oficial: criar contêiner(es) de mídia → esperar processar → publicar.
 * - Só publica conteúdo APROVADO e agendado (pubStatus AGENDADO, aprovadoEm preenchido, horário vencido).
 * - Idempotente: cada conteúdo é "reservado" com UPDATE condicional (dois relógios nunca publicam o mesmo); o contêiner criado é
 *   guardado e reaproveitado na nova tentativa (publicar o mesmo contêiner duas vezes não duplica o post).
 * - Retentativas com espera crescente para falhas transitórias; erro definitivo vira FALHOU com o motivo (código).
 * - Modo simulado: marca "publicado (simulado)" sem falar com a Meta.
 * - A Meta busca a mídia numa URL pública de uso único e curta duração (rota /api/publico/instagram/midia/<token>): exige URL_PUBLICA https,
 *   ou seja, o sistema no ar.
 */

export const VALIDADE_TOKEN_MIDIA_MINUTOS = 30;
const PRESO_MINUTOS = 45;
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export interface ResultadoRodada { simuladas: number; publicadas: number; falhas: number; adiadas: number; interrompidas: number }
type Falha = { transitorio: boolean; codigo: string };
type Passo<T> = { ok: true; valor: T } | { ok: false; falha: Falha } | { ok: false; aguardar: true };

const falhaDe = (r: RespostaGraph<unknown>): { ok: false; falha: Falha } => ({ ok: false, falha: { transitorio: erroTransitorio(r.status), codigo: `META_${r.codigo ?? r.status}` } });

/** Cria o endereço público temporário de uma mídia. O token só existe aqui e na URL entregue à Meta. */
async function urlPublicaDaMidia(db: Db, config: Config, midiaId: string, agora: Date): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(igMidiaTokens).values({ tokenHash: hashToken(token), midiaId, expiraEm: new Date(agora.getTime() + VALIDADE_TOKEN_MIDIA_MINUTOS * 60_000) });
  return `${config.URL_PUBLICA!.replace(/\/$/, "")}/api/publico/instagram/midia/${token}`;
}

async function esperarContainer(config: Config, id: string, buscar: typeof fetch | undefined, tentativas: number, pausaMs: number): Promise<Passo<true>> {
  for (let i = 0; i < tentativas; i++) {
    const s = await statusContainer(config, id, buscar);
    if (!s.ok) return falhaDe(s);
    const st = s.dados?.status_code;
    if (!st || st === "FINISHED" || st === "PUBLISHED") return { ok: true, valor: true };
    if (st === "ERROR" || st === "EXPIRED") return { ok: false, falha: { transitorio: false, codigo: `META_STATUS_${st}` } };
    if (i < tentativas - 1 && pausaMs) await new Promise((r) => setTimeout(r, pausaMs));
  }
  return { ok: false, aguardar: true };
}

interface OpcoesPublicacao { agora?: Date; buscar?: typeof fetch; pausaMs?: number; consultas?: number }

async function publicarNaMeta(db: Db, config: Config, c: typeof conteudos.$inferSelect, midias: Array<typeof conteudoMidias.$inferSelect>, o: Required<Pick<OpcoesPublicacao, "agora">> & OpcoesPublicacao): Promise<Passo<{ id: string; link: string | null }>> {
  if (!config.URL_PUBLICA?.startsWith("https://")) return { ok: false, falha: { transitorio: false, codigo: "URL_PUBLICA_AUSENTE" } };
  const tipo = c.tipoPost as TipoPostInstagram;
  const consultas = o.consultas ?? 12;
  const pausa = o.pausaMs ?? 5000;
  let containerId = c.pubContainerId;
  if (!containerId) {
    if (tipo === "CARROSSEL") {
      const filhos: string[] = [];
      for (const m of midias) {
        const url = await urlPublicaDaMidia(db, config, m.id, o.agora);
        const r = await criarContainer(config, { url, ehVideo: m.uso === "VIDEO", itemCarrossel: true, tipo }, o.buscar);
        if (!r.ok || !r.dados?.id) return r.ok ? { ok: false, falha: { transitorio: false, codigo: "META_SEM_ID" } } : falhaDe(r);
        const pronto = await esperarContainer(config, r.dados.id, o.buscar, consultas, pausa);
        if (!pronto.ok) return pronto as Passo<never>;
        filhos.push(r.dados.id);
      }
      const pai = await criarContainer(config, { url: "", ehVideo: false, filhos, legenda: c.legenda, tipo }, o.buscar);
      if (!pai.ok || !pai.dados?.id) return pai.ok ? { ok: false, falha: { transitorio: false, codigo: "META_SEM_ID" } } : falhaDe(pai);
      containerId = pai.dados.id;
    } else {
      const m = midias[0]!;
      const url = await urlPublicaDaMidia(db, config, m.id, o.agora);
      const r = await criarContainer(config, { url, ehVideo: m.uso === "VIDEO", legenda: c.legenda, tipo }, o.buscar);
      if (!r.ok || !r.dados?.id) return r.ok ? { ok: false, falha: { transitorio: false, codigo: "META_SEM_ID" } } : falhaDe(r);
      containerId = r.dados.id;
    }
    await db.update(conteudos).set({ pubContainerId: containerId }).where(eq(conteudos.id, c.id));
  }
  const pronto = await esperarContainer(config, containerId, o.buscar, consultas, pausa);
  if (!pronto.ok) return pronto as Passo<never>;
  const pub = await publicarContainer(config, containerId, o.buscar);
  if (!pub.ok || !pub.dados?.id) return pub.ok ? { ok: false, falha: { transitorio: false, codigo: "META_SEM_ID" } } : falhaDe(pub);
  const link = await lerLink(config, pub.dados.id, o.buscar);
  return { ok: true, valor: { id: pub.dados.id, link: link.ok ? link.dados?.permalink ?? null : null } };
}

/** Uma rodada: recupera conteúdos presos e publica o que venceu. Chamada pelo relógio (1 min) e pelos testes. */
export async function publicarPendentes(db: Db, config: Config, opcoes: OpcoesPublicacao = {}): Promise<ResultadoRodada> {
  const agora = opcoes.agora ?? new Date();
  const r: ResultadoRodada = { simuladas: 0, publicadas: 0, falhas: 0, adiadas: 0, interrompidas: 0 };
  await db.delete(igMidiaTokens).where(lt(igMidiaTokens.expiraEm, agora));

  // Preso em PUBLICANDO (servidor caiu no meio): não tenta de novo sozinho, porque o post pode já estar no ar.
  const presos = await db.update(conteudos).set({ pubStatus: "FALHOU", pubErro: "INTERROMPIDO_CONFIRA_NO_INSTAGRAM", atualizadoEm: agora })
    .where(and(eq(conteudos.pubStatus, "PUBLICANDO"), lt(conteudos.pubIniciadaEm, new Date(agora.getTime() - PRESO_MINUTOS * 60_000)))).returning({ id: conteudos.id });
  r.interrompidas = presos.length;

  const vencidos = await db.select({ id: conteudos.id }).from(conteudos).where(and(
    eq(conteudos.pubStatus, "AGENDADO"), isNotNull(conteudos.aprovadoEm), lte(conteudos.agendarEm, agora), or(isNull(conteudos.pubProximaEm), lte(conteudos.pubProximaEm, agora)),
  )).orderBy(asc(conteudos.agendarEm)).limit(10);

  for (const { id } of vencidos) {
    // Reserva atômica: só quem conseguir virar AGENDADO → PUBLICANDO publica.
    const [c] = await db.update(conteudos).set({ pubStatus: "PUBLICANDO", pubIniciadaEm: agora, pubTentativas: sql`${conteudos.pubTentativas} + 1`, atualizadoEm: agora })
      .where(and(eq(conteudos.id, id), eq(conteudos.pubStatus, "AGENDADO"), isNotNull(conteudos.aprovadoEm))).returning();
    if (!c) continue;
    const midias = await db.select().from(conteudoMidias).where(eq(conteudoMidias.conteudoId, id)).orderBy(asc(conteudoMidias.ordem), asc(conteudoMidias.criadoEm));
    const erros = validarAgendamento({ rede: c.rede, tipo: (c.tipoPost ?? "IMAGEM") as TipoPostInstagram, legenda: c.legenda, agendarEm: new Date(agora.getTime() + 3_600_000), midias: midias.map((m) => ({ uso: m.uso as "IMAGEM" | "VIDEO", tipo: m.tipo })) });
    const encerrar = async (campos: Partial<typeof conteudos.$inferInsert>, acao: string) => {
      await db.update(conteudos).set({ ...campos, atualizadoEm: new Date() }).where(eq(conteudos.id, id));
      await db.delete(igMidiaTokens).where(inArray(igMidiaTokens.midiaId, midias.map((m) => m.id).concat("00000000-0000-0000-0000-000000000000")));
      await auditar(db, null, acao, { tipo: "conteudo", id }, { simulado: !instagramReal(config) });
    };
    if (erros.length) { r.falhas++; await encerrar({ pubStatus: "FALHOU", pubErro: "CONTEUDO_INVALIDO" }, "INSTAGRAM_PUBLICACAO_FALHOU"); continue; }
    if (!instagramReal(config)) {
      r.simuladas++;
      await encerrar({ pubStatus: "PUBLICADO", pubSimulado: true, pubErro: null, pubEm: agora, status: "PUBLICADO" }, "INSTAGRAM_PUBLICADO_SIMULADO");
      continue;
    }
    let p: Passo<{ id: string; link: string | null }>;
    try { p = await publicarNaMeta(db, config, c, midias, { ...opcoes, agora }); } catch (e) { p = { ok: false, falha: { transitorio: true, codigo: e instanceof Error ? e.name : "ERRO" } }; }
    if (p.ok) {
      r.publicadas++;
      await encerrar({ pubStatus: "PUBLICADO", pubSimulado: false, pubErro: null, pubIdExterno: p.valor.id, pubEm: new Date(), status: "PUBLICADO", ...(p.valor.link ? { link: p.valor.link } : {}) }, "INSTAGRAM_PUBLICADO");
    } else if ("aguardar" in p) {
      // A Meta ainda processa o vídeo: volta à fila em 2 min, sem gastar tentativa.
      r.adiadas++;
      await db.update(conteudos).set({ pubStatus: "AGENDADO", pubProximaEm: new Date(agora.getTime() + 2 * 60_000), pubTentativas: sql`greatest(${conteudos.pubTentativas} - 1, 0)`, atualizadoEm: new Date() }).where(eq(conteudos.id, id));
    } else if (p.falha.transitorio && c.pubTentativas < TENTATIVAS_PUBLICACAO) {
      r.adiadas++;
      await db.update(conteudos).set({ pubStatus: "AGENDADO", pubErro: p.falha.codigo, pubProximaEm: new Date(agora.getTime() + esperaTentativaMinutos(c.pubTentativas) * 60_000), atualizadoEm: new Date() }).where(eq(conteudos.id, id));
    } else {
      r.falhas++;
      await encerrar({ pubStatus: "FALHOU", pubErro: p.falha.codigo }, "INSTAGRAM_PUBLICACAO_FALHOU");
    }
  }
  return r;
}
