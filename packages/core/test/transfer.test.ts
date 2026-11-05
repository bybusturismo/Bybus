import { describe, expect, it } from "vitest";
import { calcularHorariosBusca, calcularTaxa, escolherBairro, inserirNaOrdem, moverItem, ordenarBusca, somarMinutos, textoListaGrupo, textoListaTransfer, totaisTaxa, type BairroTransfer } from "../src/index.js";

const B = (id: string, nome: string, ordemBusca: number, pontoEmbarqueId: string | null, h: string | null = null): BairroTransfer => ({ id, nome, ordemBusca, horarioReferencia: h, pontoEmbarqueId });
const bairros = [
  B("b-san", "Santinho", 1, "p-ing"), B("b-ing", "Ingleses", 2, "p-ing", "06:40"), B("b-cach", "Cachoeira do Bom Jesus", 3, "p-cach", "06:50"),
  B("b-cana", "Canasvieiras", 4, "p-cana", "07:00"), B("b-jur", "Jurerê", 5, "p-jur", "07:10"),
];

describe("bairro da reserva", () => {
  it("usa o bairro do ponto de transfer escolhido", () => {
    expect(escolherBairro(bairros, { pontoEmbarqueId: "p-cana", hospedagem: "Hotel Fictício" })?.id).toBe("b-cana");
  });
  it("ponto compartilhado por dois bairros: o citado no hotel; senão o primeiro na ordem de busca", () => {
    expect(escolherBairro(bairros, { pontoEmbarqueId: "p-ing", hospedagem: "Pousada Fictícia, Ingleses" })?.id).toBe("b-ing");
    expect(escolherBairro(bairros, { pontoEmbarqueId: "p-ing", hospedagem: "Pousada sem bairro" })?.id).toBe("b-san");
    expect(escolherBairro(bairros, { pontoEmbarqueId: "p-ing", hospedagem: null })?.id).toBe("b-san");
  });
  it("sem ponto de transfer, acha o bairro no texto (sem acento) ou devolve nulo", () => {
    expect(escolherBairro(bairros, { pontoEmbarqueId: null, hospedagem: "Residencial em JURERE" })?.id).toBe("b-jur");
    expect(escolherBairro(bairros, { pontoEmbarqueId: null, hospedagem: "Cachoeira do Bom Jesus, rua 1" })?.id).toBe("b-cach");
    expect(escolherBairro(bairros, { pontoEmbarqueId: null, hospedagem: "Centro" })).toBeNull();
    expect(escolherBairro(bairros, { pontoEmbarqueId: null, hospedagem: null })).toBeNull();
  });
  it("ignora bairros inativos", () => {
    const lista = bairros.map((b) => (b.id === "b-cana" ? { ...b, ativo: false } : b));
    expect(escolherBairro(lista, { pontoEmbarqueId: "p-cana", hospedagem: null })).toBeNull();
  });
});

