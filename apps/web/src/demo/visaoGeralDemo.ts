/**
 * Visão Geral da demonstração: vendas FICTÍCIAS e plausíveis (geradas de forma determinística) agregadas como a API faz.
 * Nenhum dado real. As saídas de hoje e a listagem de reservas saem dos dados da própria demonstração (apiFalsa.ts).
 */
import { NAO, somarDias, type Ctx, type Rotear } from "./comum";

type CanalG = "SITE" | "ADMIN" | "AFILIADO" | "BALCAO" | "PARCEIRO" | "VIATOR" | "DECOLAR" | "CIVITATIS";
const ORDEM_CANAIS = ["SITE", "ADMIN", "AFILIADO", "BALCAO", "PARCEIRO", "VIATOR", "DECOLAR", "CIVITATIS", "OTA", "SEM_CANAL"];

interface Venda {
  dia: string; // dia da compra (Brasília)
  hora: number;
  dow: number;
  unidadeId: string;
  passeioId: string;
  passeio: string;
  canal: CanalG;
  pax: number;
  valor: number; // centavos
  desconto: number;
  cupom: string | null;
  forma: string;
  cidade: string;
  uf: string;
  pendente: number;
  comissao: number;
}

const PASSEIOS = [
  { id: "toda-ilha", nome: "City Tour Toda Ilha", un: "un-fln", preco: 14000, peso: 55 },
  { id: "bruxolico", nome: "City Tour – Passeio Bruxólico (fictício)", un: "un-fln", preco: 9000, peso: 15 },
  { id: "bc-tour", nome: "City Tour Balneário Camboriú (fictício)", un: "un-bc", preco: 8500, peso: 25 },
  { id: "bc-fret", nome: "Fretamento para eventos (fictício)", un: "un-bc", preco: 250000, peso: 5 },
];
const CIDADES: Array<[string, string]> = [["Curitiba", "PR"], ["São Paulo", "SP"], ["Porto Alegre", "RS"], ["Belo Horizonte", "MG"], ["Rio de Janeiro", "RJ"], ["Joinville", "SC"], ["Blumenau", "SC"], ["Brasília", "DF"], ["Londrina", "PR"], ["Campinas", "SP"], ["Goiânia", "GO"], ["Caxias do Sul", "RS"]];
const ESTRANGEIRAS: Array<[string, string]> = [["Buenos Aires", "ARG"], ["Montevidéu", "URY"], ["Santiago", "CHL"], ["Nova York", "USA"]];
const CUPONS = ["415", "502", "611"];

