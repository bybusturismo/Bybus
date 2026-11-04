import { gestorPorId, garantirAgregado, IDS_GESTORES, mesSaoPaulo, type IdGestor } from "@bybus/core";
import { and, between, count, eq, gt, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/cliente.js";
import { retratoFinanceiroExtra, retratoFrotaExtra } from "./extras.js";
import { exigeMfa } from "../../seguranca/permissoes.js";
import { auditoria, escalas, iaAvaliacoes, iaUso, integracoesEstado, mensagens, passageiros, passeios, perfis, pessoas, reservas, saidas, sessoes, unidades, usuarios } from "../../db/schema.js";

/**
 * "Retratos" por área: o que cada gestor de IA enxerga. SÓ AGREGADOS (contagens, somas, percentuais, alertas) —
 * nada de nomes, documentos, telefones, e-mails nem identificadores de pessoas (LGPD, ADR 0004).
 * As funções de cada área são puras sobre `Base`, carregada uma vez por avaliação; as que precisam de mais dados
 * (equipe, usuários, integrações) fazem consultas agregadas próprias.
 */

export type Retrato = Record<string, unknown>;

export function somarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export interface SaidaBase {
  id: string;
  data: string;
  status: string;
  capacidade: number;
  veiculo: string | null;
  temGuia: boolean;
  temMotorista: boolean;
  listaFechada: boolean;
  passeio: string;
  praca: string;
  minimo: number;
}
export interface PaxLinha {
  saidaId: string;
  canal: string;
  statusReserva: string;
  categoria: string;
  embarque: string;
  docValido: boolean | null;
  temDoc: boolean;
  n: number;
}
export interface ResLinha {
  saidaId: string;
  canal: string;
  status: string;
  pagamento: string | null;
  conferencia: string;
  pediuTransfer: boolean;
  semPonto: boolean;
  semTelefone: boolean;
  origemCliente: string | null;
  n: number;
}
export interface Base {
  hoje: string;
  saidas: SaidaBase[];
  pax: PaxLinha[];
  res: ResLinha[];
}

/** Janela carregada: 60 dias para trás (comparar períodos) e 30 para a frente. */
export async function carregarBase(db: Db, hoje: string): Promise<Base> {
  const de = somarDias(hoje, -60);
  const ate = somarDias(hoje, 30);
  const listaSaidas = await db
    .select({
      id: saidas.id, data: saidas.data, status: saidas.status, capacidade: saidas.capacidade, veiculo: saidas.veiculo,
      guiaId: saidas.guiaId, guiaTxt: saidas.guia, motoristaId: saidas.motoristaId, motoristaTxt: saidas.motorista,
      fechada: saidas.listaFechadaEm, passeio: passeios.codigo, praca: unidades.codigo, minimo: passeios.minimoConfirmacao,
    })
    .from(saidas)
    .innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .innerJoin(unidades, eq(unidades.id, passeios.unidadeId))
    .where(between(saidas.data, de, ate));
  const canalEfetivo = sql<string>`coalesce(${reservas.canalOrigem}, ${reservas.canal})`;
  const temDoc = sql<boolean>`${passageiros.documentoCifrado} is not null`;
  const n = sql<number>`count(*)::int`;
  const pax = await db
    .select({ saidaId: reservas.saidaId, canal: canalEfetivo, statusReserva: reservas.status, categoria: passageiros.categoria, embarque: passageiros.embarque, docValido: passageiros.documentoValido, temDoc, n })
    .from(passageiros)
    .innerJoin(reservas, eq(reservas.id, passageiros.reservaId))
    .innerJoin(saidas, eq(saidas.id, reservas.saidaId))
    .where(between(saidas.data, de, ate))
    .groupBy(reservas.saidaId, canalEfetivo, reservas.status, passageiros.categoria, passageiros.embarque, passageiros.documentoValido, temDoc);
  const semPonto = sql<boolean>`${reservas.pontoEmbarqueId} is null`;
  const semTelefone = sql<boolean>`${reservas.contatoTelefone} is null`;
  const res = await db
    .select({ saidaId: reservas.saidaId, canal: canalEfetivo, status: reservas.status, pagamento: reservas.pagamento, conferencia: reservas.conferencia, pediuTransfer: reservas.pediuTransfer, semPonto, semTelefone, origemCliente: reservas.origemCliente, n })
    .from(reservas)
    .innerJoin(saidas, eq(saidas.id, reservas.saidaId))
    .where(between(saidas.data, de, ate))
    .groupBy(reservas.saidaId, canalEfetivo, reservas.status, reservas.pagamento, reservas.conferencia, reservas.pediuTransfer, semPonto, semTelefone, reservas.origemCliente);
  return {
    hoje,
    saidas: listaSaidas.map((s) => ({
      id: s.id, data: s.data, status: s.status, capacidade: s.capacidade, veiculo: s.veiculo?.trim() || null,
      temGuia: !!(s.guiaId || s.guiaTxt?.trim()), temMotorista: !!(s.motoristaId || s.motoristaTxt?.trim()),
      listaFechada: !!s.fechada, passeio: s.passeio, praca: s.praca, minimo: s.minimo,
    })),
    pax: pax.map((p) => ({ ...p, canal: String(p.canal) })),
    res: res.map((r) => ({ ...r, canal: String(r.canal) })),
  };
}

// ---------- utilidades puras ----------

const ativas = (b: Base) => b.saidas.filter((s) => s.status !== "CANCELADA");
const noPeriodo = (b: Base, de: number, ate: number) => ativas(b).filter((s) => s.data >= somarDias(b.hoje, de) && s.data <= somarDias(b.hoje, ate));
const paxConfirmados = (b: Base) => b.pax.filter((p) => p.statusReserva === "CONFIRMADA");

function paxPorSaida(b: Base): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of paxConfirmados(b)) m.set(p.saidaId, (m.get(p.saidaId) ?? 0) + p.n);
  return m;
}

