import { and, eq, gte, lte, notExists, sql, type SQL } from "drizzle-orm";
import {
  MODELOS_LEMBRETE_AVALIACAO, MODELOS_AVALIACAO_VIATOR, MODELO_AVALIACAO_PADRAO, idiomaDoCliente, montarPedidoAvaliacao, nomeCurto, renderizarModelo,
  type CanalAvaliacao, type Idioma, type LinksAvaliacao, type ModelosPorIdioma,
} from "@bybus/core";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { avaliacaoPedidos, mensagens, npsRespostas, passageiros, passeios, reservas, saidas } from "../db/schema.js";
import { ErroHttp } from "../seguranca/sessao.js";
import { chaveLinkGoogle, dataBr, lerChaves } from "./marketingComum.js";
import { enfileirarMensagem } from "./fechamento.js";

export interface ConfigAvaliacao { modelos: Partial<ModelosPorIdioma>; linkTripadvisor: string | null; googlePorUnidade: Map<string, string> }

/** Modelos por idioma (o português continua na chave antiga `modelo_avaliacao`), link do Tripadvisor e o Google de cada praça. */
export async function lerConfigAvaliacao(db: Db): Promise<ConfigAvaliacao> {
  const c = await lerChaves(db);
  const google = new Map<string, string>();
  for (const [k, v] of c) if (k.startsWith("link_google_")) google.set(k.slice("link_google_".length), v);
  const pt = c.get("modelo_avaliacao");
  return {
    modelos: { ...(pt && pt !== MODELO_AVALIACAO_PADRAO ? { pt } : {}), ...(c.get("modelo_avaliacao_en") ? { en: c.get("modelo_avaliacao_en")! } : {}), ...(c.get("modelo_avaliacao_es") ? { es: c.get("modelo_avaliacao_es")! } : {}) },
    linkTripadvisor: c.get("link_tripadvisor") ?? null,
    googlePorUnidade: google,
  };
}
export const linksDaPraca = (cfg: ConfigAvaliacao, unidadeId: string | null): LinksAvaliacao => ({ google: (unidadeId && cfg.googlePorUnidade.get(unidadeId)) || null, tripadvisor: cfg.linkTripadvisor });

export { chaveLinkGoogle };

/**
 * Cria os pedidos de avaliação das reservas confirmadas de saídas realizadas no período (uma por reserva; repetir não duplica).
 * O texto sai no idioma do cliente (país/DDI), com o link do canal certo. Não envia nada.
 */
export async function gerarPedidosAvaliacao(db: Db, p: { de: string; ate: string; filtro?: SQL; unidadeId?: string }): Promise<number> {
  const cfg = await lerConfigAvaliacao(db);
  const canalExpr = sql<string>`coalesce(${reservas.canalOrigem}, ${reservas.canal})::text`;
  const candidatas = await db.select({
    reservaId: reservas.id, saidaId: saidas.id, nome: reservas.contatoNome, telefone: reservas.contatoTelefone, origemCliente: reservas.origemCliente,
    data: saidas.data, passeio: passeios.nome, unidadeId: passeios.unidadeId, canal: canalExpr,
  }).from(reservas).innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .where(and(
      eq(reservas.status, "CONFIRMADA"), sql`${saidas.status} <> 'CANCELADA'`, gte(saidas.data, p.de), lte(saidas.data, p.ate), p.filtro,
      p.unidadeId ? eq(passeios.unidadeId, p.unidadeId) : undefined,
      sql`exists (select 1 from ${passageiros} where ${passageiros.reservaId} = ${reservas.id} and ${passageiros.embarque} <> 'NO_SHOW')`,
      notExists(db.select({ x: sql`1` }).from(avaliacaoPedidos).where(eq(avaliacaoPedidos.reservaId, reservas.id))),
    )).limit(2000);
  let criados = 0;
  for (const c of candidatas) {
    const idioma = idiomaDoCliente({ telefone: c.telefone, origemCliente: c.origemCliente });
    const m = montarPedidoAvaliacao({ nome: c.nome, passeio: c.passeio, data: dataBr(c.data), idioma, canalReal: c.canal, links: linksDaPraca(cfg, c.unidadeId), modelos: cfg.modelos });
    const r = await db.insert(avaliacaoPedidos).values({
      reservaId: c.reservaId, saidaId: c.saidaId, texto: m.texto, idioma, canalAvaliacao: m.canal, link: m.link, status: c.telefone?.trim() ? "PENDENTE" : "SEM_TELEFONE",
    }).onConflictDoNothing().returning({ id: avaliacaoPedidos.id });
    criados += r.length;
  }
  return criados;
}

