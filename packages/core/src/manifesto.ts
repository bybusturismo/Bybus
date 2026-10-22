import { compararPontos } from "./embarque.js";
import type { Categoria, PassageiroManifesto, PontoEmbarque, ReservaManifesto } from "./tipos.js";

export interface RegrasSaida {
  /** Assentos disponíveis no veículo (QJQ2A16 = 73). */
  capacidade: number;
  /** Pagantes mínimos para confirmar a saída sem supervisor (Manual do Atendente: 12). */
  minimoConfirmacao: number;
  /** Abaixo deste valor a decisão é obrigatoriamente do supervisor (8–9). */
  minimoSupervisor: number;
  /** Se verdadeiro, documento é obrigatório para todos os passageiros (ex.: viagens SIE/ANTT). */
  documentoObrigatorio: boolean;
}

export const REGRAS_PADRAO_TODA_ILHA: RegrasSaida = {
  capacidade: 73,
  minimoConfirmacao: 12,
  minimoSupervisor: 10,
  documentoObrigatorio: false,
};

export type NivelAlerta = "info" | "atencao" | "critico";

export interface Alerta {
  codigo:
    | "MINIMO_NAO_ATINGIDO"
    | "DECISAO_SUPERVISOR"
    | "LOTACAO_EXCEDIDA"
    | "LOTACAO_PROXIMA"
    | "SEM_PONTO_EMBARQUE"
    | "SEM_DOCUMENTO"
    | "DOCUMENTO_INVALIDO"
    | "PASSAGEIRO_SEM_NOME"
    | "POSSIVEL_DUPLICATA";
  nivel: NivelAlerta;
  mensagem: string;
  reservaIds?: string[];
  passageiroIds?: string[];
}

export interface LinhaManifesto {
  /** Número sequencial na lista (1, 2, 3…), na ordem de embarque. */
  numero: number;
  reservaId: string;
  canal: ReservaManifesto["canal"];
  codigoExterno: string | null;
  contatoNome: string;
  contatoTelefone: string | null;
  observacoes: string | null;
  passageiro: PassageiroManifesto;
}

export interface BlocoManifesto {
  ponto: PontoEmbarque | null; // null = "A DEFINIR"
  linhas: LinhaManifesto[];
}

export interface Totais {
  passageiros: number;
  assentos: number;
  pagantes: number;
  porCategoria: Record<Categoria, number>;
  embarcados: number;
  noShow: number;
}

export interface Manifesto {
  blocos: BlocoManifesto[];
  totais: Totais;
  alertas: Alerta[];
}

const ocupaAssento = (c: Categoria) => c !== "COLO";
const ehPagante = (c: Categoria) => c !== "COLO" && c !== "CORTESIA";

/**
 * Monta a lista de passageiros em ordem de embarque:
 * 1) horário do ponto; 2) sequência oficial no empate; 3) nome do titular (família junta);
 * 4) bloco "A DEFINIR" no fim. Reservas canceladas não entram.
 */
export function montarManifesto(
  pontos: PontoEmbarque[],
  reservas: ReservaManifesto[],
  regras: RegrasSaida = REGRAS_PADRAO_TODA_ILHA,
  duplicatas: string[][] = [],
): Manifesto {
  const pontosOrdenados = [...pontos].sort(compararPontos);
  const porId = new Map(pontosOrdenados.map((p) => [p.id, p]));
  const ativas = reservas.filter((r) => r.status === "CONFIRMADA");

  type Item = { reserva: ReservaManifesto; passageiro: PassageiroManifesto; pontoId: string | null };
  const itens: Item[] = [];
  for (const reserva of ativas) {
    for (const passageiro of reserva.passageiros) {
      const pontoId = passageiro.pontoEmbarqueId ?? reserva.pontoEmbarqueId ?? null;
      itens.push({ reserva, passageiro, pontoId: pontoId && porId.has(pontoId) ? pontoId : null });
    }
  }

  const blocos: BlocoManifesto[] = [];
  let numero = 0;
  const grupos: Array<{ ponto: PontoEmbarque | null; itens: Item[] }> = [
    ...pontosOrdenados.map((ponto) => ({ ponto, itens: itens.filter((i) => i.pontoId === ponto.id) })),
    { ponto: null, itens: itens.filter((i) => i.pontoId === null) },
  ];
  for (const grupo of grupos) {
    if (grupo.itens.length === 0) continue;
    const ordenados = [...grupo.itens].sort(
      (a, b) =>
        a.reserva.contatoNome.localeCompare(b.reserva.contatoNome, "pt-BR", { sensitivity: "base" }) ||
        a.reserva.id.localeCompare(b.reserva.id),
    );
    blocos.push({
      ponto: grupo.ponto,
      linhas: ordenados.map(({ reserva, passageiro }) => ({
        numero: ++numero,
        reservaId: reserva.id,
        canal: reserva.canal,
        codigoExterno: reserva.codigoExterno ?? null,
        contatoNome: reserva.contatoNome,
        contatoTelefone: reserva.contatoTelefone ?? null,
        observacoes: reserva.observacoes ?? null,
        passageiro,
      })),
    });
  }

  const totais = calcularTotais(itens.map((i) => i.passageiro));
  const alertas = gerarAlertas(itens, totais, regras, duplicatas);
  return { blocos, totais, alertas };
}

