import { describe, expect, it } from "vitest";
import { ehEmailDecolar, lerEmailDecolar } from "../src/index.js";

// Mesmo formato do e-mail real da Decolar (sistema PAM), com dados FICTÍCIOS.
const corpo = `Informamos que foi gerada uma nova reserva.

Detalhe da Reserva
**Titular da reserva**: Pessoa Fictícia da Silva (Contatar passageiro *)
*Leve em consideração! Todas as respostas chegarão a contatofbyb@gmail.com.
**Telefone**: 5600000000000
**Passageiros**: Adultos: 3 | Crianças: 1 | Infantes: 1

**Service id**: 15458
**Data de reserva**: 29/12/2026 - 02:28
**Código de reserva PAM**: 8700000
**ID Compra Decolar**: 13600000000
**Lugar de compra**: Chile
**Canal**: Despegar

**Produto comprado**: Descubra Floripa a bordo do Floripa by Bus Tour: Toda ilha
**Temporada**: Temporada 2019

**Data de excursão**: 14/01/2027

Para obter mais informação sobre esta reserva deverá ingressar ao sistema PAM. Política de cancelamento conforme contrato.`;

describe("lerEmailDecolar", () => {
  it("lê a nova reserva no formato real", () => {
    expect(ehEmailDecolar("Nova reserva", corpo)).toBe(true);
    const r = lerEmailDecolar("Nova reserva", corpo)!;
    expect(r).toMatchObject({
      canal: "DECOLAR", codigoExterno: "DEC-13600000000", data: "2027-01-14", horario: null, cancelada: false,
      produto: "Descubra Floripa a bordo do Floripa by Bus Tour: Toda ilha", contatoNome: "Pessoa Fictícia da Silva", contatoTelefone: "+5600000000000",
      observacoes: "Canal: Despegar · Compra: Chile",
    });
    expect(r.referencias).toEqual(["DEC-13600000000", "PAM-8700000"]);
    expect(r.passageiros.map((p) => p.categoria)).toEqual(["ADULTO", "ADULTO", "ADULTO", "INFANTIL", "COLO"]);
    expect(r.passageiros[0]!.nome).toBe("Pessoa Fictícia da Silva");
  });

  it("cancelamento pelo assunto; e-mail sem código ou data não é reconhecido", () => {
    expect(lerEmailDecolar("Reserva cancelada 13600000000", corpo.replace("foi gerada uma nova reserva", "a reserva foi cancelada"))!.cancelada).toBe(true);
    expect(lerEmailDecolar("Oferta", "Promoção imperdível: 10% off")).toBeNull();
    expect(ehEmailDecolar("Seu pedido", "Obrigado pela compra")).toBe(false);
  });
});
