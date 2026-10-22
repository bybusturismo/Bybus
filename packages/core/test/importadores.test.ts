import { describe, expect, it } from "vitest";
import { lerCsv, lerCsvPaytour, lerDataBokun, lerEmailBokun, lerPax } from "../src/index.js";

// E-mail no formato da Bókun, com dados FICTÍCIOS.
const EMAIL_BOKUN = ` *|SUBJECT|*
The following booking was just created.

| Booking ref. | VIA-900000001 |
| Product booking ref. | BYB-T900000001[](https://exemplo.bokun.io/bookings/activity/900000001) |
| Ext. booking ref | 9000000001 |
| Product | 165696P2 - Floripa City Tour by Bus - Whole Island - The Most Complete City Tour |
| Supplier | BY BUS TURISMO |
| Sold by | Viator.com |
| Booking channel | Viator.com |
| Customer | Exemplo, Maria |
| Customer email | maria@exemplo.invalid |
| Customer phone | +1 555-000-0000 |
| Date | Sat 24.Oct '26 @ 08:00 |
| Rate | Floripa City Tour by Bus |
| PAX | 2 Adult, 1 Child |
| Created | Wed, October 21 2026 @ 05:07 |
`;

describe("Bókun (e-mail)", () => {
  it("lê data e pax", () => {
    expect(lerDataBokun("Sat 24.Oct '26 @ 08:00")).toEqual({ data: "2026-10-24", horario: "08:00" });
    expect(lerPax("1 Senior").categorias).toEqual(["SENIOR"]);
    expect(lerPax("2 Adult, 1 Child").categorias).toEqual(["ADULTO", "ADULTO", "INFANTIL"]);
  });

  it("converte o e-mail em reserva", () => {
    const r = lerEmailBokun("New booking: Sat 24.Oct '26 @ 08:00 (BYB-T900000001)", EMAIL_BOKUN)!;
    expect(r).toMatchObject({
      canal: "VIATOR",
      codigoExterno: "VIA-900000001",
      data: "2026-10-24",
      horario: "08:00",
      contatoNome: "Maria Exemplo",
      cancelada: false,
    });
    expect(r.referencias).toEqual(["BYB-T900000001", "9000000001"]);
    expect(r.passageiros.map((p) => p.categoria)).toEqual(["ADULTO", "ADULTO", "INFANTIL"]);
    expect(r.passageiros[0]!.nome).toBe("Maria Exemplo");
    expect(r.passageiros[1]!.nome).toBe("");
  });

  it("marca cancelamento pelo assunto e ignora e-mails sem reserva", () => {
    expect(lerEmailBokun("Cancelled booking: Sat 24.Oct '26", EMAIL_BOKUN)!.cancelada).toBe(true);
    expect(lerEmailBokun("Newsletter", "Olá!")).toBeNull();
  });
});

describe("Paytour (CSV)", () => {
  it("lê CSV com ; e aspas", () => {
    expect(lerCsv('a;b\n"x;1";"di""z"\n')).toEqual([["a", "b"], ["x;1", 'di"z']]);
  });

  it("agrupa passageiros por código, detecta espelho de OTA e cancelamento", () => {
    const csv = [
      "Código;Data;Atividade;Nome;Documento;Categoria;Ponto de embarque;Afiliado;Status;Observações",
      "1001;24/10/2026;City Tour Toda Ilha;Ana Teste;529.982.247-25;Adulto;Villa Romana Shopping;;Confirmada;",
      "1001;24/10/2026;City Tour Toda Ilha;Beto Teste;;Infantil;Villa Romana Shopping;;Confirmada;",
      "1002;24/10/2026;City Tour Toda Ilha;Cliente Viator;1111;Sênior;;tripadvisorinternobybus@gmail.com;Confirmada;VIA-900000001",
      "1003;24/10/2026;City Tour Toda Ilha;Cliente Cancelado;;Adulto;;;Cancelada;",
    ].join("\n");
    const { reservas, erros } = lerCsvPaytour(csv);
    expect(erros).toEqual([]);
    expect(reservas).toHaveLength(3);
    const [a, b, c] = reservas;
    expect(a).toMatchObject({ canal: "PAYTOUR", codigoExterno: "PAYTOUR-1001", data: "2026-10-24", pontoEmbarqueTexto: "Villa Romana Shopping" });
    expect(a!.passageiros.map((p) => [p.nome, p.categoria, p.documentoTipo])).toEqual([
      ["Ana Teste", "ADULTO", "CPF"],
      ["Beto Teste", "INFANTIL", null],
    ]);
    expect(b).toMatchObject({ canal: "VIATOR", referencias: ["VIA-900000001"] });
    expect(b!.passageiros[0]).toMatchObject({ categoria: "SENIOR", documento: null });
    expect(c!.cancelada).toBe(true);
  });

  it("aponta colunas obrigatórias ausentes", () => {
    expect(lerCsvPaytour("Foo;Bar\n1;2").erros[0]!.mensagem).toMatch(/obrigatória/);
  });
});
