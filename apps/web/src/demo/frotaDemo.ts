/** Frota da demonstração: 3 veículos fictícios, documentos, planos, ordens, abastecimentos e checklist. */
import { ITENS_CHECKLIST_PADRAO, alertaConsumo, consumoPorAbastecimento, mediaConsumo, resumirChecklist, situacaoPlano, situacaoVencimento } from "@bybus/core";
import { NAO, UN_BC, UN_FLN, achar, aplicar, diasEntre, type Rotear } from "./comum";

const NOME_UNIDADE: Record<string, string> = { [UN_FLN]: "Florianópolis (Floripa by Bus)", [UN_BC]: "Balneário Camboriú (BC by Bus)" };
const ROTULO_DOC: Record<string, string> = { CRLV: "CRLV", LICENCA_MUNICIPAL: "Licença municipal", ANTT: "ANTT", SEGURO: "Seguro", CRONOTACOGRAFO: "Cronotacógrafo", VISTORIA: "Vistoria", OUTRO: "Documento" };

interface V { id: string; unidadeId: string; placa: string; apelido: string | null; tipo: string; modelo: string | null; ano: number | null; capacidade: number | null; chassi: string | null; renavam: string | null; linhaPrincipal: string | null; usoPublicitario: boolean; situacao: string; kmAtual: number; observacoes: string | null }
interface Doc { id: string; veiculoId: string; tipo: string; descricao: string | null; numero: string | null; vencimento: string; observacao: string | null }
interface Plano { id: string; veiculoId: string; nome: string; intervaloKm: number | null; intervaloDias: number | null; ultimoKm: number | null; ultimaData: string | null; critico: boolean; ativo: boolean }
interface Ordem { id: string; veiculoId: string; planoId: string | null; tipo: string; status: string; descricao: string; oficina: string | null; pecas: string | null; imobiliza: boolean; abertaEm: string; concluidaEm: string | null; km: number | null; custoCentavos: number }
interface Abast { id: string; veiculoId: string; data: string; km: number; litros: number; valorCentavos: number; posto: string | null; tanqueCheio: boolean }
interface Item { id: string; grupo: string; descricao: string; critico: boolean; ordem: number; ativo: boolean }
interface Feito { id: string; veiculoId: string; motorista: string | null; data: string; km: number | null; aprovado: boolean; observacao: string | null; respostas: Array<{ itemId: string; ok: boolean; observacao: string | null }> }

let hoje = "";
let semeado = false;
const veiculos: V[] = [];
const docs: Doc[] = [];
const planos: Plano[] = [];
const ordens: Ordem[] = [];
const abastecimentos: Abast[] = [];
const itens: Item[] = [];
const feitos: Feito[] = [];

