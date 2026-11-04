/** Marketing da demonstração: painéis agregados, campanhas, conteúdo, afiliados e avaliações. Tudo fictício. */
import { NAO, UN_BC, UN_FLN, achar, aplicar, somarMeses, type Rotear } from "./comum";

const URL_LOJA = "https://loja.exemplo.test";
const MODELO_PADRAO = "Olá, {nome}! Como foi o seu passeio no {passeio}? Conte pra gente com uma nota de 1 a 5. Sua opinião ajuda muito!";

interface Resultado { id: string; mes: string; reservas: number; passageiros: number; receitaCentavos: number | null; fonte: string }
interface Campanha { id: string; unidadeId: string | null; nome: string; midia: string; inicio: string; fim: string | null; investimentoCentavos: number; cupom: string | null; utmCampanha: string | null; metaReservas: number | null; observacoes: string | null; ativa: boolean; resultados: Resultado[] }
interface Afiliado { id: string; unidadeId: string | null; nome: string; tipo: string; codigo: string; comissaoPontosBase: number | null; contato: string | null; paytourAfiliadoId: string | null; observacoes: string | null; ativo: boolean }
interface Conteudo { id: string; unidadeId: string | null; titulo: string; rede: string; status: string; dataPrevista: string | null; legenda: string | null; link: string | null; responsavelId: string | null }
interface Pedido { id: string; reservaId: string; status: string; texto: string; data: string; passeio: string; canal: string }
interface Nota { reservaId: string; nota: number; guia: string; canal: string }

let semeado = false;
let hoje = "";
let config = { modeloAvaliacao: MODELO_PADRAO, linkTripadvisor: "https://tripadvisor.exemplo.test/avaliar" as string | null };
const responsaveis = [{ id: "rs-1", nome: "Atendente Demo" }, { id: "rs-2", nome: "Supervisora Demo" }];
const campanhas: Campanha[] = [];
const afiliados: Afiliado[] = [];
const conteudos: Conteudo[] = [];
const pedidos: Pedido[] = [];
const notas: Nota[] = [];