function contar<T>(xs: T[], chave: (x: T) => string, peso: (x: T) => number = () => 1): Record<string, number> {
  const o: Record<string, number> = {};
  for (const x of xs) o[chave(x)] = (o[chave(x)] ?? 0) + peso(x);
  return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
}

function ocupacao(b: Base, lista: SaidaBase[]) {
  const por = paxPorSaida(b);
  const linhas = lista.map((s) => ({ s, pax: por.get(s.id) ?? 0 }));
  const pax = soma(linhas.map((l) => l.pax));
  const cap = soma(linhas.map((l) => l.s.capacidade));
  return {
    saidas: lista.length,
    passageirosConfirmados: pax,
    capacidadeTotal: cap,
    ocupacaoPct: pct(pax, cap),
    abaixoDoMinimo: linhas.filter((l) => l.pax < l.s.minimo).length,
    lotadas90pct: linhas.filter((l) => l.s.capacidade > 0 && l.pax / l.s.capacidade >= 0.9).length,
    acimaDaCapacidade: linhas.filter((l) => l.pax > l.s.capacidade).length,
    vazias: linhas.filter((l) => l.pax === 0).length,
  };
}

// ---------- retratos por área ----------

export function retratoComercial(b: Base): Retrato {
  const prox = noPeriodo(b, 0, 30);
  const ids30 = new Set(noPeriodo(b, -30, -1).map((s) => s.id));
  const idsAnt = new Set(noPeriodo(b, -60, -31).map((s) => s.id));
  const pax = paxConfirmados(b);
  const proxIds = new Set(prox.map((s) => s.id));
  const canaisProx = contar(pax.filter((p) => proxIds.has(p.saidaId)), (p) => p.canal, (p) => p.n);
  const canais30 = contar(pax.filter((p) => ids30.has(p.saidaId)), (p) => p.canal, (p) => p.n);
  const pax30 = soma(Object.values(canais30));
  const paxAnt = soma(pax.filter((p) => idsAnt.has(p.saidaId)).map((p) => p.n));
  const res30 = b.res.filter((r) => ids30.has(r.saidaId));
  const confirmadas = soma(res30.filter((r) => r.status === "CONFIRMADA").map((r) => r.n));
  const canceladas = soma(res30.filter((r) => r.status === "CANCELADA").map((r) => r.n));
  const principal = Object.entries(canais30)[0];
  const porPasseio: Record<string, { saidas: number; passageiros: number; ocupacaoPct: number }> = {};
  const por = paxPorSaida(b);
  for (const s of noPeriodo(b, 0, 14)) {
    const x = (porPasseio[s.passeio] ??= { saidas: 0, passageiros: 0, ocupacaoPct: 0 });
    x.saidas += 1;
    x.passageiros += por.get(s.id) ?? 0;
  }
  for (const [cod, x] of Object.entries(porPasseio)) {
    const cap = soma(noPeriodo(b, 0, 14).filter((s) => s.passeio === cod).map((s) => s.capacidade));
    x.ocupacaoPct = pct(x.passageiros, cap);
  }
  const alertas: string[] = [];
  const oc = ocupacao(b, prox);
  if (oc.abaixoDoMinimo > 0) alertas.push(`${oc.abaixoDoMinimo} saída(s) dos próximos 30 dias abaixo do mínimo de confirmação`);
  if (principal && pct(principal[1], pax30) >= 70) alertas.push(`${principal[0]} concentra ${pct(principal[1], pax30)}% dos passageiros dos últimos 30 dias`);
  if (pct(canceladas, confirmadas + canceladas) >= 10) alertas.push(`Cancelamentos em ${pct(canceladas, confirmadas + canceladas)}% das reservas dos últimos 30 dias`);
  return {
    proximos30Dias: oc,
    passageirosPorCanalProximos30Dias: canaisProx,
    ultimos30Dias: { passageiros: pax30, passageirosPor30DiasAnteriores: paxAnt, variacaoPct: paxAnt ? Math.round(((pax30 - paxAnt) / paxAnt) * 1000) / 10 : null, reservasConfirmadas: confirmadas, reservasCanceladas: canceladas, taxaCancelamentoPct: pct(canceladas, confirmadas + canceladas), passageirosPorCanal: canais30, canalPrincipalPct: principal ? pct(principal[1], pax30) : 0 },
    porPasseiroProximos14Dias: porPasseio,
    alertas,
  };
}