function semear(dataMais: (n: number) => string) {
  if (semeado) return;
  semeado = true;
  hoje = dataMais(0);
  const base = { chassi: null, renavam: null, usoPublicitario: false, observacoes: null };
  veiculos.push(
    { ...base, id: "ve-1", unidadeId: UN_FLN, placa: "DEM1A23", apelido: "Floripa 01", tipo: "ONIBUS_DOIS_ANDARES", modelo: "Ônibus de dois andares (fictício)", ano: 2019, capacidade: 73, linhaPrincipal: "CITY_TOUR", situacao: "ATIVO", kmAtual: 182_450, usoPublicitario: true },
    { ...base, id: "ve-2", unidadeId: UN_BC, placa: "DEM2B34", apelido: "Trenzinho BC", tipo: "TRENZINHO", modelo: "Trenzinho turístico (fictício)", ano: 2021, capacidade: 46, linhaPrincipal: "CITY_TOUR", situacao: "ATIVO", kmAtual: 64_920 },
    { ...base, id: "ve-3", unidadeId: UN_FLN, placa: "DEM3C45", apelido: "Van fretamento", tipo: "VAN", modelo: "Van executiva (fictícia)", ano: 2022, capacidade: 16, linhaPrincipal: "FRETAMENTO", situacao: "MANUTENCAO", kmAtual: 48_310 },
  );
  docs.push(
    { id: "do-1", veiculoId: "ve-1", tipo: "CRLV", descricao: null, numero: "00000000001", vencimento: dataMais(12), observacao: "Renovar o licenciamento esta semana (fictício)." },
    { id: "do-2", veiculoId: "ve-1", tipo: "LICENCA_MUNICIPAL", descricao: "Licença de turismo — Florianópolis", numero: "LIC-0001/2026", vencimento: dataMais(210), observacao: null },
    { id: "do-3", veiculoId: "ve-1", tipo: "SEGURO", descricao: "Apólice de responsabilidade civil", numero: "APO-000001", vencimento: dataMais(300), observacao: null },
    { id: "do-4", veiculoId: "ve-2", tipo: "CRLV", descricao: null, numero: "00000000002", vencimento: dataMais(160), observacao: null },
    { id: "do-5", veiculoId: "ve-2", tipo: "SEGURO", descricao: "Apólice de responsabilidade civil", numero: "APO-000002", vencimento: dataMais(220), observacao: null },
    { id: "do-6", veiculoId: "ve-3", tipo: "CRLV", descricao: null, numero: "00000000003", vencimento: dataMais(95), observacao: null },
    { id: "do-7", veiculoId: "ve-3", tipo: "ANTT", descricao: "Registro de fretamento", numero: "ANTT-000003", vencimento: dataMais(180), observacao: null },
  );
  planos.push(
    { id: "pl-1", veiculoId: "ve-1", nome: "Troca de óleo e filtros", intervaloKm: 10_000, intervaloDias: 180, ultimoKm: 173_000, ultimaData: dataMais(-120), critico: false, ativo: true },
    { id: "pl-2", veiculoId: "ve-1", nome: "Revisão dos freios", intervaloKm: 20_000, intervaloDias: 365, ultimoKm: 170_000, ultimaData: dataMais(-150), critico: true, ativo: true },
    { id: "pl-3", veiculoId: "ve-2", nome: "Revisão geral", intervaloKm: 15_000, intervaloDias: 180, ultimoKm: 58_000, ultimaData: dataMais(-70), critico: false, ativo: true },
    { id: "pl-4", veiculoId: "ve-3", nome: "Troca de óleo", intervaloKm: 10_000, intervaloDias: 365, ultimoKm: 42_000, ultimaData: dataMais(-100), critico: false, ativo: true },
  );
  ordens.push(
    { id: "or-1", veiculoId: "ve-3", planoId: null, tipo: "CORRETIVA", status: "EM_ANDAMENTO", descricao: "Ruído na suspensão dianteira (fictício)", oficina: "Oficina Modelo (fictícia)", pecas: "Amortecedores", imobiliza: true, abertaEm: dataMais(-3), concluidaEm: null, km: 48_290, custoCentavos: 0 },
    { id: "or-2", veiculoId: "ve-1", planoId: "pl-2", tipo: "PREVENTIVA", status: "CONCLUIDA", descricao: "Revisão dos freios e pastilhas", oficina: "Oficina Modelo (fictícia)", pecas: "Pastilhas", imobiliza: false, abertaEm: dataMais(-150), concluidaEm: dataMais(-149), km: 170_000, custoCentavos: 185_000 },
    { id: "or-3", veiculoId: "ve-2", planoId: null, tipo: "CORRETIVA", status: "CONCLUIDA", descricao: "Troca de bateria", oficina: "Auto Elétrica Exemplo (fictícia)", pecas: "Bateria 150Ah", imobiliza: false, abertaEm: dataMais(-12), concluidaEm: dataMais(-11), km: 63_900, custoCentavos: 129_000 },
  );
  const lancar = (veiculoId: string, linhas: Array<[number, number, number, number]>, posto: string) =>
    linhas.forEach(([dias, km, litros, valor], i) => abastecimentos.push({ id: `ab-${veiculoId}-${i}`, veiculoId, data: dataMais(dias), km, litros, valorCentavos: valor, posto, tanqueCheio: true }));
  lancar("ve-1", [[-24, 181_050, 155, 96_100], [-17, 181_400, 160, 99_200], [-9, 181_760, 158, 98_000], [-2, 182_100, 162, 101_400]], "Posto Ilha (fictício)");
  lancar("ve-2", [[-20, 63_900, 62, 38_400], [-10, 64_300, 66, 40_900], [-3, 64_700, 78, 48_400]], "Posto Centro BC (fictício)");
  lancar("ve-3", [[-16, 47_800, 48, 29_800], [-8, 48_050, 45, 28_000]], "Posto Ilha (fictício)");
  ITENS_CHECKLIST_PADRAO.forEach((i, n) => itens.push({ id: `it-${n + 1}`, grupo: i.grupo, descricao: i.descricao, critico: i.critico, ordem: n + 1, ativo: true }));
  const ok = (extra: Record<string, string> = {}) => itens.map((i) => ({ itemId: i.id, ok: !(i.id in extra), observacao: extra[i.id] ?? null }));
  feitos.push(
    { id: "ck-1", veiculoId: "ve-1", motorista: "Motorista Fictício Davi", data: hoje, km: 182_450, aprovado: true, observacao: null, respostas: ok() },
    { id: "ck-2", veiculoId: "ve-2", motorista: "Motorista Fictício Edu", data: dataMais(-1), km: 64_700, aprovado: true, observacao: "Limpador com ruído; avisar a oficina.", respostas: ok({ "it-8": "Palheta gasta" }) },
  );
}

