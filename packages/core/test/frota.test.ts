import { describe, expect, it } from "vitest";
import {
  alertaConsumo, consumoPorAbastecimento, mediaConsumo, motivosBloqueio, normalizarPlaca, placaValida,
  resumirChecklist, situacaoPlano, situacaoVencimento,
} from "../src/index.js";

describe("placas", () => {
  it("normaliza e valida padrão antigo e Mercosul (placas fictícias)", () => {
    expect(normalizarPlaca("abc-1d23")).toBe("ABC1D23");
    expect(placaValida("ABC-1234")).toBe(true);
    expect(placaValida("ABC1D23")).toBe(true);
    expect(placaValida("12345")).toBe(false);
  });
});

describe("vencimento de documentos", () => {
  it("vencido, a vencer em 30 dias e em dia; o dia do vencimento ainda vale", () => {
    expect(situacaoVencimento("2026-11-03", "2026-11-04")).toBe("VENCIDO");
    expect(situacaoVencimento("2026-11-04", "2026-11-04")).toBe("A_VENCER");
    expect(situacaoVencimento("2026-12-04", "2026-11-04")).toBe("A_VENCER");
    expect(situacaoVencimento("2026-12-05", "2026-11-04")).toBe("EM_DIA");
  });
});

describe("plano preventivo", () => {
  const base = { hoje: "2026-11-04", kmAtual: 100_000 };
  it("por km", () => {
    expect(situacaoPlano({ ...base, intervaloKm: 10_000, ultimoKm: 85_000 })).toMatchObject({ situacao: "VENCIDA", proximoKm: 95_000, kmRestante: -5_000 });
    expect(situacaoPlano({ ...base, intervaloKm: 10_000, ultimoKm: 91_000 })).toMatchObject({ situacao: "PROXIMA", kmRestante: 1_000 });
    expect(situacaoPlano({ ...base, intervaloKm: 10_000, ultimoKm: 95_000 }).situacao).toBe("EM_DIA");
  });
  it("por tempo e o que chegar primeiro", () => {
    expect(situacaoPlano({ ...base, intervaloDias: 180, ultimaData: "2026-05-01" })).toMatchObject({ situacao: "VENCIDA", proximaData: "2026-10-28" });
    expect(situacaoPlano({ ...base, intervaloKm: 10_000, ultimoKm: 95_000, intervaloDias: 90, ultimaData: "2026-08-10" }).situacao).toBe("PROXIMA");
  });
  it("sem base fica sem situação", () => {
    expect(situacaoPlano({ ...base, intervaloKm: 10_000 }).situacao).toBe("SEM_BASE");
  });
});

describe("consumo", () => {
  it("calcula entre tanques cheios, somando abastecimentos parciais", () => {
    const m = consumoPorAbastecimento([
      { id: "c", km: 1_300, litros: 100, tanqueCheio: true },
      { id: "a", km: 1_000, litros: 50, tanqueCheio: true },
      { id: "b", km: 1_150, litros: 60, tanqueCheio: false },
    ]);
    expect(m.get("a")).toBeNull();
    expect(m.get("b")).toBeNull();
    expect(m.get("c")).toBe(1.88); // 300 km / 160 l
  });
  it("média e alerta fora da média só com amostras suficientes", () => {
    expect(mediaConsumo([2, 3, null])).toBe(2.5);
    expect(alertaConsumo(1.5, [2.5, 2.4])).toBeNull();
    expect(alertaConsumo(1.5, [2.5, 2.4, 2.6])).toBe("ALTO");
    expect(alertaConsumo(2.4, [2.5, 2.4, 2.6])).toBeNull();
    expect(alertaConsumo(4, [2.5, 2.4, 2.6])).toBe("BAIXO");
    expect(alertaConsumo(null, [2, 2, 2])).toBeNull();
  });
});

describe("checklist e bloqueio", () => {
  it("item crítico com problema reprova", () => {
    const r = [
      { itemId: "1", descricao: "Freios", critico: true, ok: false },
      { itemId: "2", descricao: "Limpeza", critico: false, ok: false },
      { itemId: "3", descricao: "Faróis", critico: true, ok: true },
    ];
    expect(resumirChecklist(r)).toEqual({ total: 3, naoOk: 2, criticosNaoOk: 1, aprovado: false });
    expect(resumirChecklist([r[1]!, r[2]!]).aprovado).toBe(true);
  });
  it("motivos de bloqueio", () => {
    const ok = { situacao: "ATIVO" as const, documentos: [{ tipo: "CRLV", vencimento: "2026-12-31" }], planos: [{ nome: "Óleo", critico: false, situacao: "VENCIDA" }], ordensImobilizando: 0, hoje: "2026-11-04" };
    expect(motivosBloqueio(ok)).toEqual([]);
    const ruim = { ...ok, situacao: "MANUTENCAO" as const, documentos: [{ tipo: "SEGURO", descricao: "Apólice", vencimento: "2026-11-01" }], planos: [{ nome: "Freios", critico: true, situacao: "VENCIDA" }] };
    expect(motivosBloqueio(ruim)).toEqual(["Veículo em manutenção", "Documento vencido: Apólice", "Manutenção crítica vencida: Freios"]);
  });
});

describe("abastecimento com mesmo km e tipo de serviço (13/11/2026)", () => {
  it("duas linhas de diesel no mesmo km somam os litros; óleo e lubrificante não entram no km/l", () => {
    const r = consumoPorAbastecimento([
      { id: "a1", km: 300_000, litros: 100, tanqueCheio: true },
      { id: "b1", km: 300_175, litros: 188.8, tanqueCheio: true },
      { id: "b2", km: 300_175, litros: 27.06, tanqueCheio: true },
      { id: "o1", km: 300_175, litros: 5, tanqueCheio: true, tipo: "OLEO" },
    ]);
    expect(r.get("b2")).toBe(Math.round((175 / 215.86) * 100) / 100);
    expect(r.get("b1")).toBeNull();
    expect(r.get("o1")).toBeNull();
  });
  it("no mesmo km, o km/l fica na linha lançada por último, qualquer que seja o id", () => {
    const r = consumoPorAbastecimento([
      { id: "a1", km: 1000, litros: 100, tanqueCheio: true, criadoEm: "2026-11-13T10:00:00Z" },
      { id: "zz", km: 1250, litros: 80, tanqueCheio: true, criadoEm: "2026-11-13T11:00:00Z" },
      { id: "aa", km: 1250, litros: 20, tanqueCheio: true, criadoEm: "2026-11-13T11:00:05Z" },
    ]);
    expect(r.get("aa")).toBe(2.5);
    expect(r.get("zz")).toBeNull();
  });
});