export function retratoLogistico(b: Base): Retrato {
  const por = paxPorSaida(b);
  const dia = (n: number) => ativas(b).filter((s) => s.data === somarDias(b.hoje, n));
  const resumoDia = (lista: SaidaBase[]) => ({
    saidas: lista.length,
    semGuia: lista.filter((s) => !s.temGuia).length,
    semMotorista: lista.filter((s) => !s.temMotorista).length,
    semVeiculo: lista.filter((s) => !s.veiculo).length,
    listaAberta: lista.filter((s) => !s.listaFechada).length,
    passageirosConfirmados: soma(lista.map((s) => por.get(s.id) ?? 0)),
  });
  const prox7 = noPeriodo(b, 0, 7);
  const idsProx7 = new Set(prox7.map((s) => s.id));
  const idsProx2 = new Set(noPeriodo(b, 0, 2).map((s) => s.id));
  const resProx7 = b.res.filter((r) => idsProx7.has(r.saidaId) && r.status === "CONFIRMADA");
  const passadas7 = noPeriodo(b, -7, -1);
  const idsPassadas = new Set(passadas7.map((s) => s.id));
  const paxPassadas = paxConfirmados(b).filter((p) => idsPassadas.has(p.saidaId));
  const totalPassadas = soma(paxPassadas.map((p) => p.n));
  const semRegistro = soma(paxPassadas.filter((p) => p.embarque === "PENDENTE").map((p) => p.n));
  const noShow = soma(paxPassadas.filter((p) => p.embarque === "NO_SHOW").map((p) => p.n));
  const hojeR = resumoDia(dia(0));
  const amanha = resumoDia(dia(1));
  const alertas: string[] = [];
  if (hojeR.semGuia + hojeR.semMotorista + hojeR.semVeiculo > 0) alertas.push(`Hoje: ${hojeR.semGuia} saída(s) sem guia, ${hojeR.semMotorista} sem motorista, ${hojeR.semVeiculo} sem veículo`);
  if (amanha.semGuia + amanha.semMotorista + amanha.semVeiculo > 0) alertas.push(`Amanhã: ${amanha.semGuia} saída(s) sem guia, ${amanha.semMotorista} sem motorista, ${amanha.semVeiculo} sem veículo`);
  if (semRegistro > 0) alertas.push(`${semRegistro} passageiro(s) das saídas dos últimos 7 dias sem registro de embarque`);
  const pendConf = soma(b.res.filter((r) => idsProx2.has(r.saidaId) && r.status === "CONFIRMADA" && r.conferencia === "PENDENTE").map((r) => r.n));
  if (pendConf > 0) alertas.push(`${pendConf} reserva(s) das próximas 48h ainda sem conferência de embarque`);
  return {
    hoje: hojeR,
    amanha,
    proximos7Dias: { ...resumoDia(prox7), ocupacao: ocupacao(b, prox7) },
    reservasProximos7Dias: {
      confirmadas: soma(resProx7.map((r) => r.n)),
      semPontoDeEmbarque: soma(resProx7.filter((r) => r.semPonto).map((r) => r.n)),
      pediramTransfer: soma(resProx7.filter((r) => r.pediuTransfer).map((r) => r.n)),
      conferenciaPendenteProximas48h: pendConf,
    },
    embarqueUltimos7Dias: { passageiros: totalPassadas, semRegistroDeEmbarque: semRegistro, noShow, noShowPct: pct(noShow, totalPassadas) },
    alertas,
  };
}

