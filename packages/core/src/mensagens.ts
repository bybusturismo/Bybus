import type { Manifesto } from "./manifesto.js";

/** Textos das mensagens de WhatsApp (mesmos no servidor e na demonstração). */
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const semanaBr = (iso: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const SIGLA_CATEGORIA: Record<string, string> = { ADULTO: "A", SENIOR: "S", INFANTIL: "C", COLO: "Colo", CORTESIA: "Cort." };

/** Quem vem de transfer (van que busca no hotel) e onde todos se encontram com o ônibus. */
export interface TransferNaLista {
  encontro: { nome: string | null; horario: string | null } | null;
  porReserva: Map<string, { bairro: string | null }>;
}

/**
 * Texto da lista para o grupo do WhatsApp, em ordem de embarque (modelo da "Relação de passageiros" em uso).
 * LGPD: sem documento nem telefone no grupo — só nome, tipo (A/C/S), pagamento no embarque e origem.
 */
export function textoListaGrupo(
  m: Manifesto,
  cab: { passeio: string; data: string; guia: string | null; motorista: string | null; veiculo: string | null; versao: number },
  extras: Map<string, { pagamento: string | null; origemCliente: string | null }>,
  transfer?: TransferNaLista,
): string {
  const encontro = transfer?.encontro?.nome ? `${transfer.encontro.nome}${transfer.encontro.horario ? ` às ${transfer.encontro.horario}` : ""}` : "ponto de encontro a confirmar";
  const l: string[] = [];
  l.push(`*RELAÇÃO DE PASSAGEIROS${cab.versao > 1 ? ` — ADENDO ${cab.versao - 1}` : ""}*`);
  l.push(`${cab.passeio} — ${semanaBr(cab.data)}, ${dataBr(cab.data)}`);
  l.push(`Guia: ${cab.guia ?? "a definir"} · Motorista: ${cab.motorista ?? "a definir"}${cab.veiculo ? ` · Veículo: ${cab.veiculo}` : ""}`);
  let aPagar = 0;
  let transferPax = 0;
  for (const b of m.blocos) {
    if (!b.linhas.length) continue;
    l.push("");
    l.push(b.ponto ? `*${b.ponto.horario} — ${b.ponto.nome}* (${b.linhas.length})` : `*A DEFINIR* (${b.linhas.length})`);
    if (transfer && b.ponto?.ehTransfer) l.push(`↳ via transfer: embarcam todos em ${encontro}`);
    for (const x of b.linhas) {
      const e = extras.get(x.reservaId);
      const pagar = e?.pagamento === "A_PAGAR";
      if (pagar) aPagar++;
      const nome = x.passageiro.nome || `(sem nome — reserva de ${x.contatoNome})`;
      const viaTransfer = transfer?.porReserva.get(x.reservaId);
      if (viaTransfer) transferPax++;
      l.push(`${String(x.numero).padStart(2, "0")}. ${nome} · ${SIGLA_CATEGORIA[x.passageiro.categoria] ?? x.passageiro.categoria}${e?.origemCliente ? ` · ${e.origemCliente}` : ""}${viaTransfer ? ` · via transfer${viaTransfer.bairro ? ` (${viaTransfer.bairro})` : ""}` : ""}${pagar ? " · *PAGAR NO EMBARQUE*" : ""}`);
    }
  }
  const t = m.totais;
  l.push("");
  l.push(`Total: ${t.passageiros} passageiro(s) · ${t.assentos} assento(s) · A: ${t.porCategoria.ADULTO} · S: ${t.porCategoria.SENIOR} · C: ${t.porCategoria.INFANTIL} · Colo: ${t.porCategoria.COLO}`);
  if (aPagar) l.push(`Pagar no embarque: ${aPagar}`);
  if (transferPax) l.push(`Via transfer: ${transferPax} passageiro(s) — já incluídos acima; chegam juntos em ${encontro}.`);
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


/** Mensagem enviada quando o motorista inicia o rastreio: o link para acompanhar o ônibus. [A CONFIRMAR] texto oficial com o dono. */
export function textoRastreio(d: { primeiroNome: string; passeio: string; link: string }): string {
  const ola = d.primeiroNome ? `Olá, ${d.primeiroNome}!` : "Olá!";
  return [
    `${ola} O ônibus do passeio *${d.passeio}* já saiu.`,
    `Acompanhe no mapa e veja quanto falta para ele chegar ao seu ponto: ${d.link}`,
    "O horário é uma estimativa e pode variar com o trânsito. — By Bus Turismo",
  ].join("\n");
}
