import { describe, expect, it } from "vitest";
import { idLocalTripadvisor, notaDoGoogle, numeroDaApi, resumirAvaliacoes } from "../src/index.js";

describe("avaliações do Google e do Tripadvisor (18/11/2026)", () => {
  it("converte a nota do Google e números que vêm como texto", () => {
    expect(["ONE", "THREE", "FIVE", "STAR_RATING_UNSPECIFIED", 5].map(notaDoGoogle)).toEqual([1, 3, 5, null, null]);
    expect([4.5, "4.5", "1,234", "", "x", null].map(numeroDaApi)).toEqual([4.5, 4.5, 1234, null, null, null]);
  });
  it("acha o id do local do Tripadvisor no link ou no número", () => {
    expect(idLocalTripadvisor("https://www.tripadvisor.com.br/Attraction_Review-g303576-d2362697-Reviews-Floripa_by_Bus.html")).toBe("2362697");
    expect(idLocalTripadvisor("10686390")).toBe("10686390");
    expect(idLocalTripadvisor("https://example.com")).toBeNull();
  });
  it("resume média, distribuição e as notas baixas sem resposta", () => {
    expect(resumirAvaliacoes([{ nota: 5, resposta: null }, { nota: 4, resposta: "Obrigado" }, { nota: 2, resposta: null }, { nota: 3, resposta: "Sentimos muito" }])).toEqual({
      quantidade: 4, media: 3.5, distribuicao: { 1: 0, 2: 1, 3: 1, 4: 1, 5: 1 }, semResposta: 1,
    });
    expect(resumirAvaliacoes([]).media).toBeNull();
  });
});