export function retratoFrotas(b: Base): Retrato {
  const prox14 = noPeriodo(b, 0, 14);
  const usados30 = new Set(noPeriodo(b, -30, -1).map((s) => s.veiculo).filter((v): v is string => !!v));
  const porDia = new Map<string, number>();
  for (const s of prox14) if (s.veiculo) porDia.set(`${s.veiculo}|${s.data}`, (porDia.get(`${s.veiculo}|${s.data}`) ?? 0) + 1);
  const conflitos = [...porDia.entries()].filter(([, n]) => n > 1);
  const usoPorVeiculo = contar(noPeriodo(b, 0, 14).filter((s) => !!s.veiculo), (s) => s.veiculo!);
  const semVeiculo = prox14.filter((s) => !s.veiculo).length;
  const oc = ocupacao(b, prox14);
  const alertas: string[] = [];
  if (semVeiculo > 0) alertas.push(`${semVeiculo} saída(s) dos próximos 14 dias sem veículo informado`);
  if (conflitos.length > 0) alertas.push(`${conflitos.length} caso(s) do mesmo veículo em mais de uma saída no mesmo dia (confirmar se há horários compatíveis)`);
  if (oc.acimaDaCapacidade > 0) alertas.push(`${oc.acimaDaCapacidade} saída(s) com mais passageiros que a capacidade`);
  return {
    proximos14Dias: { saidas: prox14.length, semVeiculoInformado: semVeiculo, veiculosDistintos: new Set(prox14.map((s) => s.veiculo).filter(Boolean)).size, saidasPorVeiculo: usoPorVeiculo, mesmoVeiculoMaisDeUmaSaidaNoDia: conflitos.length, ocupacao: oc },
    ultimos30Dias: { veiculosDistintosUsados: usados30.size },
    alertas,
  };
}

export interface DadosEquipe {
  hoje: string;
  pessoas: Array<{ papeis: string[]; idiomas: string[]; diariaCentavos: number | null; cadasturValidade: string | null; cnhValidade: string | null }>;
  /** Escalas de hoje até +30 dias (guiaId só para contar carga; não sai no retrato). */
  escalasFuturas: Array<{ guiaId: string | null; motoristaId: string | null }>;
  trocasUltimos30Dias: number;
}

function validade(pessoasLista: DadosEquipe["pessoas"], papel: string, campo: "cadasturValidade" | "cnhValidade", hoje: string) {
  const grupo = pessoasLista.filter((p) => p.papeis.includes(papel));
  const em30 = somarDias(hoje, 30);
  return {
    ativos: grupo.length,
    semRegistroDeValidade: grupo.filter((p) => !p[campo]).length,
    vencidos: grupo.filter((p) => p[campo] && p[campo]! < hoje).length,
    vencendoEm30Dias: grupo.filter((p) => p[campo] && p[campo]! >= hoje && p[campo]! <= em30).length,
  };
}

export function retratoAdministrativo(b: Base, equipe: DadosEquipe): Retrato {
  const prox30 = noPeriodo(b, 0, 30);
  const ids = new Set(prox30.map((s) => s.id));
  const resProx = b.res.filter((r) => ids.has(r.saidaId) && r.status === "CONFIRMADA");
  const total = soma(resProx.map((r) => r.n));
  const pagamento = contar(resProx, (r) => r.pagamento ?? "NAO_INFORMADO", (r) => r.n);
  const idsProx7 = new Set(noPeriodo(b, 0, 7).map((s) => s.id));
  const aReceber7 = soma(b.res.filter((r) => idsProx7.has(r.saidaId) && r.status === "CONFIRMADA" && r.pagamento === "A_PAGAR").map((r) => r.n));
  const guiasAtivos = equipe.pessoas.filter((p) => p.papeis.includes("GUIA"));
  const diariaMedia = guiasAtivos.filter((g) => g.diariaCentavos).map((g) => g.diariaCentavos!);
  const diasComGuia = equipe.escalasFuturas.filter((e) => e.guiaId).length;
  const mediaDiaria = diariaMedia.length ? Math.round(soma(diariaMedia) / diariaMedia.length) : 0;
  const alertas: string[] = [];
  if ((pagamento.NAO_INFORMADO ?? 0) > 0) alertas.push(`${pagamento.NAO_INFORMADO} reserva(s) dos próximos 30 dias sem forma de pagamento informada`);
  if (pct(pagamento.CORTESIA ?? 0, total) >= 10) alertas.push(`Cortesias em ${pct(pagamento.CORTESIA ?? 0, total)}% das reservas dos próximos 30 dias`);
  if (aReceber7 > 0) alertas.push(`${aReceber7} reserva(s) das próximas 7 dias a receber no embarque (conferir o caixa)`);
  return {
    reservasProximos30Dias: { total, porPagamento: pagamento, cortesiaPct: pct(pagamento.CORTESIA ?? 0, total), aPagarNoEmbarqueProximos7Dias: aReceber7 },
    equipe: { guiasAtivos: guiasAtivos.length, guiasSemDiariaCadastrada: guiasAtivos.filter((g) => !g.diariaCentavos).length, diariaMediaGuiaCentavos: mediaDiaria, diasEscaladosComGuiaProximos30Dias: diasComGuia, custoEstimadoDiariasGuiaProximos30DiasCentavos: soma(equipe.escalasFuturas.filter((e) => e.guiaId).map(() => mediaDiaria)) },
    lacunasDeDados: ["Reservas ainda não guardam valor de venda: receita e margem por passeio não podem ser avaliadas."],
    alertas,
  };
}

