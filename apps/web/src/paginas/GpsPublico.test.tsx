import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { GpsPublico, mensagemGps } from "./GpsPublico";
import { LinksGps } from "./frota/LinksGps";
import type { Veiculo } from "./frota/tipos";

const base = { veiculo: "Amarelo", placa: "ABC1D23", minutosSemSinal: null, passeio: null, etapa: null, posicao: null, trajeto: [] };

describe("Link do GPS do veículo (13/11/2026)", () => {
  it("mensagens da página pública", () => {
    expect(mensagemGps({ ...base, emServico: false, situacao: "FORA_DE_SERVICO" }).texto).toMatch(/não está em serviço/);
    expect(mensagemGps({ ...base, emServico: true, situacao: "SEM_SINAL", minutosSemSinal: 7 }).texto).toBe("Sem sinal há 7 min. Mostramos a última posição.");
    expect(mensagemGps({ ...base, emServico: true, situacao: "TRANSMITINDO", etapa: "City Tour", passeio: "Toda a Ilha", posicao: { lat: 1, lng: 2, em: "2026-11-13T15:00:00Z", velocidadeKmh: 40 } }).texto).toBe("Em serviço · City Tour · Toda a Ilha");
  });

  it("página pública fora de serviço não mostra mapa", async () => {
    simularApi({ "GET /api/publico/gps/tokenFicticio0123456789abcd": { ...base, emServico: false, situacao: "FORA_DE_SERVICO" } });
    renderizar(<GpsPublico token="tokenFicticio0123456789abcd" />);
    expect(await screen.findByRole("heading", { name: "Amarelo · ABC1D23" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/não está em serviço/);
    expect(screen.queryByText(/Última posição/)).not.toBeInTheDocument();
  });

  it("gestão: cria link para um destinatário e mostra para copiar", async () => {
    const spy = simularApi({
      "GET /api/frota/veiculos/v1/links-gps": [{ id: "l1", descricao: "Hotel antigo fictício", expiraEm: null, revogadoEm: null, ultimoAcessoEm: null, criadoEm: "2026-11-10T12:00:00Z", ativo: true }],
      "POST /api/frota/veiculos/v1/links-gps": { id: "l2", caminho: "/gps/novoTokenFicticio0123456789", expiraEm: null },
    });
    renderizar(<LinksGps veiculo={{ id: "v1", placa: "ABC1D23", apelido: "Amarelo" } as Veiculo} podeEditar aoFechar={() => {}} />, { sessao: sessaoFicticia("ADMIN", ["frota:ver", "frota:gerenciar"], { unidades: [FLN] }) });
    expect(await screen.findByText("Hotel antigo fictício")).toBeInTheDocument();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Para quem"), "Recepção do hotel fictício");
    await u.selectOptions(screen.getByLabelText("Validade"), "7");
    await u.click(screen.getByRole("button", { name: "Criar link" }));
    expect(await screen.findByText(/\/gps\/novoTokenFicticio0123456789$/)).toBeInTheDocument();
    expect(corpoEnviado(spy, "POST", "/api/frota/veiculos/v1/links-gps")).toEqual({ descricao: "Recepção do hotel fictício", dias: 7 });
  });
});