/** Recria o texto de um pedido (depois de trocar idioma ou canal). */
export async function textoDoPedido(db: Db, pedidoId: string, trocar: { idioma?: Idioma; canal?: CanalAvaliacao }): Promise<{ texto: string; canal: CanalAvaliacao; link: string | null; idioma: Idioma }> {
  const [p] = await db.select({ pedido: avaliacaoPedidos, nome: reservas.contatoNome, data: saidas.data, passeio: passeios.nome, unidadeId: passeios.unidadeId, canal: sql<string>`coalesce(${reservas.canalOrigem}, ${reservas.canal})::text` })
    .from(avaliacaoPedidos).innerJoin(reservas, eq(reservas.id, avaliacaoPedidos.reservaId)).innerJoin(saidas, eq(saidas.id, avaliacaoPedidos.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .where(eq(avaliacaoPedidos.id, pedidoId));
  if (!p) throw new ErroHttp(404, "NAO_ENCONTRADO", "Pedido de avaliação não encontrado(a).");
  const cfg = await lerConfigAvaliacao(db);
  const idioma = trocar.idioma ?? (p.pedido.idioma as Idioma);
  const escolhido = trocar.canal ?? (p.pedido.canalAvaliacao as CanalAvaliacao);
  const m = montarPedidoAvaliacao({ nome: p.nome, passeio: p.passeio, data: dataBr(p.data), idioma, canalReal: p.canal, links: linksDaPraca(cfg, p.unidadeId), escolhido, modelos: cfg.modelos });
  return { ...m, idioma };
}

const FEITOS = ["ENVIADA_MANUAL", "SIMULADA", "ENVIADA"];

/**
 * Envia (ou simula, pela fila de mensagens e o provedor configurado) o pedido ou o lembrete. Nunca repete: a fila tem uma mensagem por reserva e tipo.
 * No modo simulado nada sai: o pedido fica "Simulada".
 */
export async function enviarPedidoAvaliacao(db: Db, config: Config, pedidoId: string, lembrete: boolean): Promise<{ status: string }> {
  const [p] = await db.select({ pedido: avaliacaoPedidos, telefone: reservas.contatoTelefone, data: saidas.data, passeio: passeios.nome, nome: reservas.contatoNome })
    .from(avaliacaoPedidos).innerJoin(reservas, eq(reservas.id, avaliacaoPedidos.reservaId)).innerJoin(saidas, eq(saidas.id, avaliacaoPedidos.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .where(eq(avaliacaoPedidos.id, pedidoId));
  if (!p) throw new ErroHttp(404, "NAO_ENCONTRADO", "Pedido de avaliação não encontrado(a).");
  const ped = p.pedido;
  if (!p.telefone?.trim() || ped.status === "SEM_TELEFONE") throw new ErroHttp(400, "SEM_TELEFONE", "A reserva não tem telefone: copie o texto e envie por outro meio.");
  if (lembrete ? !FEITOS.includes(ped.status) : ped.status !== "PENDENTE") throw new ErroHttp(409, "SITUACAO_INVALIDA", lembrete ? "O lembrete só vale para pedido já enviado." : "Este pedido já foi enviado ou foi encerrado.");
  const idioma = ped.idioma as Idioma;
  const textoLembrete = ped.canalAvaliacao === "VIATOR"
    ? renderizarModelo(MODELOS_AVALIACAO_VIATOR[idioma], { nome: nomeCurto(p.nome), passeio: p.passeio, data: dataBr(p.data) })
    : renderizarModelo(MODELOS_LEMBRETE_AVALIACAO[idioma], { nome: nomeCurto(p.nome), passeio: p.passeio, link: ped.link });
  const m = await enfileirarMensagem(db, config, { tipo: lembrete ? "AVALIACAO_LEMBRETE" : "AVALIACAO", reservaId: ped.reservaId, saidaId: ped.saidaId, destino: p.telefone, texto: lembrete ? textoLembrete : ped.texto });
  if (!m) throw new ErroHttp(409, "JA_ENVIADA", lembrete ? "O lembrete deste pedido já foi enviado." : "Este pedido já foi enviado.");
  const [atual] = await db.select({ status: mensagens.status }).from(mensagens).where(eq(mensagens.id, m.id));
  const s = atual?.status ?? "PENDENTE";
  if (s === "SEM_TELEFONE") throw new ErroHttp(400, "SEM_TELEFONE", "Telefone inválido: copie o texto e envie por outro meio.");
  if (s === "FALHA") throw new ErroHttp(502, "ENVIO_FALHOU", "O envio falhou. Tente de novo em instantes.");
  const novo = s === "ENVIADA" ? "ENVIADA" : "SIMULADA";
  const agora = new Date();
  await db.update(avaliacaoPedidos).set(lembrete ? { status: "LEMBRADA", lembreteEm: agora, atualizadoEm: agora } : { status: novo, pedidoEm: agora, atualizadoEm: agora }).where(eq(avaliacaoPedidos.id, pedidoId));
  return { status: lembrete ? "LEMBRADA" : novo };
}

/** Pedidos a enviar de reservas que não têm NPS (quem tem NPS recebe o convite pela página do NPS). */
export async function pendentesSemNps(db: Db, de: string, ate: string, filtro?: SQL): Promise<string[]> {
  const r = await db.select({ id: avaliacaoPedidos.id }).from(avaliacaoPedidos).innerJoin(saidas, eq(saidas.id, avaliacaoPedidos.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .where(and(eq(avaliacaoPedidos.status, "PENDENTE"), gte(saidas.data, de), lte(saidas.data, ate), filtro,
      notExists(db.select({ x: sql`1` }).from(npsRespostas).where(eq(npsRespostas.reservaId, avaliacaoPedidos.reservaId))))).limit(200);
  return r.map((x) => x.id);
}