export function calcularTotais(passageiros: PassageiroManifesto[]): Totais {
  const porCategoria: Record<Categoria, number> = { ADULTO: 0, SENIOR: 0, INFANTIL: 0, COLO: 0, CORTESIA: 0 };
  let assentos = 0;
  let pagantes = 0;
  let embarcados = 0;
  let noShow = 0;
  for (const p of passageiros) {
    porCategoria[p.categoria]++;
    if (ocupaAssento(p.categoria)) assentos++;
    if (ehPagante(p.categoria)) pagantes++;
    if (p.embarque === "EMBARCOU") embarcados++;
    if (p.embarque === "NO_SHOW") noShow++;
  }
  return { passageiros: passageiros.length, assentos, pagantes, porCategoria, embarcados, noShow };
}

function gerarAlertas(
  itens: Array<{ reserva: ReservaManifesto; passageiro: PassageiroManifesto; pontoId: string | null }>,
  totais: Totais,
  regras: RegrasSaida,
  duplicatas: string[][],
): Alerta[] {
  const alertas: Alerta[] = [];

  if (totais.pagantes < regras.minimoSupervisor) {
    alertas.push({
      codigo: "DECISAO_SUPERVISOR",
      nivel: "critico",
      mensagem: `Apenas ${totais.pagantes} pagante(s). Abaixo de ${regras.minimoSupervisor}: decisão obrigatória do supervisor — não cancelar reservas sem autorização.`,
    });
  } else if (totais.pagantes < regras.minimoConfirmacao) {
    alertas.push({
      codigo: "MINIMO_NAO_ATINGIDO",
      nivel: "atencao",
      mensagem: `${totais.pagantes} pagante(s); mínimo para confirmar é ${regras.minimoConfirmacao}. Aguardar até ~16h30/17h e comunicar o supervisor (prazo oficial: 18h do dia anterior).`,
    });
  }

  if (totais.assentos > regras.capacidade) {
    alertas.push({
      codigo: "LOTACAO_EXCEDIDA",
      nivel: "critico",
      mensagem: `${totais.assentos} assentos ocupados para ${regras.capacidade} lugares.`,
    });
  } else if (totais.assentos >= Math.ceil(regras.capacidade * 0.9)) {
    alertas.push({
      codigo: "LOTACAO_PROXIMA",
      nivel: "atencao",
      mensagem: `${totais.assentos} de ${regras.capacidade} lugares ocupados (≥ 90%). Bloquear vendas nas OTAs se necessário.`,
    });
  }

  const semPonto = [...new Set(itens.filter((i) => i.pontoId === null).map((i) => i.reserva.id))];
  if (semPonto.length > 0) {
    alertas.push({
      codigo: "SEM_PONTO_EMBARQUE",
      nivel: "atencao",
      mensagem: `${semPonto.length} reserva(s) sem ponto de embarque — contatar o cliente (WhatsApp ou painel da OTA).`,
      reservaIds: semPonto,
    });
  }

  const semNome = itens.filter((i) => !i.passageiro.nome.trim()).map((i) => i.passageiro.id);
  if (semNome.length > 0) {
    alertas.push({
      codigo: "PASSAGEIRO_SEM_NOME",
      nivel: "atencao",
      mensagem: `${semNome.length} passageiro(s) sem nome (ex.: reservas de OTA com apenas a quantidade).`,
      passageiroIds: semNome,
    });
  }

  const semDoc = itens.filter((i) => !i.passageiro.documento).map((i) => i.passageiro.id);
  if (semDoc.length > 0) {
    alertas.push({
      codigo: "SEM_DOCUMENTO",
      nivel: regras.documentoObrigatorio ? "critico" : "info",
      mensagem: `${semDoc.length} passageiro(s) sem documento cadastrado.`,
      passageiroIds: semDoc,
    });
  }

  const docInvalido = itens.filter((i) => i.passageiro.documento && i.passageiro.documentoValido === false).map((i) => i.passageiro.id);
  if (docInvalido.length > 0) {
    alertas.push({
      codigo: "DOCUMENTO_INVALIDO",
      nivel: "atencao",
      mensagem: `${docInvalido.length} documento(s) com número inválido (ex.: CPF com dígito verificador errado).`,
      passageiroIds: docInvalido,
    });
  }

  for (const grupo of duplicatas) {
    alertas.push({
      codigo: "POSSIVEL_DUPLICATA",
      nivel: "atencao",
      mensagem: "Possível reserva duplicada entre canais — confirmar antes de embarcar.",
      reservaIds: grupo,
    });
  }

  return alertas;
}
