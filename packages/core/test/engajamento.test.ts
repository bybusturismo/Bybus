import { describe, expect, it } from "vitest";
import {
  abreCasoInterno, atribuirVenda, calcularNps, canalDeAvaliacao, classificarNps, conviteDeAvaliacaoPublica, idiomaDoCliente, idiomaPelaOrigem, idiomaPeloTelefone,
  lembreteDevido, lerCsvAds, lerNumero, montarLinkUtm, montarPedidoAvaliacao, normalizarUtm, origemDoClique, periodoDoRelatorio, relatoriosDevidos, renderizarModelo,
  tempoDoFormularioOk, utmDoAfiliado, variacaoPercentual,
} from "../src/index.js";

describe("idioma do cliente", () => {
  it("pelo DDI do telefone", () => {
    expect(idiomaPeloTelefone("+55 48 99999-0000")).toBe("pt");
    expect(idiomaPeloTelefone("48 99999-0000")).toBe("pt");
    expect(idiomaPeloTelefone("54999998888")).toBe("pt"); // DDD 54 (RS), não a Argentina
    expect(idiomaPeloTelefone("+54 9 11 2345 6789")).toBe("es");
    expect(idiomaPeloTelefone("+1 415 555 0100")).toBe("en");
    expect(idiomaPeloTelefone("0044 20 7946 0958")).toBe("en");
    expect(idiomaPeloTelefone("+351 912 345 678")).toBe("pt");
    expect(idiomaPeloTelefone("+34 612 345 678")).toBe("es");
    expect(idiomaPeloTelefone("+49 151 2345 6789")).toBe("en");
    expect(idiomaPeloTelefone("123")).toBeNull();
    expect(idiomaPeloTelefone(null)).toBeNull();
  });
  it("pela origem: UF é português e ES é Espírito Santo, não Espanha", () => {
    expect(idiomaPelaOrigem("SP")).toBe("pt");
    expect(idiomaPelaOrigem("es")).toBe("pt");
    expect(idiomaPelaOrigem("Argentina")).toBe("es");
    expect(idiomaPelaOrigem("EUA")).toBe("en");
    expect(idiomaPelaOrigem("México")).toBe("es");
    expect(idiomaPelaOrigem("Narnia")).toBeNull();
  });
  it("país estrangeiro manda; senão telefone; senão português", () => {
    expect(idiomaDoCliente({ telefone: "+55 48 99999-0000", origemCliente: "Chile" })).toBe("es");
    expect(idiomaDoCliente({ telefone: "+1 415 555 0100", origemCliente: "SC" })).toBe("pt");
    expect(idiomaDoCliente({ telefone: "+1 415 555 0100" })).toBe("en");
    expect(idiomaDoCliente({})).toBe("pt");
  });
});

describe("mensagem de avaliação", () => {
  const links = { google: "https://g.page/r/exemplo", tripadvisor: "https://tripadvisor.exemplo/x" };
  it("Viator orienta a avaliar na Viator, sem link de outro canal", () => {
    expect(canalDeAvaliacao({ canalReal: "VIATOR", links })).toEqual({ canal: "VIATOR", link: null });
    const p = montarPedidoAvaliacao({ nome: "John Sample", passeio: "City Tour", data: "05/11/2026", idioma: "en", canalReal: "VIATOR", links });
    expect(p.texto).toContain("Viator");
    expect(p.texto).not.toContain("g.page");
    expect(p.texto).toContain("Hi John!");
  });
  it("Google é o padrão; Tripadvisor quando escolhido; cai no outro se faltar link", () => {
    expect(canalDeAvaliacao({ canalReal: "PAYTOUR", links }).canal).toBe("GOOGLE");
    expect(canalDeAvaliacao({ canalReal: "PAYTOUR", links, escolhido: "TRIPADVISOR" }).canal).toBe("TRIPADVISOR");
    expect(canalDeAvaliacao({ canalReal: "PAYTOUR", links: { google: null, tripadvisor: links.tripadvisor } }).canal).toBe("TRIPADVISOR");
    expect(canalDeAvaliacao({ canalReal: "PAYTOUR", links: { google: null, tripadvisor: null } })).toEqual({ canal: "NENHUM", link: null });
  });
  it("texto no idioma do cliente com só o primeiro nome", () => {
    const p = montarPedidoAvaliacao({ nome: "Lucía Prueba Gómez", passeio: "Toda a Ilha", data: "05/11/2026", idioma: "es", canalReal: "PAYTOUR", links });
    expect(p.texto).toContain("¡Hola, Lucía!");
    expect(p.texto).toContain("https://g.page/r/exemplo");
    expect(p.texto).not.toContain("Gómez");
  });
  it("modelo próprio e variável desconhecida", () => {
    expect(renderizarModelo("Oi {nome} {x}", { nome: "Ana" })).toBe("Oi Ana {x}");
  });
  it("lembrete só 7 dias depois de um pedido já feito", () => {
    const agora = new Date("2026-11-20T12:00:00Z");
    expect(lembreteDevido("2026-11-13T11:00:00Z", "ENVIADA_MANUAL", agora)).toBe(true);
    expect(lembreteDevido("2026-11-14T11:00:00Z", "SIMULADA", agora)).toBe(false);
    expect(lembreteDevido("2026-11-01T11:00:00Z", "PENDENTE", agora)).toBe(false);
    expect(lembreteDevido("2026-11-01T11:00:00Z", "AVALIADA", agora)).toBe(false);
    expect(lembreteDevido(null, "ENVIADA_MANUAL", agora)).toBe(false);
  });
});

