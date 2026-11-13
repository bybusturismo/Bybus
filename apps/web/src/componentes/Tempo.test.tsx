import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TempoDoDia } from "./Tempo";

describe("ícone da previsão do tempo", () => {
  const porPraca = {
    u1: [
      { data: "2026-11-20", fonte: "PREVISAO" as const, icone: "CHUVA" as const, tempMin: 19, tempMax: 24, chuvaMm: 12.5, probChuva: null },
      { data: "2027-01-10", fonte: "HISTORICO" as const, icone: "SOL_NUVENS" as const, tempMin: 22, tempMax: 29, chuvaMm: 4, probChuva: 35 },
    ],
  };
  it("mostra a previsão com a dica e a máxima", () => {
    render(<TempoDoDia unidadeId="u1" data="2026-11-20" porPraca={porPraca} />);
    expect(screen.getByRole("img", { name: "Previsão: Chuva · 19° a 24° · chuva 12,5 mm (MET Norway)" })).toHaveTextContent("24°");
  });
  it("média histórica aparece mais clara e diz que ainda não há previsão", () => {
    render(<TempoDoDia unidadeId="u1" data="2027-01-10" porPraca={porPraca} />);
    const el = screen.getByRole("img", { name: /Média histórica para o dia \(ainda sem previsão\): 35% de chance de chuva/ });
    expect(el).toHaveClass("tempo--historico");
  });
  it("sem dado: não mostra nada", () => {
    const { container } = render(<TempoDoDia unidadeId="u1" data="2026-12-01" porPraca={porPraca} />);
    expect(container).toBeEmptyDOMElement();
  });
});
