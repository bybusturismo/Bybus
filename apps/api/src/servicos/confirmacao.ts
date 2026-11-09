import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  avaliarConfirmacao, HORAS_SEM_RESPOSTA_VIATOR, idiomaDoCliente, REGRAS_CONFIRMACAO_PADRAO, textoViatorSemResposta, regiaoComTransito, textoConfirmacao, textoPrevia,
  type ContarPor, type DecisaoConfirmacao, type RegrasConfirmacao,
} from "@bybus/core";
import { auditar } from "../auditoria.js";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { confirmacaoRegras, mensagens, passageiros, passeios, pontosEmbarque, reservas, saidas } from "../db/schema.js";
import { agoraSp, enfileirarMensagem } from "./fechamento.js";
import { gerarLinkEmbarque } from "./linkEmbarque.js";
import { sincronizarTransfer, transferNaLista } from "./transfer.js";

/**
 * Confirmação da véspera em duas etapas (gerente, 09/11/2026). Ver `packages/core/src/confirmacao.ts` e
 * `docs/produto/modulo-confirmacao.md`. Nada aqui cancela saída: abaixo do corte, na hora limite, a equipe decide.
 */

export async function lerRegrasConfirmacao(db: Db): Promise<RegrasConfirmacao> {
  const [r] = await db.select().from(confirmacaoRegras).where(eq(confirmacaoRegras.id, "padrao"));
  if (!r) return { ...REGRAS_CONFIRMACAO_PADRAO };
  return {
    ligado: r.ligado, contarPor: r.contarPor as ContarPor, pagasParaConfirmar: r.pagasParaConfirmar, totalParaConfirmar: r.totalParaConfirmar,
    pagasMinimasNoTotal: r.pagasMinimasNoTotal, horaPrevia: r.horaPrevia, horaLimite: r.horaLimite,
  };
}

export async function salvarRegrasConfirmacao(db: Db, r: RegrasConfirmacao, usuarioId: string) {
  const valores = { ...r, atualizadoPor: usuarioId, atualizadoEm: new Date() };
  await db.insert(confirmacaoRegras).values({ id: "padrao", ...valores }).onConflictDoUpdate({ target: confirmacaoRegras.id, set: valores });
}

/** Pagas × pendentes (A_PAGAR) das reservas confirmadas da saída, por reserva ou por passageiro (colo não conta). */
export async function contarPagamentos(db: Db, saidaIds: string[], contarPor: ContarPor): Promise<Map<string, { pagas: number; pendentes: number }>> {
  const mapa = new Map<string, { pagas: number; pendentes: number }>(saidaIds.map((id) => [id, { pagas: 0, pendentes: 0 }]));
  if (!saidaIds.length) return mapa;
  const rs = await db.select({ id: reservas.id, saidaId: reservas.saidaId, pagamento: reservas.pagamento }).from(reservas)
    .where(and(inArray(reservas.saidaId, saidaIds), eq(reservas.status, "CONFIRMADA")));
  const pax = new Map<string, number>();
  if (contarPor === "PASSAGEIROS" && rs.length) {
    const ps = await db.select({ reservaId: passageiros.reservaId }).from(passageiros)
      .where(and(inArray(passageiros.reservaId, rs.map((r) => r.id)), ne(passageiros.categoria, "COLO")));
    for (const p of ps) pax.set(p.reservaId, (pax.get(p.reservaId) ?? 0) + 1);
  }
  for (const r of rs) {
    const c = mapa.get(r.saidaId)!;
    const n = contarPor === "PASSAGEIROS" ? (pax.get(r.id) ?? 0) : 1;
    if (r.pagamento === "A_PAGAR") c.pendentes += n; else c.pagas += n;
  }
  return mapa;
}

const primeiroNome = (nome: string) => nome.split(/[\s,]+/).filter(Boolean)[0] ?? "";