function semear(dataMais: (n: number) => string) {
  if (semeado) return;
  semeado = true;
  hoje = dataMais(0);
  const mes = hoje.slice(0, 7);
  const m1 = somarMeses(mes, -1);
  const m2 = somarMeses(mes, -2);
  campanhas.push(
    {
      id: "cp-1", unidadeId: UN_FLN, nome: "Google Ads — City Tour Toda Ilha", midia: "GOOGLE_ADS", inicio: `${m2}-01`, fim: null, investimentoCentavos: 1_200_000, cupom: "ILHA10", utmCampanha: "ads-toda-ilha", metaReservas: 120, observacoes: null, ativa: true,
      resultados: [
        { id: "cr-1", mes: m2, reservas: 41, passageiros: 98, receitaCentavos: 1_960_000, fonte: "Paytour" },
        { id: "cr-2", mes: m1, reservas: 58, passageiros: 141, receitaCentavos: 2_820_000, fonte: "Paytour" },
      ],
    },
    {
      id: "cp-2", unidadeId: UN_BC, nome: "Instagram — Balneário Camboriú", midia: "INSTAGRAM", inicio: `${m1}-10`, fim: null, investimentoCentavos: 450_000, cupom: "BC15", utmCampanha: "insta-bc", metaReservas: 40, observacoes: "Impulsionamento de vídeos do trenzinho.", ativa: true,
      resultados: [{ id: "cr-3", mes: m1, reservas: 17, passageiros: 39, receitaCentavos: 702_000, fonte: "Paytour" }],
    },
    {
      id: "cp-3", unidadeId: UN_FLN, nome: "Cartazes no aeroporto (offline)", midia: "OFFLINE", inicio: `${m2}-05`, fim: `${m1}-28`, investimentoCentavos: 800_000, cupom: null, utmCampanha: null, metaReservas: null, observacoes: "Sem cupom: atribuição ainda não é possível.", ativa: false, resultados: [],
    },
  );
  afiliados.push(
    { id: "af-1", unidadeId: UN_FLN, nome: "Hotel Mar Azul (fictício)", tipo: "HOTEL", codigo: "HOTEL-MAR-AZUL", comissaoPontosBase: 1000, contato: "recepcao@marazul.exemplo.test", paytourAfiliadoId: null, observacoes: null, ativo: true },
    { id: "af-2", unidadeId: UN_FLN, nome: "Pousada Lagoa (fictícia)", tipo: "POUSADA", codigo: "POUSADA-LAGOA", comissaoPontosBase: 800, contato: null, paytourAfiliadoId: null, observacoes: null, ativo: true },
    { id: "af-3", unidadeId: UN_BC, nome: "Agência Viva Sul (fictícia)", tipo: "AGENCIA", codigo: "VIVA-SUL", comissaoPontosBase: null, contato: "contato@vivasul.exemplo.test", paytourAfiliadoId: null, observacoes: "Comissão a confirmar.", ativo: true },
  );
  conteudos.push(
    { id: "ct-1", unidadeId: UN_FLN, titulo: "Reels: o que ver no City Tour Toda Ilha", rede: "INSTAGRAM", status: "AGENDADO", dataPrevista: dataMais(2), legenda: "Seis paradas, 110 km e muita vista bonita. Reserve pelo site!", link: null, responsavelId: "rs-1" },
    { id: "ct-2", unidadeId: UN_BC, titulo: "Vídeo: trenzinho ao pôr do sol", rede: "TIKTOK", status: "PRODUCAO", dataPrevista: dataMais(5), legenda: null, link: null, responsavelId: "rs-2" },
    { id: "ct-3", unidadeId: UN_FLN, titulo: "Post: dicas de roupa e protetor para o passeio", rede: "FACEBOOK", status: "IDEIA", dataPrevista: null, legenda: null, link: null, responsavelId: null },
    { id: "ct-4", unidadeId: null, titulo: "Artigo do blog: roteiro de 1 dia em Florianópolis", rede: "BLOG", status: "PUBLICADO", dataPrevista: dataMais(-6), legenda: null, link: "https://blog.exemplo.test/roteiro-1-dia", responsavelId: "rs-1" },
  );
  const nomesPasseio = ["City Tour Toda Ilha", "City Tour Balneário Camboriú"];
  (["PENDENTE", "PENDENTE", "ENVIADA_MANUAL", "SEM_TELEFONE"] as const).forEach((status, i) => pedidos.push({
    id: `pd-${i + 1}`, reservaId: `rv-demo-${i + 1}`, status, data: dataMais(-(i + 1)), passeio: nomesPasseio[i % 2]!, canal: ["PAYTOUR", "VIATOR", "PAYTOUR", "CIVITATIS"][i]!,
    texto: MODELO_PADRAO.replace("{nome}", ["Ana Exemplo", "John Sample", "Carla Teste", "Lucía Prueba"][i]!).replace("{passeio}", nomesPasseio[i % 2]!),
  }));
  ([[5, "Guia Fictícia Ana", "PAYTOUR"], [5, "Guia Fictícia Ana", "VIATOR"], [4, "Guia Fictícia Bia", "PAYTOUR"], [5, "Guia Fictícia Bia", "DECOLAR"], [5, "Guia Fictícia Ana", "PAYTOUR"], [3, "Guia Fictícia Bia", "CIVITATIS"], [4, "Guia Fictícia Ana", "PAYTOUR"], [5, "Guia Fictícia Bia", "PAYTOUR"]] as const)
    .forEach(([nota, guia, canal], i) => notas.push({ reservaId: `rv-nota-${i + 1}`, nota, guia, canal }));
}

