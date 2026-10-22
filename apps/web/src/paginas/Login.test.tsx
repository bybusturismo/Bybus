import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { respostaJson } from "../teste/ajuda";
import { Login } from "./Login";

describe("Login", () => {
  it("pede o código de 6 dígitos quando a API responde MFA_NECESSARIO e reenvia com o código", async () => {
    const aoEntrar = vi.fn();
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respostaJson(401, { codigo: "MFA_NECESSARIO", mensagem: "Informe o código." }))
      .mockResolvedValueOnce(respostaJson(200, { usuario: {} }));
    render(<Login aoEntrar={aoEntrar} />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("E-mail"), "admin@bybus.test");
    await u.type(screen.getByLabelText("Senha"), "Bybus-teste-2026");
    await u.click(screen.getByRole("button", { name: "Entrar" }));

    const codigo = await screen.findByLabelText(/Código de 6 dígitos/);
    await u.click(screen.getByRole("button", { name: "Verificar e entrar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("O código tem 6 dígitos.");
    expect(f).toHaveBeenCalledTimes(1);

    await u.type(codigo, "123 456");
    await u.click(screen.getByRole("button", { name: "Verificar e entrar" }));
    expect(aoEntrar).toHaveBeenCalled();
    const corpo = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string);
    expect(corpo).toEqual({ email: "admin@bybus.test", senha: "Bybus-teste-2026", codigo: "123456" });
    expect((f.mock.calls[1]![1] as RequestInit).headers).toMatchObject({ "X-Bybus": "1" });
  });

  it.each([
    [401, "CREDENCIAIS_INVALIDAS", /E-mail ou senha incorretos/],
    [429, "MUITAS_REQUISICOES", /Aguarde um minuto/],
    [423, "USUARIO_BLOQUEADO", /Muitas tentativas/],
  ])("mostra mensagem clara para %s %s", async (status, codigo, esperado) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaJson(status, { codigo, mensagem: "x" }));
    render(<Login aoEntrar={vi.fn()} />);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("E-mail"), "a@bybus.test");
    await u.type(screen.getByLabelText("Senha"), "errada");
    await u.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(esperado);
  });
});
