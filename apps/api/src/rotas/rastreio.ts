import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { atualizarVisitado, preverChegada, PRECISAO_MAXIMA_M, situacaoSinal, velocidadeMediaKmh } from "@bybus/core";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { passeios, pessoas, rastreioLinks, rastreioPosicoes, rastreioSessoes, reservas, saidas, transferDias } from "../db/schema.js";
import { filtroUnidade, garantirSaida } from "../seguranca/escopo.js";
import { pode, type Permissao } from "../seguranca/permissoes.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { agoraSp } from "../servicos/fechamento.js";
import { hashToken } from "../servicos/linkEmbarque.js";
import { avisarChegadas, coordenadaDe, enviarLinksRastreio, localizarHoteisTransfer, paradasDoTransfer, pontosDaRota, ultimaSessao } from "../servicos/rastreio.js";

const uuid = z.string().uuid();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const token = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
const diaSp = (d: Date) => agoraSp(d).hoje;

const posicaoZ = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  precisaoM: z.number().min(0).max(100_000).nullish(),
  velocidade: z.number().min(0).max(100).nullish(),
  direcao: z.number().min(0).max(360).nullish(),
  registradaEm: z.string().datetime({ message: "Horário inválido (use o formato ISO em UTC)." }),
});

const invalido = () => new ErroHttp(404, "LINK_INVALIDO", "Este link não é válido ou já expirou. Fale com a By Bus pelo WhatsApp.");