// ---------- derivações ----------
const veiculo = (id: string) => veiculos.find((v) => v.id === id)!;
const rotulo = (v: V) => ({ veiculoId: v.id, placa: v.placa, apelido: v.apelido });
const rotuloPlaca = (v: V) => ({ placa: v.placa, apelido: v.apelido });

const docPublico = (d: Doc) => {
  const v = veiculo(d.veiculoId);
  return { ...d, ...rotuloPlaca(v), situacao: situacaoVencimento(d.vencimento, hoje), dias: diasEntre(hoje, d.vencimento) };
};
const planoPublico = (p: Plano) => {
  const v = veiculo(p.veiculoId);
  return { ...p, ...rotuloPlaca(v), kmAtual: v.kmAtual, ...situacaoPlano({ intervaloKm: p.intervaloKm, intervaloDias: p.intervaloDias, ultimoKm: p.ultimoKm, ultimaData: p.ultimaData, kmAtual: v.kmAtual, hoje }) };
};
const ordemPublica = (o: Ordem) => {
  const v = veiculo(o.veiculoId);
  const fim = o.concluidaEm ?? hoje;
  return { ...o, ...rotuloPlaca(v), diasParado: o.imobiliza ? Math.max(0, diasEntre(o.abertaEm, fim)) : null };
};
function situacaoOperacional(v: V) {
  const motivos: string[] = [];
  if (v.situacao === "MANUTENCAO") motivos.push("Veículo em manutenção");
  if (v.situacao === "INATIVO") motivos.push("Veículo inativo");
  for (const d of docs.filter((x) => x.veiculoId === v.id)) if (situacaoVencimento(d.vencimento, hoje) === "VENCIDO") motivos.push(`${ROTULO_DOC[d.tipo] ?? "Documento"} vencido(a)`);
  for (const o of ordens.filter((x) => x.veiculoId === v.id && (x.status === "ABERTA" || x.status === "EM_ANDAMENTO") && x.imobiliza)) motivos.push(`Ordem de manutenção em aberto: ${o.descricao}`);
  const planosV = planos.filter((p) => p.veiculoId === v.id && p.ativo).map(planoPublico);
  for (const p of planosV) if (p.critico && p.situacao === "VENCIDA") motivos.push(`Manutenção crítica vencida: ${p.nome}`);
  return { motivos, docs: docs.filter((x) => x.veiculoId === v.id).map(docPublico), planos: planosV };
}
const veiculoPublico = (v: V) => {
  const s = situacaoOperacional(v);
  return {
    ...v, unidadeNome: NOME_UNIDADE[v.unidadeId] ?? "", disponivel: v.situacao !== "INATIVO" && s.motivos.length === 0, motivosBloqueio: s.motivos,
    documentosVencidos: s.docs.filter((d) => d.situacao === "VENCIDO").length, documentosAVencer: s.docs.filter((d) => d.situacao === "A_VENCER").length,
    manutencoesPendentes: s.planos.filter((p) => p.situacao === "VENCIDA" || p.situacao === "PROXIMA").length + ordens.filter((o) => o.veiculoId === v.id && (o.status === "ABERTA" || o.status === "EM_ANDAMENTO")).length,
  };
};
const visiveis = (q: URLSearchParams) => veiculos.filter((v) => !q.get("unidadeId") || v.unidadeId === q.get("unidadeId"));

