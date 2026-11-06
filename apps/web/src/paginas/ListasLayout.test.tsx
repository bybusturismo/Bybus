import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderizar, sessaoFicticia } from "../teste/ajuda";
import { ListasLayout } from "./ListasLayout";

const abas = () => within(screen.getByRole("navigation", { name: "Listas de passageiros" })).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")]);

describe("Abas de Listas de passageiros", () => {
  it("quem vê a lista e confere reservas vê as três abas", () => {
    renderizar(<ListasLayout />, { sessao: sessaoFicticia("ATENDENTE", ["manifesto:ver", "reservas:editar"]) });
    expect(abas()).toEqual([["Listas do dia", "/listas"], ["Todas as saídas", "/listas/saidas"], ["A conferir", "/listas/conferir"]]);
  });

  it("sem reservas:editar a aba A conferir não aparece", () => {
    renderizar(<ListasLayout />, { sessao: sessaoFicticia("GUIA", ["manifesto:ver"]) });
    expect(abas().map((a) => a[0])).toEqual(["Listas do dia", "Todas as saídas"]);
  });
});