describe("ordem de busca", () => {
  const it1 = (id: string, bairroOrdem: number | null, titular: string) => ({ id, bairroOrdem, titular });
  it("do mais longe para o mais perto, depois titular; sem bairro no fim", () => {
    const r = ordenarBusca([it1("1", 5, "Zé"), it1("2", null, "Ana"), it1("3", 1, "Bia"), it1("4", 1, "Ana"), it1("5", 3, "Caio")]);
    expect(r.map((x) => x.id)).toEqual(["4", "3", "5", "1", "2"]);
  });
  it("lista vazia e um só item", () => {
    expect(ordenarBusca([])).toEqual([]);
    expect(ordenarBusca([it1("1", 2, "A")])).toHaveLength(1);
  });
  it("item novo entra no grupo do bairro sem desfazer ajuste manual", () => {
    // Ordem manual: Jurerê antes de Ingleses.
    const manual = [it1("j", 5, "Jô"), it1("i", 2, "Iara")];
    const r = inserirNaOrdem(manual, it1("n", 5, "Zeca"));
    expect(r.map((x) => x.id)).toEqual(["j", "n", "i"]);
    const r2 = inserirNaOrdem([it1("a", 1, "A"), it1("c", 3, "C")], it1("b", 2, "B"));
    expect(r2.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(inserirNaOrdem([], it1("x", 1, "X")).map((x) => x.id)).toEqual(["x"]);
  });
  it("mover item respeita os limites", () => {
    expect(moverItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moverItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(moverItem([1, 2, 3], 0, -5)).toEqual([1, 2, 3]);
    expect(moverItem([1, 2, 3], 0, 99)).toEqual([2, 3, 1]);
    expect(moverItem([1, 2, 3], 9, 0)).toEqual([1, 2, 3]);
  });
});

describe("horários de busca", () => {
  it("soma minutos sem passar da meia-noite", () => {
    expect(somarMinutos("06:40", 10)).toBe("06:50");
    expect(somarMinutos("06:55", 10)).toBe("07:05");
    expect(somarMinutos("23:55", 30)).toBe("23:59");
  });
  it("primeiro de cada bairro no horário do bairro; os seguintes somam o intervalo; manual vale como está; sem horário = nulo", () => {
    const r = calcularHorariosBusca([
      { bairroId: "ing", horarioBairro: "06:40", horarioManual: null },
      { bairroId: "ing", horarioBairro: "06:40", horarioManual: null },
      { bairroId: "ing", horarioBairro: "06:40", horarioManual: "06:48" },
      { bairroId: "cach", horarioBairro: "06:50", horarioManual: null },
      { bairroId: "x", horarioBairro: null, horarioManual: null },
      { bairroId: null, horarioBairro: null, horarioManual: null },
    ], 5);
    expect(r).toEqual(["06:40", "06:45", "06:48", "06:50", null, null]);
  });
  it("ordem manual muda o horário calculado (o bairro volta a começar no horário dele)", () => {
    const r = calcularHorariosBusca([
      { bairroId: "a", horarioBairro: "06:40", horarioManual: null },
      { bairroId: "b", horarioBairro: "06:50", horarioManual: null },
      { bairroId: "a", horarioBairro: "06:40", horarioManual: null },
    ], 5);
    expect(r).toEqual(["06:40", "06:50", "06:40"]);
  });
});

describe("taxa", () => {
  it("por passageiro com assento; colo não paga; sem valor ou sem assento = 0", () => {
    expect(calcularTaxa(4000, 3)).toBe(12000);
    expect(calcularTaxa(3500, 1)).toBe(3500);
    expect(calcularTaxa(4000, 0)).toBe(0);
    expect(calcularTaxa(0, 5)).toBe(0);
  });
  it("totais: a receber, PIX, dinheiro, incluído e não apareceu", () => {
    const t = totaisTaxa([
      { situacao: "CONFIRMADO", taxaCentavos: 8000, forma: null, taxaSituacao: "A_RECEBER" },
      { situacao: "BUSCADO", taxaCentavos: 4000, forma: "PIX", taxaSituacao: "RECEBIDO" },
      { situacao: "BUSCADO", taxaCentavos: 12000, forma: "DINHEIRO", taxaSituacao: "RECEBIDO" },
      { situacao: "BUSCADO", taxaCentavos: 4000, forma: "INCLUIDO_NO_PASSEIO", taxaSituacao: "RECEBIDO" },
      { situacao: "NAO_APARECEU", taxaCentavos: 4000, forma: null, taxaSituacao: "A_RECEBER" },
    ]);
    expect(t).toEqual({ total: 28000, aReceber: 8000, recebidoPix: 4000, recebidoDinheiro: 12000, incluidoNoPasseio: 4000, naoApareceram: 4000 });
  });
});

describe("textos", () => {
  const linhas = [
    { horario: "06:40", bairro: "Ingleses", endereco: "Pousada Fictícia", titular: "Ana Fictícia", pax: 2, telefone: null, situacao: "CONFIRMADO" as const, taxaCentavos: 8000, forma: null, taxaSituacao: "A_RECEBER" as const },
    { horario: "07:00", bairro: "Canasvieiras", endereco: "Hotel Exemplo", titular: "Bia Modelo", pax: 1, telefone: null, situacao: "BUSCADO" as const, taxaCentavos: 4000, forma: "PIX" as const, taxaSituacao: "RECEBIDO" as const },
  ];
  const cab = { passeio: "City Tour Toda Ilha", data: "2026-11-06", motorista: "Motorista Fictício", veiculo: "Van fictícia", lugares: 15, encontro: { nome: "Villa Romana Shopping", horario: "07:50" } };
  it("lista do transfer em ordem de busca, com taxa; telefone só quando informado", () => {
    const t = textoListaTransfer(cab, linhas);
    expect(t).toContain("1. 06:40 · Ingleses · Pousada Fictícia");
    expect(t).toContain("cobrar R$ 80,00");
    expect(t).toContain("pago (PIX)");
    expect(t).toContain("Encontro com o ônibus: Villa Romana Shopping às 07:50");
    expect(t).toContain("a cobrar: R$ 80,00");
    expect(t).not.toContain("+55");
    expect(textoListaTransfer(cab, [{ ...linhas[0]!, telefone: "+55 48 90000-0001" }])).toContain("+55 48 90000-0001");
  });
  it("lista de passageiros: 'via transfer' e ponto de encontro, sem duplicar passageiro", () => {
    const ponto = { id: "p1", ordem: 10, horario: "06:50", nome: "Transfer — Ingleses", ehTransfer: true };
    const m = { blocos: [{ ponto, linhas: [{ numero: 1, reservaId: "r1", canal: "PAYTOUR", codigoExterno: null, contatoNome: "Ana", contatoTelefone: null, observacoes: null, passageiro: { id: "x", nome: "Ana Fictícia", categoria: "ADULTO", documentoTipo: null, documento: null, documentoValido: null, embarque: "PENDENTE", pontoEmbarqueId: null } }] }], totais: { passageiros: 1, assentos: 1, pagantes: 1, porCategoria: { ADULTO: 1, SENIOR: 0, INFANTIL: 0, COLO: 0, CORTESIA: 0 }, embarcados: 0, noShow: 0 }, alertas: [] } as never;
    const cabL = { passeio: "City Tour", data: "2026-11-06", guia: null, motorista: null, veiculo: null, versao: 1 };
    const t = textoListaGrupo(m, cabL, new Map(), { encontro: { nome: "Villa Romana Shopping", horario: "07:50" }, porReserva: new Map([["r1", { bairro: "Ingleses" }]]) });
    expect(t).toContain("via transfer (Ingleses)");
    expect(t).toContain("embarcam todos em Villa Romana Shopping às 07:50");
    expect(t.match(/Ana Fictícia/g)).toHaveLength(1);
    expect(textoListaGrupo(m, cabL, new Map())).not.toContain("via transfer");
  });
});
