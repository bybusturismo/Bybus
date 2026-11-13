import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizarPlaca, situacaoSinal } from "@bybus/core";
import type { Contexto } from "../app.js";
import { auditar } from "../auditoria.js";
import { passeios, rastreioPosicoes, rastreioSessoes, saidas, transferDias, veiculos, veiculosLinksGps } from "../db/schema.js";
import { podeUnidade } from "../seguranca/escopo.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { hashToken } from "../servicos/linkEmbarque.js";

const token = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
const invalido = () => new ErroHttp(404, "LINK_INVALIDO", "Link inválido, cancelado ou vencido.");

/**
 * Link de compartilhamento do GPS de cada veículo (dono, 13/11/2026). A equipe cria um link por destinatário (hotel, parceiro,
 * escritório), com validade opcional, e pode cancelar. A página pública mostra o veículo no mapa só enquanto o motorista estiver
 * com o rastreio ligado nele (city tour pela placa da saída; transfer pelo veículo do dia); fora disso, "fora de serviço" —
 * sem a última posição (não expõe a garagem). Nada de passageiros, telefones ou nomes da equipe.
 */
export async function rotasGpsVeiculo(app: FastifyInstance, { db, config }: Contexto) {
  const ver = { preHandler: exigir(config, "frota:ver") };
  const gerenciar = { preHandler: exigir(config, "frota:gerenciar") };

  async function veiculoDoUsuario(u: { todasUnidades: boolean; unidadeIds: string[] }, id: string) {
    const [v] = await db.select().from(veiculos).where(eq(veiculos.id, id));
    if (!v || !(u.todasUnidades || podeUnidade(u as never, v.unidadeId))) throw new ErroHttp(404, "NAO_ENCONTRADO", "Veículo não encontrado.");
    return v;
  }

  app.get("/api/frota/veiculos/:id/links-gps", ver, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await veiculoDoUsuario(req.usuario!, id);
    const lista = await db.select().from(veiculosLinksGps).where(eq(veiculosLinksGps.veiculoId, id)).orderBy(desc(veiculosLinksGps.criadoEm));
    const agora = new Date();
    return lista.map(({ tokenHash: _t, ...l }) => ({ ...l, ativo: !l.revogadoEm && (!l.expiraEm || l.expiraEm > agora) }));
  });

  app.post("/api/frota/veiculos/:id/links-gps", gerenciar, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ descricao: z.string().trim().min(2).max(120), dias: z.number().int().min(1).max(365).nullish() }).parse(req.body);
    const v = await veiculoDoUsuario(req.usuario!, id);
    const t = randomBytes(24).toString("base64url");
    const expiraEm = b.dias ? new Date(Date.now() + b.dias * 86_400_000) : null;
    const [l] = await db.insert(veiculosLinksGps).values({ veiculoId: v.id, tokenHash: hashToken(t), descricao: b.descricao, expiraEm, criadoPor: req.usuario!.id }).returning({ id: veiculosLinksGps.id });
    await auditar(db, req, "VEICULO_LINK_GPS_CRIADO", { tipo: "veiculo", id: v.id }, { linkId: l!.id, descricao: b.descricao, dias: b.dias ?? null });
    reply.code(201);
    // O link completo só aparece agora (o banco guarda o hash): a tela mostra para copiar.
    return { id: l!.id, caminho: `/gps/${t}`, expiraEm };
  });

  app.delete("/api/frota/links-gps/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [l] = await db.select().from(veiculosLinksGps).where(eq(veiculosLinksGps.id, id));
    if (!l) throw new ErroHttp(404, "NAO_ENCONTRADO", "Link não encontrado.");
    await veiculoDoUsuario(req.usuario!, l.veiculoId);
    await db.update(veiculosLinksGps).set({ revogadoEm: new Date() }).where(and(eq(veiculosLinksGps.id, id), isNull(veiculosLinksGps.revogadoEm)));
    await auditar(db, req, "VEICULO_LINK_GPS_CANCELADO", { tipo: "veiculo", id: l.veiculoId }, { linkId: id });
    return { ok: true };
  });

  // ---------- Página pública ----------
  app.get("/api/publico/gps/:token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const { token: t } = z.object({ token }).parse(req.params);
    const agora = new Date();
    const [l] = await db.select({ link: veiculosLinksGps, v: veiculos }).from(veiculosLinksGps).innerJoin(veiculos, eq(veiculos.id, veiculosLinksGps.veiculoId))
      .where(eq(veiculosLinksGps.tokenHash, hashToken(t)));
    if (!l || l.link.revogadoEm || (l.link.expiraEm && l.link.expiraEm < agora)) throw invalido();
    // Último acesso (no máximo 1 gravação por minuto por link).
    if (!l.link.ultimoAcessoEm || agora.getTime() - l.link.ultimoAcessoEm.getTime() > 60_000) {
      await db.update(veiculosLinksGps).set({ ultimoAcessoEm: agora }).where(eq(veiculosLinksGps.id, l.link.id));
    }
    const placa = normalizarPlaca(l.v.placa);
    // Sessões abertas das últimas 18 h: city tour (placa no campo veículo da saída) ou transfer (veículo do dia).
    const abertas = await db.select({ s: rastreioSessoes, saidaVeiculo: saidas.veiculo, passeio: passeios.nome, transferVeiculoId: transferDias.veiculoId })
      .from(rastreioSessoes).innerJoin(saidas, eq(saidas.id, rastreioSessoes.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .leftJoin(transferDias, eq(transferDias.saidaId, rastreioSessoes.saidaId))
      .where(and(isNull(rastreioSessoes.encerradaEm), gte(rastreioSessoes.iniciadaEm, new Date(agora.getTime() - 18 * 3_600_000))))
      .orderBy(desc(rastreioSessoes.iniciadaEm));
    const daqui = abertas.find((a) => a.s.tipo === "TRANSFER" ? a.transferVeiculoId === l.v.id : normalizarPlaca(a.saidaVeiculo ?? "").includes(placa));
    const base = { veiculo: l.v.apelido || "Ônibus By Bus", placa: l.v.placa, tipoVeiculo: l.v.tipo };
    if (!daqui) return { ...base, emServico: false, situacao: "FORA_DE_SERVICO" as const, minutosSemSinal: null, passeio: null, etapa: null, posicao: null, trajeto: [] };
    const sinal = situacaoSinal(daqui.s, agora);
    const recentes = await db.select({ lat: rastreioPosicoes.lat, lng: rastreioPosicoes.lng, em: rastreioPosicoes.registradaEm, velocidade: rastreioPosicoes.velocidade })
      .from(rastreioPosicoes).where(and(eq(rastreioPosicoes.sessaoId, daqui.s.id), gte(rastreioPosicoes.registradaEm, new Date(agora.getTime() - 30 * 60_000))))
      .orderBy(desc(rastreioPosicoes.registradaEm)).limit(400);
    const ultima = recentes[0] ?? null;
    return {
      ...base, emServico: true, situacao: sinal.situacao, minutosSemSinal: sinal.situacao === "SEM_SINAL" ? sinal.minutosSemSinal : null,
      passeio: daqui.passeio, etapa: daqui.s.tipo === "TRANSFER" ? "Transfer" : "City Tour",
      posicao: ultima ? { lat: ultima.lat, lng: ultima.lng, em: ultima.em, velocidadeKmh: ultima.velocidade != null ? Math.round(ultima.velocidade * 3.6) : null } : null,
      trajeto: [...recentes].reverse().map((p) => ({ lat: p.lat, lng: p.lng })),
    };
  });
}
