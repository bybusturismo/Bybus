import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import {
  calcularHorariosBusca, calcularTaxa, escolherBairro, inserirNaOrdem, moverItem, ordenarBusca, textoListaTransfer, totaisTaxa,
  type BairroTransfer, type FormaTaxa, type SituacaoBusca, type SituacaoTaxa, type TransferNaLista,
} from "@bybus/core";
import { auditar } from "../auditoria.js";
import type { Db } from "../db/cliente.js";
import { passageiros, passeios, pessoas, pontosEmbarque, reservas, saidas, transferBairros, transferConfig, transferDias, transferReservas, usuarios, veiculos } from "../db/schema.js";

export type ConfigTransfer = typeof transferConfig.$inferSelect;
type LinhaTr = typeof transferReservas.$inferSelect;

/** Padrões do transfer do passeio; sem registro, os padrões do sistema (taxa a confirmar). */
export async function configDoPasseio(db: Db, passeioId: string): Promise<ConfigTransfer> {
  const [c] = await db.select().from(transferConfig).where(eq(transferConfig.passeioId, passeioId));
  return c ?? {
    passeioId, taxaPorPassageiroCentavos: 4000, taxaAConfirmar: true, intervaloMinutos: 5, pontoEncontroId: null, chegadaPrevista: null,
    motoristaPadraoId: null, veiculoPadraoId: null, veiculoPadraoTexto: null, lugaresPadrao: null, atualizadoEm: new Date(),
  };
}

export async function bairrosDoPasseio(db: Db, passeioId: string, soAtivos = true) {
  return db.select().from(transferBairros)
    .where(and(eq(transferBairros.passeioId, passeioId), soAtivos ? eq(transferBairros.ativo, true) : undefined))
    .orderBy(asc(transferBairros.ordemBusca), asc(transferBairros.nome));
}
const paraCore = (b: typeof transferBairros.$inferSelect): BairroTransfer => ({ id: b.id, nome: b.nome, ordemBusca: b.ordemBusca, horarioReferencia: b.horarioReferencia, pontoEmbarqueId: b.pontoEmbarqueId, ativo: b.ativo });

/** Reservas confirmadas da saída que vêm de transfer (ponto de transfer ou pedido de transfer), com passageiros e assentos. */
async function reservasElegiveis(db: Db, saidaId: string) {
  const lista = await db.select({ reserva: reservas, ehTransfer: pontosEmbarque.ehTransfer }).from(reservas)
    .leftJoin(pontosEmbarque, eq(pontosEmbarque.id, reservas.pontoEmbarqueId))
    .where(and(eq(reservas.saidaId, saidaId), eq(reservas.status, "CONFIRMADA")));
  const elegiveis = lista.filter((l) => l.ehTransfer || l.reserva.pediuTransfer).map((l) => l.reserva);
  const pax = elegiveis.length ? await db.select({ reservaId: passageiros.reservaId, categoria: passageiros.categoria }).from(passageiros).where(inArray(passageiros.reservaId, elegiveis.map((r) => r.id))) : [];
  return elegiveis.map((reserva) => {
    const meus = pax.filter((p) => p.reservaId === reserva.id);
    return { reserva, pax: meus.length, assentos: meus.filter((p) => p.categoria !== "COLO").length };
  });
}

export interface ResumoSincronia { diaId: string | null; novo: boolean; criadas: number; atualizadas: number; removidas: number }

/**
 * Monta (ou atualiza) o transfer do dia a partir das reservas confirmadas de transfer. Preserva o que foi ajustado à mão
 * (bairro, endereço, horário, taxa) e a ordem de busca já existente; reservas novas entram no grupo do bairro.
 * `criar`: "sempre" cria o transfer do dia mesmo vazio; "se_houver" só se houver reservas; false só atualiza um já existente.
 */
