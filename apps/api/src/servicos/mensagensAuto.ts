import { randomBytes } from "node:crypto";
import { and, eq, gte, lte, notExists, sql } from "drizzle-orm";
import { CODIGOS_FLUXO, FLUXOS, idiomaDoCliente, nomeCurto, renderizarModelo, type CodigoFluxo, type Idioma, type ModelosPorIdioma } from "@bybus/core";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { fluxosMensagem, mensagens, npsRespostas, passageiros, passeios, reservas, saidas } from "../db/schema.js";
import { enfileirarMensagem } from "./fechamento.js";
import { gerarPedidosAvaliacao, pendentesSemNps, enviarPedidoAvaliacao } from "./avaliacoes.js";
import { dataBr, horaSp, hojeSp, somarDias } from "./marketingComum.js";
import { hashToken } from "./linkEmbarque.js";
import { normalizarDestino } from "./whatsapp.js";

export interface FluxoEfetivo {
  codigo: CodigoFluxo; ligado: boolean;
  /** Texto em uso por idioma (o personalizado, ou o padrão do sistema). */
  textos: ModelosPorIdioma;
  /** Quais idiomas têm texto personalizado. */
  personalizado: Record<Idioma, boolean>;
  extra: string | null;
}

/**
 * Fluxos de mensagem automática. Sem linha na tabela: o padrão do sistema, desligado — exceto a confirmação da compra, que segue a
 * variável MENSAGEM_VOUCHER_AUTOMATICA até alguém ligar ou desligar pela tela. A véspera é o fechamento da lista (já existente) e sempre roda.
 */
export async function lerFluxos(db: Db, config: Config): Promise<Record<CodigoFluxo, FluxoEfetivo>> {
  const linhas = await db.select().from(fluxosMensagem);
  const r = {} as Record<CodigoFluxo, FluxoEfetivo>;
  for (const codigo of CODIGOS_FLUXO) {
    const l = linhas.find((x) => x.codigo === codigo);
    const def = FLUXOS[codigo];
    r[codigo] = {
      codigo,
      ligado: codigo === "VESPERA" ? true : l ? l.ligado : codigo === "COMPRA" ? config.MENSAGEM_VOUCHER_AUTOMATICA : false,
      textos: { pt: l?.textoPt || def.modelos.pt, en: l?.textoEn || def.modelos.en, es: l?.textoEs || def.modelos.es },
      personalizado: { pt: !!l?.textoPt, en: !!l?.textoEn, es: !!l?.textoEs },
      extra: l?.extra ?? null,
    };
  }
  return r;
}

export const urlBase = (config: Config) => (config.URL_PUBLICA ?? config.ORIGEM_WEB).replace(/\/$/, "");

const dias = (n: number) => n * 86_400_000;

/** Confirmação da compra: reservas confirmadas nas últimas 48h, de passeios futuros cuja lista ainda não fechou (depois disso a véspera cobre). */
export async function enviarConfirmacoesDeCompra(db: Db, config: Config, fluxo: FluxoEfetivo, agora: Date): Promise<number> {
  if (!fluxo.ligado) return 0;
  const hoje = hojeSp(agora);
  const rs = await db.select({
    id: reservas.id, saidaId: saidas.id, nome: reservas.contatoNome, telefone: reservas.contatoTelefone, origemCliente: reservas.origemCliente, data: saidas.data, passeio: passeios.nome,
  }).from(reservas).innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .where(and(
      eq(reservas.status, "CONFIRMADA"), sql`${saidas.status} <> 'CANCELADA'`, sql`${saidas.data} > ${hoje}`, sql`${saidas.listaFechadaEm} is null`,
      gte(reservas.criadoEm, new Date(agora.getTime() - dias(2))), sql`length(trim(coalesce(${reservas.contatoTelefone}, ''))) > 0`,
      notExists(db.select({ x: sql`1` }).from(mensagens).where(and(eq(mensagens.reservaId, reservas.id), eq(mensagens.tipo, "COMPRA")))),
    )).limit(200);
  let n = 0;
  for (const r of rs) {
    if (!normalizarDestino(r.telefone)) continue;
    const idioma = idiomaDoCliente({ telefone: r.telefone, origemCliente: r.origemCliente });
    const texto = renderizarModelo(fluxo.textos[idioma], { nome: nomeCurto(r.nome) || "tudo bem", passeio: r.passeio, data: dataBr(r.data) });
    if (await enfileirarMensagem(db, config, { tipo: "COMPRA", reservaId: r.id, saidaId: r.saidaId, destino: r.telefone, texto })) n++;
  }
  return n;
}

