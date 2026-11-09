import { and, eq, gte, inArray, isNull, ne, type SQL } from "drizzle-orm";
import { textoListaGrupo } from "@bybus/core";
import { auditar } from "../auditoria.js";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { fechamentos, mensagens, passeios, reservas, saidas } from "../db/schema.js";
import type { Cofre } from "../seguranca/cripto.js";
import { carregarManifesto } from "./manifesto.js";
import { confirmarSaida, rodarConfirmacaoVespera, situacaoConfirmacao, viatorSemResposta } from "./confirmacao.js";
import { enviarWhatsapp, normalizarDestino } from "./whatsapp.js";
import { registrarSaidaFila } from "./whatsappConversas.js";
import { mensagemDoMotoristaTransfer, sincronizarTransfer, transferNaLista } from "./transfer.js";

const FUSO = "America/Sao_Paulo";
/** Hoje e amanhã no fuso de Brasília ("AAAA-MM-DD"), e a hora "HH:MM". */
export function agoraSp(agora = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(agora);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const hoje = `${v("year")}-${v("month")}-${v("day")}`;
  const amanha = new Date(new Date(`${hoje}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  return { hoje, amanha, hora: `${v("hour")}:${v("minute")}` };
}

/** Coloca a mensagem na fila (uma por reserva e tipo) e tenta enviar já. */
export async function enfileirarMensagem(db: Db, config: Config, m: { tipo: string; reservaId: string | null; saidaId: string | null; destino: string | null; texto: string }) {
  const destino = normalizarDestino(m.destino);
  const [nova] = await db.insert(mensagens).values({ ...m, destino, status: destino ? "PENDENTE" : "SEM_TELEFONE" }).onConflictDoNothing().returning();
  if (nova && destino) await enviarMensagem(db, config, nova.id);
  return nova ?? null;
}

export async function enviarMensagem(db: Db, config: Config, id: string) {
  const [m] = await db.select().from(mensagens).where(eq(mensagens.id, id));
  if (!m || !m.destino || m.status === "ENVIADA") return;
  const r = await enviarWhatsapp(config, m.destino, m.texto);
  await db.update(mensagens).set({ status: r.status, provedor: r.provedor, erro: r.erro ?? null, enviadaEm: r.status === "ENVIADA" ? new Date() : null }).where(eq(mensagens.id, id));
  await registrarSaidaFila(db, m, r); // também aparece na conversa do destinatário (grupo fica de fora)
}

/**
 * Fecha a lista da saída: nova versão (a das 21h ou um adendo), texto para o grupo e confirmação a cada titular
 * que ainda não recebeu. Retorna o texto (a supervisão pode copiar se o grupo não estiver configurado).
 */
export async function fecharLista(db: Db, cofre: Cofre, config: Config, saidaId: string, quem: { usuarioId: string | null; automatico: boolean }) {
  // O transfer do dia é montado (ou atualizado) junto do fechamento, para a lista já sair com "via transfer".
  const transferResumo = await sincronizarTransfer(db, saidaId, "se_houver");
  const { saida, passeio, manifesto } = await carregarManifesto(db, cofre, saidaId, { documentosCompletos: false, mostrarContatos: true });
  const versao = saida.listaVersao + 1;
  const ativas = await db.select().from(reservas).where(and(eq(reservas.saidaId, saidaId), eq(reservas.status, "CONFIRMADA")));
  const extras = new Map(ativas.map((r) => [r.id, { pagamento: r.pagamento, origemCliente: r.origemCliente }]));
  const viaTransfer = await transferNaLista(db, saidaId);
  const texto = textoListaGrupo(manifesto, { passeio: passeio.nome, data: saida.data, guia: saida.guia, motorista: saida.motorista, veiculo: saida.veiculo, versao }, extras, viaTransfer?.lista);
  const resumo = {
    passageiros: manifesto.totais.passageiros, reservas: ativas.length,
    semPonto: manifesto.blocos.find((b) => !b.ponto)?.linhas.length ?? 0,
    naoConferidas: ativas.filter((r) => r.conferencia !== "CONFERIDA").length,
    aPagar: ativas.filter((r) => r.pagamento === "A_PAGAR").length,
  };
  await db.transaction(async (tx) => {
    await tx.insert(fechamentos).values({ saidaId, versao, automatico: quem.automatico, fechadoPor: quem.usuarioId, resumo });
    await tx.update(saidas).set({ listaFechadaEm: new Date(), listaVersao: versao }).where(eq(saidas.id, saidaId));
  });
  await auditar(db, null, quem.automatico ? "LISTA_FECHADA_AUTOMATICA" : "LISTA_FECHADA", { tipo: "saida", id: saidaId }, { versao, ...resumo }, quem.usuarioId);

  if (config.WHATSAPP_GRUPO_LISTA) await enfileirarMensagem(db, config, { tipo: `LISTA_GRUPO_V${versao}`, reservaId: null, saidaId, destino: config.WHATSAPP_GRUPO_LISTA, texto });

  // Lista do transfer para o motorista da van (sem telefones de passageiros; respeita o modo simulado do WhatsApp).
  const msgTransfer = transferResumo ? await mensagemDoMotoristaTransfer(db, saidaId) : null;
  if (msgTransfer) await enfileirarMensagem(db, config, { tipo: `TRANSFER_V${versao}`, reservaId: null, saidaId, destino: msgTransfer.destino, texto: msgTransfer.texto });

  // Fechar a lista confirma a saída (se a véspera ainda não tinha confirmado) e manda a confirmação a quem ainda não recebeu.
  await confirmarSaida(db, config, saidaId, { usuarioId: quem.usuarioId, motivo: "Fechamento da lista" });
  return { versao, texto, resumo };
}

/** Saídas do dia seguinte ainda abertas: fecha no horário configurado (21h). Reenvia a fila pendente. */
export function agendarFechamento(db: Db, cofre: Cofre, config: Config, log: { error: (o: unknown, m: string) => void; info: (o: unknown, m: string) => void }): () => void {
  if (!config.FECHAMENTO_AUTOMATICO || config.AMBIENTE === "testes") return () => {};
  let rodando = false;
  const rodar = async () => {
    if (rodando) return;
    rodando = true;
    try {
      // Véspera: prévia, pedido do ponto e confirmação pelos pontos de corte (da manhã até o fechamento).
      try {
        const c = await rodarConfirmacaoVespera(db, config);
        if (c.confirmadas) log.info({ confirmadas: c.confirmadas }, "Saídas confirmadas pelos pontos de corte");
      } catch (e) {
        log.error({ erro: e instanceof Error ? e.message : e }, "Falha na confirmação da véspera");
      }
      const { hoje, amanha, hora } = agoraSp();
      // Depois das 21h fecha a de amanhã; se o servidor ficou fora nessa hora, ainda fecha a de hoje até as 05h.
      const data = hora >= config.FECHAMENTO_HORA ? amanha : hora < "05:00" ? hoje : null;
      if (data) {
        const abertas = await db.select({ id: saidas.id }).from(saidas).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
          .where(and(eq(saidas.data, data), isNull(saidas.listaFechadaEm), ne(saidas.status, "CANCELADA"), eq(passeios.ativo, true)));
        for (const s of abertas) {
          try {
            const r = await fecharLista(db, cofre, config, s.id, { usuarioId: null, automatico: true });
            log.info({ saida: s.id, passageiros: r.resumo.passageiros }, "Lista fechada automaticamente");
          } catch (e) {
            log.error({ saida: s.id, erro: e instanceof Error ? e.message : e }, "Falha ao fechar lista");
          }
        }
      }
      const pendentes = await db.select({ id: mensagens.id }).from(mensagens).where(and(eq(mensagens.status, "PENDENTE"), gte(mensagens.criadoEm, new Date(Date.now() - 86_400_000)))).limit(50);
      for (const m of pendentes) await enviarMensagem(db, config, m.id);
    } catch (e) {
      log.error({ erro: e instanceof Error ? e.message : e }, "Falha no fechamento automático");
    } finally {
      rodando = false;
    }
  };
  const intervalo = setInterval(rodar, 60_000);
  return () => clearInterval(intervalo);
}

/** Situação do fechamento para a tela (por data). */
export async function situacaoFechamento(db: Db, data: string, filtro: SQL | undefined) {
  const lista = await db.select({ saida: saidas, passeio: { nome: passeios.nome, unidadeId: passeios.unidadeId } }).from(saidas)
    .innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .where(and(eq(saidas.data, data), ne(saidas.status, "CANCELADA"), filtro));
  const ids = lista.map((l) => l.saida.id);
  const rs = ids.length ? await db.select().from(reservas).where(and(inArray(reservas.saidaId, ids), eq(reservas.status, "CONFIRMADA"))) : [];
  const ms = ids.length ? await db.select({ saidaId: mensagens.saidaId, status: mensagens.status, tipo: mensagens.tipo }).from(mensagens).where(inArray(mensagens.saidaId, ids)) : [];
  const conf = await situacaoConfirmacao(db, lista.map(({ saida: s }) => s));
  const semResposta = await viatorSemResposta(db, ids);
  return lista.map(({ saida: s, passeio }) => {
    const minhas = rs.filter((r) => r.saidaId === s.id);
    return {
      saidaId: s.id, passeio: passeio.nome, data: s.data, guia: s.guia, motorista: s.motorista, veiculo: s.veiculo,
      listaFechadaEm: s.listaFechadaEm, versao: s.listaVersao,
      reservas: minhas.length,
      naoConferidas: minhas.filter((r) => r.conferencia !== "CONFERIDA").length,
      semPonto: minhas.filter((r) => !r.pontoEmbarqueId).length,
      // Vendas novas ou embarque informado pelo cliente depois da lista: entram no próximo adendo.
      depoisDoFechamento: s.listaFechadaEm ? minhas.filter((r) => r.criadoEm > s.listaFechadaEm! || (r.informadoPeloClienteEm && r.informadoPeloClienteEm > s.listaFechadaEm!)).length : 0,
      confirmacao: conf.get(s.id)!,
      viatorSemResposta: semResposta.filter((x) => x.saidaId === s.id).length,
      previasEnviadas: ms.filter((m) => m.saidaId === s.id && m.tipo === "PREVIA").length,
      mensagens: ms.filter((m) => m.saidaId === s.id).reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.status]: (acc[m.status] ?? 0) + 1 }), {}),
    };
  });
}