/** Envia a confirmação completa a cada titular que ainda não recebeu (uma por reserva; vendas novas recebem depois). */
export async function enviarConfirmacoes(db: Db, config: Config, saidaId: string) {
  const [s] = await db.select({ saida: saidas, passeio: passeios.nome, passeioId: passeios.id }).from(saidas).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).where(eq(saidas.id, saidaId));
  if (!s) return 0;
  const ativas = await db.select().from(reservas).where(and(eq(reservas.saidaId, saidaId), eq(reservas.status, "CONFIRMADA")));
  const pontos = await db.select().from(pontosEmbarque).where(eq(pontosEmbarque.passeioId, s.passeioId));
  // Confirmação antes das 21h: o transfer do dia é montado já, para o cliente receber o horário padrão do bairro.
  await sincronizarTransfer(db, saidaId, "se_houver");
  const viaTransfer = await transferNaLista(db, saidaId);
  const enviadas = await db.select({ id: mensagens.reservaId, tipo: mensagens.tipo }).from(mensagens)
    .where(and(eq(mensagens.saidaId, saidaId), inArray(mensagens.tipo, ["CONFIRMACAO", "PREVIA"])));
  const jaConfirmadas = new Set(enviadas.filter((m) => m.tipo === "CONFIRMACAO").map((m) => m.id));
  const comPrevia = new Set(enviadas.filter((m) => m.tipo === "PREVIA").map((m) => m.id));
  let n = 0;
  for (const r of ativas) {
    if (jaConfirmadas.has(r.id)) continue;
    const p = pontos.find((x) => x.id === r.pontoEmbarqueId) ?? null;
    const transfer = viaTransfer?.porReserva[r.id] ?? null;
    // Sem ponto: um link novo invalidaria o da prévia; só gera se a prévia não levou link.
    const linkJaEnviado = !p && comPrevia.has(r.id) && !!config.URL_PUBLICA;
    const link = !p && !linkJaEnviado && config.URL_PUBLICA ? `${config.URL_PUBLICA.replace(/\/$/, "")}${(await gerarLinkEmbarque(db, r.id)).caminho}` : null;
    // Aviso de trânsito: hospedado no continente, norte ou Lagoa e embarcando fora da própria região.
    const regiaoHotel = regiaoComTransito(r.hospedagemInformada);
    const transitoIntenso = !!p && !p.ehTransfer && !!regiaoHotel && regiaoHotel !== regiaoComTransito(p.nome, p.endereco);
    const m = await enfileirarMensagem(db, config, {
      tipo: "CONFIRMACAO", reservaId: r.id, saidaId, destino: r.contatoTelefone,
      texto: textoConfirmacao({ primeiroNome: primeiroNome(r.contatoNome), passeio: s.passeio, data: s.saida.data, ponto: p, linkEmbarque: link, linkJaEnviado, transfer, transitoIntenso }),
    });
    if (m) n++;
  }
  return n;
}

/** Prévia ("estamos montando a lista") a quem ainda não recebeu prévia nem confirmação; já pede a hospedagem de quem não tem ponto. */
async function enviarPrevias(db: Db, config: Config, saidaId: string) {
  const [s] = await db.select({ data: saidas.data, passeio: passeios.nome }).from(saidas).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).where(eq(saidas.id, saidaId));
  if (!s) return 0;
  const ativas = await db.select().from(reservas).where(and(eq(reservas.saidaId, saidaId), eq(reservas.status, "CONFIRMADA")));
  const ja = new Set((await db.select({ id: mensagens.reservaId }).from(mensagens)
    .where(and(eq(mensagens.saidaId, saidaId), inArray(mensagens.tipo, ["CONFIRMACAO", "PREVIA"])))).map((m) => m.id));
  let n = 0;
  for (const r of ativas) {
    if (ja.has(r.id)) continue;
    const semPonto = !r.pontoEmbarqueId;
    const link = semPonto && config.URL_PUBLICA ? `${config.URL_PUBLICA.replace(/\/$/, "")}${(await gerarLinkEmbarque(db, r.id)).caminho}` : null;
    const m = await enfileirarMensagem(db, config, {
      tipo: "PREVIA", reservaId: r.id, saidaId, destino: r.contatoTelefone,
      texto: textoPrevia({ primeiroNome: primeiroNome(r.contatoNome), passeio: s.passeio, data: s.data, linkEmbarque: link, semPonto }),
    });
    if (m) n++;
  }
  return n;
}

/** Marca a saída como confirmada (se ainda não estava) e envia as confirmações pendentes. */
export async function confirmarSaida(db: Db, config: Config, saidaId: string, quem: { usuarioId: string | null; motivo?: string }) {
  const marcadas = await db.update(saidas).set({ confirmadaEm: new Date(), confirmadaPor: quem.usuarioId, confirmadaAutomatica: !quem.usuarioId })
    .where(and(eq(saidas.id, saidaId), isNull(saidas.confirmadaEm))).returning({ id: saidas.id });
  if (marcadas.length) {
    await auditar(db, null, quem.usuarioId ? "SAIDA_CONFIRMADA" : "SAIDA_CONFIRMADA_AUTOMATICA", { tipo: "saida", id: saidaId }, { motivo: quem.motivo ?? null }, quem.usuarioId);
  }
  const enviadas = await enviarConfirmacoes(db, config, saidaId);
  return { jaEstava: !marcadas.length, enviadas };
}