export async function sincronizarTransfer(db: Db, saidaId: string, criar: "sempre" | "se_houver" | false): Promise<ResumoSincronia | null> {
  const [s] = await db.select({ passeioId: saidas.passeioId }).from(saidas).where(eq(saidas.id, saidaId));
  if (!s) return null;
  const bairros = await bairrosDoPasseio(db, s.passeioId);
  if (!bairros.length) return null;
  const cfg = await configDoPasseio(db, s.passeioId);
  const bairrosCore = bairros.map(paraCore);
  const elegiveis = await reservasElegiveis(db, saidaId);
  let [dia] = await db.select().from(transferDias).where(eq(transferDias.saidaId, saidaId));
  let novo = false;
  if (!dia) {
    if (!criar || (criar === "se_houver" && !elegiveis.length)) return null;
    [dia] = await db.insert(transferDias).values({
      saidaId, veiculoId: cfg.veiculoPadraoId, veiculoTexto: cfg.veiculoPadraoTexto, motoristaId: cfg.motoristaPadraoId,
      lugares: cfg.lugaresPadrao, pontoEncontroId: cfg.pontoEncontroId, chegadaPrevista: cfg.chegadaPrevista,
    }).onConflictDoNothing().returning();
    if (!dia) [dia] = await db.select().from(transferDias).where(eq(transferDias.saidaId, saidaId));
    novo = true;
  }
  const diaId = dia!.id;
  const existentes = await db.select().from(transferReservas).where(eq(transferReservas.transferDiaId, diaId));
  const porReserva = new Map(existentes.map((e) => [e.reservaId, e]));
  const idsElegiveis = new Set(elegiveis.map((e) => e.reserva.id));
  const ordemDoBairro = (id: string | null) => bairrosCore.find((b) => b.id === id)?.ordemBusca ?? null;

  let criadas = 0, atualizadas = 0, removidas = 0;
  // Quem sai do transfer fica inativo (histórico), nunca é apagado.
  for (const e of existentes) {
    if (e.ativo && !idsElegiveis.has(e.reservaId)) {
      await db.update(transferReservas).set({ ativo: false, atualizadoEm: new Date() }).where(eq(transferReservas.id, e.id));
      removidas++;
    }
  }
  // Atualiza campos automáticos e separa quem precisa (re)entrar na ordem.
  const reinserir: Array<{ id: string; reservaId: string; bairroId: string | null; titular: string }> = [];
  const mantidos = new Map<string, LinhaTr>(); // existentes ativos que ficam onde estão
  for (const { reserva: r, assentos } of elegiveis) {
    const e = porReserva.get(r.id);
    const bairro = escolherBairro(bairrosCore, { pontoEmbarqueId: r.pontoEmbarqueId, hospedagem: r.hospedagemInformada });
    const taxaCalculada = calcularTaxa(cfg.taxaPorPassageiroCentavos, assentos);
    if (!e) {
      const [n] = await db.insert(transferReservas).values({
        transferDiaId: diaId, reservaId: r.id, bairroId: bairro?.id ?? null, enderecoBusca: r.hospedagemInformada, taxaCentavos: taxaCalculada,
        ordem: 9999,
      }).returning();
      reinserir.push({ id: n!.id, reservaId: r.id, bairroId: n!.bairroId, titular: r.contatoNome });
      criadas++;
      continue;
    }
    const mud: Partial<LinhaTr> = {};
    if (!e.ativo) mud.ativo = true;
    if (!e.editados.includes("bairro") && (bairro?.id ?? null) !== e.bairroId) mud.bairroId = bairro?.id ?? null;
    if (!e.editados.includes("endereco") && (r.hospedagemInformada ?? null) !== e.enderecoBusca) mud.enderecoBusca = r.hospedagemInformada;
    if (!e.editados.includes("taxa") && e.taxaSituacao === "A_RECEBER" && taxaCalculada !== e.taxaCentavos) mud.taxaCentavos = taxaCalculada;
    const mudouBairro = "bairroId" in mud || !e.ativo;
    if (Object.keys(mud).length) {
      await db.update(transferReservas).set({ ...mud, atualizadoEm: new Date() }).where(eq(transferReservas.id, e.id));
      atualizadas++;
    }
    const atual = { ...e, ...mud } as LinhaTr;
    if (mudouBairro) reinserir.push({ id: e.id, reservaId: r.id, bairroId: atual.bairroId, titular: r.contatoNome });
    else mantidos.set(e.id, atual);
  }
  if (criadas || atualizadas || removidas || novo) {
    const titulares = new Map(elegiveis.map((e) => [e.reserva.id, e.reserva.contatoNome]));
    let ordem = [...mantidos.values()].sort((a, b) => a.ordem - b.ordem)
      .map((e) => ({ id: e.id, bairroOrdem: ordemDoBairro(e.bairroId), titular: titulares.get(e.reservaId) ?? "" }));
    for (const n of ordenarBusca(reinserir.map((x) => ({ id: x.id, bairroOrdem: ordemDoBairro(x.bairroId), titular: x.titular })))) ordem = inserirNaOrdem(ordem, n);
    await aplicarOrdem(db, diaId, ordem.map((o) => o.id));
  }
  return { diaId, novo, criadas, atualizadas, removidas };
}

