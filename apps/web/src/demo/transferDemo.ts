/**
 * Transfer da demonstração: o transfer FICTÍCIO de amanhã (8 reservas em Ingleses (com Santinho), Cachoeira, Canasvieiras e Jurerê,
 * hotéis fictícios, taxas a receber e já recebidas). Usa as mesmas regras do sistema (@bybus/core). Nada sai de verdade.
 */
import { calcularHorariosBusca, calcularTaxa, moverItem, ordenarBusca, textoListaTransfer, totaisTaxa, type FormaTaxa, type SituacaoBusca, type SituacaoTaxa } from "@bybus/core";
import { NAO, type Corpo, type Ctx, type Rotear } from "./comum";

export interface ReservaDemoTransfer { id: string; saidaId: string; status: string; pontoEmbarqueId: string | null; contatoNome: string; contatoTelefone: string | null; observacoes: string | null }
export interface DepsTransferDemo {
  passeio: { id: string; nome: string; unidadeId: string };
  podeUnidade(unidadeId: string): boolean;
  pode(permissao: string): boolean;
  /** Pessoa (motorista) ligada ao usuário logado, se houver. */
  pessoaDoUsuario(): string | null;
  usuarioNome(): string;
  saidaDe(passeioId: string, data: string): { id: string; data: string; status: string } | undefined;
  reservas(): ReservaDemoTransfer[];
  paxDe(reservaId: string): Array<{ categoria: string }>;
  pontos(): Array<{ id: string; nome: string; horario: string; ehTransfer: boolean }>;
  criarReserva(saidaId: string, d: { titular: string; telefone: string; pontoId: string; categorias: string[] }): string;
  motoristas(): Array<{ id: string; nome: string }>;
}

interface Bairro { id: string; nome: string; ordemBusca: number; horarioReferencia: string | null; horarioAConfirmar: boolean; pontoEmbarqueId: string | null; ativo: boolean }
interface Parada {
  id: string; reservaId: string; bairroId: string | null; endereco: string | null; horarioManual: string | null; horario: string | null; ordem: number;
  situacao: SituacaoBusca; taxaCentavos: number; taxaForma: FormaTaxa | null; taxaSituacao: SituacaoTaxa; recebidoPor: string | null; recebidoEm: string | null; editados: string[];
}

const HOTEIS = ["Pousada Mar Azul (fictícia)", "Hotel Sol Nascente (fictício)", "Residencial Brisa do Norte (fictício)", "Apart Praia Grande (fictício)", "Pousada Jurerê Sul (fictícia)", "Hotel Costa Norte (fictício)", "Pousada das Dunas (fictícia)", "Hotel Beira Mar Fictício"];
const NOVOS = [
  { titular: "Helena Prado Fictícia", pontoIdx: 0, categorias: ["ADULTO", "ADULTO"], hotel: "Pousada Santinho Azul (fictícia)" },
  { titular: "Otávio Lima Fictício", pontoIdx: 3, categorias: ["ADULTO", "INFANTIL", "COLO"], hotel: "Hotel Jurerê Mar (fictício)" },
  { titular: "Priscila Rocha Fictícia", pontoIdx: 2, categorias: ["ADULTO"], hotel: "Apart Canasvieiras Sol (fictício)" },
  { titular: "Ricardo Alves Fictício", pontoIdx: 0, categorias: ["ADULTO", "SENIOR"], hotel: "Pousada Ingleses do Norte (fictícia)" },
];