function prng(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function escolher<T>(r: () => number, opcoes: Array<[T, number]>): T {
  const total = opcoes.reduce((t, o) => t + o[1], 0);
  let x = r() * total;
  for (const [v, p] of opcoes) { if ((x -= p) < 0) return v; }
  return opcoes[opcoes.length - 1]![0];
}

let cache: { hoje: string; vendas: Venda[] } | null = null;
function vendasDemo(hoje: string): Venda[] {
  if (cache?.hoje === hoje) return cache.vendas;
  const r = prng(20261104);
  const vendas: Venda[] = [];
  for (let i = -1100; i <= 0; i++) {
    const dia = somarDias(hoje, i);
    const dow = new Date(`${dia}T12:00:00Z`).getUTCDay();
    const crescimento = i > -365 ? 1 : i > -730 ? 0.8 : 0.55;
    const sazon = [1.3, 1.2, 0.9, 0.9, 1, 1.15, 1.35][((Number(dia.slice(5, 7)) + 10) % 12) % 7]!;
    const n = Math.round((2.5 + r() * 3) * crescimento * sazon * ([1.3, 0.8, 0.8, 0.9, 1, 1.2, 1.4][dow]!));
    for (let k = 0; k < n; k++) {
      const p = escolher(r, PASSEIOS.map((x) => [x, x.peso] as [typeof PASSEIOS[number], number]));
      const canal = p.un === "un-bc"
        ? escolher<CanalG>(r, [["SITE", 45], ["ADMIN", 20], ["AFILIADO", 15], ["BALCAO", 10], ["PARCEIRO", 10]])
        : escolher<CanalG>(r, [["SITE", 38], ["ADMIN", 12], ["AFILIADO", 11], ["BALCAO", 6], ["PARCEIRO", 4], ["VIATOR", 15], ["DECOLAR", 5], ["CIVITATIS", 9]]);
      const ota = canal === "VIATOR" || canal === "DECOLAR" || canal === "CIVITATIS";
      const pax = p.id === "bc-fret" ? 1 : 1 + Math.floor(r() * r() * 6);
      const bruto = pax * p.preco;
      const cupom = canal === "SITE" && r() < 0.1 ? CUPONS[Math.floor(r() * CUPONS.length)]! : null;
      const desconto = cupom ? Math.round(bruto * 0.1) : 0;
      const hora = canal === "SITE" ? escolher(r, [[8, 6], [11, 10], [15, 12], [19, 14], [21, 14], [23, 6], [3, 2]]) : canal === "ADMIN" || canal === "BALCAO" ? 8 + Math.floor(r() * 10) : Math.floor(r() * 24);
      const [cidade, uf] = ota ? ESTRANGEIRAS[Math.floor(r() * ESTRANGEIRAS.length)]! : CIDADES[Math.floor(r() * r() * CIDADES.length)]!;
      const forma = ota ? "CANAL"
        : canal === "SITE" ? escolher(r, [["PIX", 35], ["CARTAO_1X", 20], ["CARTAO_2_6X", 30], ["CARTAO_7X", 3], ["NO_DIA", 12]])
        : escolher(r, [["NO_DIA", 35], ["EXTERNO", 22], ["PIX", 18], ["DINHEIRO", 10], ["CARTAO_1X", 15]]);
      vendas.push({
        dia, hora, dow, unidadeId: p.un, passeioId: p.id, passeio: p.nome, canal, pax, valor: bruto - desconto, desconto, cupom, forma, cidade, uf,
        pendente: forma === "NO_DIA" && i > -20 && r() < 0.5 ? Math.round((bruto - desconto) * 0.4) : 0,
        comissao: canal === "AFILIADO" ? Math.round((bruto - desconto) * 0.1) : 0,
      });
    }
  }
  cache = { hoje, vendas };
  return vendas;
}

/** Valor fictício e estável de uma reserva da demonstração (para a listagem). */
export function valorDemoDaReserva(chave: string, passageiros: number): number {
  const n = [...chave].reduce((t, ch) => t + ch.charCodeAt(0), 0);
  return passageiros * (n % 5 === 0 ? 9000 : 14000);
}

export function resumoDeVendas(hoje: string, escopo: string[] | null, unidadeId: string | null, valores: boolean) {
  const mes = hoje.slice(0, 7);
  const dentro = (v: Venda) => (!escopo || escopo.includes(v.unidadeId)) && (!unidadeId || v.unidadeId === unidadeId);
  const todas = vendasDemo(hoje).filter(dentro);
  const doMes = todas.filter((v) => v.dia.startsWith(mes));
  const mesAnt = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5)) - 2, 1)).toISOString().slice(0, 7);
  const dia = Number(hoje.slice(8));
  const ateMesmoDia = todas.filter((v) => v.dia.startsWith(mesAnt) && Number(v.dia.slice(8)) <= dia);
  const soma = (l: Venda[], f: (v: Venda) => number) => l.reduce((t, v) => t + f(v), 0);
  const cupons = new Map<string, { usos: number; desc: number }>();
  for (const v of doMes.filter((x) => x.cupom)) { const c = cupons.get(v.cupom!) ?? { usos: 0, desc: 0 }; c.usos++; c.desc += v.desconto; cupons.set(v.cupom!, c); }
  const R = (n: number) => (valores ? n : null);
  const pend = todas.filter((v) => v.pendente > 0);
  const afil = doMes.filter((v) => v.comissao > 0);
  return {
    faturamentoMes: { mes, reservas: doMes.length, semValor: doMes.filter((v) => v.canal === "DECOLAR").length, valorCentavos: R(soma(doMes.filter((v) => v.canal !== "DECOLAR"), (v) => v.valor)), mesAnteriorCentavos: R(soma(ateMesmoDia.filter((v) => v.canal !== "DECOLAR"), (v) => v.valor)) },
    cupons: { usos: doMes.filter((v) => v.cupom).length, descontoCentavos: R(soma(doMes, (v) => v.desconto)), porCupom: [...cupons].sort((a, b) => b[1].usos - a[1].usos).map(([cupomId, c]) => ({ cupomId, usos: c.usos, descontoCentavos: R(c.desc) })) },
    aguardandoPagamento: { pedidos: pend.length, saldoCentavos: R(soma(pend, (v) => v.pendente)) },
    comissaoAfiliados: { pedidos: afil.length, totalCentavos: R(soma(afil, (v) => v.comissao)) },
  };
}

