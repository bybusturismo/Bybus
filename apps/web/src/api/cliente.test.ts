import { describe, expect, it, vi } from "vitest";
import { api, ErroApi } from "./cliente";

function respostaJson(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

describe("cliente da API", () => {
  it("GET não envia X-Bybus; POST/PATCH/DELETE enviam X-Bybus: 1 e credentials same-origin", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => respostaJson(200, { ok: true }));
    await api.get("/api/x");
    await api.post("/api/x", { a: 1 });
    await api.patch("/api/x", { a: 1 });
    await api.delete("/api/x");
    const chamadas = f.mock.calls.map(([, init]) => init as RequestInit);
    expect((chamadas[0]!.headers as Record<string, string>)["X-Bybus"]).toBeUndefined();
    for (const c of chamadas.slice(1)) expect((c.headers as Record<string, string>)["X-Bybus"]).toBe("1");
    for (const c of chamadas) expect(c.credentials).toBe("same-origin");
    expect((chamadas[3]!.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("converte erro da API em ErroApi com código e detalhes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaJson(400, { codigo: "DADOS_INVALIDOS", mensagem: "Dados inválidos.", detalhes: [{ campo: "email", mensagem: "x" }] }));
    const erro = await api.post("/api/x").catch((e) => e);
    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro).toMatchObject({ status: 400, codigo: "DADOS_INVALIDOS", detalhes: [{ campo: "email", mensagem: "x" }] });
  });

  it("falha de rede vira mensagem em português", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.get("/api/x")).rejects.toMatchObject({ codigo: "SEM_CONEXAO" });
  });
});