export function retratoMarketing(b: Base): Retrato {
  const ids30 = new Set(noPeriodo(b, -30, -1).map((s) => s.id));
  const idsProx = new Set(noPeriodo(b, 0, 30).map((s) => s.id));
  const res30 = b.res.filter((r) => ids30.has(r.saidaId) && r.status === "CONFIRMADA");
  const total = soma(res30.map((r) => r.n));
  const canais = contar(b.pax.filter((p) => ids30.has(p.saidaId) && p.statusReserva === "CONFIRMADA"), (p) => p.canal, (p) => p.n);
  const origens = Object.entries(contar(res30, (r) => r.origemCliente?.trim() || "NAO_INFORMADA", (r) => r.n)).slice(0, 8);
  const proxPorCanal = contar(b.pax.filter((p) => idsProx.has(p.saidaId) && p.statusReserva === "CONFIRMADA"), (p) => p.canal, (p) => p.n);
  const semTel = soma(res30.filter((r) => r.semTelefone).map((r) => r.n));
  const diretas = (canais.BALCAO ?? 0) + (canais.PAYTOUR ?? 0);
  const alertas: string[] = [];
  const semOrigem = origens.find(([k]) => k === "NAO_INFORMADA")?.[1] ?? 0;
  if (pct(semOrigem, total) >= 30) alertas.push(`${pct(semOrigem, total)}% das reservas dos últimos 30 dias sem origem do cliente (estado/país)`);
  if (pct(semTel, total) >= 20) alertas.push(`${pct(semTel, total)}% das reservas dos últimos 30 dias sem telefone (limita comunicação e remarketing)`);
  return {
    ultimos30Dias: { reservasConfirmadas: total, passageirosPorCanal: canais, vendaDiretaPct: pct(diretas, soma(Object.values(canais))), principaisOrigensDosClientes: Object.fromEntries(origens), reservasSemTelefonePct: pct(semTel, total) },
    proximos30Dias: { passageirosPorCanal: proxPorCanal },
    alertas,
  };
}

export interface DadosJuridico {
  eq: DadosEquipe;
  usuariosSensiveisSemMfa: number;
  acessosADocumentosCompletos30Dias: number;
  exportacoesDeManifesto30Dias: number;
}

export function retratoJuridico(b: Base, d: DadosJuridico): Retrato {
  const idsProx = new Set(noPeriodo(b, 0, 30).map((s) => s.id));
  const idsAnt = new Set(noPeriodo(b, -30, -1).map((s) => s.id));
  const paxProx = b.pax.filter((p) => idsProx.has(p.saidaId) && p.statusReserva === "CONFIRMADA");
  const totalPax = soma(paxProx.map((p) => p.n));
  const res30 = b.res.filter((r) => idsAnt.has(r.saidaId));
  const canc = soma(res30.filter((r) => r.status === "CANCELADA").map((r) => r.n));
  const tot = soma(res30.map((r) => r.n));
  const cadastur = validade(d.eq.pessoas, "GUIA", "cadasturValidade", b.hoje);
  const cnh = validade(d.eq.pessoas, "MOTORISTA", "cnhValidade", b.hoje);
  const alertas: string[] = [];
  if (cadastur.vencidos) alertas.push(`${cadastur.vencidos} guia(s) ativo(s) com Cadastur vencido`);
  if (cadastur.vencendoEm30Dias) alertas.push(`${cadastur.vencendoEm30Dias} Cadastur de guia vencendo em 30 dias`);
  if (cnh.vencidos) alertas.push(`${cnh.vencidos} motorista(s) ativo(s) com CNH vencida`);
  if (cnh.vencendoEm30Dias) alertas.push(`${cnh.vencendoEm30Dias} CNH de motorista vencendo em 30 dias`);
  if (d.usuariosSensiveisSemMfa) alertas.push(`${d.usuariosSensiveisSemMfa} usuário(s) com acesso sensível sem MFA ativado`);
  const semDoc = soma(paxProx.filter((p) => !p.temDoc).map((p) => p.n));
  return {
    cadasturDosGuias: cadastur,
    cnhDosMotoristas: cnh,
    passageirosProximos30Dias: {
      total: totalPax,
      semDocumento: semDoc,
      semDocumentoPct: pct(semDoc, totalPax),
      comDocumentoInvalido: soma(paxProx.filter((p) => p.docValido === false).map((p) => p.n)),
      criancasEBebes: soma(paxProx.filter((p) => p.categoria === "INFANTIL" || p.categoria === "COLO").map((p) => p.n)),
      idosos: soma(paxProx.filter((p) => p.categoria === "SENIOR").map((p) => p.n)),
    },
    consumidor: { reservasUltimos30Dias: tot, cancelamentosUltimos30Dias: canc, taxaCancelamentoPct: pct(canc, tot) },
    lgpd: { acessosADocumentosCompletosUltimos30Dias: d.acessosADocumentosCompletos30Dias, exportacoesDeListaUltimos30Dias: d.exportacoesDeManifesto30Dias, usuariosSensiveisSemMfa: d.usuariosSensiveisSemMfa },
    lacunasDeDados: ["Contratos e registro de consentimento de mensagens ainda não estão no sistema."],
    alertas,
  };
}