const pct = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 1000) / 10 : 0);

export const rotearVisaoGeral: Rotear = (ctx: Ctx, metodo, caminho, q) => {
  const m = /^\/api\/visao-geral\/([a-z-]+)$/.exec(caminho);
  if (metodo !== "GET" || !m || m[1] === "resumo") return NAO;
  ctx.exigir("manifesto:ver");
  if (!ctx.pode("marketing:ver") && !ctx.pode("financeiro:ver")) throw ctx.erro(403, "SEM_PERMISSAO", "Seu perfil não tem acesso a esta análise de vendas.");
  const valores = ctx.pode("financeiro:ver");
  const hoje = ctx.dataMais(0);
  const ate = q.get("ate") ?? hoje;
  const de = q.get("de") ?? somarDias(ate, -29);
  if (de > ate) throw ctx.erro(400, "PERIODO_INVALIDO", "A data inicial deve ser anterior à final.");
  const escopo = ctx.escopo();
  const unidadeId = q.get("unidadeId");
  if (unidadeId && escopo && !escopo.includes(unidadeId)) throw ctx.erro(404, "NAO_ENCONTRADO", "Praça não encontrada.");
  const passeioId = q.get("passeioId");
  const canal = q.get("canal");
  const base = vendasDemo(hoje).filter((v) => (!escopo || escopo.includes(v.unidadeId)) && (!unidadeId || v.unidadeId === unidadeId) && (!passeioId || v.passeioId === passeioId));
  const noPeriodo = (a: string, b: string, filtrarCanal = true) => base.filter((v) => v.dia >= a && v.dia <= b && (!filtrarCanal || !canal || v.canal === canal));
  const vs = noPeriodo(de, ate);
  const R = (n: number) => (valores ? n : null);
  const soma = (l: Venda[]) => l.reduce((t, v) => t + v.valor, 0);
  const periodo = { de, ate };
  const agrupar = <K extends string>(l: Venda[], chave: (v: Venda) => K) => { const g = new Map<K, Venda[]>(); for (const v of l) g.set(chave(v), [...(g.get(chave(v)) ?? []), v]); return g; };

  switch (m[1]) {
    case "emissores": {
      const g = [...agrupar(vs, (v) => `${v.cidade}|${v.uf}`)].map(([k, l]) => ({ cidade: k.split("|")[0]!, uf: k.split("|")[1]!, reservas: l.length, passageiros: l.reduce((t, v) => t + v.pax, 0), valor: soma(l) }));
      g.sort((a, b) => (valores ? b.valor - a.valor : 0) || b.reservas - a.reservas);
      const total = { reservas: vs.length, valor: soma(vs) };
      const porValor = valores && total.valor > 0;
      return { periodo, baseDoPercentual: porValor ? "valor" : "reservas", total: { reservas: total.reservas, valorCentavos: R(total.valor) }, emissores: g.slice(0, 15).map((e) => ({ cidade: e.cidade, uf: e.uf, reservas: e.reservas, passageiros: e.passageiros, valorCentavos: R(e.valor), percentual: porValor ? pct(e.valor, total.valor) : pct(e.reservas, total.reservas) })) };
    }
    case "comparativo": {
      if (!valores) throw ctx.erro(403, "SEM_PERMISSAO", "Valores em reais exigem permissão de ver o financeiro.");
      const anos = [0, 1, 2].map((atras) => {
        const a = `${Number(de.slice(0, 4)) - atras}${de.slice(4)}`;
        const b = `${Number(ate.slice(0, 4)) - atras}${ate.slice(4)}`;
        const l = noPeriodo(a, b);
        return { ano: Number(b.slice(0, 4)), de: a, ate: b, reservas: l.length, valorCentavos: soma(l) };
      });
      return { periodo, anos, semHistorico: anos.slice(1).every((a) => a.reservas === 0) };
    }
    case "dia-semana": {
      const dias = Array.from({ length: 7 }, (_, dia) => {
        const porCanal: Record<string, number> = {};
        for (const v of vs.filter((x) => x.dow === dia)) porCanal[v.canal] = (porCanal[v.canal] ?? 0) + 1;
        return { dia, total: Object.values(porCanal).reduce((t, n) => t + n, 0), porCanal };
      });
      return { periodo, dias, canais: ORDEM_CANAIS.filter((c) => dias.some((d) => (d.porCanal[c] ?? 0) > 0)) };
    }
    case "horario-compra": {
      const l = noPeriodo(de, ate, false);
      const faixas = ["02–06", "06–10", "10–14", "14–18", "18–22", "22–02"].map((rotulo, i) => {
        const nf = l.filter((v) => Math.floor(((v.hora - 2 + 24) % 24) / 4) === i);
        return { rotulo, site: nf.filter((v) => v.canal === "SITE").length, admin: nf.filter((v) => v.canal === "ADMIN" || v.canal === "BALCAO").length, outros: nf.filter((v) => !["SITE", "ADMIN", "BALCAO"].includes(v.canal)).length };
      });
      return { periodo, faixas, nota: "Site = compra pelo site; Admin = venda pelo painel (operador) ou balcão. Outros canais não entram nas linhas." };
    }
    case "passeios": {
      const g = [...agrupar(vs, (v) => v.passeioId)].map(([id, l]) => ({ id, nome: l[0]!.passeio, reservas: l.length, pax: l.reduce((t, v) => t + v.pax, 0), valor: soma(l) }));
      g.sort((a, b) => (valores ? b.valor - a.valor : 0) || b.pax - a.pax);
      const tv = soma(vs), tp = vs.reduce((t, v) => t + v.pax, 0);
      const porValor = valores && tv > 0;
      return { periodo, baseDoPercentual: porValor ? "valor" : "passageiros", total: { reservas: vs.length, passageiros: tp, valorCentavos: R(tv) }, passeios: g.map((p) => ({ passeioId: p.id, passeio: p.nome, reservas: p.reservas, passageiros: p.pax, valorCentavos: R(p.valor), percentual: porValor ? pct(p.valor, tv) : pct(p.pax, tp) })) };
    }
    case "pagamentos": {
      const g = [...agrupar(vs, (v) => v.forma)].map(([forma, l]) => ({ forma, reservas: l.length, valor: soma(l) })).sort((a, b) => b.reservas - a.reservas);
      const tv = soma(vs);
      const porValor = valores && tv > 0;
      return { periodo, baseDoPercentual: porValor ? "valor" : "reservas", total: { reservas: vs.length, valorCentavos: R(tv) }, formas: g.map((f) => ({ forma: f.forma, reservas: f.reservas, valorCentavos: R(f.valor), percentual: porValor ? pct(f.valor, tv) : pct(f.reservas, vs.length) })) };
    }
    case "faturamento": {
      if (!valores) throw ctx.erro(403, "SEM_PERMISSAO", "Valores em reais exigem permissão de ver o financeiro.");
      const porMes = (Date.parse(ate) - Date.parse(de)) / 86_400_000 > 62;
      const com = vs.filter((v) => v.canal !== "DECOLAR"); // a Decolar não informa valor
      const pontos = [...agrupar(com, (v) => (porMes ? v.dia.slice(0, 7) : v.dia))].sort((a, b) => a[0].localeCompare(b[0])).map(([chave, l]) => {
        const porCanal: Record<string, number> = {};
        for (const v of l) porCanal[v.canal] = (porCanal[v.canal] ?? 0) + v.valor;
        return { chave, total: soma(l), porCanal };
      });
      const totais: Record<string, number> = {};
      for (const v of com) totais[v.canal] = (totais[v.canal] ?? 0) + v.valor;
      return { periodo, agrupamento: porMes ? "mes" : "dia", pontos, totaisPorCanal: totais, totalCentavos: soma(com), canais: ORDEM_CANAIS.filter((c) => (totais[c] ?? 0) > 0) };
    }
    default:
      return NAO;
  }
};