describe("UTM", () => {
  it("normaliza", () => {
    expect(normalizarUtm("  Promoção Verão 2026!! ")).toBe("promocao-verao-2026");
    expect(normalizarUtm(null)).toBe("");
  });
  it("monta o link mantendo parâmetros e exige https", () => {
    const url = new URL(montarLinkUtm("https://loja.exemplo.test/passeio?x=1", { origem: "Google", midia: "cpc", campanha: "Toda Ilha", ref: "HOTEL-A" }));
    expect(url.searchParams.get("x")).toBe("1");
    expect(url.searchParams.get("utm_source")).toBe("google");
    expect(url.searchParams.get("utm_campaign")).toBe("toda-ilha");
    expect(url.searchParams.get("ref")).toBe("HOTEL-A");
    expect(() => montarLinkUtm("http://x.test", { origem: "a", midia: "b", campanha: "c" })).toThrow();
    expect(() => montarLinkUtm("https://x.test", { origem: "", midia: "b", campanha: "c" })).toThrow();
  });
  it("UTM do afiliado", () => expect(utmDoAfiliado("Hotel-Mar").campanha).toBe("afiliado-hotel-mar"));
});

describe("atribuição de venda", () => {
  const c1 = { id: "c1", utmCampanha: "ads-toda-ilha", cupom: "ILHA10", inicio: "2026-10-01", fim: null };
  const c2 = { id: "c2", utmCampanha: null, cupom: "BC15", inicio: "2026-10-10", fim: "2026-10-31" };
  const af = [{ id: "a1", codigo: "HOTEL-MAR", paytourAfiliadoId: "77" }];
  it("UTM tem prioridade sobre o cupom", () => {
    expect(atribuirVenda({ utmCampaign: "Ads-Toda-Ilha", cupomExternoId: "BC15", dia: "2026-10-20" }, [c1, c2])).toMatchObject({ campanhaId: "c1", regraCampanha: "UTM" });
  });
  it("cupom sem diferenciar maiúsculas", () => {
    expect(atribuirVenda({ cupomExternoId: " bc15 ", dia: "2026-10-20" }, [c1, c2])).toMatchObject({ campanhaId: "c2", regraCampanha: "CUPOM" });
  });
  it("fora do período da campanha não atribui (borda: último dia vale, o seguinte não)", () => {
    expect(atribuirVenda({ cupomExternoId: "BC15", dia: "2026-10-31" }, [c2]).campanhaId).toBe("c2");
    expect(atribuirVenda({ cupomExternoId: "BC15", dia: "2026-11-01" }, [c2]).campanhaId).toBeNull();
    expect(atribuirVenda({ cupomExternoId: "BC15", dia: "2026-10-09" }, [c2]).campanhaId).toBeNull();
  });
  it("sem sinal nenhum, sem atribuição; UTM vazio nunca casa com campanha sem UTM", () => {
    expect(atribuirVenda({ dia: "2026-10-20" }, [c1, c2])).toEqual({ campanhaId: null, regraCampanha: null, afiliadoId: null });
    expect(atribuirVenda({ utmCampaign: "", cupomExternoId: "", dia: "2026-10-20" }, [c2]).campanhaId).toBeNull();
  });
  it("empate: a campanha mais recente", () => {
    const velha = { ...c1, id: "velha", inicio: "2026-09-01" };
    expect(atribuirVenda({ utmCampaign: "ads-toda-ilha", dia: "2026-10-20" }, [velha, c1]).campanhaId).toBe("c1");
  });
  it("afiliado pelo id da Paytour ou pelo UTM do QR", () => {
    expect(atribuirVenda({ afiliadoId: "77", dia: null }, [], af).afiliadoId).toBe("a1");
    expect(atribuirVenda({ utmCampaign: "afiliado-hotel-mar", dia: null }, [], af).afiliadoId).toBe("a1");
    expect(atribuirVenda({ afiliadoId: "78", dia: null }, [], af).afiliadoId).toBeNull();
  });
});