function abastecimentosCalculados(veiculoId?: string) {
  const lista: Array<Abast & { kml: number | null; alerta: "ALTO" | "BAIXO" | null }> = [];
  for (const v of veiculos) {
    if (veiculoId && v.id !== veiculoId) continue;
    const dele = abastecimentos.filter((a) => a.veiculoId === v.id).sort((a, b) => a.km - b.km);
    const kml = consumoPorAbastecimento(dele);
    const anteriores: Array<number | null> = [];
    for (const a of dele) {
      const k = kml.get(a.id) ?? null;
      lista.push({ ...a, kml: k == null ? null : Math.round(k * 100) / 100, alerta: alertaConsumo(k, anteriores) });
      anteriores.push(k);
    }
  }
  return lista;
}

function resultadoChecklist(respostas: Array<{ itemId: string; ok: boolean; observacao: string | null }>) {
  return resumirChecklist(respostas.map((r) => { const i = itens.find((x) => x.id === r.itemId); return { itemId: r.itemId, descricao: i?.descricao ?? "", ok: r.ok, critico: i?.critico ?? false }; }));
}

export const rotearFrota: Rotear = (ctx, metodo, caminho, q, c) => {
  if (!caminho.startsWith("/api/frota/")) return NAO;
  semear(ctx.dataMais);
  hoje = ctx.dataMais(0);
  let m: RegExpMatchArray | null;
  const r = (re: RegExp) => (m = caminho.match(re));
  const ver = () => ctx.exigir("frota:ver");
  const gerir = () => ctx.exigir("frota:gerenciar");

  // Veículos
  if (metodo === "GET" && caminho === "/api/frota/veiculos") { ver(); return visiveis(q).sort((a, b) => a.placa.localeCompare(b.placa)).map(veiculoPublico); }
  if (metodo === "GET" && caminho === "/api/frota/veiculos/opcoes") {
    ctx.exigir();
    return visiveis(q).filter((v) => v.situacao !== "INATIVO").map((v) => { const p = veiculoPublico(v); return { id: v.id, placa: v.placa, apelido: v.apelido, tipo: v.tipo, capacidade: v.capacidade, unidadeId: v.unidadeId, disponivel: p.disponivel, motivosBloqueio: p.motivosBloqueio }; });
  }
  if (metodo === "GET" && r(/^\/api\/frota\/disponibilidade\/([^/]+)$/)) {
    ctx.exigir();
    const v = veiculos.find((x) => x.placa === decodeURIComponent(m![1]!).toUpperCase().replace(/[^A-Z0-9]/g, ""));
    if (!v) throw ctx.erro(404, "NAO_ENCONTRADO", "Veículo não encontrado.");
    const p = veiculoPublico(v);
    return { placa: v.placa, disponivel: p.disponivel, motivosBloqueio: p.motivosBloqueio };
  }
  if (metodo === "POST" && caminho === "/api/frota/veiculos") {
    gerir();
    const v: V = { id: ctx.id("ve"), unidadeId: c.unidadeId, placa: String(c.placa ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""), apelido: c.apelido || null, tipo: c.tipo, modelo: c.modelo || null, ano: c.ano ?? null, capacidade: c.capacidade ?? null, chassi: c.chassi || null, renavam: c.renavam || null, linhaPrincipal: c.linhaPrincipal || null, usoPublicitario: !!c.usoPublicitario, situacao: c.situacao ?? "ATIVO", kmAtual: c.kmAtual ?? 0, observacoes: c.observacoes || null };
    if (veiculos.some((x) => x.placa === v.placa)) throw ctx.erro(409, "PLACA_EM_USO", "Já existe um veículo com esta placa.");
    veiculos.push(v);
    ctx.auditar("VEICULO_CRIADO", "veiculo", v.id);
    return veiculoPublico(v);
  }
  if (r(/^\/api\/frota\/veiculos\/([^/]+)$/)) {
    ver();
    const v = achar(veiculos, m![1]!, ctx, "Veículo");
    if (metodo === "GET") return veiculoPublico(v);
    if (metodo === "PATCH") {
      gerir();
      aplicar(v, c, ["unidadeId", "apelido", "tipo", "modelo", "ano", "capacidade", "chassi", "renavam", "linhaPrincipal", "usoPublicitario", "situacao", "kmAtual", "observacoes"]);
      if (c.placa) v.placa = String(c.placa).toUpperCase().replace(/[^A-Z0-9]/g, "");
      ctx.auditar("VEICULO_ALTERADO", "veiculo", v.id);
      return veiculoPublico(v);
    }
  }

  // Documentos
  if (metodo === "GET" && caminho === "/api/frota/documentos") {
    ver();
    return docs.filter((d) => !q.get("veiculoId") || d.veiculoId === q.get("veiculoId")).map(docPublico)
      .filter((d) => !q.get("situacao") || d.situacao === q.get("situacao")).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }
  if (metodo === "POST" && caminho === "/api/frota/documentos") {
    gerir();
    const d: Doc = { id: ctx.id("do"), veiculoId: c.veiculoId, tipo: c.tipo, descricao: c.descricao || null, numero: c.numero || null, vencimento: c.vencimento, observacao: c.observacao || null };
    docs.push(d);
    return docPublico(d);
  }
  if (r(/^\/api\/frota\/documentos\/([^/]+)$/)) {
    gerir();
    const d = achar(docs, m![1]!, ctx, "Documento");
    if (metodo === "DELETE") { docs.splice(docs.indexOf(d), 1); return { ok: true }; }
    if (metodo === "PATCH") return docPublico(aplicar(d, c, ["tipo", "descricao", "numero", "vencimento", "observacao"]));
  }

  // Planos e ordens de manutenção
  if (metodo === "GET" && caminho === "/api/frota/planos") {
    ver();
    return planos.filter((p) => !q.get("veiculoId") || p.veiculoId === q.get("veiculoId")).map(planoPublico);
  }
  if (metodo === "POST" && caminho === "/api/frota/planos") {
    gerir();
    const p: Plano = { id: ctx.id("pl"), veiculoId: c.veiculoId, nome: c.nome, intervaloKm: c.intervaloKm ?? null, intervaloDias: c.intervaloDias ?? null, ultimoKm: c.ultimoKm ?? veiculo(c.veiculoId)?.kmAtual ?? null, ultimaData: c.ultimaData ?? hoje, critico: !!c.critico, ativo: c.ativo ?? true };
    planos.push(p);
    return planoPublico(p);
  }
  if (metodo === "PATCH" && r(/^\/api\/frota\/planos\/([^/]+)$/)) {
    gerir();
    return planoPublico(aplicar(achar(planos, m![1]!, ctx, "Plano"), c, ["nome", "intervaloKm", "intervaloDias", "ultimoKm", "ultimaData", "critico", "ativo"]));
  }
  if (metodo === "GET" && caminho === "/api/frota/ordens") {
    ver();
    return ordens.filter((o) => (!q.get("veiculoId") || o.veiculoId === q.get("veiculoId")) && (!q.get("status") || o.status === q.get("status")))
      .sort((a, b) => b.abertaEm.localeCompare(a.abertaEm)).map(ordemPublica);
  }
  if (metodo === "POST" && caminho === "/api/frota/ordens") {
    gerir();
    const o: Ordem = { id: ctx.id("or"), veiculoId: c.veiculoId, planoId: c.planoId ?? null, tipo: c.tipo, status: "ABERTA", descricao: c.descricao, oficina: c.oficina ?? null, pecas: c.pecas ?? null, imobiliza: !!c.imobiliza, abertaEm: c.abertaEm ?? hoje, concluidaEm: null, km: c.km ?? null, custoCentavos: 0 };
    ordens.push(o);
    ctx.auditar("ORDEM_ABERTA", "ordem", o.id);
    return ordemPublica(o);
  }
  if (metodo === "PATCH" && r(/^\/api\/frota\/ordens\/([^/]+)$/)) {
    gerir();
    const o = achar(ordens, m![1]!, ctx, "Ordem");
    aplicar(o, c, ["status", "descricao", "oficina", "pecas", "imobiliza", "km", "custoCentavos", "concluidaEm"]);
    if (o.status === "CONCLUIDA" && !o.concluidaEm) o.concluidaEm = hoje;
    return ordemPublica(o);
  }

  // Abastecimentos e quilometragem
  if (metodo === "GET" && caminho === "/api/frota/abastecimentos") {
    ver();
    const de = q.get("de") || "0000-00-00";
    const ate = q.get("ate") || "9999-99-99";
    const todos = abastecimentosCalculados(q.get("veiculoId") || undefined).filter((a) => a.data >= de && a.data <= ate);
    const itensRes = todos.sort((a, b) => b.data.localeCompare(a.data)).map((a) => ({ ...a, ...rotuloPlaca(veiculo(a.veiculoId)) }));
    const resumo = veiculos.filter((v) => todos.some((a) => a.veiculoId === v.id)).map((v) => {
      const dele = todos.filter((a) => a.veiculoId === v.id);
      return { veiculoId: v.id, ...rotuloPlaca(v), litros: dele.reduce((s, a) => s + a.litros, 0), valorCentavos: dele.reduce((s, a) => s + a.valorCentavos, 0), mediaKml: mediaConsumo(dele.map((a) => a.kml)), alertas: dele.filter((a) => a.alerta).length };
    });
    return { itens: itensRes, resumo };
  }
  if (metodo === "POST" && caminho === "/api/frota/abastecimentos") {
    gerir();
    const a: Abast = { id: ctx.id("ab"), veiculoId: c.veiculoId, data: c.data, km: c.km, litros: c.litros, valorCentavos: c.valorCentavos, posto: c.posto ?? null, tanqueCheio: c.tanqueCheio !== false };
    abastecimentos.push(a);
    const v = veiculo(a.veiculoId);
    if (v && a.km > v.kmAtual) v.kmAtual = a.km;
    return { ...a, ...rotuloPlaca(v!), kml: null, alerta: null };
  }
  if (metodo === "DELETE" && r(/^\/api\/frota\/abastecimentos\/([^/]+)$/)) {
    gerir();
    abastecimentos.splice(abastecimentos.indexOf(achar(abastecimentos, m![1]!, ctx, "Abastecimento")), 1);
    return { ok: true };
  }
  if (metodo === "GET" && caminho === "/api/frota/leituras-km") { ver(); return []; }
  if (metodo === "POST" && caminho === "/api/frota/leituras-km") {
    gerir();
    const v = achar(veiculos, c.veiculoId, ctx, "Veículo");
    if (c.km < v.kmAtual) throw ctx.erro(400, "KM_MENOR", "A quilometragem não pode ser menor que a atual.");
    v.kmAtual = c.km;
    return { ok: true, kmAtual: v.kmAtual };
  }

  // Checklist
  if (metodo === "GET" && caminho === "/api/frota/checklist/itens") {
    ctx.exigir();
    return itens.filter((i) => q.get("todos") === "true" || i.ativo).sort((a, b) => a.ordem - b.ordem);
  }
  if (metodo === "POST" && caminho === "/api/frota/checklist/itens") {
    gerir();
    const i: Item = { id: ctx.id("it"), grupo: c.grupo, descricao: c.descricao, critico: !!c.critico, ordem: c.ordem ?? itens.length + 1, ativo: true };
    itens.push(i);
    return i;
  }
  if (metodo === "PATCH" && r(/^\/api\/frota\/checklist\/itens\/([^/]+)$/)) {
    gerir();
    return aplicar(achar(itens, m![1]!, ctx, "Item"), c, ["grupo", "descricao", "critico", "ordem", "ativo"]);
  }
  if (metodo === "GET" && caminho === "/api/frota/checklist/veiculos") {
    ctx.exigir();
    return veiculos.filter((v) => v.situacao !== "INATIVO").map((v) => {
      const hojeFeito = feitos.find((f) => f.veiculoId === v.id && f.data === hoje);
      return { id: v.id, placa: v.placa, apelido: v.apelido, tipo: v.tipo, kmAtual: v.kmAtual, situacao: v.situacao, feitoHoje: !!hojeFeito, aprovadoHoje: hojeFeito ? hojeFeito.aprovado : null };
    });
  }
  if (metodo === "GET" && caminho === "/api/frota/checklists") {
    ver();
    return feitos.filter((f) => (!q.get("veiculoId") || f.veiculoId === q.get("veiculoId")) && (!q.get("de") || f.data >= q.get("de")!)
      && (!q.get("somenteProblemas") || !f.aprovado || f.respostas.some((x) => !x.ok)))
      .sort((a, b) => b.data.localeCompare(a.data)).map((f) => {
        const v = veiculo(f.veiculoId);
        const respostas = f.respostas.map((x) => { const i = itens.find((y) => y.id === x.itemId)!; return { itemId: x.itemId, grupo: i.grupo, descricao: i.descricao, critico: i.critico, ok: x.ok, observacao: x.observacao }; });
        return { id: f.id, veiculoId: f.veiculoId, ...rotuloPlaca(v), motorista: f.motorista, data: f.data, km: f.km, aprovado: f.aprovado, observacao: f.observacao, respostas, resumo: { ...resultadoChecklist(f.respostas), aprovado: f.aprovado } };
      });
  }
  if (metodo === "POST" && caminho === "/api/frota/checklists") {
    ctx.exigir("frota:checklist");
    const respostas = (c.respostas ?? []) as Array<{ itemId: string; ok: boolean; observacao?: string | null }>;
    const norm = respostas.map((x) => ({ itemId: x.itemId, ok: x.ok, observacao: x.observacao ?? null }));
    const resumo = resultadoChecklist(norm);
    const aprovado = resumo.criticosNaoOk === 0;
    const v = achar(veiculos, c.veiculoId, ctx, "Veículo");
    feitos.push({ id: ctx.id("ck"), veiculoId: v.id, motorista: "Usuário da demonstração", data: hoje, km: c.km ?? null, aprovado, observacao: c.observacao ?? null, respostas: norm });
    if (c.km && c.km > v.kmAtual) v.kmAtual = c.km;
    return { aprovado, veiculoBloqueado: false, resumo: { total: resumo.total, naoOk: resumo.naoOk, criticosNaoOk: resumo.criticosNaoOk } };
  }

  // Painel
  if (metodo === "GET" && caminho === "/api/frota/painel") {
    ver();
    const mes = q.get("mes") || hoje.slice(0, 7);
    const ativos = veiculos.filter((v) => v.situacao !== "INATIVO");
    const sits = new Map(ativos.map((v) => [v.id, situacaoOperacional(v)]));
    const disp = ativos.filter((v) => sits.get(v.id)!.motivos.length === 0 && v.situacao === "ATIVO");
    const vencimentos = ativos.flatMap((v) => sits.get(v.id)!.docs.filter((d) => d.situacao !== "EM_DIA").map((d) => ({ ...rotulo(v), documentoId: d.id, tipo: d.tipo, descricao: d.descricao, vencimento: d.vencimento, situacao: d.situacao, dias: d.dias }))).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const manutencoes = ativos.flatMap((v) => sits.get(v.id)!.planos.filter((p) => p.situacao === "VENCIDA" || p.situacao === "PROXIMA").map((p) => ({ ...rotulo(v), planoId: p.id, nome: p.nome, critico: p.critico, situacao: p.situacao, kmRestante: p.kmRestante, diasRestantes: p.diasRestantes })));
    const ab = abastecimentosCalculados().filter((a) => a.data.slice(0, 7) === mes);
    const custos = veiculos.map((v) => {
      const man = ordens.filter((o) => o.veiculoId === v.id && o.status === "CONCLUIDA" && (o.concluidaEm ?? "").slice(0, 7) === mes).reduce((s, o) => s + o.custoCentavos, 0);
      const dele = ab.filter((a) => a.veiculoId === v.id);
      const comb = dele.reduce((s, a) => s + a.valorCentavos, 0);
      const kms = dele.map((a) => a.km);
      const km = kms.length > 1 ? Math.max(...kms) - Math.min(...kms) : 0;
      return { ...rotulo(v), manutencaoCentavos: man, combustivelCentavos: comb, totalCentavos: man + comb, kmRodados: km, custoPorKmCentavos: km > 0 ? Math.round((man + comb) / km) : null };
    }).filter((x) => x.totalCentavos > 0);
    return {
      mes,
      disponibilidade: { total: ativos.length, disponiveis: disp.length, percentual: ativos.length ? Math.round((disp.length / ativos.length) * 100) : null, indisponiveis: ativos.filter((v) => !disp.includes(v)).map((v) => ({ ...rotulo(v), motivos: sits.get(v.id)!.motivos })) },
      vencimentos,
      vencimentosTotais: { vencidos: vencimentos.filter((x) => x.situacao === "VENCIDO").length, aVencer: vencimentos.filter((x) => x.situacao === "A_VENCER").length },
      manutencoes,
      ordensAbertas: ordens.filter((o) => o.status === "ABERTA" || o.status === "EM_ANDAMENTO").length,
      checklist: { pendentesHoje: ativos.filter((v) => v.situacao === "ATIVO" && !feitos.some((f) => f.veiculoId === v.id && f.data === hoje)).map(rotulo), reprovadosHoje: feitos.filter((f) => f.data === hoje && !f.aprovado).length },
      custos,
      totais: { manutencaoCentavos: custos.reduce((s, x) => s + x.manutencaoCentavos, 0), combustivelCentavos: custos.reduce((s, x) => s + x.combustivelCentavos, 0), litros: ab.reduce((s, a) => s + a.litros, 0), mediaKml: mediaConsumo(ab.map((a) => a.kml)) },
      alertasConsumo: ab.filter((a) => a.alerta).map((a) => ({ ...rotulo(veiculo(a.veiculoId)), abastecimentoId: a.id, data: a.data, kml: a.kml, alerta: a.alerta! })),
    };
  }
  throw ctx.erro(404, "NAO_ENCONTRADO", "Função não disponível na demonstração.");
};
