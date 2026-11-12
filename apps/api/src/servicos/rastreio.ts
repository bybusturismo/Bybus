import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { avisosDeChegada, compararPontos, indicesNoTracado, modeloChegada, modeloRastreio, renderizarModeloMeta, textoRastreio, type TipoRastreio } from "@bybus/core";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { mensagens, passageiros, passeios, pontosEmbarque, rastreioLinks, rastreioPosicoes, rastreioSessoes, reservas, saidas, transferDias, transferReservas } from "../db/schema.js";
import { agoraSp, enfileirarMensagem } from "./fechamento.js";
import { hashToken } from "./linkEmbarque.js";

/** Posições guardadas por no máximo 30 dias (LGPD: a localização do motorista só existe em serviço). */
export const RETENCAO_POSICOES_DIAS = 30;

/** Expiração do link: fim do dia do passeio em Brasília (03:00 UTC do dia seguinte). */
export const fimDoDia = (data: string) => new Date(new Date(`${data}T03:00:00Z`).getTime() + 86_400_000);

/** Pontos ativos do passeio na ordem da rota (horário, depois ordem oficial). */
export async function pontosDaRota(db: Db, passeioId: string) {
  const lista = await db.select().from(pontosEmbarque).where(and(eq(pontosEmbarque.passeioId, passeioId), eq(pontosEmbarque.ativo, true))).orderBy(asc(pontosEmbarque.ordem));
  return lista.sort(compararPontos);
}

/** Traçado real do passeio (importado do mapa) com o índice de cada parada nele; null sem traçado. */
export async function rotaDoPasseio(db: Db, passeioId: string, paradas: ReadonlyArray<{ lat: number; lng: number } | null>) {
  const [p] = await db.select({ tracado: passeios.tracado }).from(passeios).where(eq(passeios.id, passeioId));
  if (!p?.tracado || p.tracado.length < 2) return null;
  const tracado = p.tracado.map(([lat, lng]) => ({ lat, lng }));
  return { tracado, indices: indicesNoTracado(tracado, paradas) };
}

export const coordenadaDe = (p: { latitude: number | null; longitude: number | null }) => (p.latitude !== null && p.longitude !== null ? { lat: p.latitude, lng: p.longitude } : null);

/** Sessão mais recente da saída, do ônibus (padrão) ou da van do transfer. */
export async function ultimaSessao(db: Db, saidaId: string, tipo: TipoRastreio = "ONIBUS") {
  const [s] = await db.select().from(rastreioSessoes).where(and(eq(rastreioSessoes.saidaId, saidaId), eq(rastreioSessoes.tipo, tipo))).orderBy(desc(rastreioSessoes.iniciadaEm)).limit(1);
  return s ?? null;
}

// ---------------------------------------------------------------- van do transfer e avisos de chegada (11/11/2026)

