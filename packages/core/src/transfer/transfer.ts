import { centavosParaTexto } from "../financeiro/dinheiro.js";

/**
 * Regras puras do transfer do Norte da ilha (van/carro separado que busca os passageiros na porta do hotel
 * e os leva até o ônibus do city tour). Ordem de busca: do bairro mais longe do centro para o mais perto.
 */

export const SITUACOES_BUSCA = ["A_CONFIRMAR", "CONFIRMADO", "BUSCADO", "NAO_APARECEU"] as const;
export type SituacaoBusca = (typeof SITUACOES_BUSCA)[number];
export const ROTULO_SITUACAO_BUSCA: Record<SituacaoBusca, string> = {
  A_CONFIRMAR: "A confirmar",
  CONFIRMADO: "Confirmado com o cliente",
  BUSCADO: "Buscado",
  NAO_APARECEU: "Não apareceu",
};

/** PIX e DINHEIRO: pago ao motorista; INCLUIDO_NO_PASSEIO: cobrado na compra (nada a receber do motorista). */
export const FORMAS_TAXA = ["PIX", "DINHEIRO", "INCLUIDO_NO_PASSEIO"] as const;
export type FormaTaxa = (typeof FORMAS_TAXA)[number];
export const ROTULO_FORMA_TAXA: Record<FormaTaxa, string> = { PIX: "PIX", DINHEIRO: "Dinheiro", INCLUIDO_NO_PASSEIO: "Incluído no passeio" };

export const SITUACOES_TAXA = ["A_RECEBER", "RECEBIDO"] as const;
export type SituacaoTaxa = (typeof SITUACOES_TAXA)[number];

export interface BairroTransfer {
  id: string;
  nome: string;
  /** 1 = o primeiro a ser buscado (o mais longe do centro). */
  ordemBusca: number;
  /** Horário "HH:MM" em que a van chega ao bairro; nulo = a confirmar. */
  horarioReferencia: string | null;
  pontoEmbarqueId: string | null;
  ativo?: boolean;
}

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Palavra que identifica o bairro dentro de um texto de hotel/endereço ("Cachoeira do Bom Jesus" → "cachoeira"). */
function chaveDoBairro(nome: string): string {
  const ignorar = new Set(["de", "da", "do", "dos", "das", "praia", "bairro", "vila"]);
  const palavras = semAcento(nome).split(/[^a-z0-9]+/).filter((p) => p.length >= 4 && !ignorar.has(p));
  return palavras[0] ?? semAcento(nome).trim();
}

/**
 * Bairro de uma reserva: 1) bairros ligados ao ponto de transfer escolhido (se mais de um, o que aparece no texto
 * do hotel; senão o primeiro na ordem de busca); 2) sem ponto de transfer, o bairro citado no texto do hotel; 3) nenhum.
 */
export function escolherBairro(bairros: BairroTransfer[], r: { pontoEmbarqueId: string | null; hospedagem: string | null }): BairroTransfer | null {
  const ativos = bairros.filter((b) => b.ativo !== false).sort((a, b) => a.ordemBusca - b.ordemBusca);
  const texto = semAcento(r.hospedagem ?? "");
  const citado = (lista: BairroTransfer[]) => (texto ? lista.find((b) => texto.includes(chaveDoBairro(b.nome))) ?? null : null);
  const doPonto = r.pontoEmbarqueId ? ativos.filter((b) => b.pontoEmbarqueId === r.pontoEmbarqueId) : [];
  if (doPonto.length === 1) return doPonto[0]!;
  if (doPonto.length > 1) return citado(doPonto) ?? doPonto[0]!;
  return citado(ativos);
}

