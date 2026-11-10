import { describe, expect, it } from "vitest";
import { lugaresDoPonto, PONTOS_TODA_ILHA, sugerirPontos } from "../src/index.js";

const pontos = PONTOS_TODA_ILHA.map((p, i) => ({ ...p, id: String(i), endereco: p.endereco ?? null }));
const nome = (consulta: string) => sugerirPontos(consulta, pontos).map((s) => pontos[Number(s.pontoId)]!.nome);

describe("sugerirPontos", () => {
  it("usa os hotéis citados na descrição oficial de cada ponto", () => {
    expect(nome("Estou no Mercure Convention")[0]).toBe("Villa Romana Shopping");
    expect(nome("hotel lumar")[0]).toBe("Hotel Ibis");
    expect(nome("Slaviero Baía Norte")[0]).toBe("Hotel Castelmar");
    expect(nome("Florianópolis Palace Hotel")[0]).toBe("Catedral Metropolitana — Praça XV de Novembro");
    expect(nome("Cris Hotel na Joaquina")[0]).toBe("Praia da Joaquina");
  });

  it("bairros dos transfers e o próprio ponto", () => {
    expect(nome("pousada nos Ingleses")[0]).toBe("Transfer — Ingleses");
    expect(nome("Jurerê Internacional")[0]).toBe("Transfer — Jurerê");
    expect(nome("Blue Tree")[0]).toBe("Hotel Blue Tree Towers");
  });

  it("sem combinação não inventa sugestão", () => {
    expect(nome("Airbnb no Campeche")).toEqual([]);
    expect(nome("ok")).toEqual([]);
  });

  it("extrai os lugares da descrição", () => {
    expect(lugaresDoPonto({ nome: "Hotel Ibis", endereco: "Próximo aos hotéis Lumar, Ecobox Hostel, Farol da Ilha, Valerim e Faial" })).toEqual(expect.arrayContaining(["Ibis", "Lumar", "Ecobox Hostel", "Farol da Ilha", "Valerim", "Faial"]));
  });
});