const dinheiroTot = (rs: Resultado[]) => (rs.some((r) => r.receitaCentavos != null) ? rs.reduce((s, r) => s + (r.receitaCentavos ?? 0), 0) : null);
function campanhaPublica(cp: Campanha) {
  const reservas = cp.resultados.reduce((s, r) => s + r.reservas, 0);
  const passageiros = cp.resultados.reduce((s, r) => s + r.passageiros, 0);
  const receita = dinheiroTot(cp.resultados);
  const tem = cp.resultados.length > 0;
  return {
    ...cp, totais: { reservas, passageiros, receitaCentavos: receita },
    indicadores: {
      temAtribuicao: tem, custoPorReservaCentavos: tem && reservas > 0 ? Math.round(cp.investimentoCentavos / reservas) : null, custoPorPassageiroCentavos: tem && passageiros > 0 ? Math.round(cp.investimentoCentavos / passageiros) : null,
      retorno: tem && receita != null && cp.investimentoCentavos > 0 ? Math.round((receita / cp.investimentoCentavos) * 100) / 100 : null, atingimentoMeta: cp.metaReservas ? Math.round((reservas / cp.metaReservas) * 100) : null,
    },
  };
}
const afiliadoPublico = (a: Afiliado) => ({ ...a, link: `${URL_LOJA}/?ref=${encodeURIComponent(a.codigo)}` });
const media = (ns: number[]) => (ns.length ? Math.round((ns.reduce((s, n) => s + n, 0) / ns.length) * 10) / 10 : null);
const agrupar = (chave: (n: Nota) => string) => [...new Set(notas.map(chave))].sort().map((k) => { const ns = notas.filter((n) => chave(n) === k).map((n) => n.nota); return { chave: k, quantidade: ns.length, media: media(ns) }; });