/** Grava a ordem (ids da primeira à última parada) e recalcula os horários de busca que não foram digitados à mão. */
export async function aplicarOrdem(db: Db, diaId: string, idsEmOrdem: string[]) {
  const [dia] = await db.select({ saidaId: transferDias.saidaId }).from(transferDias).where(eq(transferDias.id, diaId));
  const [s] = await db.select({ passeioId: saidas.passeioId }).from(saidas).where(eq(saidas.id, dia!.saidaId));
  const cfg = await configDoPasseio(db, s!.passeioId);
  const bairros = await bairrosDoPasseio(db, s!.passeioId, false);
  const linhas = await db.select().from(transferReservas).where(eq(transferReservas.transferDiaId, diaId));
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const ordenadas = idsEmOrdem.map((i) => porId.get(i)).filter((l): l is LinhaTr => !!l);
  const horarios = calcularHorariosBusca(ordenadas.map((l) => {
    const b = bairros.find((x) => x.id === l.bairroId);
    return { bairroId: l.bairroId, horarioBairro: b?.horarioReferencia ?? null, horarioManual: l.editados.includes("horario") ? l.horarioBusca : null };
  }), cfg.intervaloMinutos);
  for (const [i, l] of ordenadas.entries()) {
    if (l.ordem !== i || l.horarioBusca !== horarios[i]) {
      await db.update(transferReservas).set({ ordem: i, horarioBusca: horarios[i] ?? null, atualizadoEm: new Date() }).where(eq(transferReservas.id, l.id));
    }
  }
}

/** Reordena tudo pela ordem automática (bairros do mais longe ao mais perto, depois titular). Mantém horários digitados. */
export async function recalcularOrdem(db: Db, diaId: string) {
  const linhas = await linhasAtivas(db, diaId);
  const bairros = await db.select().from(transferBairros);
  const ordem = ordenarBusca(linhas.map((l) => ({ id: l.tr.id, bairroOrdem: bairros.find((b) => b.id === l.tr.bairroId)?.ordemBusca ?? null, titular: l.reserva.contatoNome })));
  await aplicarOrdem(db, diaId, ordem.map((o) => o.id));
}

/** Move a parada para a posição indicada (0 = primeira) na ordem de busca. */
export async function moverParada(db: Db, diaId: string, trId: string, posicao: number) {
  const linhas = await linhasAtivas(db, diaId);
  const ids = linhas.map((l) => l.tr.id);
  const de = ids.indexOf(trId);
  await aplicarOrdem(db, diaId, moverItem(ids, de, posicao));
}