/** Cria a pesquisa NPS da reserva (token só no link; o banco guarda o hash) e devolve o caminho do link. */
export async function criarNps(db: Db, reservaId: string, saidaId: string, idioma: Idioma, agora: Date): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db.insert(npsRespostas).values({ reservaId, saidaId, tokenHash: hashToken(token), tokenExpiraEm: new Date(agora.getTime() + dias(30)), idioma });
  return `/nps/${token}`;
}

/** Pós-passeio: no dia seguinte (recupera até 3 dias, se o servidor ficou fora) manda o NPS a quem foi ao passeio. */
export async function enviarPosPasseio(db: Db, config: Config, fluxo: FluxoEfetivo, agora: Date): Promise<number> {
  if (!fluxo.ligado) return 0;
  const hoje = hojeSp(agora);
  const rs = await db.select({
    id: reservas.id, saidaId: saidas.id, nome: reservas.contatoNome, telefone: reservas.contatoTelefone, origemCliente: reservas.origemCliente, data: saidas.data, passeio: passeios.nome,
  }).from(reservas).innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .where(and(
      eq(reservas.status, "CONFIRMADA"), sql`${saidas.status} <> 'CANCELADA'`, gte(saidas.data, somarDias(hoje, -3)), lte(saidas.data, somarDias(hoje, -1)),
      sql`length(trim(coalesce(${reservas.contatoTelefone}, ''))) > 0`,
      sql`exists (select 1 from ${passageiros} where ${passageiros.reservaId} = ${reservas.id} and ${passageiros.embarque} <> 'NO_SHOW')`,
      notExists(db.select({ x: sql`1` }).from(npsRespostas).where(eq(npsRespostas.reservaId, reservas.id))),
    )).limit(300);
  let n = 0;
  for (const r of rs) {
    if (!normalizarDestino(r.telefone)) continue;
    const idioma = idiomaDoCliente({ telefone: r.telefone, origemCliente: r.origemCliente });
    const caminho = await criarNps(db, r.id, r.saidaId, idioma, agora);
    const texto = renderizarModelo(fluxo.textos[idioma], { nome: nomeCurto(r.nome) || "tudo bem", passeio: r.passeio, data: dataBr(r.data), linkNps: `${urlBase(config)}${caminho}` });
    if (await enfileirarMensagem(db, config, { tipo: "POS_PASSEIO", reservaId: r.id, saidaId: r.saidaId, destino: r.telefone, texto })) n++;
  }
  return n;
}

/**
 * Rotina do marketing (a cada minuto pelo agendador; também chamada pela tela "Rodar agora").
 * - gera a fila de avaliações de quem passeou ontem (sempre; só cria os pedidos);
 * - a partir das 09h: confirmação da compra, NPS pós-passeio e, com o fluxo ligado, envio automático dos pedidos de avaliação.
 * Respeita o modo simulado do WhatsApp (nada sai de verdade sem provedor).
 */
export async function rodarMensagensAutomaticas(db: Db, config: Config, agora = new Date(), opcoes: { ignorarHorario?: boolean } = {}) {
  const resultado = { pedidosCriados: 0, compra: 0, posPasseio: 0, avaliacoesEnviadas: 0 };
  const hoje = hojeSp(agora);
  resultado.pedidosCriados = await gerarPedidosAvaliacao(db, { de: somarDias(hoje, -3), ate: somarDias(hoje, -1) });
  if (!opcoes.ignorarHorario && horaSp(agora) < "09:00") return resultado;
  const fluxos = await lerFluxos(db, config);
  resultado.compra = await enviarConfirmacoesDeCompra(db, config, fluxos.COMPRA, agora);
  resultado.posPasseio = await enviarPosPasseio(db, config, fluxos.POS_PASSEIO, agora);
  if (fluxos.AVALIACAO.ligado) {
    for (const id of await pendentesSemNps(db, somarDias(hoje, -3), somarDias(hoje, -1))) {
      try { await enviarPedidoAvaliacao(db, config, id, false); resultado.avaliacoesEnviadas++; } catch { /* sem telefone ou falha: segue para o próximo */ }
    }
  }
  return resultado;
}
