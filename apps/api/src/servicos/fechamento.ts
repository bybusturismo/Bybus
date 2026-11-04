import { and, eq, gte, inArray, isNull, ne, type SQL } from "drizzle-orm";
import type { Manifesto } from "@bybus/core";
import { auditar } from "../auditoria.js";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { fechamentos, mensagens, passeios, pontosEmbarque, reservas, saidas } from "../db/schema.js";
import type { Cofre } from "../seguranca/cripto.js";
import { carregarManifesto } from "./manifesto.js";
import { gerarLinkEmbarque } from "./linkEmbarque.js";
import { enviarWhatsapp, normalizarDestino } from "./whatsapp.js";

const FUSO = "America/Sao_Paulo";
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const semanaBr = (iso: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const SIGLA_CATEGORIA: Record<string, string> = { ADULTO: "A", SENIOR: "S", INFANTIL: "C", COLO: "Colo", CORTESIA: "Cort." };

/** Hoje e amanhã no fuso de Brasília ("AAAA-MM-DD"), e a hora "HH:MM". */
export function agoraSp(agora = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(agora);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const hoje = `${v("year")}-${v("month")}-${v("day")}`;
  const amanha = new Date(new Date(`${hoje}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  return { hoje, amanha, hora: `${v("hour")}:${v("minute")}` };
}

/**
 * Texto da lista para o grupo do WhatsApp, em ordem de embarque (modelo da "Relação de passageiros" em uso).
 * LGPD: sem documento nem telefone no grupo — só nome, tipo (A/C/S), pagamento no embarque e origem.
 */
export function textoListaGrupo(
  m: Manifesto,
  cab: { passeio: string; data: string; guia: string | null; motorista: string | null; veiculo: string | null; versao: number },
  extras: Map<string, { pagamento: string | null; origemCliente: string | null }>,
): string {
  const l: string[] = [];
  l.push(`*RELAÇÃO DE PASSAGEIROS${cab.versao > 1 ? ` — ADENDO ${cab.versao - 1}` : ""}*`);
  l.push(`${cab.passeio} — ${semanaBr(cab.data)}, ${dataBr(cab.data)}`);
  l.push(`Guia: ${cab.guia ?? "a definir"} · Motorista: ${cab.motorista ?? "a definir"}${cab.veiculo ? ` · Veículo: ${cab.veiculo}` : ""}`);
  let aPagar = 0;
  for (const b of m.blocos) {
    if (!b.linhas.length) continue;
    l.push("");
    l.push(b.ponto ? `*${b.ponto.horario} — ${b.ponto.nome}* (${b.linhas.length})` : `*A DEFINIR* (${b.linhas.length})`);
    for (const x of b.linhas) {
      const e = extras.get(x.reservaId);
      const pagar = e?.pagamento === "A_PAGAR";
      if (pagar) aPagar++;
      const nome = x.passageiro.nome || `(sem nome — reserva de ${x.contatoNome})`;
      l.push(`${String(x.numero).padStart(2, "0")}. ${nome} · ${SIGLA_CATEGORIA[x.passageiro.categoria] ?? x.passageiro.categoria}${e?.origemCliente ? ` · ${e.origemCliente}` : ""}${pagar ? " · *PAGAR NO EMBARQUE*" : ""}`);
    }
  }
  const t = m.totais;
  l.push("");
  l.push(`Total: ${t.passageiros} passageiro(s) · ${t.assentos} assento(s) · A: ${t.porCategoria.ADULTO} · S: ${t.porCategoria.SENIOR} · C: ${t.porCategoria.INFANTIL} · Colo: ${t.porCategoria.COLO}`);
  if (aPagar) l.push(`Pagar no embarque: ${aPagar}`);
  const semPonto = m.blocos.find((b) => !b.ponto)?.linhas.length ?? 0;
  if (semPonto) l.push(`⚠️ ${semPonto} sem ponto de embarque — confirmar antes da saída.`);
  return l.join("\n");
}

/** Mensagem de confirmação ao titular (véspera, após o fechamento). [A CONFIRMAR] texto oficial com o dono. */
export function textoConfirmacao(d: { primeiroNome: string; passeio: string; data: string; ponto: { horario: string; nome: string; endereco: string | null } | null; linkEmbarque: string | null }): string {
  const ola = d.primeiroNome ? `Olá, ${d.primeiroNome}!` : "Olá!";
  const linhas = [`${ola} Seu passeio *${d.passeio}* é amanhã, ${semanaBr(d.data)} (${dataBr(d.data)}).`];
  if (d.ponto) {
    linhas.push(`Embarque: *${d.ponto.horario}* — ${d.ponto.nome}${d.ponto.endereco ? ` (${d.ponto.endereco})` : ""}.`);
    linhas.push("Chegue alguns minutos antes: não há tolerância para atrasos.");
  } else {
    linhas.push(d.linkEmbarque ? `Ainda não temos o seu ponto de embarque. Informe aqui: ${d.linkEmbarque}` : "Ainda não temos o seu ponto de embarque: responda esta mensagem com o hotel ou endereço onde está hospedado(a).");
  }
  linhas.push("Pela manhã enviaremos o link para acompanhar o ônibus. Bom passeio! — By Bus Turismo");
  return linhas.join("\n");
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
}

/**
 * Fecha a lista da saída: nova versão (a das 21h ou um adendo), texto para o grupo e confirmação a cada titular
 * que ainda não recebeu. Retorna o texto (a supervisão pode copiar se o grupo não estiver configurado).
 */
export async function fecharLista(db: Db, cofre: Cofre, config: Config, saidaId: string, quem: { usuarioId: string | null; automatico: boolean }) {
  const { saida, passeio, manifesto } = await carregarManifesto(db, cofre, saidaId, { documentosCompletos: false, mostrarContatos: true });
  const versao = saida.listaVersao + 1;
  const ativas = await db.select().from(reservas).where(and(eq(reservas.saidaId, saidaId), eq(reservas.status, "CONFIRMADA")));
  const extras = new Map(ativas.map((r) => [r.id, { pagamento: r.pagamento, origemCliente: r.origemCliente }]));
  const texto = textoListaGrupo(manifesto, { passeio: passeio.nome, data: saida.data, guia: saida.guia, motorista: saida.motorista, veiculo: saida.veiculo, versao }, extras);
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

  const pontos = await db.select().from(pontosEmbarque).where(eq(pontosEmbarque.passeioId, passeio.id));
  for (const r of ativas) {
    const p = pontos.find((x) => x.id === r.pontoEmbarqueId) ?? null;
    // Sem ponto: a confirmação já leva o link para o cliente informar (só com o endereço público configurado).
    const link = !p && config.URL_PUBLICA ? `${config.URL_PUBLICA.replace(/\/$/, "")}${(await gerarLinkEmbarque(db, r.id)).caminho}` : null;
    await enfileirarMensagem(db, config, {
      tipo: "CONFIRMACAO", reservaId: r.id, saidaId, destino: r.contatoTelefone,
      texto: textoConfirmacao({ primeiroNome: r.contatoNome.split(/[\s,]+/).filter(Boolean)[0] ?? "", passeio: passeio.nome, data: saida.data, ponto: p, linkEmbarque: link }),
    });
  }
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
      const { amanha, hora } = agoraSp();
      if (hora >= config.FECHAMENTO_HORA) {
        const abertas = await db.select({ id: saidas.id }).from(saidas).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
          .where(and(eq(saidas.data, amanha), isNull(saidas.listaFechadaEm), ne(saidas.status, "CANCELADA"), eq(passeios.ativo, true)));
        for (const s of abertas) {
          const r = await fecharLista(db, cofre, config, s.id, { usuarioId: null, automatico: true });
          log.info({ saida: s.id, passageiros: r.resumo.passageiros }, "Lista fechada automaticamente");
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
  return lista.map(({ saida: s, passeio }) => {
    const minhas = rs.filter((r) => r.saidaId === s.id);
    return {
      saidaId: s.id, passeio: passeio.nome, data: s.data, guia: s.guia, motorista: s.motorista, veiculo: s.veiculo,
      listaFechadaEm: s.listaFechadaEm, versao: s.listaVersao,
      reservas: minhas.length,
      naoConferidas: minhas.filter((r) => r.conferencia !== "CONFERIDA").length,
      semPonto: minhas.filter((r) => !r.pontoEmbarqueId).length,
      depoisDoFechamento: s.listaFechadaEm ? minhas.filter((r) => r.criadoEm > s.listaFechadaEm!).length : 0,
      mensagens: ms.filter((m) => m.saidaId === s.id).reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.status]: (acc[m.status] ?? 0) + 1 }), {}),
    };
  });
}

