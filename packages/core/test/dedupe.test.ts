import { describe, expect, it } from "vitest";
import { detectarDuplicatas, extrairReferenciasOta } from "../src/index.js";

describe("deduplicação", () => {
  it("agrupa pelo código de OTA citado na observação da Paytour", () => {
    const grupos = detectarDuplicatas([
      { id: "bokun", canal: "VIATOR", codigoExterno: "VIA-107216084", contatoNome: "Carla Teste", categorias: ["SENIOR"] },
      { id: "paytour", canal: "VIATOR", codigoExterno: "PAYTOUR-555", referencias: ["VIA-107216084"], contatoNome: "Carla", categorias: ["SENIOR"] },
    ]);
    expect(grupos).toEqual([["bokun", "paytour"]]);
  });

  it("sugere duplicata por titular + composição quando não há código", () => {
    const grupos = detectarDuplicatas([
      { id: "a", canal: "DECOLAR", contatoNome: "João da Silva Teste", categorias: ["ADULTO", "INFANTIL"] },
      { id: "b", canal: "PAYTOUR", canalOrigem: "DECOLAR", contatoNome: "teste joão da silva", categorias: ["INFANTIL", "ADULTO"] },
      { id: "c", canal: "PAYTOUR", contatoNome: "João da Silva Teste", categorias: ["ADULTO", "INFANTIL"] },
    ]);
    expect(grupos).toEqual([["a", "b"]]);
  });

  it("extrai referências de OTA de texto livre", () => {
    expect(extrairReferenciasOta("cliente viator VIA-107216084 / BYB-T150688831")).toEqual(["VIA-107216084", "BYB-T150688831"]);
    expect(extrairReferenciasOta(null)).toEqual([]);
  });
});