/** Paradas da van: as reservas do transfer do dia, na ordem de busca, com o local e o ponto no mapa. */
export async function paradasDoTransfer(db: Db, saidaId: string) {
  return db.select({
    id: transferReservas.id, reservaId: transferReservas.reservaId, situacao: transferReservas.situacao, horario: transferReservas.horarioBusca,
    local: sql<string | null>`coalesce(${transferReservas.enderecoBusca}, ${reservas.hospedagemInformada})`,
    latitude: transferReservas.latitude, longitude: transferReservas.longitude,
  }).from(transferReservas).innerJoin(transferDias, eq(transferDias.id, transferReservas.transferDiaId)).innerJoin(reservas, eq(reservas.id, transferReservas.reservaId))
    .where(and(eq(transferDias.saidaId, saidaId), eq(reservas.status, "CONFIRMADA"))).orderBy(asc(transferReservas.ordem));
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Acha no mapa (OpenStreetMap/Nominatim, gratuito) os hotéis do transfer que ainda não têm ponto. Política do Nominatim: no máximo
 * 1 pedido por segundo, identificação do sistema e cache (o resultado fica gravado; só busca de novo se o endereço mudar).
 * Os endereços vêm dos clientes: vão só o texto do hotel/endereço e a cidade, nunca nome ou telefone.
 */
export async function localizarHoteisTransfer(db: Db, saidaId: string, cidade: string, buscar: typeof fetch = fetch, intervaloMs = 1100) {
  const faltam = (await paradasDoTransfer(db, saidaId)).filter((p) => p.local && (p.latitude === null || p.longitude === null));
  let achados = 0;
  for (const [i, p] of faltam.entries()) {
    if (i > 0) await espera(intervaloMs);
    try {
      const url = `${NOMINATIM}?format=jsonv2&limit=1&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(`${p.local}, ${cidade}, SC`)}`;
      const r = await buscar(url, { headers: { "User-Agent": "BybusGestao/1.0 (+https://gestao.bybusturismo.com.br)" }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) continue;
      const [achado] = (await r.json()) as Array<{ lat?: string; lon?: string }>;
      const lat = Number(achado?.lat);
      const lng = Number(achado?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      await db.update(transferReservas).set({ latitude: lat, longitude: lng, localOrigem: "OSM" }).where(and(eq(transferReservas.id, p.id), isNull(transferReservas.latitude)));
      achados++;
    } catch {
      /* sem internet ou endereço não achado: a equipe corrige à mão */
    }
  }
  return { procurados: faltam.length, achados };
}

const TIPO_MENSAGEM = { ONIBUS: { CHEGANDO: "ONIBUS_CHEGANDO", CHEGOU: "ONIBUS_CHEGOU" }, TRANSFER: { CHEGANDO: "VAN_CHEGANDO", CHEGOU: "VAN_CHEGOU" } } as const;
/** Posições mais velhas que isto (ex.: fila que estava sem internet) não disparam aviso. */
const IDADE_MAXIMA_AVISO_MS = 2 * 60_000;

/**
 * Depois de gravar posições: manda "chega em ~5 min" e "chegou" para os clientes das paradas certas (uma vez por reserva e tipo).
 * Ônibus: clientes de cada ponto de embarque, menos os do transfer (estão na van) e quem já embarcou.
 * Van: cada hotel do transfer, menos quem já foi buscado ou não apareceu.
 */
export async function avisarChegadas(db: Db, config: Config, p: {
  tipo: TipoRastreio; saida: { id: string; passeioId: string }; passeio: string;
  visitadoAntes: number; visitadoAgora: number; posicao: { lat: number; lng: number; em: Date }; velocidadeKmh: number;
}) {
  if (Date.now() - p.posicao.em.getTime() > IDADE_MAXIMA_AVISO_MS) return { enfileiradas: 0 };
  // Cada parada → reservas a avisar e o nome do local.
  let paradas: Array<{ coord: { lat: number; lng: number } | null; local: string; reservas: string[] }>;
  if (p.tipo === "TRANSFER") {
    paradas = (await paradasDoTransfer(db, p.saida.id)).map((x) => ({
      coord: x.latitude !== null && x.longitude !== null ? { lat: x.latitude, lng: x.longitude } : null,
      local: x.local ?? "seu hotel", reservas: x.situacao === "BUSCADO" || x.situacao === "NAO_APARECEU" ? [] : [x.reservaId],
    }));
  } else {
    const rota = await pontosDaRota(db, p.saida.passeioId);
    const daSaida = await db.select({ id: reservas.id, ponto: reservas.pontoEmbarqueId }).from(reservas).where(and(eq(reservas.saidaId, p.saida.id), eq(reservas.status, "CONFIRMADA")));
    const naVan = new Set((await paradasDoTransfer(db, p.saida.id)).map((x) => x.reservaId));
    const ids = daSaida.map((r) => r.id);
    const embarcadas = new Set(ids.length ? (await db.selectDistinct({ id: passageiros.reservaId }).from(passageiros).where(and(inArray(passageiros.reservaId, ids), eq(passageiros.embarque, "EMBARCOU")))).map((x) => x.id) : []);
    paradas = rota.map((pt) => ({ coord: coordenadaDe(pt), local: pt.nome, reservas: daSaida.filter((r) => r.ponto === pt.id && !naVan.has(r.id) && !embarcadas.has(r.id)).map((r) => r.id) }));
  }
  const coords = paradas.map((x) => x.coord);
  const rota = p.tipo === "ONIBUS" ? await rotaDoPasseio(db, p.saida.passeioId, coords) : null;
  const a = avisosDeChegada({ paradas: coords, visitadoAntes: p.visitadoAntes, visitadoAgora: p.visitadoAgora, posicao: p.posicao, velocidadeKmh: p.velocidadeKmh, rota });
  const alvo = [...a.chegou.map((i) => ({ i, tipo: "CHEGOU" as const })), ...a.chegando.map((i) => ({ i, tipo: "CHEGANDO" as const }))];
  let enfileiradas = 0;
  for (const { i, tipo } of alvo) {
    const parada = paradas[i]!;
    if (!parada.reservas.length) continue;
    const lista = await db.select({ id: reservas.id, nome: reservas.contatoNome, telefone: reservas.contatoTelefone }).from(reservas).where(inArray(reservas.id, parada.reservas));
    for (const r of lista) {
      const modelo = modeloChegada(tipo, {
        rastreio: p.tipo, primeiroNome: r.nome.split(/[\s,]+/).filter(Boolean)[0] ?? "", passeio: p.passeio, local: parada.local,
        proximoPonto: p.tipo === "ONIBUS" ? (paradas[i + 1]?.local ?? null) : null,
      });
      const m = await enfileirarMensagem(db, config, { tipo: TIPO_MENSAGEM[p.tipo][tipo], reservaId: r.id, saidaId: p.saida.id, destino: r.telefone, texto: renderizarModeloMeta(modelo), modelo });
      if (m) enfileiradas++;
    }
  }
  return { enfileiradas };
}

/**
 * Cria (ou troca) o link de acompanhamento da reserva. O token vai só na mensagem; o banco guarda o hash.
 * Refazer o link invalida o anterior.
 */
export async function gerarLinkRastreio(db: Db, reservaId: string, data: string) {
  const token = randomBytes(24).toString("base64url");
  const expiraEm = fimDoDia(data);
  await db.insert(rastreioLinks).values({ reservaId, tokenHash: hashToken(token), expiraEm });
  return token;
}

/**
 * Ao iniciar o rastreio do ônibus (o motorista liga quando sai do 1º ponto): enfileira a mensagem RASTREIO ("o ônibus já saiu" +
 * link do mapa) só para quem AINDA NÃO EMBARCOU (dono, 11/11/2026): quem já embarcou no 1º ponto e quem veio na van do transfer
 * (buscado) não recebe. Uma por reserva (reiniciar no mesmo dia não reenvia). Sem URL pública não há link: nada é enfileirado.
 */
export async function enviarLinksRastreio(db: Db, config: Config, saida: { id: string; data: string }, passeioNome: string) {
  if (!config.URL_PUBLICA) return { enfileiradas: 0, semUrlPublica: true };
  const base = config.URL_PUBLICA.replace(/\/$/, "");
  const ativas = await db.select().from(reservas).where(and(eq(reservas.saidaId, saida.id), eq(reservas.status, "CONFIRMADA")));
  const jaTem = new Set((await db.select({ id: mensagens.reservaId }).from(mensagens).where(and(eq(mensagens.saidaId, saida.id), eq(mensagens.tipo, "RASTREIO")))).map((m) => m.id));
  const ids = ativas.map((r) => r.id);
  if (ids.length) {
    // Já embarcou (marcado pela guia) ou já está na van do transfer: não precisa do aviso.
    for (const x of await db.selectDistinct({ id: passageiros.reservaId }).from(passageiros).where(and(inArray(passageiros.reservaId, ids), eq(passageiros.embarque, "EMBARCOU")))) jaTem.add(x.id);
    for (const x of await paradasDoTransfer(db, saida.id)) if (x.situacao === "BUSCADO") jaTem.add(x.reservaId);
  }
  let enfileiradas = 0;
  for (const r of ativas) {
    if (jaTem.has(r.id)) continue;
    const token = await gerarLinkRastreio(db, r.id, saida.data);
    const m = await enfileirarMensagem(db, config, {
      tipo: "RASTREIO", reservaId: r.id, saidaId: saida.id, destino: r.contatoTelefone,
      texto: textoRastreio({ primeiroNome: r.contatoNome.split(/[\s,]+/).filter(Boolean)[0] ?? "", passeio: passeioNome, link: `${base}/rastreio/${token}` }),
      modelo: modeloRastreio({ primeiroNome: r.contatoNome.split(/[\s,]+/).filter(Boolean)[0] ?? "", passeio: passeioNome, link: `${base}/rastreio/${token}` }),
    });
    if (m) enfileiradas++;
  }
  return { enfileiradas, semUrlPublica: false };
}

/**
 * Limpeza: encerra sessões esquecidas abertas de dias anteriores e apaga posições com mais de 30 dias.
 * Roda de hora em hora (barata), então a retenção é aplicada todo dia.
 */
export async function limparRastreio(db: Db, agora = new Date()) {
  const { hoje } = agoraSp(agora);
  const abertas = await db.select({ id: rastreioSessoes.id, data: saidas.data }).from(rastreioSessoes)
    .innerJoin(saidas, eq(saidas.id, rastreioSessoes.saidaId)).where(isNull(rastreioSessoes.encerradaEm));
  let encerradas = 0;
  for (const s of abertas) {
    if (s.data < hoje) {
      await db.update(rastreioSessoes).set({ encerradaEm: agora }).where(eq(rastreioSessoes.id, s.id));
      encerradas++;
    }
  }
  const corte = new Date(agora.getTime() - RETENCAO_POSICOES_DIAS * 86_400_000);
  const apagadas = await db.delete(rastreioPosicoes).where(lt(rastreioPosicoes.registradaEm, corte)).returning({ id: rastreioPosicoes.id });
  await db.delete(rastreioLinks).where(lt(rastreioLinks.expiraEm, corte));
  return { encerradas, apagadas: apagadas.length };
}

export function agendarLimpezaRastreio(db: Db, config: Config, log: { error: (o: unknown, m: string) => void; info: (o: unknown, m: string) => void }): () => void {
  if (config.AMBIENTE === "testes") return () => {};
  const rodar = () => limparRastreio(db).then((r) => { if (r.encerradas || r.apagadas) log.info(r, "Limpeza do rastreio"); }).catch((e) => log.error({ erro: e instanceof Error ? e.message : e }, "Falha na limpeza do rastreio"));
  const inicio = setTimeout(rodar, 30_000);
  const intervalo = setInterval(rodar, 3_600_000);
  return () => { clearTimeout(inicio); clearInterval(intervalo); };
}
