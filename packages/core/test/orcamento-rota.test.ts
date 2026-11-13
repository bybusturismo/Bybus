import { describe, expect, it } from "vitest";
import { cargaHorariaMin, montarOrcamentoPdf, precoPelaTabela, resumoRotaOrs } from "../src/index.js";

describe("orçamento com rota (13/11/2026)", () => {
  it("carga horária e preço pela tabela, com horas e valor mínimos", () => {
    const pontos = [{ nome: "Centro", lat: -27.59, lng: -48.55, permanenciaMin: 40 }, { nome: "Lagoa", lat: -27.6, lng: -48.46, permanenciaMin: 20 }];
    expect(cargaHorariaMin(95, pontos, 30)).toBe(185);
    const t = { valorKmCentavos: 650, valorHoraCentavos: 9000, horasMinimas: 4, minimoCentavos: 90000 };
    expect(precoPelaTabela(100, 185, t)).toEqual({ porKmCentavos: 65000, porHoraCentavos: 36000, horasCobradas: 4, totalCentavos: 101000, aplicouMinimo: false });
    expect(precoPelaTabela(10, 60, t)).toMatchObject({ totalCentavos: 90000, aplicouMinimo: true });
  });

  it("lê a resposta do OpenRouteService", () => {
    expect(resumoRotaOrs({ routes: [{ summary: { distance: 104_870, duration: 7_260 }, segments: [{ distance: 50_000, duration: 3_600 }, { distance: 54_870, duration: 3_660 }] }] }))
      .toEqual({ distanciaKm: 104.9, duracaoMin: 121, trechos: [{ km: 50, min: 60 }, { km: 54.9, min: 61 }] });
    expect(resumoRotaOrs({ error: "x" })).toBeNull();
  });

  it("documento do orçamento com roteiro, carga horária, valor por extenso e por pessoa", () => {
    const t = montarOrcamentoPdf({
      numero: "2026-0001", cliente: "Escola Fictícia", contato: "Representante Fictícia", dataPasseio: "2026-12-05", horarioInicio: "08:00", veiculo: "ONIBUS", pessoas: 40,
      pontos: [{ nome: "Centro histórico", lat: 0, lng: 0, permanenciaMin: 40 }, { nome: "Lagoa", lat: 0, lng: 0, permanenciaMin: 0 }],
      distanciaKm: 104.9, duracaoRotaMin: 121, cargaHorariaMin: 480, valorCentavos: 520000, validadeDias: 15, observacoes: null, emitidoEm: "2026-11-13", cidade: "Florianópolis/SC", sinalPercentual: 50,
    }).map((b) => ("texto" in b ? b.texto : "")).join("\n");
    expect(t).toContain("ORÇAMENTO Nº 2026-0001");
    expect(t).toContain("a) Centro histórico — permanência de aproximadamente 40 min");
    expect(t).toContain("104,9 km");
    expect(t).toContain("carga horária estimada:** 8h");
    expect(t).toContain("**R$ 5.200,00 (cinco mil e duzentos reais)**, equivalente a R$ 130,00 por pessoa");
    expect(t).toContain("válido por 15 dias");
  });
});