export function retratoRh(b: Base, equipe: DadosEquipe): Retrato {
  const prox14 = noPeriodo(b, 0, 14);
  const semGuia = prox14.filter((s) => !s.temGuia).length;
  const porPessoa = new Map<string, number>();
  for (const e of equipe.escalasFuturas) if (e.guiaId) porPessoa.set(e.guiaId, (porPessoa.get(e.guiaId) ?? 0) + 1);
  const cargas = [...porPessoa.values()];
  const guias = equipe.pessoas.filter((p) => p.papeis.includes("GUIA"));
  const idiomas: Record<string, number> = {};
  for (const g of guias) for (const i of g.idiomas) idiomas[i] = (idiomas[i] ?? 0) + 1;
  const cadastur = validade(equipe.pessoas, "GUIA", "cadasturValidade", b.hoje);
  const cnh = validade(equipe.pessoas, "MOTORISTA", "cnhValidade", b.hoje);
  const alertas: string[] = [];
  if (semGuia > 0) alertas.push(`${semGuia} saída(s) dos próximos 14 dias sem guia escalado`);
  if (cargas.length && Math.max(...cargas) >= 20) alertas.push(`Há guia com ${Math.max(...cargas)} dias escalados nos próximos 30 dias (risco de sobrecarga)`);
  if (cadastur.vencidos + cadastur.vencendoEm30Dias + cnh.vencidos + cnh.vencendoEm30Dias > 0) alertas.push("Há documentos de guias/motoristas vencidos ou vencendo em 30 dias");
  return {
    equipeAtiva: contar(equipe.pessoas.flatMap((p) => p.papeis), (x) => x),
    cobertura: { saidasProximos14Dias: prox14.length, semGuia, semMotorista: prox14.filter((s) => !s.temMotorista).length, coberturaDeGuiaPct: pct(prox14.length - semGuia, prox14.length) },
    cargaDosGuiasProximos30Dias: { guiasEscalados: cargas.length, maximoDeDiasPorGuia: cargas.length ? Math.max(...cargas) : 0, mediaDeDiasPorGuia: cargas.length ? Math.round((soma(cargas) / cargas.length) * 10) / 10 : 0 },
    trocasPorForcaMaiorUltimos30Dias: equipe.trocasUltimos30Dias,
    idiomasDosGuias: idiomas,
    validadeDosRegistros: { cadasturDosGuias: cadastur, cnhDosMotoristas: cnh },
    alertas,
  };
}

export interface DadosTecnologia {
  usuariosAtivos: number;
  usuariosSemMfa: number;
  usuariosSensiveisSemMfa: number;
  usuariosBloqueadosAgora: number;
  sessoesAtivas: number;
  eventos7Dias: Record<string, number>;
  registrosDeAuditoria24h: number;
  integracoes: Array<{ chave: string; minutosDesdeUltimaExecucao: number | null; comErro: boolean }>;
  mensagensComFalha7Dias: number;
  iaGastoMesUsd: number;
  iaLimiteMesUsd: number;
  avaliacoesDeIaComFalhaUltimos7Dias: number;
}

