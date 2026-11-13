import { afterEach, describe, expect, it, vi } from "vitest";
import { imprimirPagina } from "./appCelular";

const g = globalThis as unknown as { Capacitor?: unknown };

describe("impressão (lista física de passageiros, 13/11/2026)", () => {
  afterEach(() => {
    delete g.Capacitor;
    vi.restoreAllMocks();
  });

  it("no navegador usa o window.print()", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    expect(await imprimirPagina("Lista")).toBeNull();
    expect(print).toHaveBeenCalledOnce();
  });

  it("no app usa a impressão do Android e não o window.print()", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const imprimir = vi.fn(async () => {});
    g.Capacitor = { isNativePlatform: () => true, Plugins: { Impressao: { imprimir } } };
    expect(await imprimirPagina("Lista de passageiros - Toda a Ilha")).toBeNull();
    expect(imprimir).toHaveBeenCalledWith({ titulo: "Lista de passageiros - Toda a Ilha" });
    expect(print).not.toHaveBeenCalled();
  });

  it("app antigo, sem o plugin: pede para atualizar o app", async () => {
    g.Capacitor = { isNativePlatform: () => true, Plugins: {} };
    expect(await imprimirPagina("Lista")).toMatch(/atualize o app By Bus/);
  });
});