describe("NPS", () => {
  it("classifica nas bordas", () => {
    expect([0, 6, 7, 8, 9, 10].map(classificarNps)).toEqual(["DETRATOR", "DETRATOR", "NEUTRO", "NEUTRO", "PROMOTOR", "PROMOTOR"]);
    expect(() => classificarNps(11)).toThrow();
    expect(() => classificarNps(-1)).toThrow();
    expect(() => classificarNps(7.5)).toThrow();
  });
  it("nota 0 a 6 abre caso interno", () => {
    expect(abreCasoInterno(6)).toBe(true);
    expect(abreCasoInterno(7)).toBe(false);
  });
  it("calcula o NPS (promotores − detratores)", () => {
    expect(calcularNps([10, 10, 9, 8, 3])).toEqual({ total: 5, promotores: 3, neutros: 1, detratores: 1, nps: 40 });
    expect(calcularNps([])).toEqual({ total: 0, promotores: 0, neutros: 0, detratores: 0, nps: null });
    expect(calcularNps([0, 0]).nps).toBe(-100);
  });
  it("o convite de avaliação pública NÃO depende da nota (sem review gating)", () => {
    for (let n = 0; n <= 10; n++) {
      expect(conviteDeAvaliacaoPublica(true, n)).toBe(true);
      expect(conviteDeAvaliacaoPublica(false, n)).toBe(false);
    }
  });
});

describe("CSV de anúncios", () => {
  it("Google Ads em português: título e período antes do cabeçalho, ; e vírgula decimal, linha de total", () => {
    const csv = ["Relatório de campanha", "1 de novembro de 2026 - 3 de novembro de 2026", "Dia;Campanha;Cliques;Impr.;Custo;Custo / conv.", "2026-11-01;Toda Ilha;12;340;\"1.234,56\";20,00", "2026-11-02;Toda Ilha;8;200;99,90;10,00", "Total: conta;;20;540;1.334,46;"].join("\n");
    const r = lerCsvAds(csv);
    expect(r.erros).toEqual([]);
    expect(r.linhas).toEqual([
      { dia: "2026-11-01", custoCentavos: 123456, cliques: 12, impressoes: 340 },
      { dia: "2026-11-02", custoCentavos: 9990, cliques: 8, impressoes: 200 },
    ]);
  });
  it("Meta Ads em inglês com datas ISO e ponto decimal; soma linhas do mesmo dia", () => {
    const csv = "Reporting starts,Campaign name,Amount spent (BRL),Link clicks,Impressions\n2026-11-01,A,10.50,3,100\n2026-11-01,B,5.25,2,50\n";
    expect(lerCsvAds(csv).linhas).toEqual([{ dia: "2026-11-01", custoCentavos: 1575, cliques: 5, impressoes: 150 }]);
  });
  it("data brasileira, BOM e erros por linha", () => {
    const csv = "﻿Dia,Custo\n01/11/2026,\"R$ 1,50\"\n31/02/2026,2\n02/11/2026,abc\n";
    const r = lerCsvAds(csv);
    expect(r.linhas).toEqual([{ dia: "2026-11-01", custoCentavos: 150, cliques: null, impressoes: null }]);
    expect(r.erros).toEqual(["Linha 3: data inválida.", "Linha 4: custo inválido."]);
  });
  it("sem cabeçalho reconhecível explica o que exportar", () => {
    const r = lerCsvAds("a,b\n1,2");
    expect(r.linhas).toEqual([]);
    expect(r.erros[0]).toMatch(/Dia e Custo/);
  });
  it("lerNumero", () => {
    expect([lerNumero("1.234,56"), lerNumero("1,234.56"), lerNumero("12,5"), lerNumero("1.234"), lerNumero("0.5"), lerNumero("x")]).toEqual([1234.56, 1234.56, 12.5, 1234, 0.5, null]);
  });
});

