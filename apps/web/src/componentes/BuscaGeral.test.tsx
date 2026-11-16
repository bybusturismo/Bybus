import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { renderizar, simularApi } from "../teste/ajuda";
import { BuscaGeral } from "./BuscaGeral";

function Onde() {
  const l = useLocation();
  return <p data-testid="onde">{l.pathname + l.search}</p>;
}
const telas = [{ para: "/frota/abastecimento", rotulo: "Abastecimento", area: "Frota" }, { para: "/grupos", rotulo: "Grupos fechados", area: "Reservas" }];

describe("Busca geral do topo (16/11/2026)", () => {
  it("mostra telas e cadastros agrupados; setas e Enter abrem o resultado", async () => {
    simularApi({ "GET /api/busca": { resultados: [
      { grupo: "Reservas", titulo: "Cliente Fictício Grupo", detalhe: "20/11/2026 · City Tour", para: "/saidas/s1/reservas?busca=PT-1" },
      { grupo: "Grupos fechados", titulo: "Escola Fictícia Grupo", detalhe: null, para: "/grupos/g1" },
    ] } });
    renderizar(<><BuscaGeral telas={telas} /><Routes><Route path="*" element={<Onde />} /></Routes></>);
    const u = userEvent.setup();
    await u.type(screen.getByRole("combobox", { name: "Buscar no sistema" }), "grupo");
    expect(await screen.findByRole("option", { name: /Cliente Fictício Grupo/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Telas" })).toHaveTextContent("Grupos fechados");
    expect(screen.getByRole("group", { name: "Reservas" })).toHaveTextContent("20/11/2026 · City Tour");
    await u.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByTestId("onde")).toHaveTextContent("/saidas/s1/reservas?busca=PT-1");
    expect(screen.getByRole("combobox")).toHaveValue("");
  });

  it("tecla / leva à busca; sem resultado avisa", async () => {
    simularApi({ "GET /api/busca": { resultados: [] } });
    renderizar(<BuscaGeral telas={telas} />);
    const u = userEvent.setup();
    await u.keyboard("/");
    expect(screen.getByRole("combobox")).toHaveFocus();
    await u.keyboard("zzzz");
    expect(await screen.findByText("Nada encontrado.")).toBeInTheDocument();
  });
});
