import { describe, expect, it } from "vitest";
import { montarContratoGrupo, montarReciboGrupo, type DadosEmpresaContrato, type DadosGrupoContrato } from "../src/index.js";

const empresa: DadosEmpresaContrato = { razaoSocial: "By Bus Turismo", cnpj: "09.529.650/0001-01", endereco: "Avenida Exemplo, 1, Florianópolis/SC", cidadeForo: "Florianópolis/SC", assinanteNome: "Diretora Fictícia", assinanteCargo: "Diretora" };
const grupo: DadosGrupoContrato = {
  nome: "Escola Fictícia", estilo: "ESCOLA", razaoSocial: "Escola Fictícia Ltda", cnpj: "00.000.000/0001-00", endereco: "Rua Fictícia, 10", representanteNome: "Representante Fictícia", representanteCargo: "Diretora",
  dataPasseio: "2026-10-29", horarioInicio: "08:00", localInicio: "Terminal fictício", roteiro: "Centro histórico\nLagoa da Conceição\nAlmoço nos Ingleses", duracaoTexto: "8 a 8h30",
  almoco: true, localAlmoco: "região dos Ingleses", pessoas: 30, pessoasMinimo: 25, cortesias: 3, valorPorPessoaCentavos: 13000, valorTotalCentavos: 390000, sinalPercentual: 50,
  vencimentoSinal: "2026-10-05", prazoLista: "2026-10-26",
};
const texto = (b: ReturnType<typeof montarContratoGrupo>) => b.map((x) => ("texto" in x ? x.texto : JSON.stringify(x))).join("\n");

describe("contrato de grupo (13/11/2026)", () => {
  it("monta as 16 cláusulas com os dados e os valores do modelo do dono", () => {
    const t = texto(montarContratoGrupo(grupo, empresa, "2026-10-13"));
    expect(t).toContain("CONTRATO DE PRESTAÇÃO DE SERVIÇOS – PASSEIO PEDAGÓGICO");
    expect((t.match(/CLÁUSULA \d+ª/g) ?? []).length).toBe(16);
    expect(t).toContain("**R$ 130,00 (cento e trinta reais)** por aluno");
    expect(t).toContain("**25 (vinte e cinco) alunos**");
    expect(t).toContain("o valor mínimo do serviço será de **R$ 3.250,00 (três mil duzentos e cinquenta reais)**");
    expect(t).toContain("equivalente a **R$ 1.625,00 (mil seiscentos e vinte e cinco reais)**, até **05/10/2026**");
    expect(t).toContain("**03 (três) vaga(s) de professores e/ou monitores como cortesia**");
    expect(t).toContain("a) Centro histórico");
    expect(t).toContain("parada para almoço em região dos Ingleses");
    expect(t).toContain("**não será devolvido**");
    expect(t).toContain("**12 (doze) meses**");
    expect(t).toContain("Florianópolis/SC, 13 de outubro de 2026.");
    expect(t).toContain("Representante: Diretora Fictícia (Diretora)");
  });

  it("empresa (não escola) fala em participantes; sem dados, deixa linhas para preencher", () => {
    const t = texto(montarContratoGrupo({ ...grupo, estilo: "EMPRESA", pessoasMinimo: null, valorPorPessoaCentavos: null, valorTotalCentavos: null, dataPasseio: null, roteiro: null, cortesias: 0 }, { ...empresa, assinanteNome: null }, "2026-11-13"));
    expect(t).toContain("PASSEIO TURÍSTICO EM GRUPO");
    expect(t).not.toMatch(/alunos/);
    expect(t).toContain("R$ ____________");
    expect(t).toContain("Representante: ____________");
  });

  it("recibo com valor por extenso", () => {
    const t = texto(montarReciboGrupo({ empresa, pagador: "Escola Fictícia Ltda", cnpjPagador: "00.000.000/0001-00", valorCentavos: 162500, referente: "sinal do passeio de 29/10/2026", pagoEm: "2026-10-04" }));
    expect(t).toContain("RECIBO — R$ 1.625,00");
    expect(t).toContain("a quantia de **R$ 1.625,00 (mil seiscentos e vinte e cinco reais)**, referente a sinal do passeio de 29/10/2026.");
    expect(t).toContain("Florianópolis/SC, 4 de outubro de 2026.");
  });
});