export function retratoTecnologia(d: DadosTecnologia): Retrato {
  const falhas = (d.eventos7Dias.LOGIN_FALHOU ?? 0) + (d.eventos7Dias.MFA_FALHOU ?? 0);
  const alertas: string[] = [];
  if (d.usuariosSensiveisSemMfa) alertas.push(`${d.usuariosSensiveisSemMfa} usuário(s) com acesso sensível sem MFA`);
  if (falhas >= 20) alertas.push(`${falhas} falhas de login/MFA nos últimos 7 dias`);
  for (const i of d.integracoes) {
    if (i.comErro) alertas.push(`Integração "${i.chave}" com erro na última execução`);
    else if (i.minutosDesdeUltimaExecucao != null && i.minutosDesdeUltimaExecucao > 60 * 24) alertas.push(`Integração "${i.chave}" sem executar há mais de 24h`);
  }
  if (d.mensagensComFalha7Dias) alertas.push(`${d.mensagensComFalha7Dias} mensagem(ns) com falha de envio nos últimos 7 dias`);
  if (d.iaLimiteMesUsd > 0 && d.iaGastoMesUsd >= d.iaLimiteMesUsd * 0.8) alertas.push(`Gasto com IA em ${pct(d.iaGastoMesUsd, d.iaLimiteMesUsd)}% do limite mensal`);
  return {
    usuarios: { ativos: d.usuariosAtivos, semMfa: d.usuariosSemMfa, comAcessoSensivelSemMfa: d.usuariosSensiveisSemMfa, bloqueadosAgora: d.usuariosBloqueadosAgora, sessoesAtivas: d.sessoesAtivas },
    eventosDeSegurancaUltimos7Dias: d.eventos7Dias,
    integracoes: d.integracoes,
    mensagensComFalhaUltimos7Dias: d.mensagensComFalha7Dias,
    auditoriaUltimas24h: d.registrosDeAuditoria24h,
    ia: { gastoNoMesUsd: d.iaGastoMesUsd, limiteMensalUsd: d.iaLimiteMesUsd, avaliacoesComFalhaUltimos7Dias: d.avaliacoesDeIaComFalhaUltimos7Dias },
    alertas,
  };
}

// ---------- consultas agregadas de apoio ----------

export async function carregarEquipe(db: Db, hoje: string): Promise<DadosEquipe> {
  const lista = await db
    .select({ papeis: pessoas.papeis, idiomas: pessoas.idiomas, diariaCentavos: pessoas.diariaCentavos, cadasturValidade: pessoas.cadasturValidade, cnhValidade: pessoas.cnhValidade })
    .from(pessoas)
    .where(eq(pessoas.ativo, true));
  const futuras = await db.select({ guiaId: escalas.guiaId, motoristaId: escalas.motoristaId }).from(escalas).where(between(escalas.data, hoje, somarDias(hoje, 30)));
  const [trocas] = await db
    .select({ n: count() })
    .from(escalas)
    .where(and(eq(escalas.origem, "TROCA"), between(escalas.data, somarDias(hoje, -30), hoje)));
  return { hoje, pessoas: lista, escalasFuturas: futuras, trocasUltimos30Dias: trocas?.n ?? 0 };
}

export async function gastoDoMesMicro(db: Db, mes: string): Promise<number> {
  const [r] = await db.select({ t: sql<number>`coalesce(sum(${iaUso.custoMicroUsd}), 0)::bigint` }).from(iaUso).where(eq(iaUso.mesRef, mes));
  return Number(r?.t ?? 0);
}

async function contarSensiveisSemMfa(db: Db): Promise<{ ativos: number; semMfa: number; sensiveisSemMfa: number }> {
  const linhas = await db
    .select({ totp: usuarios.totpAtivo, permissoes: perfis.permissoes })
    .from(usuarios)
    .innerJoin(perfis, eq(perfis.id, usuarios.perfilId))
    .where(eq(usuarios.ativo, true));
  return {
    ativos: linhas.length,
    semMfa: linhas.filter((l) => !l.totp).length,
    sensiveisSemMfa: linhas.filter((l) => !l.totp && exigeMfa(l.permissoes)).length,
  };
}

async function eventos(db: Db, desde: Date, acoes: string[]): Promise<Record<string, number>> {
  const linhas = await db
    .select({ acao: auditoria.acao, n: sql<number>`count(*)::int` })
    .from(auditoria)
    .where(and(gte(auditoria.criadoEm, desde), inArray(auditoria.acao, acoes)))
    .groupBy(auditoria.acao);
  return Object.fromEntries(linhas.map((l) => [l.acao, l.n]));
}