describe("períodos dos relatórios", () => {
  it("semanal: a última semana completa, a partir de qualquer dia", () => {
    const p = periodoDoRelatorio("SEMANAL", "2026-11-09"); // segunda
    expect([p.de, p.ate, p.anteriorDe, p.anteriorAte]).toEqual(["2026-11-02", "2026-11-08", "2026-10-26", "2026-11-01"]);
    expect(periodoDoRelatorio("SEMANAL", "2026-11-15").de).toBe("2026-11-02"); // domingo ainda é da semana corrente
  });
  it("mensal: o mês anterior, também na virada do ano", () => {
    const p = periodoDoRelatorio("MENSAL", "2026-11-01");
    expect([p.de, p.ate, p.anteriorDe, p.anteriorAte]).toEqual(["2026-10-01", "2026-10-31", "2026-09-01", "2026-09-30"]);
    expect(p.rotulo).toBe("Outubro de 2026");
    const j = periodoDoRelatorio("MENSAL", "2027-01-01");
    expect([j.de, j.ate, j.anteriorDe]).toEqual(["2026-12-01", "2026-12-31", "2026-11-01"]);
    expect(periodoDoRelatorio("MENSAL", "2026-03-01").ate).toBe("2026-02-28");
  });
  it("quando gerar: segunda e dia 1, depois das 7h", () => {
    expect(relatoriosDevidos("2026-11-09", "06:59")).toEqual([]);
    expect(relatoriosDevidos("2026-11-09", "07:00")).toEqual(["SEMANAL"]);
    expect(relatoriosDevidos("2026-11-10", "09:00")).toEqual([]);
    expect(relatoriosDevidos("2026-12-01", "08:00")).toEqual(["MENSAL"]); // terça
    expect(relatoriosDevidos("2026-06-01", "08:00")).toEqual(["SEMANAL", "MENSAL"]); // segunda e dia 1
  });
  it("variação percentual", () => {
    expect(variacaoPercentual(150, 100)).toBe(50);
    expect(variacaoPercentual(50, 100)).toBe(-50);
    expect(variacaoPercentual(5, 0)).toBeNull();
    expect(variacaoPercentual(0, 0)).toBe(0);
  });
});

describe("bio e formulário", () => {
  it("origem do clique sem dado pessoal", () => {
    expect(origemDoClique("Instagram")).toBe("instagram");
    expect(origemDoClique("")).toBe("direto");
    expect(origemDoClique("a".repeat(100)).length).toBe(40);
    expect(origemDoClique("joao@exemplo.test")).toBe("joaoexemplotest");
  });
  it("tempo mínimo e máximo do formulário", () => {
    expect(tempoDoFormularioOk(0, 3999)).toBe(false);
    expect(tempoDoFormularioOk(0, 4000)).toBe(true);
    expect(tempoDoFormularioOk(0, 7_200_000)).toBe(true);
    expect(tempoDoFormularioOk(0, 7_200_001)).toBe(false);
  });
});

import { resumoNumeros, type DadosRelatorio } from "../src/index.js";
describe("resumo do relatório", () => {
  const base: DadosRelatorio = {
    periodo: { de: "2026-11-02", ate: "2026-11-08", anteriorDe: "2026-10-26", anteriorAte: "2026-11-01", rotulo: "Semana de 02/11/2026 a 08/11/2026" },
    vendas: { atual: { reservas: 30, passageiros: 80, receitaCentavos: 1_234_500 }, anterior: { reservas: 20, passageiros: 50, receitaCentavos: 900_000 }, variacao: { reservas: 50, passageiros: 60, receita: 37.2 }, porCanal: [{ canal: "PAYTOUR", reservas: 20, passageiros: 50, receitaCentavos: 1_000_000, reservasAnterior: 10, variacaoReservas: 100 }] },
    origem: [{ origem: "SP", passageiros: 20 }],
    campanhas: [{ nome: "Ads", midia: "GOOGLE_ADS", reservas: 5, receitaCentavos: 200_000, investimentoCentavos: 50_000, custoOrigem: "CSV", custoPorReservaCentavos: 10_000, retorno: 4 }],
    avaliacoes: { pedidosFeitos: 10, avaliados: 3, pedidosFeitosAnterior: 8, avaliadosAnterior: 2, notaInterna: 4.5, notaInternaAnterior: null, notasCanais: [{ canal: "GOOGLE", nota: 4.8, quantidade: 120 }] },
    nps: { respostas: 12, nps: 58, npsAnterior: 50, detratores: 1 },
    orcamentos: { recebidos: 3, recebidosAnterior: 0, fechados: 1 },
    bio: { visitas: 100, cliques: 40, visitasAnterior: 80, cliquesAnterior: 20 },
  };
  it("traz os números e a comparação", () => {
    const t = resumoNumeros(base);
    expect(t).toContain("Reservas: 30 (+50% sobre o período anterior)");
    expect(t).toContain("R$");
    expect(t).toContain("Paytour 20");
    expect(t).toContain("NPS: 58");
    expect(t).toContain("sem base de comparação"); // orçamentos: 3 contra 0
    expect(t).toContain("+100%"); // cliques da bio
  });
  it("sem campanha e sem receita", () => {
    const t = resumoNumeros({ ...base, campanhas: [], vendas: { ...base.vendas, atual: { ...base.vendas.atual, receitaCentavos: null } }, orcamentos: null, bio: null });
    expect(t).toContain("Nenhuma venda atribuída a campanha");
    expect(t).not.toContain("Receita das reservas");
    expect(t).not.toContain("Orçamentos");
  });
});