export const rotearMarketing: Rotear = (ctx, metodo, caminho, q, c) => {
  if (!caminho.startsWith("/api/marketing/")) return NAO;
  semear(ctx.dataMais);
  let m: RegExpMatchArray | null;
  const r = (re: RegExp) => (m = caminho.match(re));
  const ver = () => ctx.exigir("marketing:ver");
  const gerir = () => ctx.exigir("marketing:gerenciar");

  // Painéis agregados (sem dado de cliente)
  if (metodo === "GET" && caminho === "/api/marketing/painel/canais") {
    ver();
    const mes = hoje.slice(0, 7);
    const dados = [["PAYTOUR", 212, 541], ["VIATOR", 74, 168], ["BALCAO", 61, 133], ["DECOLAR", 38, 92], ["CIVITATIS", 29, 71], ["OUTRO", 6, 14]] as const;
    const totalR = dados.reduce((s, d) => s + d[1], 0);
    const totalP = dados.reduce((s, d) => s + d[2], 0);
    const linhas = [[mes, "toda-ilha", "City Tour Toda Ilha", 128, 322], [somarMeses(mes, -1), "toda-ilha", "City Tour Toda Ilha", 142, 351], [mes, "bc-tour", "City Tour Balneário Camboriú", 52, 118], [somarMeses(mes, -1), "bc-tour", "City Tour Balneário Camboriú", 66, 149], [somarMeses(mes, -2), "toda-ilha", "City Tour Toda Ilha", 48, 112]] as const;
    return {
      periodo: { de: q.get("de"), ate: q.get("ate") }, total: { reservas: totalR, passageiros: totalP },
      porCanal: dados.map(([canal, reservas, passageiros]) => ({ canal, reservas, passageiros, percentual: Math.round((passageiros / totalP) * 1000) / 10 })),
      porPasseioMes: [...linhas].sort((a, b) => b[0].localeCompare(a[0]) || a[2].localeCompare(b[2])).map(([mesL, passeioId, passeio, reservas, passageiros]) => ({ mes: mesL, passeioId, passeio, reservas, passageiros })),
    };
  }
  if (metodo === "GET" && caminho === "/api/marketing/painel/origem") {
    ver();
    const dados = [["SC", 168], ["SP", 142], ["RS", 96], ["PR", 88], ["MG", 54], ["RJ", 47], ["ARG", 52], ["USA", 28], ["CHL", 19], ["URY", 14]] as const;
    const totalInf = dados.reduce((s, d) => s + d[1], 0);
    return {
      ranking: dados.map(([origem, passageiros]) => ({ origem, reservas: Math.round(passageiros / 2.4), passageiros, percentual: Math.round((passageiros / totalInf) * 1000) / 10 })),
      outras: 23, semInformacao: { reservas: 31, passageiros: 74 }, totalInformado: totalInf,
    };
  }

  // Campanhas
  if (metodo === "GET" && caminho === "/api/marketing/campanhas") {
    ver();
    const lista = campanhas.map(campanhaPublica);
    return {
      atribuicao: { situacao: "PARCIAL", nota: "Resultados lançados à mão por mês. A atribuição automática pelo cupom ou UTM da Paytour ainda está a confirmar." },
      campanhas: lista, totais: { investimentoCentavos: lista.reduce((s, x) => s + x.investimentoCentavos, 0), reservasAtribuidas: lista.reduce((s, x) => s + x.totais.reservas, 0) },
    };
  }
  if (metodo === "POST" && caminho === "/api/marketing/campanhas") {
    gerir();
    const x: Campanha = { id: ctx.id("cp"), unidadeId: c.unidadeId ?? null, nome: c.nome, midia: c.midia, inicio: c.inicio, fim: c.fim ?? null, investimentoCentavos: c.investimentoCentavos ?? 0, cupom: c.cupom ?? null, utmCampanha: c.utmCampanha ?? null, metaReservas: c.metaReservas ?? null, observacoes: c.observacoes ?? null, ativa: c.ativa ?? true, resultados: [] };
    campanhas.push(x);
    return campanhaPublica(x);
  }
  if (r(/^\/api\/marketing\/campanhas\/([^/]+)$/)) {
    gerir();
    const x = achar(campanhas, m![1]!, ctx, "Campanha");
    if (metodo === "DELETE") { campanhas.splice(campanhas.indexOf(x), 1); return { ok: true }; }
    if (metodo === "PATCH") return campanhaPublica(aplicar(x, c, ["unidadeId", "nome", "midia", "inicio", "fim", "investimentoCentavos", "cupom", "utmCampanha", "metaReservas", "observacoes", "ativa"]));
  }
  if (metodo === "POST" && r(/^\/api\/marketing\/campanhas\/([^/]+)\/resultados$/)) {
    gerir();
    const x = achar(campanhas, m![1]!, ctx, "Campanha");
    const novo: Resultado = { id: ctx.id("cr"), mes: c.mes, reservas: c.reservas, passageiros: c.passageiros, receitaCentavos: c.receitaCentavos ?? null, fonte: c.fonte ?? "" };
    x.resultados = [...x.resultados.filter((rs) => rs.mes !== c.mes), novo].sort((a, b) => a.mes.localeCompare(b.mes));
    return campanhaPublica(x);
  }
  if (metodo === "DELETE" && r(/^\/api\/marketing\/campanhas\/([^/]+)\/resultados\/([^/]+)$/)) {
    gerir();
    const x = achar(campanhas, m![1]!, ctx, "Campanha");
    x.resultados = x.resultados.filter((rs) => rs.mes !== m![2]);
    return { ok: true };
  }

  // Conteúdo
  if (metodo === "GET" && caminho === "/api/marketing/responsaveis") { ver(); return responsaveis; }
  if (metodo === "GET" && caminho === "/api/marketing/conteudos") {
    ver();
    return conteudos.filter((x) => (!q.get("rede") || x.rede === q.get("rede")) && (!q.get("status") || x.status === q.get("status")))
      .sort((a, b) => (a.dataPrevista ?? "9999").localeCompare(b.dataPrevista ?? "9999")).map((x) => ({ ...x, responsavel: responsaveis.find((p) => p.id === x.responsavelId)?.nome ?? null }));
  }
  if (metodo === "POST" && caminho === "/api/marketing/conteudos") {
    gerir();
    const x: Conteudo = { id: ctx.id("ct"), unidadeId: c.unidadeId ?? null, titulo: c.titulo, rede: c.rede, status: c.status ?? "IDEIA", dataPrevista: c.dataPrevista ?? null, legenda: c.legenda ?? null, link: c.link ?? null, responsavelId: c.responsavelId ?? null };
    conteudos.push(x);
    return x;
  }
  if (r(/^\/api\/marketing\/conteudos\/([^/]+)$/)) {
    gerir();
    const x = achar(conteudos, m![1]!, ctx, "Conteúdo");
    if (metodo === "DELETE") { conteudos.splice(conteudos.indexOf(x), 1); return { ok: true }; }
    if (metodo === "PATCH") return aplicar(x, c, ["unidadeId", "titulo", "rede", "status", "dataPrevista", "legenda", "link", "responsavelId"]);
  }

  // Afiliados
  if (metodo === "GET" && caminho === "/api/marketing/afiliados") {
    ver();
    return { urlLoja: URL_LOJA, ligacaoPaytour: { situacao: "PENDENTE", nota: "Ligação com os afiliados da Paytour pendente: confirmar se o link com ?ref= atribui a venda e como casar o código com o afiliado da Paytour." }, afiliados: afiliados.map(afiliadoPublico) };
  }
  if (metodo === "POST" && caminho === "/api/marketing/afiliados") {
    gerir();
    if (afiliados.some((a) => a.codigo === c.codigo)) throw ctx.erro(409, "CODIGO_EM_USO", "Já existe um afiliado com este código.");
    const x: Afiliado = { id: ctx.id("af"), unidadeId: c.unidadeId ?? null, nome: c.nome, tipo: c.tipo, codigo: c.codigo, comissaoPontosBase: c.comissaoPontosBase ?? null, contato: c.contato ?? null, paytourAfiliadoId: null, observacoes: c.observacoes ?? null, ativo: true };
    afiliados.push(x);
    return afiliadoPublico(x);
  }
  if (r(/^\/api\/marketing\/afiliados\/([^/]+)$/)) {
    gerir();
    const x = achar(afiliados, m![1]!, ctx, "Afiliado");
    if (metodo === "DELETE") { afiliados.splice(afiliados.indexOf(x), 1); return { ok: true }; }
    if (metodo === "PATCH") return afiliadoPublico(aplicar(x, c, ["unidadeId", "nome", "tipo", "codigo", "comissaoPontosBase", "contato", "observacoes", "ativo"]));
  }

  // Avaliações e configuração
  if (metodo === "GET" && caminho === "/api/marketing/config") {
    ver();
    return { ...config, urlLoja: URL_LOJA, envioWhatsapp: { ligado: false, nota: "Envio por WhatsApp ainda não ligado (provedor a contratar). Por enquanto, copie o texto." } };
  }
  if (metodo === "PATCH" && caminho === "/api/marketing/config") {
    gerir();
    config = { modeloAvaliacao: c.modeloAvaliacao ?? config.modeloAvaliacao, linkTripadvisor: "linkTripadvisor" in c ? c.linkTripadvisor : config.linkTripadvisor };
    return { ...config, urlLoja: URL_LOJA, envioWhatsapp: { ligado: false, nota: "Envio por WhatsApp ainda não ligado (provedor a contratar). Por enquanto, copie o texto." } };
  }
  if (metodo === "GET" && caminho === "/api/marketing/avaliacoes/resumo") {
    ver();
    const porStatus: Record<string, number> = {};
    for (const p of pedidos) porStatus[p.status] = (porStatus[p.status] ?? 0) + 1;
    return {
      notas: {
        quantidade: notas.length, media: media(notas.map((n) => n.nota)), distribuicao: [1, 2, 3, 4, 5].map((nota) => ({ nota, quantidade: notas.filter((n) => n.nota === nota).length })),
        porGuia: agrupar((n) => n.guia), porCanal: agrupar((n) => n.canal),
      },
      pedidos: porStatus, tripadvisor: { reservasViator: 74, passageirosViator: 168, link: config.linkTripadvisor },
    };
  }
  if (metodo === "GET" && caminho === "/api/marketing/avaliacoes/pedidos") {
    ver();
    return pedidos.filter((p) => !q.get("status") || p.status === q.get("status"));
  }
  if (metodo === "POST" && caminho === "/api/marketing/avaliacoes/pedidos/gerar") { gerir(); return { criados: 0 }; }
  if (metodo === "PATCH" && r(/^\/api\/marketing\/avaliacoes\/pedidos\/([^/]+)$/)) {
    gerir();
    return aplicar(achar(pedidos, m![1]!, ctx, "Pedido"), c, ["status"]);
  }
  if (metodo === "GET" && caminho === "/api/marketing/avaliacoes/notas") { ver(); return notas; }
  if (metodo === "POST" && caminho === "/api/marketing/avaliacoes/notas") {
    gerir();
    const p = pedidos.find((x) => x.reservaId === c.reservaId);
    notas.push({ reservaId: c.reservaId, nota: c.nota, guia: "Guia Fictícia Ana", canal: p?.canal ?? "PAYTOUR" });
    if (p) p.status = "IGNORADA";
    return { ok: true };
  }
  throw ctx.erro(404, "NAO_ENCONTRADO", "Função não disponível na demonstração.");
};
