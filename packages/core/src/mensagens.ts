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
  l.push(`*RELAÇÃO DE PASSAGEIROS${cab.versao > 1 ? ` — LISTA ATUALIZADA (versão ${cab.versao})` : ""}*`);
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

const AVISO_TRANSITO = "Você está numa região com trânsito intenso pela manhã: saia com folga para chegar a tempo.";

/**
 * Confirmação ao titular (véspera): sai quando a saída é confirmada (pelos cortes, pela equipe ou no fechamento das 21h).
 * Regras do gerente (09/11/2026): aguardar em frente ao hotel ou no ponto 10 minutos antes; tolerância zero; quem está em
 * região de trânsito intenso sai mais cedo; o transfer tem horário padrão e qualquer mudança é avisada pelo WhatsApp.
 * [A CONFIRMAR] texto oficial com o dono.
 */
export interface DadosConfirmacao {
  primeiroNome: string; passeio: string; data: string; ponto: { horario: string; nome: string; endereco: string | null } | null; linkEmbarque: string | null;
  /** Quem vem de transfer: horário de busca, local e taxa a pagar ao motorista. */
  transfer?: { horario: string | null; local: string | null; taxaACobrarCentavos: number } | null;
  /** Hospedado em região de trânsito intenso (continente, norte da ilha, Lagoa da Conceição). */
  transitoIntenso?: boolean;
  /** O link de embarque já foi na prévia da manhã (gerar outro invalidaria o primeiro). */
  linkJaEnviado?: boolean;
  /** Link do mapa do ônibus, enviado já na confirmação (uma mensagem a menos por reserva: o dono paga por mensagem). */
  linkRastreio?: string | null;
}

/** Fecho da confirmação: com o link do mapa já incluído, não há mensagem de rastreio separada no dia. */
export const fechoConfirmacao = (linkRastreio?: string | null) =>
  linkRastreio ? `No dia, acompanhe o ônibus no mapa por aqui: ${linkRastreio}` : "No dia, enviaremos o link para acompanhar o ônibus.";

/** Linhas do meio da confirmação (embarque, transfer ou pedido do ponto): as mesmas no texto livre e no modelo da Meta. */
export function detalhesConfirmacao(d: DadosConfirmacao): string[] {
  const linhas: string[] = [];
  if (d.transfer) {
    linhas.push(d.transfer.horario
      ? `Transfer: vamos buscar você${d.transfer.local ? ` em ${d.transfer.local}` : ""} às *${d.transfer.horario}*. Aguarde em frente ao hotel 10 minutos antes: a van é pontual e não há tolerância para atrasos. Se o horário mudar, avisaremos por aqui.`
      : `Transfer: confirmaremos o horário de busca${d.transfer.local ? ` em ${d.transfer.local}` : ""} em breve.`);
    if (d.transfer.taxaACobrarCentavos > 0) linhas.push(`Taxa do transfer: R$ ${(d.transfer.taxaACobrarCentavos / 100).toFixed(2).replace(".", ",")}, paga ao motorista (PIX ou dinheiro).`);
  } else if (d.ponto) {
    linhas.push(`Embarque: *${d.ponto.horario}* — ${d.ponto.nome}${d.ponto.endereco ? ` (${d.ponto.endereco})` : ""}.`);
    linhas.push("Aguarde no local 10 minutos antes: o ônibus é pontual e não há tolerância para atrasos.");
    if (d.transitoIntenso) linhas.push(AVISO_TRANSITO);
  } else {
    linhas.push(d.linkEmbarque
      ? `Falta só o seu ponto de embarque. Informe onde está hospedado(a) aqui: ${d.linkEmbarque}`
      : d.linkJaEnviado
        ? "Falta só o seu ponto de embarque: informe pelo link que enviamos mais cedo ou responda esta mensagem com o hotel onde está hospedado(a)."
        : "Falta só o seu ponto de embarque: responda esta mensagem com o hotel ou endereço onde está hospedado(a).");
    linhas.push("Se o seu hotel não tiver embarque, indicaremos o ponto mais próximo.");
  }
  return linhas;
}

/** "sábado (14/11/2026)": como a data aparece nas mensagens da véspera. */
export const diaComData = (iso: string) => `${semanaBr(iso)} (${dataBr(iso)})`;

export function textoConfirmacao(d: DadosConfirmacao): string {
  const ola = d.primeiroNome ? `Olá, ${d.primeiroNome}!` : "Olá!";
  return [
    `${ola} Seu passeio *${d.passeio}* de amanhã, ${diaComData(d.data)}, está confirmado! 🚌`,
    ...detalhesConfirmacao(d),
    `${fechoConfirmacao(d.linkRastreio)} Bom passeio! — Equipe By Bus`,
  ].join("\n");
}

/**
 * Prévia da véspera (manhã), enquanto a saída ainda não atingiu os cortes de confirmação: acalma o cliente e,
 * para quem ainda não tem ponto, já pede onde está hospedado (o dia todo para responder). [A CONFIRMAR] texto oficial.
 */
export function textoPrevia(d: { primeiroNome: string; passeio: string; data: string; linkEmbarque: string | null; semPonto: boolean }): string {
  const ola = d.primeiroNome ? `Olá, ${d.primeiroNome}!` : "Olá!";
  const linhas = [
    `${ola} Recebemos sua reserva do passeio *${d.passeio}* para amanhã, ${semanaBr(d.data)} (${dataBr(d.data)}).`,
    "Estamos montando a lista de passageiros e, ao longo do dia, enviaremos a confirmação com o horário e o local de embarque.",
  ];
  if (d.semPonto) {
    linhas.push(d.linkEmbarque
      ? `Para adiantar, informe onde está hospedado(a): ${d.linkEmbarque}`
      : "Para adiantar, responda esta mensagem com o hotel ou endereço onde está hospedado(a).");
  }
  linhas.push("— Equipe By Bus");
  return linhas.join("\n");
}

/** Mensagem enviada quando o motorista inicia o rastreio: o link para acompanhar o City Tour. */
export function textoRastreio(d: { primeiroNome: string; passeio: string; link: string }): string {
  const ola = d.primeiroNome ? `Olá, ${d.primeiroNome}!` : "Olá!";
  return [
    `${ola} O City Tour *${d.passeio.replace(/^\s*city\s*tour\s*[-–:·]?\s*/i, "").trim() || d.passeio}* já saiu.`,
    `Acompanhe no mapa e veja quanto falta para ele chegar ao seu ponto: ${d.link}`,
    "O horário é uma estimativa e pode variar com o trânsito. — Equipe By Bus",
  ].join("\n");
}