export async function rotasRastreio(app: FastifyInstance, { db, config }: Contexto) {
  const motorista = { preHandler: exigir(config, "rastreio:transmitir") };
  const equipe = {
    preHandler: async (req: Parameters<ReturnType<typeof exigir>>[0]) => {
      await exigir(config)(req);
      const u = req.usuario!;
      if (!(["manifesto:ver", "saidas:decidir"] as Permissao[]).some((p) => pode(u, p))) throw new ErroHttp(403, "SEM_PERMISSAO", "Seu perfil não tem acesso a esta função.");
    },
  };

  /** A saída precisa ser de hoje (Brasília) e ter como motorista a pessoa ligada ao usuário logado. */
  async function saidaDoMotorista(usuarioId: string, saidaId: string) {
    const [r] = await db.select({ saida: saidas, passeio: passeios, motoristaUsuarioId: pessoas.usuarioId }).from(saidas)
      .innerJoin(passeios, eq(passeios.id, saidas.passeioId)).leftJoin(pessoas, eq(pessoas.id, saidas.motoristaId)).where(eq(saidas.id, saidaId));
    if (!r) throw new ErroHttp(404, "NAO_ENCONTRADO", "Saída não encontrada.");
    if (r.motoristaUsuarioId !== usuarioId) throw new ErroHttp(403, "NAO_E_O_MOTORISTA", "Só o motorista escalado nesta saída pode transmitir a posição.");
    return r;
  }

  /** Transfer de hoje com o usuário logado como motorista da van. */
  async function transferDoMotorista(usuarioId: string, saidaId: string) {
    const [r] = await db.select({ saida: saidas, passeio: passeios, dia: transferDias, motoristaUsuarioId: pessoas.usuarioId }).from(transferDias)
      .innerJoin(saidas, eq(saidas.id, transferDias.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .leftJoin(pessoas, eq(pessoas.id, transferDias.motoristaId)).where(eq(transferDias.saidaId, saidaId));
    if (!r) throw new ErroHttp(404, "NAO_ENCONTRADO", "Esta saída não tem transfer.");
    if (r.motoristaUsuarioId !== usuarioId) throw new ErroHttp(403, "NAO_E_O_MOTORISTA", "Só o motorista do transfer pode transmitir a posição da van.");
    return r;
  }

  // ---------- Motorista (celular) ----------
  // Dois momentos (dono, 11/11/2026): a VAN do transfer (de manhã, buscando nos hotéis) e o ÔNIBUS (pontos de embarque).
  app.get("/api/rastreio/minhas-saidas", motorista, async (req) => {
    const hoje = agoraSp().hoje;
    const daVan = await db.select({ saida: saidas, passeio: passeios, veiculo: transferDias.veiculoTexto }).from(transferDias)
      .innerJoin(saidas, eq(saidas.id, transferDias.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).innerJoin(pessoas, eq(pessoas.id, transferDias.motoristaId))
      .where(and(eq(saidas.data, hoje), eq(pessoas.usuarioId, req.usuario!.id), ne(saidas.status, "CANCELADA"))).orderBy(asc(passeios.nome));
    const doOnibus = await db.select({ saida: saidas, passeio: passeios }).from(saidas)
      .innerJoin(passeios, eq(passeios.id, saidas.passeioId)).innerJoin(pessoas, eq(pessoas.id, saidas.motoristaId))
      .where(and(eq(saidas.data, hoje), eq(pessoas.usuarioId, req.usuario!.id), ne(saidas.status, "CANCELADA"))).orderBy(asc(passeios.nome));
    const resultado = [];
    for (const [tipo, lista] of [["TRANSFER", daVan], ["ONIBUS", doOnibus]] as const) {
      for (const x of lista) {
        const s = await ultimaSessao(db, x.saida.id, tipo);
        resultado.push({
          saidaId: x.saida.id, tipo, passeio: x.passeio.nome, data: x.saida.data,
          veiculo: tipo === "TRANSFER" ? ("veiculo" in x ? x.veiculo : null) : x.saida.veiculo,
          sessao: s && !s.encerradaEm ? { id: s.id, iniciadaEm: s.iniciadaEm } : null,
        });
      }
    }
    return resultado;
  });

  app.post("/api/rastreio/saidas/:saidaId/iniciar", motorista, async (req, reply) => {
    const { saidaId } = z.object({ saidaId: uuid }).parse(req.params);
    const { tipo } = z.object({ tipo: z.enum(["ONIBUS", "TRANSFER"]).default("ONIBUS") }).parse(req.body ?? {});
    const { saida, passeio } = tipo === "TRANSFER" ? await transferDoMotorista(req.usuario!.id, saidaId) : await saidaDoMotorista(req.usuario!.id, saidaId);
    if (saida.status === "CANCELADA") throw new ErroHttp(409, "SAIDA_CANCELADA", "Esta saída foi cancelada.");
    if (saida.data !== agoraSp().hoje) throw new ErroHttp(409, "FORA_DO_DIA", "O rastreio só pode ser iniciado no dia do passeio.");
    const aberta = (await ultimaSessao(db, saidaId, tipo));
    if (aberta && !aberta.encerradaEm) {
      if (aberta.motoristaUsuarioId !== req.usuario!.id) throw new ErroHttp(409, "RASTREIO_ABERTO", "Já há um rastreio aberto nesta saída. Peça à supervisão para encerrá-lo.");
      return { sessaoId: aberta.id, iniciadaEm: aberta.iniciadaEm, retomada: true, linksEnfileirados: 0 };
    }
    let sessao;
    try {
      [sessao] = await db.insert(rastreioSessoes).values({ saidaId, motoristaUsuarioId: req.usuario!.id, tipo }).returning();
    } catch {
      throw new ErroHttp(409, "RASTREIO_ABERTO", "Já há um rastreio aberto nesta saída.");
    }
    await auditar(db, req, "RASTREIO_INICIADO", { tipo: "saida", id: saidaId }, { sessaoId: sessao!.id, veiculo: tipo });
    if (tipo === "TRANSFER") {
      // Acha no mapa os hotéis que ainda não têm ponto (devagar, 1 por segundo; não segura a resposta).
      if (config.AMBIENTE !== "testes") void localizarHoteisTransfer(db, saidaId, passeio.cidade).catch(() => undefined);
      reply.status(201);
      return { sessaoId: sessao!.id, iniciadaEm: sessao!.iniciadaEm, retomada: false, linksEnfileirados: 0 };
    }
    // Ônibus: o rastreio da van deste motorista termina aqui (os clientes do transfer já estão a bordo).
    const van = await ultimaSessao(db, saidaId, "TRANSFER");
    if (van && !van.encerradaEm && van.motoristaUsuarioId === req.usuario!.id) {
      await db.update(rastreioSessoes).set({ encerradaEm: new Date() }).where(eq(rastreioSessoes.id, van.id));
      await auditar(db, req, "RASTREIO_ENCERRADO", { tipo: "saida", id: saidaId }, { sessaoId: van.id, porInicioDoOnibus: true });
    }
    const envio = await enviarLinksRastreio(db, config, saida, passeio.nome);
    reply.status(201);
    return { sessaoId: sessao!.id, iniciadaEm: sessao!.iniciadaEm, retomada: false, linksEnfileirados: envio.enfileiradas, semUrlPublica: envio.semUrlPublica };
  });

  app.post("/api/rastreio/sessoes/:id/encerrar", { preHandler: exigir(config) }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const u = req.usuario!;
    const [s] = await db.select().from(rastreioSessoes).where(eq(rastreioSessoes.id, id));
    if (!s) throw new ErroHttp(404, "NAO_ENCONTRADO", "Rastreio não encontrado.");
    const dono = s.motoristaUsuarioId === u.id && pode(u, "rastreio:transmitir");
    if (!dono) {
      // A supervisão (com escopo de praça) também pode encerrar, por exemplo se o celular do motorista parou.
      if (!pode(u, "saidas:decidir")) throw new ErroHttp(403, "SEM_PERMISSAO", "Seu perfil não tem acesso a esta função.");
      await garantirSaida(db, u, s.saidaId);
    }
    if (s.encerradaEm) return { ok: true, jaEncerrado: true };
    await db.update(rastreioSessoes).set({ encerradaEm: new Date() }).where(eq(rastreioSessoes.id, id));
    await auditar(db, req, "RASTREIO_ENCERRADO", { tipo: "saida", id: s.saidaId }, { sessaoId: id, porSupervisao: !dono });
    return { ok: true, jaEncerrado: false };
  });

  app.post("/api/rastreio/sessoes/:id/posicoes", { preHandler: exigir(config, "rastreio:transmitir"), config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { posicoes } = z.object({ posicoes: z.array(posicaoZ).min(1).max(20) }).parse(req.body);
    const [s] = await db.select({ sessao: rastreioSessoes, saidaData: saidas.data, passeioId: saidas.passeioId, passeio: passeios.nome }).from(rastreioSessoes)
      .innerJoin(saidas, eq(saidas.id, rastreioSessoes.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).where(eq(rastreioSessoes.id, id));
    if (!s || s.sessao.motoristaUsuarioId !== req.usuario!.id) throw new ErroHttp(403, "NAO_E_O_MOTORISTA", "Só o motorista que iniciou o rastreio pode enviar posições.");
    if (s.sessao.encerradaEm) throw new ErroHttp(409, "SESSAO_ENCERRADA", "Este rastreio já foi encerrado.");
    const agora = new Date();
    if (s.saidaData !== diaSp(agora)) throw new ErroHttp(409, "FORA_DO_DIA", "O rastreio só transmite no dia do passeio.");

    const descartadas = { precisao: 0, horario: 0, duplicadas: 0 };
    const boas = [];
    for (const p of posicoes) {
      const quando = new Date(p.registradaEm);
      // Horário do aparelho: nunca no futuro (relógio errado) e sempre no dia da saída.
      if (quando.getTime() > agora.getTime() + 2 * 60_000 || diaSp(quando) !== s.saidaData) descartadas.horario++;
      else if (p.precisaoM != null && p.precisaoM > PRECISAO_MAXIMA_M) descartadas.precisao++;
      else boas.push({ sessaoId: id, lat: p.lat, lng: p.lng, precisaoM: p.precisaoM ?? null, velocidade: p.velocidade ?? null, direcao: p.direcao ?? null, registradaEm: quando });
    }
    let aceitas = 0;
    if (boas.length) {
      const novas = await db.insert(rastreioPosicoes).values(boas).onConflictDoNothing().returning({ registradaEm: rastreioPosicoes.registradaEm });
      aceitas = novas.length;
      descartadas.duplicadas = boas.length - novas.length;
      if (novas.length) {
        const maisRecente = new Date(Math.max(...novas.map((n) => n.registradaEm.getTime())));
        const tipo = s.sessao.tipo === "TRANSFER" ? "TRANSFER" : "ONIBUS";
        // Paradas: hotéis do transfer (van) ou pontos de embarque (ônibus).
        const paradas = tipo === "TRANSFER"
          ? (await paradasDoTransfer(db, s.sessao.saidaId)).map((x) => (x.latitude !== null && x.longitude !== null ? { lat: x.latitude, lng: x.longitude } : null))
          : (await pontosDaRota(db, s.passeioId)).map(coordenadaDe);
        const ordenadas = boas.filter((b) => novas.some((n) => n.registradaEm.getTime() === b.registradaEm.getTime())).sort((a, b) => a.registradaEm.getTime() - b.registradaEm.getTime());
        const visitado = Math.max(atualizarVisitado(s.sessao.ultimoPontoVisitado, paradas, ordenadas.map((b) => ({ lat: b.lat, lng: b.lng }))), s.sessao.ultimoPontoVisitado);
        await db.update(rastreioSessoes).set({
          ultimaPosicaoEm: s.sessao.ultimaPosicaoEm && s.sessao.ultimaPosicaoEm > maisRecente ? s.sessao.ultimaPosicaoEm : maisRecente,
          ultimoPontoVisitado: visitado,
        }).where(eq(rastreioSessoes.id, id));
        // Avisos "chega em ~5 min" e "chegou" (WhatsApp; uma vez por reserva). Falha aqui não perde as posições.
        const ultimaBoa = ordenadas.at(-1)!;
        try {
          await avisarChegadas(db, config, {
            tipo, saida: { id: s.sessao.saidaId, passeioId: s.passeioId }, passeio: s.passeio,
            visitadoAntes: s.sessao.ultimoPontoVisitado, visitadoAgora: visitado,
            posicao: { lat: ultimaBoa.lat, lng: ultimaBoa.lng, em: ultimaBoa.registradaEm },
            velocidadeKmh: velocidadeMediaKmh(ordenadas.slice(-5).map((b) => b.velocidade)),
          });
        } catch (e) {
          req.log.error({ erro: e instanceof Error ? e.message : e }, "Falha nos avisos de chegada");
        }
      }
    }
    return { aceitas, descartadas };
  });

  // ---------- Equipe ----------
  /** Última posição e velocidades recentes de uma sessão. */
  async function recentes(sessaoId: string) {
    return db.select({ lat: rastreioPosicoes.lat, lng: rastreioPosicoes.lng, velocidade: rastreioPosicoes.velocidade, em: rastreioPosicoes.registradaEm }).from(rastreioPosicoes)
      .where(eq(rastreioPosicoes.sessaoId, sessaoId)).orderBy(desc(rastreioPosicoes.registradaEm)).limit(5);
  }

  app.get("/api/rastreio/saidas", equipe, async (req) => {
    const q = z.object({ data: dataIso.optional() }).parse(req.query);
    const data = q.data ?? agoraSp().hoje;
    const lista = await db.select({ saida: saidas, passeio: { nome: passeios.nome, unidadeId: passeios.unidadeId, id: passeios.id } }).from(saidas)
      .innerJoin(passeios, eq(passeios.id, saidas.passeioId)).where(and(eq(saidas.data, data), ne(saidas.status, "CANCELADA"), filtroUnidade(req.usuario!)))
      .orderBy(asc(passeios.nome));
    const agora = new Date();
    const cobertura = new Map<string, { total: number; comCoordenadas: number }>();
    return Promise.all(lista.map(async ({ saida, passeio }) => {
      const sessao = await ultimaSessao(db, saida.id);
      const sinal = situacaoSinal(sessao, agora);
      const ultima = sessao ? (await recentes(sessao.id))[0] ?? null : null;
      if (!cobertura.has(passeio.id)) {
        const pts = await pontosDaRota(db, passeio.id);
        cobertura.set(passeio.id, { total: pts.length, comCoordenadas: pts.filter((p) => coordenadaDe(p)).length });
      }
      const van = await ultimaSessao(db, saida.id, "TRANSFER");
      const sinalVan = van ? situacaoSinal(van, agora) : null;
      return {
        saidaId: saida.id, passeio: passeio.nome, data: saida.data, motorista: saida.motorista, veiculo: saida.veiculo,
        situacao: sinal.situacao, minutosSemSinal: sinal.minutosSemSinal,
        // Van do transfer (11/11/2026): situação e última posição, à parte do ônibus.
        van: van && sinalVan ? { situacao: sinalVan.situacao, minutosSemSinal: sinalVan.minutosSemSinal, ultimaPosicao: (await recentes(van.id))[0] ?? null } : null,
        sessao: sessao ? { id: sessao.id, iniciadaEm: sessao.iniciadaEm, encerradaEm: sessao.encerradaEm } : null,
        ultimaPosicao: ultima ? { lat: ultima.lat, lng: ultima.lng, velocidade: ultima.velocidade, em: ultima.em } : null,
        pontos: cobertura.get(passeio.id)!,
      };
    }));
  });

  app.get("/api/rastreio/saidas/:saidaId", equipe, async (req) => {
    const { saidaId } = z.object({ saidaId: uuid }).parse(req.params);
    await garantirSaida(db, req.usuario!, saidaId);
    const [r] = await db.select({ saida: saidas, passeio: passeios }).from(saidas).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).where(eq(saidas.id, saidaId));
    const sessao = await ultimaSessao(db, saidaId);
    const sinal = situacaoSinal(sessao, new Date());
    const rota = await pontosDaRota(db, r!.passeio.id);
    const trajeto = sessao
      ? await db.select({ lat: rastreioPosicoes.lat, lng: rastreioPosicoes.lng, em: rastreioPosicoes.registradaEm }).from(rastreioPosicoes)
        .where(eq(rastreioPosicoes.sessaoId, sessao.id)).orderBy(asc(rastreioPosicoes.registradaEm)).limit(3000)
      : [];
    const ultima = trajeto.at(-1) ?? null;
    return {
      saidaId, passeio: r!.passeio.nome, data: r!.saida.data, motorista: r!.saida.motorista, veiculo: r!.saida.veiculo,
      situacao: sinal.situacao, minutosSemSinal: sinal.minutosSemSinal,
      sessao: sessao ? { id: sessao.id, iniciadaEm: sessao.iniciadaEm, encerradaEm: sessao.encerradaEm } : null,
      ultimaPosicao: ultima,
      pontos: rota.map((p, i) => ({ id: p.id, nome: p.nome, horario: p.horario, lat: p.latitude, lng: p.longitude, passou: !!sessao && i <= sessao.ultimoPontoVisitado })),
      trajeto,
    };
  });

  // ---------- Público (sem login) ----------
  // Revisão: o token (24 bytes aleatórios; só o hash no banco) identifica UMA reserva. Expira no fim do dia do passeio.
  // Devolve só: nome do passeio, ponto da própria reserva, posição do ônibus (só em serviço), pontos da rota (nome e
  // coordenadas, dados já públicos no site) e a previsão. Nunca motorista, placa, guia nem outros passageiros.
  app.get("/api/publico/rastreio/:token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const { token: t } = z.object({ token }).parse(req.params);
    const [l] = await db.select({ link: rastreioLinks, reserva: reservas, saida: saidas, passeio: passeios }).from(rastreioLinks)
      .innerJoin(reservas, eq(reservas.id, rastreioLinks.reservaId)).innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .where(eq(rastreioLinks.tokenHash, hashToken(t)));
    if (!l || l.reserva.status !== "CONFIRMADA" || l.link.expiraEm < new Date() || l.saida.status === "CANCELADA") throw invalido();

    const rota = await pontosDaRota(db, l.passeio.id);
    const alvo = rota.findIndex((p) => p.id === l.reserva.pontoEmbarqueId);
    const pontoCliente = alvo >= 0 ? rota[alvo]! : null;
    const sessao = await ultimaSessao(db, l.saida.id);
    const sinal = situacaoSinal(sessao, new Date());
    const ultimas = sessao && !sessao.encerradaEm ? await recentes(sessao.id) : [];
    const ultima = ultimas[0] ?? null;
    const visitado = sessao ? sessao.ultimoPontoVisitado : -1;

    const emServico = sinal.situacao === "TRANSMITINDO" || sinal.situacao === "SEM_SINAL";
    const previsao = ultima && sinal.situacao === "TRANSMITINDO"
      ? preverChegada({ posicao: ultima, pontos: rota.map(coordenadaDe), visitado, alvo: alvo >= 0 ? alvo : null, velocidadeKmh: velocidadeMediaKmh(ultimas.map((u) => u.velocidade)) })
      : null;
    return {
      passeio: l.passeio.nome, cidade: l.passeio.cidade, data: l.saida.data,
      situacao: sinal.situacao,
      minutosSemSinal: sinal.situacao === "SEM_SINAL" ? sinal.minutosSemSinal : null,
      ponto: pontoCliente ? { nome: pontoCliente.nome, horario: pontoCliente.horario, ...coordenadaDe(pontoCliente) } : null,
      onibus: emServico && ultima ? { lat: ultima.lat, lng: ultima.lng, em: ultima.em } : null,
      rota: rota.map((p, i) => ({ p, i })).filter(({ p }) => coordenadaDe(p)).map(({ p, i }) => ({ nome: p.nome, lat: p.latitude!, lng: p.longitude!, passou: i <= visitado, doCliente: i === alvo })),
      previsao: previsao ? { situacao: previsao.situacao, minutos: previsao.minutos, motivo: previsao.motivo ?? null, estimativa: true } : null,
      jaPassou: !!sessao && alvo >= 0 && alvo <= visitado,
    };
  });
}