export function criarTransferDemo(d: DepsTransferDemo) {
  const bairros: Bairro[] = [
    // Bairros e horários-base do dono (05/11/2026); Santinho fica dentro de Ingleses.
    { id: "tb-2", nome: "Ingleses", ordemBusca: 1, horarioReferencia: "06:40", horarioAConfirmar: false, pontoEmbarqueId: null, ativo: true },
    { id: "tb-3", nome: "Cachoeira do Bom Jesus", ordemBusca: 2, horarioReferencia: "06:50", horarioAConfirmar: false, pontoEmbarqueId: null, ativo: true },
    { id: "tb-4", nome: "Canasvieiras", ordemBusca: 3, horarioReferencia: "07:00", horarioAConfirmar: false, pontoEmbarqueId: null, ativo: true },
    { id: "tb-5", nome: "Jurerê", ordemBusca: 4, horarioReferencia: "07:10", horarioAConfirmar: false, pontoEmbarqueId: null, ativo: true },
  ];
  const config = { taxaPorPassageiroCentavos: 4000, taxaAConfirmar: true, intervaloMinutos: 5, pontoEncontroId: null as string | null, chegadaPrevista: null as string | null, motoristaPadraoId: "pe-davi" as string | null, veiculoPadraoId: null as string | null, veiculoPadraoTexto: "Van fictícia ZZZ0Z00" as string | null, lugaresPadrao: 15 as number | null };
  const dia = { id: "tdia-1", saidaId: "", veiculoTexto: config.veiculoPadraoTexto, motoristaId: config.motoristaPadraoId, lugares: config.lugaresPadrao, pontoEncontroId: null as string | null, chegadaPrevista: null as string | null, observacoes: null as string | null };
  let paradas: Parada[] = [];
  let pronto = false;
  let seq = 1;

  const assentos = (reservaId: string) => d.paxDe(reservaId).filter((p) => p.categoria !== "COLO").length;
  const reserva = (id: string) => d.reservas().find((r) => r.id === id);
  const horarioDe = (b: Bairro | undefined) => b?.horarioReferencia ?? null;

  /** Cria as reservas fictícias extras e monta as paradas na primeira vez que alguém abre o transfer. */
  function iniciar() {
    if (pronto) return;
    pronto = true;
    const pontos = d.pontos();
    const pontosTransfer = pontos.filter((p) => p.ehTransfer);
    const villa = pontos.find((p) => /villa romana/i.test(p.nome));
    bairros.forEach((b, i) => { b.pontoEmbarqueId = pontosTransfer[i]?.id ?? null; });
    config.pontoEncontroId = villa?.id ?? null;
    dia.pontoEncontroId = config.pontoEncontroId;
    const amanha = d.saidaDe(d.passeio.id, diaData());
    if (!amanha) return;
    dia.saidaId = amanha.id;
    const hoteisDe = new Map<string, string>();
    NOVOS.forEach((n, i) => {
      const id = d.criarReserva(amanha.id, { titular: n.titular, telefone: `+55 48 91111-${String(2000 + i).slice(-4)}`, pontoId: pontosTransfer[n.pontoIdx]?.id ?? "", categorias: n.categorias });
      hoteisDe.set(id, n.hotel);
    });
    const elegiveis = d.reservas().filter((r) => r.saidaId === amanha.id && r.status === "CONFIRMADA" && pontosTransfer.some((p) => p.id === r.pontoEmbarqueId));
    paradas = elegiveis.map((r, i) => {
      const doPonto = bairros.filter((b) => b.pontoEmbarqueId === r.pontoEmbarqueId);
      const endereco = hoteisDe.get(r.id) ?? HOTEIS[i % HOTEIS.length]!;
      // Ponto compartilhado por dois bairros: o hotel cita o bairro (como no sistema); senão, o primeiro na ordem de busca.
      const b = doPonto.find((x) => endereco.toLowerCase().includes(x.nome.split(" ")[0]!.toLowerCase())) ?? doPonto[0];
      return {
        id: `tr-${seq++}`, reservaId: r.id, bairroId: b?.id ?? null, endereco, horarioManual: null, horario: null, ordem: 0, situacao: "CONFIRMADO" as SituacaoBusca,
        taxaCentavos: calcularTaxa(config.taxaPorPassageiroCentavos, assentos(r.id)), taxaForma: null, taxaSituacao: "A_RECEBER" as SituacaoTaxa, recebidoPor: null, recebidoEm: null, editados: [],
      };
    });
    reordenar(true);
    // Um pouco de movimento fictício: taxas já recebidas e uma busca ainda sem confirmação do cliente.
    if (paradas[0]) Object.assign(paradas[0], { taxaForma: "PIX", taxaSituacao: "RECEBIDO", recebidoPor: "Motorista Demo", recebidoEm: new Date().toISOString(), situacao: "BUSCADO" });
    if (paradas[1]) Object.assign(paradas[1], { taxaForma: "DINHEIRO", taxaSituacao: "RECEBIDO", recebidoPor: "Motorista Demo", recebidoEm: new Date().toISOString(), situacao: "BUSCADO" });
    if (paradas[2]) paradas[2]!.situacao = "A_CONFIRMAR";
    if (paradas[3]) { paradas[3]!.taxaForma = "INCLUIDO_NO_PASSEIO"; paradas[3]!.taxaSituacao = "RECEBIDO"; }
  }

  function horarios() {
    const lista = ordenadas();
    const hs = calcularHorariosBusca(lista.map((p) => ({ bairroId: p.bairroId, horarioBairro: horarioDe(bairros.find((b) => b.id === p.bairroId)), horarioManual: p.horarioManual })), config.intervaloMinutos);
    lista.forEach((p, i) => { p.horario = hs[i] ?? null; });
  }
  const ordenadas = () => [...paradas].sort((a, b) => a.ordem - b.ordem);
  function reordenar(automatica: boolean, ids?: string[]) {
    const lista = ids ? ids.map((i) => paradas.find((p) => p.id === i)!) : automatica
      ? ordenarBusca(paradas.map((p) => ({ id: p.id, bairroOrdem: bairros.find((b) => b.id === p.bairroId)?.ordemBusca ?? null, titular: reserva(p.reservaId)?.contatoNome ?? "" }))).map((x) => paradas.find((p) => p.id === x.id)!)
      : ordenadas();
    lista.forEach((p, i) => { p.ordem = i; });
    horarios();
  }

  function dto(_ctx?: Ctx) {
    iniciar();
    const verContatos = d.pode("manifesto:contatos");
    const lista = ordenadas();
    const pontos = d.pontos();
    const reservasDto = lista.map((p) => {
      const r = reserva(p.reservaId)!;
      const pax = d.paxDe(r.id).length;
      return {
        id: p.id, reservaId: r.id, titular: r.contatoNome, pax, assentos: assentos(r.id), telefone: verContatos ? r.contatoTelefone : null,
        bairroId: p.bairroId, bairro: bairros.find((b) => b.id === p.bairroId)?.nome ?? null, endereco: p.endereco, horario: p.horario, horarioManual: !!p.horarioManual, ordem: p.ordem,
        situacao: p.situacao, taxaCentavos: p.taxaCentavos, taxaForma: p.taxaForma, taxaSituacao: p.taxaSituacao, recebidoPor: p.recebidoPor, recebidoEm: p.recebidoEm, observacoes: r.observacoes,
      };
    });
    const encontro = pontos.find((p) => p.id === dia.pontoEncontroId) ?? null;
    const motorista = d.motoristas().find((m) => m.id === dia.motoristaId)?.nome ?? null;
    const totais = {
      reservas: reservasDto.length, pax: reservasDto.reduce((t, r) => t + r.pax, 0), assentos: reservasDto.reduce((t, r) => t + r.assentos, 0),
      buscados: reservasDto.filter((r) => r.situacao === "BUSCADO").length, naoApareceram: reservasDto.filter((r) => r.situacao === "NAO_APARECEU").length,
      taxa: totaisTaxa(reservasDto.map((r) => ({ situacao: r.situacao, taxaCentavos: r.taxaCentavos, forma: r.taxaForma, taxaSituacao: r.taxaSituacao }))),
    };
    const alertas: string[] = [];
    if (dia.lugares && totais.assentos > dia.lugares) alertas.push(`${totais.assentos} passageiros para ${dia.lugares} lugares: falta lugar na van.`);
    return {
      habilitado: true,
      saida: { id: dia.saidaId, data: diaData(), status: "PREVISTA", passeioId: d.passeio.id, passeio: d.passeio.nome, unidadeId: d.passeio.unidadeId, listaFechadaEm: null },
      config: { taxaPorPassageiroCentavos: config.taxaPorPassageiroCentavos, taxaAConfirmar: config.taxaAConfirmar, intervaloMinutos: config.intervaloMinutos },
      dia: { id: dia.id, veiculoId: null, veiculoTexto: dia.veiculoTexto, veiculo: dia.veiculoTexto, veiculoCapacidade: null, motoristaId: dia.motoristaId, motorista, lugares: dia.lugares, pontoEncontroId: dia.pontoEncontroId, chegadaPrevista: dia.chegadaPrevista, observacoes: dia.observacoes },
      encontro: encontro ? { id: encontro.id, nome: encontro.nome, horario: dia.chegadaPrevista ?? config.chegadaPrevista ?? encontro.horario } : null,
      pontosEncontro: pontos.filter((p) => !p.ehTransfer).map(({ id, nome, horario }) => ({ id, nome, horario })),
      bairros: bairros.filter((b) => b.ativo).map(({ id, nome, ordemBusca, horarioReferencia }) => ({ id, nome, ordemBusca, horarioReferencia })),
      reservas: reservasDto, candidatas: 0, totais, alertas,
      opcoes: d.pode("transfer:gerenciar") ? { motoristas: d.motoristas(), veiculos: [] } : null,
    };
  }
  const diaData = () => new Date(Date.now() + 86_400_000).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

  function parada(ctx: Ctx, id: string, gestao: boolean) {
    iniciar();
    const p = paradas.find((x) => x.id === id);
    if (!p) throw ctx.erro(404, "NAO_ENCONTRADO", "Parada do transfer não encontrada.");
    if (gestao) ctx.exigir("transfer:gerenciar");
    else if (!d.pode("transfer:gerenciar")) {
      ctx.exigir("transfer:operar");
      if (d.pessoaDoUsuario() !== dia.motoristaId) throw ctx.erro(403, "NAO_E_O_MOTORISTA", "Só o motorista escalado no transfer deste dia pode registrar a busca e a taxa.");
    }
    return p;
  }
  const texto = (contatos: boolean) => {
    iniciar();
    const r = dto();
    return textoListaTransfer(
      { passeio: r.saida.passeio, data: r.saida.data, motorista: r.dia.motorista, veiculo: r.dia.veiculo, lugares: r.dia.lugares, encontro: r.encontro },
      r.reservas.map((x) => ({ horario: x.horario, bairro: x.bairro, endereco: x.endereco, titular: x.titular, pax: x.pax, telefone: contatos ? x.telefone : null, situacao: x.situacao, taxaCentavos: x.taxaCentavos, forma: x.taxaForma, taxaSituacao: x.taxaSituacao })),
    );
  };

  const rotear: Rotear = (ctx: Ctx, metodo: string, caminho: string, q: URLSearchParams, c: Corpo) => {
    let m: RegExpMatchArray | null;
    if (metodo === "GET" && caminho === "/api/transfer/passeios") {
      ctx.exigir("manifesto:ver");
      return d.podeUnidade(d.passeio.unidadeId) ? [{ id: d.passeio.id, nome: d.passeio.nome, unidadeId: d.passeio.unidadeId }] : [];
    }
    if (metodo === "GET" && caminho === "/api/transfer") {
      ctx.exigir("manifesto:ver");
      if (q.get("passeioId") !== d.passeio.id || !d.podeUnidade(d.passeio.unidadeId)) throw ctx.erro(404, "NAO_ENCONTRADO", "Passeio não encontrado(a).");
      const data = q.get("data") ?? ctx.dataMais(1);
      const saida = d.saidaDe(d.passeio.id, data);
      if (!saida) return { habilitado: true, saida: null, data };
      iniciar();
      if (saida.id !== dia.saidaId) return { habilitado: true, saida: { id: saida.id, data, status: saida.status, passeioId: d.passeio.id, passeio: d.passeio.nome, unidadeId: d.passeio.unidadeId, listaFechadaEm: null }, dia: null, reservas: [], candidatas: 0, data };
      return { ...dto(ctx), data };
    }
    if (metodo === "POST" && caminho === "/api/transfer/montar") {
      ctx.exigir("transfer:gerenciar");
      iniciar();
      if (c.saidaId !== dia.saidaId) throw ctx.erro(409, "SO_AMANHA", "Na demonstração, o transfer fictício existe só para amanhã.");
      ctx.auditar("TRANSFER_MONTADO", "saida", dia.saidaId);
      return dto(ctx);
    }
    if (metodo === "PATCH" && (m = caminho.match(/^\/api\/transfer\/dias\/([^/]+)$/))) {
      ctx.exigir("transfer:gerenciar");
      iniciar();
      for (const k of ["motoristaId", "lugares", "pontoEncontroId", "chegadaPrevista", "observacoes"] as const) if (k in c) (dia as Record<string, unknown>)[k] = c[k];
      if ("veiculoTexto" in c || "veiculoId" in c) dia.veiculoTexto = c.veiculoTexto ?? null;
      ctx.auditar("TRANSFER_DIA_ALTERADO", "transfer", dia.id, { campos: Object.keys(c) });
      return dto(ctx);
    }
    if (metodo === "POST" && (m = caminho.match(/^\/api\/transfer\/dias\/([^/]+)\/recalcular-ordem$/))) {
      ctx.exigir("transfer:gerenciar");
      iniciar();
      reordenar(true);
      ctx.auditar("TRANSFER_ORDEM_RECALCULADA", "transfer", dia.id);
      return dto(ctx);
    }
    if (metodo === "POST" && (m = caminho.match(/^\/api\/transfer\/reservas\/([^/]+)\/mover$/))) {
      const p = parada(ctx, m[1]!, true);
      const ids = ordenadas().map((x) => x.id);
      reordenar(false, moverItem(ids, ids.indexOf(p.id), Number(c.posicao)));
      ctx.auditar("TRANSFER_ORDEM_ALTERADA", "transfer", dia.id);
      return dto(ctx);
    }
    if (metodo === "PATCH" && (m = caminho.match(/^\/api\/transfer\/reservas\/([^/]+)$/))) {
      const p = parada(ctx, m[1]!, true);
      if ("enderecoBusca" in c) p.endereco = c.enderecoBusca || p.endereco;
      if ("horarioBusca" in c) p.horarioManual = c.horarioBusca ?? null;
      if ("bairroId" in c) p.bairroId = c.bairroId ?? p.bairroId;
      if ("taxaCentavos" in c) {
        if (p.taxaSituacao === "RECEBIDO") throw ctx.erro(409, "TAXA_JA_RECEBIDA", "A taxa já foi recebida: desfaça o recebimento antes de alterar o valor.");
        p.taxaCentavos = Number(c.taxaCentavos);
      }
      if ("incluidoNoPasseio" in c) {
        if (c.incluidoNoPasseio) Object.assign(p, { taxaForma: "INCLUIDO_NO_PASSEIO", taxaSituacao: "RECEBIDO", recebidoPor: null });
        else if (p.taxaForma === "INCLUIDO_NO_PASSEIO") Object.assign(p, { taxaForma: null, taxaSituacao: "A_RECEBER" });
      }
      if ("bairroId" in c) reordenar(false, ordenarBusca(paradas.map((x) => ({ id: x.id, bairroOrdem: bairros.find((b) => b.id === x.bairroId)?.ordemBusca ?? null, titular: reserva(x.reservaId)?.contatoNome ?? "" }))).map((x) => x.id));
      else reordenar(false);
      ctx.auditar("taxaCentavos" in c ? "TRANSFER_COBRANCA_ALTERADA" : "TRANSFER_PARADA_ALTERADA", "transfer", dia.id, { campos: Object.keys(c) });
      return dto(ctx);
    }
    if (metodo === "POST" && (m = caminho.match(/^\/api\/transfer\/reservas\/([^/]+)\/situacao$/))) {
      const p = parada(ctx, m[1]!, false);
      if (!d.pode("transfer:gerenciar") && !["BUSCADO", "NAO_APARECEU", "CONFIRMADO"].includes(c.situacao)) throw ctx.erro(403, "SEM_PERMISSAO", "O motorista só pode marcar buscado, não apareceu ou desfazer.");
      ctx.auditar("TRANSFER_SITUACAO_ALTERADA", "transfer", dia.id, { antes: p.situacao, depois: c.situacao });
      p.situacao = c.situacao;
      return dto(ctx);
    }
    if (metodo === "POST" && (m = caminho.match(/^\/api\/transfer\/reservas\/([^/]+)\/recebimento$/))) {
      const p = parada(ctx, m[1]!, false);
      if (p.taxaSituacao === "RECEBIDO") throw ctx.erro(409, "JA_RECEBIDA", "A taxa desta reserva já foi registrada como recebida.");
      if (c.valorCentavos !== undefined && c.valorCentavos !== p.taxaCentavos) throw ctx.erro(400, "VALOR_DIFERENTE", "O valor informado é diferente da taxa da reserva. Peça à supervisão para ajustar o valor.");
      Object.assign(p, { taxaSituacao: "RECEBIDO", taxaForma: c.forma, recebidoPor: d.usuarioNome(), recebidoEm: new Date().toISOString() });
      ctx.auditar("TRANSFER_TAXA_RECEBIDA", "transfer", dia.id, { valorCentavos: p.taxaCentavos, forma: c.forma });
      return dto(ctx);
    }
    if (metodo === "POST" && (m = caminho.match(/^\/api\/transfer\/reservas\/([^/]+)\/estornar$/))) {
      const p = parada(ctx, m[1]!, true);
      Object.assign(p, { taxaSituacao: "A_RECEBER", taxaForma: null, recebidoPor: null, recebidoEm: null });
      ctx.auditar("TRANSFER_TAXA_ESTORNADA", "transfer", dia.id);
      return dto(ctx);
    }
    if (metodo === "GET" && caminho === "/api/transfer/texto") {
      ctx.exigir("manifesto:ver");
      return { texto: texto(d.pode("manifesto:contatos")) };
    }
    if (metodo === "GET" && caminho === "/api/transfer/motorista") {
      ctx.exigir("transfer:operar");
      iniciar();
      const meu = d.pessoaDoUsuario() === dia.motoristaId;
      const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
      return { hoje, amanha: diaData(), transfers: meu && dia.saidaId ? [{ ...dto(ctx), opcoes: null }] : [] };
    }
    if (metodo === "GET" && (m = caminho.match(/^\/api\/passeios\/([^/]+)\/transfer$/))) {
      ctx.exigir("manifesto:ver");
      iniciar();
      if (m[1] !== d.passeio.id) return { config: { ...config }, bairros: [], pontos: [], motoristas: [], veiculos: [] };
      return {
        config: { ...config },
        bairros: bairros.filter((b) => b.ativo),
        pontos: d.pontos(), motoristas: d.motoristas(), veiculos: [],
      };
    }
    if (metodo === "PUT" && (m = caminho.match(/^\/api\/passeios\/([^/]+)\/transfer$/))) {
      ctx.exigir("transfer:gerenciar");
      iniciar();
      Object.assign(config, c.config);
      const novos: Bairro[] = (c.bairros as Array<Partial<Bairro>>).map((b, i) => ({
        id: b.id ?? `tb-${Date.now()}-${i}`, nome: String(b.nome), ordemBusca: i + 1, horarioReferencia: b.horarioReferencia ?? null, horarioAConfirmar: !!b.horarioAConfirmar || !b.horarioReferencia, pontoEmbarqueId: b.pontoEmbarqueId ?? null, ativo: true,
      }));
      bairros.splice(0, bairros.length, ...novos);
      horarios();
      ctx.auditar("TRANSFER_CONFIG_ALTERADA", "passeio", String(m[1]), { taxaPorPassageiroCentavos: config.taxaPorPassageiroCentavos });
      return { ok: true };
    }
    return NAO;
  };

  /** Quem vem de transfer na lista de passageiros (manifesto e texto), no formato da API. */
  function viaTransfer(saidaId: string) {
    iniciar();
    if (saidaId !== dia.saidaId || !paradas.length) return null;
    const encontro = d.pontos().find((p) => p.id === dia.pontoEncontroId) ?? null;
    return {
      encontro: encontro ? { nome: encontro.nome, horario: dia.chegadaPrevista ?? encontro.horario } : null,
      reservas: Object.fromEntries(paradas.map((p) => [p.reservaId, { bairro: bairros.find((b) => b.id === p.bairroId)?.nome ?? null }])),
    };
  }
  return { rotear, viaTransfer, iniciar };
}
