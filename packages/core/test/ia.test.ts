import { describe, expect, it } from "vitest";
import { acharDadoPessoal, custoMicroUsd, dataSaoPaulo, ehIdGestor, GESTORES, garantirAgregado, IDS_GESTORES, limiteAtingido, mesSaoPaulo, proximaExecucao } from "../src/index.js";

describe("gestores de IA", () => {
  it("tem os 8 gestores pedidos, sem repetição", () => {
    expect(GESTORES.map((g) => g.id)).toEqual([...IDS_GESTORES]);
    expect(new Set(GESTORES.map((g) => g.id)).size).toBe(8);
    expect(ehIdGestor("rh")).toBe(true);
    expect(ehIdGestor("ceo")).toBe(false);
  });
});

describe("custo", () => {
  it("calcula em micro-dólares com cache", () => {
    // 1M de entrada + 1M de saída no Opus 5.5 = US$ 4 + US$ 20
    expect(custoMicroUsd("claude-opus-5-5", { entrada: 1_000_000, saida: 1_000_000 })).toBe(24_000_000);
    // leitura de cache = 10%, escrita = 125%
    expect(custoMicroUsd("claude-opus-5-5", { entrada: 0, saida: 0, cacheLeitura: 1_000_000, cacheEscrita: 1_000_000 })).toBe(400_000 + 5_000_000);
  });
  it("modelo desconhecido usa o preço mais alto", () => {
    expect(custoMicroUsd("modelo-novo", { entrada: 1_000_000, saida: 0 })).toBe(10_000_000);
  });
  it("limite mensal", () => {
    expect(limiteAtingido(39_999_999, 40)).toBe(false);
    expect(limiteAtingido(40_000_000, 40)).toBe(true);
    expect(limiteAtingido(10, 0)).toBe(false); // 0 = sem limite
  });
  it("mês e data no fuso de São Paulo", () => {
    const d = new Date("2026-12-01T01:00:00Z"); // ainda 30/11 em São Paulo
    expect(dataSaoPaulo(d)).toBe("2026-11-30");
    expect(mesSaoPaulo(d)).toBe("2026-11");
  });
});

describe("agenda diária", () => {
  it("antes das 6h30 roda hoje; depois, amanhã", () => {
    expect(proximaExecucao(new Date("2026-11-04T08:00:00Z")).toISOString()).toBe("2026-11-04T09:30:00.000Z"); // 05:00 SP
    expect(proximaExecucao(new Date("2026-11-04T10:00:00Z")).toISOString()).toBe("2026-11-05T09:30:00.000Z"); // 07:00 SP
    expect(proximaExecucao(new Date("2026-11-04T09:30:00Z")).toISOString()).toBe("2026-11-05T09:30:00.000Z"); // exatamente agora
  });
  it("vira o mês", () => {
    expect(proximaExecucao(new Date("2026-11-30T20:00:00Z")).toISOString()).toBe("2026-12-01T09:30:00.000Z");
  });
  it("recusa horário inválido", () => {
    expect(() => proximaExecucao(new Date(), "25:00")).toThrow();
  });
});

describe("trava de LGPD", () => {
  it("aceita agregados", () => {
    expect(acharDadoPessoal({ reservas: 12, porCanal: { PAYTOUR: 8 }, alertas: ["3 saídas sem guia"] })).toEqual([]);
  });
  it("barra e-mail, telefone, CPF e chaves de dado pessoal", () => {
    expect(acharDadoPessoal({ x: "fulano@exemplo.com" })).toHaveLength(1);
    expect(acharDadoPessoal({ x: "ligar (48) 99999-1234" })).toHaveLength(1);
    expect(acharDadoPessoal({ x: "123.456.789-09" })).toHaveLength(1);
    expect(acharDadoPessoal({ nome: 3 })).toHaveLength(1);
    expect(() => garantirAgregado({ lista: [{ telefone: 1 }] })).toThrow(/bloqueado/);
  });
  it("não confunde datas e contagens com telefone", () => {
    expect(acharDadoPessoal({ periodo: "2026-11-04 a 2026-11-18", total: 123456789 })).toEqual([]);
  });
});
