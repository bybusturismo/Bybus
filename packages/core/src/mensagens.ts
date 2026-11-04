import type { Manifesto } from "./manifesto.js";

/** Textos das mensagens de WhatsApp (mesmos no servidor e na demonstração). */
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const semanaBr = (iso: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const SIGLA_CATEGORIA: Record<string, string> = { ADULTO: "A", SENIOR: "S", INFANTIL: "C", COLO: "Colo", CORTESIA: "Cort." };

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