export function minutosDe(horario: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(horario);
  if (!m) throw new Error(`Horário inválido: ${horario}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "06:40" + 10 → "06:50" (não passa da meia-noite). */
export function somarMinutos(horario: string, minutos: number): string {
  const t = Math.min(23 * 60 + 59, Math.max(0, minutosDe(horario) + minutos));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export interface ItemBusca {
  id: string;
  /** Ordem de busca do bairro (nula = bairro não definido: vai para o fim). */
  bairroOrdem: number | null;
  titular: string;
}

const SEM_BAIRRO = Number.MAX_SAFE_INTEGER;
const compararAutomatico = (a: ItemBusca, b: ItemBusca) =>
  (a.bairroOrdem ?? SEM_BAIRRO) - (b.bairroOrdem ?? SEM_BAIRRO) ||
  a.titular.localeCompare(b.titular, "pt-BR", { sensitivity: "base" }) ||
  a.id.localeCompare(b.id);

/** Ordem automática: bairro (do mais longe para o mais perto), depois o nome do titular (família junta). */
export function ordenarBusca<T extends ItemBusca>(itens: T[]): T[] {
  return [...itens].sort(compararAutomatico);
}

/**
 * Coloca um item novo numa lista já ordenada (talvez ajustada à mão) sem mexer nos demais:
 * fica depois do último item do mesmo bairro; se o bairro ainda não está na lista, depois do último bairro anterior.
 */
export function inserirNaOrdem<T extends ItemBusca>(existentes: T[], novo: T): T[] {
  const ultimoDoBairro = existentes.reduce((u, e, i) => ((e.bairroOrdem ?? SEM_BAIRRO) === (novo.bairroOrdem ?? SEM_BAIRRO) ? i : u), -1);
  let posicao = ultimoDoBairro + 1;
  if (ultimoDoBairro < 0) {
    posicao = 0;
    existentes.forEach((e, i) => {
      if ((e.bairroOrdem ?? SEM_BAIRRO) < (novo.bairroOrdem ?? SEM_BAIRRO)) posicao = i + 1;
    });
  }
  const copia = [...existentes];
  copia.splice(posicao, 0, novo);
  return copia;
}

/** Move o item para a posição (0 = primeiro) dentro da lista. Posição fora do intervalo é ajustada. */
export function moverItem<T>(lista: T[], de: number, para: number): T[] {
  if (de < 0 || de >= lista.length) return [...lista];
  const alvo = Math.min(Math.max(para, 0), lista.length - 1);
  const copia = [...lista];
  const [x] = copia.splice(de, 1);
  copia.splice(alvo, 0, x!);
  return copia;
}

export interface ItemHorario {
  bairroId: string | null;
  horarioBairro: string | null;
  /** Horário digitado à mão (não é recalculado). */
  horarioManual: string | null;
}

/**
 * Horário de busca de cada item, na ordem recebida: o primeiro de cada bairro sai no horário do bairro e os seguintes
 * do mesmo bairro somam `intervaloMinutos` cada. Sem horário de bairro: nulo (a confirmar). Horário manual vale como está.
 * Os horários nunca voltam: se o bairro seguinte tem horário de referência menor que a parada anterior + intervalo,
 * a busca passa para depois da anterior.
 */
export function calcularHorariosBusca(itens: ItemHorario[], intervaloMinutos: number): Array<string | null> {
  const resultado: Array<string | null> = [];
  let bairroAtual: string | null | undefined;
  let posicaoNoBairro = 0;
  let ultimo: number | null = null;
  for (const it of itens) {
    if (it.bairroId !== bairroAtual) {
      bairroAtual = it.bairroId;
      posicaoNoBairro = 0;
    }
    if (it.horarioManual) {
      resultado.push(it.horarioManual);
      ultimo = minutosDe(it.horarioManual);
    } else if (it.horarioBairro) {
      // Nunca volta no tempo: a van só chega à próxima parada depois da anterior (+ intervalo).
      let h = minutosDe(it.horarioBairro) + posicaoNoBairro * intervaloMinutos;
      if (ultimo !== null && h < ultimo + intervaloMinutos) h = ultimo + intervaloMinutos;
      const texto = somarMinutos("00:00", h);
      resultado.push(texto);
      ultimo = h;
    } else resultado.push(null);
    posicaoNoBairro++;
  }
  return resultado;
}

/**
 * Taxa da reserva em centavos: taxa única por passageiro (mesmo valor em todos os bairros) × passageiros com assento
 * (bebê de colo não paga). Decisão do dono em 05/11/2026; o valor (R$ 35–45) ainda é a confirmar.
 */
export function calcularTaxa(taxaPorPassageiroCentavos: number, assentos: number): number {
  if (taxaPorPassageiroCentavos <= 0 || assentos <= 0) return 0;
  return taxaPorPassageiroCentavos * assentos;
}

export interface ItemTaxa {
  situacao: SituacaoBusca;
  taxaCentavos: number;
  forma: FormaTaxa | null;
  taxaSituacao: SituacaoTaxa;
}

export interface TotaisTaxa {
  total: number;
  aReceber: number;
  recebidoPix: number;
  recebidoDinheiro: number;
  incluidoNoPasseio: number;
  /** Quem não apareceu e ainda não pagou não entra em "a receber". */
  naoApareceram: number;
}

export function totaisTaxa(itens: ItemTaxa[]): TotaisTaxa {
  const t: TotaisTaxa = { total: 0, aReceber: 0, recebidoPix: 0, recebidoDinheiro: 0, incluidoNoPasseio: 0, naoApareceram: 0 };
  for (const i of itens) {
    if (i.taxaSituacao === "RECEBIDO") {
      if (i.forma === "PIX") t.recebidoPix += i.taxaCentavos;
      else if (i.forma === "DINHEIRO") t.recebidoDinheiro += i.taxaCentavos;
      else t.incluidoNoPasseio += i.taxaCentavos;
      t.total += i.taxaCentavos;
    } else if (i.situacao === "NAO_APARECEU") {
      t.naoApareceram += i.taxaCentavos;
    } else {
      t.aReceber += i.taxaCentavos;
      t.total += i.taxaCentavos;
    }
  }
  return t;
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const semanaBr = (iso: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
export const reais = (centavos: number) => `R$ ${centavosParaTexto(centavos)}`;

export interface LinhaListaTransfer {
  horario: string | null;
  bairro: string | null;
  endereco: string | null;
  titular: string;
  pax: number;
  /** Só preenchido para quem pode ver contatos (manifesto:contatos). */
  telefone: string | null;
  situacao: SituacaoBusca;
  taxaCentavos: number;
  forma: FormaTaxa | null;
  taxaSituacao: SituacaoTaxa;
}

/** Texto da lista do transfer para o WhatsApp do motorista, em ordem de busca. */
export function textoListaTransfer(
  cab: { passeio: string; data: string; motorista: string | null; veiculo: string | null; lugares: number | null; encontro: { nome: string | null; horario: string | null } | null },
  linhas: LinhaListaTransfer[],
): string {
  const l: string[] = [];
  l.push(`*TRANSFER — ${cab.passeio}*`);
  l.push(`${semanaBr(cab.data)}, ${dataBr(cab.data)}`);
  l.push(`Motorista: ${cab.motorista ?? "a definir"} · Veículo: ${cab.veiculo ?? "a definir"}${cab.lugares ? ` · ${cab.lugares} lugares` : ""}`);
  l.push(cab.encontro?.nome
    ? `Encontro com o ônibus: ${cab.encontro.nome}${cab.encontro.horario ? ` às ${cab.encontro.horario}` : " (horário a confirmar)"}`
    : "Encontro com o ônibus: a confirmar");
  l.push("");
  let pax = 0;
  let cobrar = 0;
  linhas.forEach((x, i) => {
    pax += x.pax;
    const taxa = x.taxaSituacao === "RECEBIDO" ? (x.forma === "INCLUIDO_NO_PASSEIO" ? "taxa já paga na compra" : `pago (${x.forma === "PIX" ? "PIX" : "dinheiro"})`) : x.taxaCentavos > 0 ? `*cobrar ${reais(x.taxaCentavos)}*` : "sem taxa";
    if (x.taxaSituacao !== "RECEBIDO") cobrar += x.taxaCentavos;
    const estado = x.situacao === "BUSCADO" ? " ✅" : x.situacao === "NAO_APARECEU" ? " ❌ não apareceu" : x.situacao === "A_CONFIRMAR" ? " (a confirmar com o cliente)" : "";
    l.push(`${i + 1}. ${x.horario ?? "--:--"} · ${x.bairro ?? "BAIRRO A DEFINIR"} · ${x.endereco ?? "hotel a informar"}`);
    l.push(`   ${x.titular} · ${x.pax} pax${x.telefone ? ` · ${x.telefone}` : ""} · ${taxa}${estado}`);
  });
  l.push("");
  l.push(`Total: ${linhas.length} reserva(s) · ${pax} passageiro(s)${cobrar ? ` · a cobrar: ${reais(cobrar)}` : ""}`);
  return l.join("\n");
}