async function linhasAtivas(db: Db, diaId: string) {
  return db.select({ tr: transferReservas, reserva: reservas }).from(transferReservas)
    .innerJoin(reservas, eq(reservas.id, transferReservas.reservaId))
    .where(and(eq(transferReservas.transferDiaId, diaId), eq(transferReservas.ativo, true)))
    .orderBy(asc(transferReservas.ordem), asc(reservas.contatoNome));
}

export interface ReservaTransferDto {
  id: string; reservaId: string; titular: string; pax: number; assentos: number; telefone: string | null;
  bairroId: string | null; bairro: string | null; endereco: string | null; horario: string | null; horarioManual: boolean; ordem: number;
  situacao: SituacaoBusca; taxaCentavos: number; taxaForma: FormaTaxa | null; taxaSituacao: SituacaoTaxa;
  recebidoPor: string | null; recebidoEm: Date | null; observacoes: string | null;
}

/** Tudo que a tela do transfer precisa para uma saída (telefone só com `verContatos`). */
export async function carregarTransfer(db: Db, saidaId: string, opcoes: { verContatos: boolean; comOpcoes: boolean }) {
  const [linha] = await db.select({ saida: saidas, passeio: passeios }).from(saidas).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).where(eq(saidas.id, saidaId));
  if (!linha) return null;
  const { saida, passeio } = linha;
  const bairrosTodos = await bairrosDoPasseio(db, passeio.id);
  const cfg = await configDoPasseio(db, passeio.id);
  const pontos = await db.select({ id: pontosEmbarque.id, nome: pontosEmbarque.nome, horario: pontosEmbarque.horario, ehTransfer: pontosEmbarque.ehTransfer })
    .from(pontosEmbarque).where(and(eq(pontosEmbarque.passeioId, passeio.id), eq(pontosEmbarque.ativo, true))).orderBy(asc(pontosEmbarque.horario), asc(pontosEmbarque.ordem));
  const [dia] = await db.select().from(transferDias).where(eq(transferDias.saidaId, saidaId));
  const itens = dia ? await linhasAtivas(db, dia.id) : [];
  const idsRes = itens.map((i) => i.reserva.id);
  const pax = idsRes.length ? await db.select({ reservaId: passageiros.reservaId, categoria: passageiros.categoria }).from(passageiros).where(inArray(passageiros.reservaId, idsRes)) : [];
  const usuariosIds = [...new Set(itens.map((i) => i.tr.recebidoPor).filter((x): x is string => !!x))];
  const nomesUsuarios = usuariosIds.length ? await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(inArray(usuarios.id, usuariosIds)) : [];
  const elegiveis = bairrosTodos.length ? await reservasElegiveis(db, saidaId) : [];
  const noTransfer = new Set(itens.map((i) => i.reserva.id));

  const reservasDto: ReservaTransferDto[] = itens.map(({ tr, reserva }) => {
    const meus = pax.filter((p) => p.reservaId === reserva.id);
    return {
      id: tr.id, reservaId: reserva.id, titular: reserva.contatoNome, pax: meus.length, assentos: meus.filter((p) => p.categoria !== "COLO").length,
      telefone: opcoes.verContatos ? reserva.contatoTelefone : null,
      bairroId: tr.bairroId, bairro: bairrosTodos.find((b) => b.id === tr.bairroId)?.nome ?? null,
      endereco: tr.enderecoBusca, horario: tr.horarioBusca, horarioManual: tr.editados.includes("horario"), ordem: tr.ordem,
      situacao: tr.situacao as SituacaoBusca, taxaCentavos: tr.taxaCentavos, taxaForma: tr.taxaForma as FormaTaxa | null, taxaSituacao: tr.taxaSituacao as SituacaoTaxa,
      recebidoPor: nomesUsuarios.find((u) => u.id === tr.recebidoPor)?.nome ?? null, recebidoEm: tr.recebidoEm, observacoes: reserva.observacoes,
    };
  });

  let motorista: string | null = null;
  let veiculo: string | null = dia?.veiculoTexto ?? null;
  let veiculoCapacidade: number | null = null;
  if (dia?.motoristaId) motorista = (await db.select({ nome: pessoas.nome }).from(pessoas).where(eq(pessoas.id, dia.motoristaId)))[0]?.nome ?? null;
  if (dia?.veiculoId) {
    const [v] = await db.select({ placa: veiculos.placa, apelido: veiculos.apelido, capacidade: veiculos.capacidade }).from(veiculos).where(eq(veiculos.id, dia.veiculoId));
    if (v) { veiculo = v.apelido ? `${v.apelido} (${v.placa})` : v.placa; veiculoCapacidade = v.capacidade; }
  }
  const encontroId = dia?.pontoEncontroId ?? cfg.pontoEncontroId;
  const encontro = pontos.find((p) => p.id === encontroId) ?? null;
  const totais = {
    reservas: reservasDto.length,
    pax: reservasDto.reduce((t, r) => t + r.pax, 0),
    assentos: reservasDto.reduce((t, r) => t + r.assentos, 0),
    buscados: reservasDto.filter((r) => r.situacao === "BUSCADO").length,
    naoApareceram: reservasDto.filter((r) => r.situacao === "NAO_APARECEU").length,
    taxa: totaisTaxa(reservasDto.map((r) => ({ situacao: r.situacao, taxaCentavos: r.taxaCentavos, forma: r.taxaForma, taxaSituacao: r.taxaSituacao }))),
  };
  const lugares = dia?.lugares ?? null;
  const alertas: string[] = [];
  if (dia && !dia.motoristaId) alertas.push("Motorista do transfer não definido.");
  if (dia && !veiculo) alertas.push("Veículo do transfer não definido.");
  if (dia && !encontro) alertas.push("Ponto de encontro com o ônibus não definido.");
  if (lugares && totais.assentos > lugares) alertas.push(`${totais.assentos} passageiros para ${lugares} lugares: falta lugar na van.`);
  const semBairro = reservasDto.filter((r) => !r.bairroId).length;
  if (semBairro) alertas.push(`${semBairro} reserva(s) sem bairro definido: escolha o bairro para entrar na ordem de busca.`);
  const semHotel = reservasDto.filter((r) => !r.endereco).length;
  if (semHotel) alertas.push(`${semHotel} reserva(s) sem hotel/endereço de busca.`);

  return {
    habilitado: bairrosTodos.length > 0,
    saida: { id: saida.id, data: saida.data, status: saida.status, passeioId: passeio.id, passeio: passeio.nome, unidadeId: passeio.unidadeId, listaFechadaEm: saida.listaFechadaEm },
    config: { taxaPorPassageiroCentavos: cfg.taxaPorPassageiroCentavos, taxaAConfirmar: cfg.taxaAConfirmar, intervaloMinutos: cfg.intervaloMinutos },
    dia: dia ? {
      id: dia.id, veiculoId: dia.veiculoId, veiculoTexto: dia.veiculoTexto, veiculo, veiculoCapacidade, motoristaId: dia.motoristaId, motorista, lugares,
      pontoEncontroId: dia.pontoEncontroId, chegadaPrevista: dia.chegadaPrevista, observacoes: dia.observacoes,
    } : null,
    encontro: encontro ? { id: encontro.id, nome: encontro.nome, horario: dia?.chegadaPrevista ?? cfg.chegadaPrevista ?? encontro.horario } : null,
    pontosEncontro: pontos.filter((p) => !p.ehTransfer).map(({ id, nome, horario }) => ({ id, nome, horario })),
    bairros: bairrosTodos.map((b) => ({ id: b.id, nome: b.nome, ordemBusca: b.ordemBusca, horarioReferencia: b.horarioReferencia })),
    reservas: reservasDto,
    candidatas: elegiveis.filter((e) => !noTransfer.has(e.reserva.id)).length,
    totais,
    alertas,
    opcoes: opcoes.comOpcoes ? await opcoesDoTransfer(db, passeio.unidadeId) : null,
  };
}

