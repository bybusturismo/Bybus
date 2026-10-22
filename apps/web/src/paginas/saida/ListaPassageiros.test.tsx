import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Alerta, BlocoManifesto } from "../../api/tipos";
import { BlocoPassageiros, ordenarAlertas, PainelAlertas } from "./ListaPassageiros";

const linha = (numero: number, nome: string, extra: Partial<BlocoManifesto["linhas"][number]> = {}): BlocoManifesto["linhas"][number] => ({
  numero,
  reservaId: `r${numero}`,
  canal: "VIATOR",
  codigoExterno: `VIA-${numero}`,
  contatoNome: "Titular Ficticio",
  contatoTelefone: "+55 48 90000-0000",
  observacoes: null,
  passageiro: { id: `p${numero}`, nome, categoria: "ADULTO", documentoTipo: "CPF", documento: "•••4725", documentoValido: true, embarque: "PENDENTE" },
  ...extra,
});

describe("Lista de passageiros", () => {
  it("bloco sem ponto aparece como A DEFINIR e passageiro sem nome como (a informar), sem telefone", () => {
    render(<BlocoPassageiros bloco={{ ponto: null, linhas: [linha(7, "")] }} filtro="" />);
    expect(screen.getByRole("heading", { name: /A DEFINIR/ })).toBeInTheDocument();
    const tabela = screen.getByRole("table");
    expect(within(tabela).getByText("(a informar)")).toBeInTheDocument();
    expect(within(tabela).getByText("•••4725")).toBeInTheDocument();
    expect(tabela).not.toHaveTextContent("+55");
  });

  it("cabeçalho do ponto mostra horário, nome e endereço; busca esconde só na tela", () => {
    const { container } = render(
      <BlocoPassageiros
        bloco={{ ponto: { id: "x", ordem: 50, horario: "08:00", nome: "Villa Romana Shopping", endereco: "Rua Santa Mônica", ehTransfer: false }, linhas: [linha(1, "Ana Exemplo"), linha(2, "Bruno Exemplo")] }}
        filtro="bruno"
      />,
    );
    expect(screen.getByRole("heading", { name: "08:00 — Villa Romana Shopping" })).toBeInTheDocument();
    expect(screen.getByText("Rua Santa Mônica")).toBeInTheDocument();
    const ocultas = container.querySelectorAll("tr.oculto-na-tela");
    expect(ocultas).toHaveLength(1);
    expect(ocultas[0]).toHaveTextContent("Ana Exemplo");
  });

  it("alertas críticos primeiro", () => {
    const alertas: Alerta[] = [
      { codigo: "SEM_DOCUMENTO", nivel: "info", mensagem: "i" },
      { codigo: "DECISAO_SUPERVISOR", nivel: "critico", mensagem: "c" },
      { codigo: "SEM_PONTO_EMBARQUE", nivel: "atencao", mensagem: "a" },
    ];
    expect(ordenarAlertas(alertas).map((a) => a.nivel)).toEqual(["critico", "atencao", "info"]);
    render(<PainelAlertas alertas={alertas} />);
    expect(screen.getByRole("heading", { name: /Alertas \(3\)/ })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Crítico");
  });
});
