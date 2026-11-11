import { describe, expect, it } from "vitest";
import { avisosDeChegada, modeloChegada, quemChega, renderizarModeloMeta } from "../src/index.js";

// Paradas fictícias numa reta (cada 0,01° de latitude ≈ 1,1 km).
const paradas = [{ lat: -27.50, lng: -48.50 }, { lat: -27.51, lng: -48.50 }, { lat: -27.52, lng: -48.50 }, { lat: -27.60, lng: -48.50 }];

describe("avisos de chegada", () => {
  it("avisa 'chegando' só para as paradas a até 5 min e 'chegou' para as alcançadas agora", () => {
    // Antes da primeira parada, a ~1 km: a 25 km/h ≈ 4 min (1,3 × 1,1 km) → chegando na 0; a 1 (mais 1 min de parada) também.
    const r = avisosDeChegada({ paradas, visitadoAntes: -1, visitadoAgora: -1, posicao: { lat: -27.49, lng: -48.50 } });
    expect(r.chegou).toEqual([]);
    expect(r.chegando).toContain(0);
    expect(r.chegando).not.toContain(3);
    const r2 = avisosDeChegada({ paradas, visitadoAntes: -1, visitadoAgora: 0, posicao: paradas[0]! });
    expect(r2.chegou).toEqual([0]);
  });

  it("não manda 'chegou' de parada antiga e para de prever sem coordenadas", () => {
    const r = avisosDeChegada({ paradas: [paradas[0]!, null, paradas[2]!], visitadoAntes: 0, visitadoAgora: 0, posicao: paradas[0]! });
    expect(r).toEqual({ chegando: [], chegou: [] });
  });

  it("modelo da Meta com o texto que o cliente lê", () => {
    const t = renderizarModeloMeta(modeloChegada("CHEGANDO", { primeiroNome: "Ana", quem: quemChega("TRANSFER", "City Tour"), local: "Pousada Fictícia" }));
    expect(t).toBe("Olá, Ana! A van do transfer da By Bus chega em cerca de 5 minutos em Pousada Fictícia.\nPor favor, aguarde no local. — Equipe By Bus");
    expect(renderizarModeloMeta(modeloChegada("CHEGOU", { primeiroNome: "Ana", quem: quemChega("ONIBUS", "City Tour"), local: "Villa Romana" }))).toContain("O ônibus do passeio City Tour chegou em Villa Romana.");
  });
});
