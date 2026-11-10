import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { simularApi } from "../teste/ajuda";
import { ProvedorSessao, useSessao } from "./Sessao";

function Tela() {
  const { sair, estado } = useSessao();
  const local = useLocation();
  return <div><span>rota:{local.pathname}</span><span>fase:{estado.fase}</span><button type="button" onClick={() => void sair()}>Sair</button></div>;
}

describe("sessão", () => {
  it("quem sai volta para o início (o próximo login abre na tela inicial)", async () => {
    simularApi({
      "GET /api/auth/eu": { usuario: { id: "u1", nome: "Admin Fictício", email: "a@exemplo.test", perfil: "ADMIN", perfilNome: "Administrador", todasUnidades: true, trocarSenha: false, totpAtivo: false, fotoVersao: null }, permissoes: [], unidades: [], pendencia: null },
      "POST /api/auth/logout": { ok: true },
    });
    render(<MemoryRouter initialEntries={["/usuarios"]}><ProvedorSessao><Routes><Route path="*" element={<Tela />} /></Routes></ProvedorSessao></MemoryRouter>);
    expect(await screen.findByText("rota:/usuarios")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("fase:autenticado")).toBeInTheDocument());
    await userEvent.setup().click(screen.getByRole("button", { name: "Sair" }));
    expect(await screen.findByText("rota:/")).toBeInTheDocument();
  });
});