/**
 * Rotina da véspera (roda a cada minuto, entre a hora da prévia e o fechamento das 21h), para as saídas de amanhã:
 * confirmada → manda a confirmação a vendas novas; senão aplica os cortes (confirma) ou manda a prévia.
 */
export async function rodarConfirmacaoVespera(db: Db, config: Config, agora = new Date()) {
  const regras = await lerRegrasConfirmacao(db);
  const { amanha, hora } = agoraSp(agora);
  if (!regras.ligado || hora < regras.horaPrevia || hora >= config.FECHAMENTO_HORA) return { avaliadas: 0, confirmadas: 0 };
  const lista = await db.select({ id: saidas.id, confirmadaEm: saidas.confirmadaEm }).from(saidas).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .where(and(eq(saidas.data, amanha), isNull(saidas.listaFechadaEm), ne(saidas.status, "CANCELADA"), eq(passeios.ativo, true)));
  const contagens = await contarPagamentos(db, lista.map((s) => s.id), regras.contarPor);
  let confirmadas = 0;
  for (const s of lista) {
    if (s.confirmadaEm) { await enviarConfirmacoes(db, config, s.id); continue; }
    const c = contagens.get(s.id)!;
    if (c.pagas + c.pendentes === 0) continue;
    const a = avaliarConfirmacao(c, regras, hora);
    if (a.decisao === "CONFIRMAR") {
      await confirmarSaida(db, config, s.id, { usuarioId: null, motivo: a.motivo });
      confirmadas++;
    } else {
      await enviarPrevias(db, config, s.id);
    }
  }
  return { avaliadas: lista.length, confirmadas };
}

/** Situação da confirmação de cada saída, para a tela das listas. */
export async function situacaoConfirmacao(db: Db, ss: Array<{ id: string; confirmadaEm: Date | null; confirmadaAutomatica: boolean | null }>, agora = new Date()) {
  const regras = await lerRegrasConfirmacao(db);
  const contagens = await contarPagamentos(db, ss.map((s) => s.id), regras.contarPor);
  const { hora } = agoraSp(agora);
  return new Map(ss.map((s) => {
    const c = contagens.get(s.id)!;
    const a = avaliarConfirmacao(c, regras, hora);
    const decisao: DecisaoConfirmacao | "CONFIRMADA" = s.confirmadaEm ? "CONFIRMADA" : a.decisao;
    return [s.id, { ...c, decisao, motivo: s.confirmadaEm ? null : a.motivo, confirmadaEm: s.confirmadaEm, automatica: s.confirmadaAutomatica }];
  }));
}

/**
 * Clientes da Viator/Tripadvisor sem ponto de embarque X horas depois da prévia/confirmação (não responderam no WhatsApp):
 * a equipe manda pelo chat da Viator, com o texto pronto (gerente, 09/11/2026). Nada é enviado sozinho.
 */
export async function viatorSemResposta(db: Db, saidaIds: string[], agora = new Date()) {
  if (!saidaIds.length) return [];
  const corte = new Date(agora.getTime() - HORAS_SEM_RESPOSTA_VIATOR * 3_600_000);
  const rs = await db.select({ r: reservas, data: saidas.data, passeio: passeios.nome }).from(reservas)
    .innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .where(and(inArray(reservas.saidaId, saidaIds), eq(reservas.status, "CONFIRMADA"), isNull(reservas.pontoEmbarqueId)));
  const viator = rs.filter((x) => (x.r.canalOrigem ?? x.r.canal) === "VIATOR");
  if (!viator.length) return [];
  const msgs = await db.select({ reservaId: mensagens.reservaId, criadoEm: mensagens.criadoEm }).from(mensagens)
    .where(and(inArray(mensagens.reservaId, viator.map((x) => x.r.id)), inArray(mensagens.tipo, ["PREVIA", "CONFIRMACAO"])));
  return viator.flatMap(({ r, data, passeio }) => {
    const primeira = msgs.filter((m) => m.reservaId === r.id).map((m) => m.criadoEm).sort((a, b) => a.getTime() - b.getTime())[0];
    if (!primeira || primeira > corte) return [];
    const idioma = idiomaDoCliente({ telefone: r.contatoTelefone, origemCliente: r.origemCliente });
    return [{
      reservaId: r.id, saidaId: r.saidaId, titular: r.contatoNome, referencia: r.codigoExterno ?? r.referencias[0] ?? null, desde: primeira, idioma,
      texto: textoViatorSemResposta(idioma, { primeiroNome: primeiroNome(r.contatoNome), passeio, data }),
    }];
  });
}
