import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { AbastecimentoPagina } from "./Abastecimento";
import type { Abastecimento, AbastecimentoPendente } from "./tipos";

const veiculos = [{ id: "v1", placa: "ABC1D23", apelido: "Amarelo", tipo: "ONIBUS_DOIS_ANDARES", kmAtual: 120_000, situacao: "ATIVO", feitoHoje: false, aprovadoHoje: null }];
const pendente = (extra: Partial<AbastecimentoPendente> = {}): AbastecimentoPendente => ({
  id: "p1", veiculoId: "v1", placa: "ABC1D23", apelido: "Amarelo", data: "2026-11-18", km: null, litros: 45.5, valorCentavos: 31245, posto: "Posto Fictício",
  tanqueCheio: true, origem: "WHATSAPP", observacao: null, pessoaNome: "Motorista Fictício", criadoPor: null, criadoEm: "2026-11-18T12:00:00Z", leituraIa: { observacao: null },
  fotos: [{ id: "f1", tipo: "CUPOM", nomeArquivo: "cupom.jpg", mime: "image/jpeg" }], faltas: ["km do painel"], ...extra,
});
const conferido: Abastecimento = {
  id: "a1", veiculoId: "v1", placa: "ABC1D23", apelido: "Amarelo", data: "2026-11-17", km: 119_800, litros: 40, valorCentavos: 28_000, posto: "Posto", tanqueCheio: true, tipo: "COMBUSTIVEL",
  kml: 4.5, alerta: null, lancamentoId: "l1", pagamento: { id: "l1", situacao: "REALIZADO", pagoEm: "2026-11-18", vencimento: "2026-11-17", comprovante: false },
};
const motorista = sessaoFicticia("MOTORISTA", ["frota:checklist"], { unidades: [FLN] });
const gerente = sessaoFicticia("ADMIN", ["frota:ver", "frota:gerenciar"], { unidades: [FLN] });

describe("Abastecimento pela foto do cupom", () => {
  it("motorista só manda a foto (com placa e km) e não vê a lista dos conferidos", async () => {
    const spy = simularApi({
      "GET /api/frota/checklist/veiculos": veiculos,
      "GET /api/frota/abastecimentos/pendentes": { iaLigada: true, itens: [] },
      "POST /api/frota/abastecimentos/foto": { ...pendente({ origem: "APP" }), iaLigada: true },
    });
    renderizar(<AbastecimentoPagina />, { sessao: motorista });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: /Enviar foto do cupom/ }));
    expect(screen.queryByRole("button", { name: /Novo abastecimento/ })).not.toBeInTheDocument();
    const d = within(await screen.findByRole("dialog"));
    await u.upload(d.getByLabelText("Foto do cupom"), new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2])], "cupom.jpg", { type: "image/jpeg" }));
    await u.selectOptions(d.getByLabelText("Placa"), "v1");
    await u.type(d.getByLabelText("Km do painel"), "120.500");
    await u.click(d.getByRole("button", { name: "Enviar" }));
    await screen.findByText(/Foto enviada\. Falta: km do painel/);
    expect(corpoEnviado(spy, "POST", "/api/frota/abastecimentos/foto")).toMatchObject({ veiculoId: "v1", km: 120_500, fotos: [{ nome: "cupom.jpg", tipo: "CUPOM", base64: btoa(String.fromCharCode(0xff, 0xd8, 0xff, 1, 2)) }] });
    expect(spy.mock.calls.some(([x]) => /\/api\/frota\/abastecimentos(\?|$)/.test(String(x)))).toBe(false);
  });

  it("quem gerencia vê o pendente com a foto e o que falta, confere e gera a conta a pagar; a lista mostra o pagamento", async () => {
    const spy = simularApi({
      "GET /api/frota/checklist/veiculos": veiculos,
      "GET /api/frota/abastecimentos/pendentes": { iaLigada: true, itens: [pendente()] },
      "GET /api/frota/pagamento-combustivel": {},
      "GET /api/frota/abastecimentos": { itens: [conferido], resumo: [] },
      "POST /api/frota/abastecimentos/p1/conferir": { ...pendente(), situacao: "CONFERIDO" },
    });
    renderizar(<AbastecimentoPagina />, { sessao: gerente });
    const u = userEvent.setup();
    const sec = within(await screen.findByRole("region", { name: /Pendentes de conferência \(1\)/ }));
    expect(sec.getByText("Falta: km do painel")).toBeInTheDocument();
    expect(sec.getByRole("img", { name: "Foto do cupom" })).toHaveAttribute("src", "/api/frota/abastecimentos/fotos/f1");
    expect(sec.getByText("Enviado por Motorista Fictício")).toBeInTheDocument();
    // pagamento na lista dos conferidos
    expect(await screen.findByText("Pago em 18/11/2026")).toBeInTheDocument();
    expect(screen.getByText("sem comprovante")).toBeInTheDocument();
    await u.click(sec.getByRole("button", { name: "Conferir" }));
    const d = within(await screen.findByRole("dialog"));
    expect(d.getByLabelText("Litros")).toHaveValue("45,5");
    expect(d.getByLabelText("Valor total (R$)")).toHaveValue("312,45");
    await u.type(d.getByLabelText("Km do painel"), "120450");
    await u.selectOptions(d.getByLabelText("Pagamento"), "FATURADO");
    await u.click(d.getByRole("button", { name: "Conferir" }));
    await screen.findByRole("region", { name: /Pendentes/ });
    expect(corpoEnviado(spy, "POST", "/api/frota/abastecimentos/p1/conferir")).toMatchObject({ veiculoId: "v1", km: 120_450, litros: 45.5, valorCentavos: 31245, formaPagamento: "FATURADO", gerarConta: true, tanqueCheio: true });
  });
});