async function opcoesDoTransfer(db: Db, unidadeId: string) {
  const pes = await db.select({ id: pessoas.id, nome: pessoas.nome, papeis: pessoas.papeis, unidadeId: pessoas.unidadeId }).from(pessoas).where(eq(pessoas.ativo, true)).orderBy(asc(pessoas.nome));
  const veic = await db.select({ id: veiculos.id, placa: veiculos.placa, apelido: veiculos.apelido, capacidade: veiculos.capacidade }).from(veiculos)
    .where(and(eq(veiculos.unidadeId, unidadeId), eq(veiculos.situacao, "ATIVO"))).orderBy(asc(veiculos.placa));
  return {
    motoristas: pes.filter((p) => p.papeis.includes("MOTORISTA") && (!p.unidadeId || p.unidadeId === unidadeId)).map(({ id, nome }) => ({ id, nome })),
    veiculos: veic,
  };
}

/** Quem vem de transfer e onde todos encontram o ônibus, para a lista de passageiros (texto, tela e impressão). Sem gravar nada. */
export async function transferNaLista(db: Db, saidaId: string): Promise<{ lista: TransferNaLista; porReserva: Record<string, { bairro: string | null; horario: string | null; local: string | null; taxaACobrarCentavos: number }> } | null> {
  const dto = await carregarTransfer(db, saidaId, { verContatos: false, comOpcoes: false });
  if (!dto?.habilitado) return null;
  const [s] = await db.select({ passeioId: saidas.passeioId }).from(saidas).where(eq(saidas.id, saidaId));
  const bairros = (await bairrosDoPasseio(db, s!.passeioId)).map(paraCore);
  const elegiveis = await reservasElegiveis(db, saidaId);
  if (!elegiveis.length) return null;
  const porReserva = new Map<string, { bairro: string | null; horario: string | null; local: string | null; taxaACobrarCentavos: number }>();
  for (const { reserva } of elegiveis) {
    const noDia = dto.reservas.find((r) => r.reservaId === reserva.id);
    const bairro = noDia ? noDia.bairro : escolherBairro(bairros, { pontoEmbarqueId: reserva.pontoEmbarqueId, hospedagem: reserva.hospedagemInformada })?.nome ?? null;
    porReserva.set(reserva.id, {
      bairro,
      horario: noDia?.horario ?? null,
      local: noDia?.endereco ?? reserva.hospedagemInformada ?? bairro,
      // Taxa a cobrar na hora só quando ainda não foi paga nem está incluída no passeio.
      taxaACobrarCentavos: noDia && noDia.taxaSituacao === "A_RECEBER" && noDia.taxaForma !== "INCLUIDO_NO_PASSEIO" ? noDia.taxaCentavos : 0,
    });
  }
  const lista = { encontro: dto.encontro ? { nome: dto.encontro.nome, horario: dto.encontro.horario } : null, porReserva: new Map([...porReserva].map(([k, v]) => [k, { bairro: v.bairro }])) };
  return { lista, porReserva: Object.fromEntries(porReserva) };
}

