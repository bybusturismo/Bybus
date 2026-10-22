import { describe, expect, it } from "vitest";
import type { RespostaManifesto } from "../../api/tipos";
import { comEmbarque, contarBloco } from "./Embarque";

const dados = {
  saida: {},
  passeio: {},
  manifesto: {
    alertas: [],
    totais: { passageiros: 2, assentos: 2, pagantes: 2, porCategoria: { ADULTO: 2, SENIOR: 0, INFANTIL: 0, COLO: 0, CORTESIA: 0 }, embarcados: 0, noShow: 0 },
    blocos: [
      {
        ponto: null,
        linhas: [1, 2].map((n) => ({
          numero: n,
          reservaId: "r",
          canal: "PAYTOUR",
          codigoExterno: null,
          contatoNome: "T",
          contatoTelefone: null,
          observacoes: null,
          passageiro: { id: `p${n}`, nome: `P${n}`, categoria: "ADULTO", embarque: "PENDENTE" },
        })),
      },
    ],
  },
} as unknown as RespostaManifesto;

describe("Modo embarque", () => {
  it("atualização otimista recalcula contadores", () => {
    const a = comEmbarque(dados, "p1", "EMBARCOU");
    const b = comEmbarque(a, "p2", "NO_SHOW");
    expect(b.manifesto.totais).toMatchObject({ embarcados: 1, noShow: 1 });
    expect(contarBloco(b.manifesto.blocos[0]!)).toEqual({ esperados: 2, embarcados: 1, noShow: 1, pendentes: 0 });
    expect(comEmbarque(b, "p1", "PENDENTE").manifesto.totais.embarcados).toBe(0);
  });
});