async function carregarTecnologia(db: Db, agora: Date, limiteUsd: number): Promise<DadosTecnologia> {
  const u = await contarSensiveisSemMfa(db);
  const [bloq] = await db.select({ n: count() }).from(usuarios).where(and(eq(usuarios.ativo, true), gt(usuarios.bloqueadoAte, agora)));
  const [sess] = await db.select({ n: count() }).from(sessoes).where(and(eq(sessoes.revogada, false), gt(sessoes.expiraEm, agora)));
  const ev = await eventos(db, new Date(agora.getTime() - 7 * 86_400_000), ["LOGIN_FALHOU", "MFA_FALHOU", "USUARIO_BLOQUEADO", "LOGIN_RECUSADO_BLOQUEIO"]);
  const [aud] = await db.select({ n: count() }).from(auditoria).where(gte(auditoria.criadoEm, new Date(agora.getTime() - 86_400_000)));
  const integ = await db.select({ chave: integracoesEstado.chave, ultima: integracoesEstado.ultimaExecucaoEm, erro: integracoesEstado.ultimoErro }).from(integracoesEstado);
  const [falhaMsg] = await db.select({ n: count() }).from(mensagens).where(and(eq(mensagens.status, "FALHA"), gte(mensagens.criadoEm, new Date(agora.getTime() - 7 * 86_400_000))));
  const mes = mesSaoPaulo(agora);
  const [falhaIa] = await db.select({ n: count() }).from(iaAvaliacoes).where(and(eq(iaAvaliacoes.status, "FALHA"), gte(iaAvaliacoes.iniciadaEm, new Date(agora.getTime() - 7 * 86_400_000))));
  return {
    usuariosAtivos: u.ativos, usuariosSemMfa: u.semMfa, usuariosSensiveisSemMfa: u.sensiveisSemMfa,
    usuariosBloqueadosAgora: bloq?.n ?? 0, sessoesAtivas: sess?.n ?? 0, eventos7Dias: ev, registrosDeAuditoria24h: aud?.n ?? 0,
    integracoes: integ.map((i) => ({ chave: i.chave, minutosDesdeUltimaExecucao: i.ultima ? Math.round((agora.getTime() - i.ultima.getTime()) / 60_000) : null, comErro: !!i.erro })),
    mensagensComFalha7Dias: falhaMsg?.n ?? 0,
    iaGastoMesUsd: (await gastoDoMesMicro(db, mes)) / 1_000_000, iaLimiteMesUsd: limiteUsd,
    avaliacoesDeIaComFalhaUltimos7Dias: falhaIa?.n ?? 0,
  };
}

/** Pontos de extensão: módulos novos (frota, financeiro, marketing…) acrescentam dados agregados ao retrato da sua área. */
const EXTRAS: Partial<Record<IdGestor, Array<(db: Db, hoje: string) => Promise<Retrato>>>> = {};
export function registrarRetratoExtra(id: IdGestor, fn: (db: Db, hoje: string) => Promise<Retrato>) {
  (EXTRAS[id] ??= []).push(fn);
}

// Módulos já existentes alimentam os retratos de frotas e administrativo (só agregados).
registrarRetratoExtra("frotas", retratoFrotaExtra);
registrarRetratoExtra("administrativo", retratoFinanceiroExtra);

/** Retratos de todas as áreas para o dia `hoje` (AAAA-MM-DD, America/Sao_Paulo). Passa pela trava de LGPD. */
export async function montarRetratos(db: Db, hoje: string, opcoes: { agora?: Date; limiteMesUsd?: number } = {}): Promise<Record<IdGestor, Retrato>> {
  const agora = opcoes.agora ?? new Date();
  const base = await carregarBase(db, hoje);
  const equipe = await carregarEquipe(db, hoje);
  const tec = await carregarTecnologia(db, agora, opcoes.limiteMesUsd ?? 0);
  const trintaDias = new Date(agora.getTime() - 30 * 86_400_000);
  const docs = await eventos(db, trintaDias, ["MANIFESTO_DOCUMENTOS_COMPLETOS", "MANIFESTO_EXPORTADO"]);
  const retratos: Record<IdGestor, Retrato> = {
    comercial: retratoComercial(base),
    logistico: retratoLogistico(base),
    frotas: retratoFrotas(base),
    administrativo: retratoAdministrativo(base, equipe),
    marketing: retratoMarketing(base),
    juridico: retratoJuridico(base, { eq: equipe, usuariosSensiveisSemMfa: tec.usuariosSensiveisSemMfa, acessosADocumentosCompletos30Dias: docs.MANIFESTO_DOCUMENTOS_COMPLETOS ?? 0, exportacoesDeManifesto30Dias: docs.MANIFESTO_EXPORTADO ?? 0 }),
    rh: retratoRh(base, equipe),
    tecnologia: retratoTecnologia(tec),
  };
  for (const id of IDS_GESTORES) {
    for (const extra of EXTRAS[id] ?? []) retratos[id] = { ...retratos[id], ...(await extra(db, hoje)) };
    garantirAgregado(retratos[id], `retrato.${id}`);
  }
  return retratos;
}

export const nomeDoGestor = (id: string) => gestorPorId(id)?.nome ?? id;