/** Texto da lista do transfer (WhatsApp do motorista). Telefones só com `contatos`. */
export async function textoDoTransfer(db: Db, saidaId: string, contatos: boolean): Promise<string | null> {
  const dto = await carregarTransfer(db, saidaId, { verContatos: contatos, comOpcoes: false });
  if (!dto?.dia || !dto.reservas.length) return null;
  return textoListaTransfer(
    { passeio: dto.saida.passeio, data: dto.saida.data, motorista: dto.dia.motorista, veiculo: dto.dia.veiculo, lugares: dto.dia.lugares, encontro: dto.encontro },
    dto.reservas.map((r) => ({ horario: r.horario, bairro: r.bairro, endereco: r.endereco, titular: r.titular, pax: r.pax, telefone: r.telefone, situacao: r.situacao, taxaCentavos: r.taxaCentavos, forma: r.taxaForma, taxaSituacao: r.taxaSituacao })),
  );
}

/** Mensagem automática para o motorista do transfer (sem telefones de passageiros: mínimo de dados no WhatsApp). */
export async function mensagemDoMotoristaTransfer(db: Db, saidaId: string): Promise<{ destino: string | null; texto: string } | null> {
  const texto = await textoDoTransfer(db, saidaId, false);
  if (!texto) return null;
  const [dia] = await db.select({ motoristaId: transferDias.motoristaId }).from(transferDias).where(eq(transferDias.saidaId, saidaId));
  const [m] = dia?.motoristaId ? await db.select({ telefone: pessoas.telefone }).from(pessoas).where(eq(pessoas.id, dia.motoristaId)) : [];
  return { destino: m?.telefone ?? null, texto };
}

/** A reserva mudou (ponto, hospedagem, passageiros, cancelamento): atualiza o transfer do dia, se já existir. */
export async function atualizarTransferDaReserva(db: Db, req: FastifyRequest | null, reservaId: string) {
  const [r] = await db.select({ saidaId: reservas.saidaId }).from(reservas).where(eq(reservas.id, reservaId));
  if (!r) return null;
  const resumo = await sincronizarTransfer(db, r.saidaId, false);
  if (resumo && (resumo.criadas || resumo.atualizadas || resumo.removidas)) {
    await auditar(db, req, "TRANSFER_ATUALIZADO", { tipo: "saida", id: r.saidaId }, { motivo: "reserva_alterada", reservaId, criadas: resumo.criadas, atualizadas: resumo.atualizadas, removidas: resumo.removidas });
  }
  return resumo;
}

/** Bairros de transfer padrão do City Tour Toda Ilha, a partir dos pontos de transfer já cadastrados (ordem e horários editáveis). */
export async function semearTransferPadrao(db: Db, passeioId: string) {
  const [ja] = await db.select({ n: sql<number>`count(*)::int` }).from(transferBairros).where(eq(transferBairros.passeioId, passeioId));
  if (ja && ja.n > 0) return;
  const pontos = await db.select().from(pontosEmbarque).where(and(eq(pontosEmbarque.passeioId, passeioId), eq(pontosEmbarque.ehTransfer, true)));
  if (!pontos.length) return;
  const ponto = (trecho: string) => pontos.find((p) => p.nome.toLowerCase().includes(trecho))?.id ?? null;
  // Bairros e horários-base confirmados pelo dono em 05/11/2026 (do mais longe do centro para o mais perto). São uma base:
  // o horário real de cada busca depende da quantidade de pessoas e dos hotéis e é confirmado no fechamento das 21h da véspera.
  const padrao = [
    { nome: "Ingleses", ponto: "ingleses", horario: "06:40", aConfirmar: false },
    { nome: "Cachoeira do Bom Jesus", ponto: "cachoeira", horario: "06:50", aConfirmar: false },
    { nome: "Canasvieiras", ponto: "canasvieiras", horario: "07:00", aConfirmar: false },
    { nome: "Jurerê", ponto: "jurer", horario: "07:10", aConfirmar: false },
  ];
  await db.insert(transferBairros).values(padrao.map((b, i) => ({ passeioId, nome: b.nome, ordemBusca: i + 1, horarioReferencia: b.horario, horarioAConfirmar: b.aConfirmar, pontoEmbarqueId: ponto(b.ponto) }))).onConflictDoNothing();
  const [villa] = await db.select({ id: pontosEmbarque.id }).from(pontosEmbarque).where(and(eq(pontosEmbarque.passeioId, passeioId), eq(pontosEmbarque.ehTransfer, false), sql`lower(${pontosEmbarque.nome}) like '%villa romana%'`));
  await db.insert(transferConfig).values({ passeioId, pontoEncontroId: villa?.id ?? null }).onConflictDoNothing();
}
