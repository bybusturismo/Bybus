/** Marketing 2 da demonstração: avaliações (fila), retorno de campanhas, relatórios, link na bio, orçamentos, mensagens e NPS. Tudo fictício. */
import { NAO, UN_FLN, UN_BC, achar, diasEntre, inicioDaSemana, somarMeses, type Rotear } from "./comum";

type Idioma = "pt" | "en" | "es";
interface Pedido { id: string; reservaId: string; status: string; texto: string; idioma: Idioma; canalAvaliacao: string; link: string | null; data: string; passeio: string; canal: string; temTelefone: boolean; nps: string | null; pedidoEm: string | null }
interface Externa { id: string; semana: string; canal: string; alvo: string; unidadeId: string | null; notaCentesimos: number; quantidade: number }
interface Botao { id: string; rotulo: string; url: string; tipo: string; ordem: number; destaque: boolean; ativo: boolean }
interface Orc { id: string; protocolo: string; nome: string; organizacao: string; tipoGrupo: string; telefone: string | null; email: string | null; contatosOcultos: boolean; dataPrevista: string | null; dataPretendida: string | null; pessoas: number; servico: string; cidadeOrigem: string | null; mensagem: string | null; utmSource: string | null; utmCampaign: string | null; status: string; responsavelId: string | null; responsavel: string | null; anotacoes: string | null; anonimizado: boolean; criadoEm: string }
interface Caso { id: string; reservaId: string; nota: number; comentario: string | null; titular: string; data: string; passeio: string; guia: string | null; casoStatus: string; casoNota: string | null; responsavel: string | null }

const MODELOS: Record<Idioma, string> = {
  pt: "Olá, {nome}! Obrigado por passear com a By Bus no {passeio} em {data}. Sua opinião ajuda muito: pode nos avaliar? {link}",
  en: "Hi {nome}! Thank you for joining By Bus on the {passeio} on {data}. Your feedback helps a lot: would you leave us a review? {link}",
  es: "¡Hola, {nome}! Gracias por pasear con By Bus en el {passeio} el {data}. Tu opinión ayuda mucho: ¿nos dejas una reseña? {link}",
};
const GOOGLE_FLN = "https://g.page/r/bybus-floripa-exemplo";
const TRIP = "https://tripadvisor.exemplo.test/bybus";
const FLUXOS = [
  { codigo: "COMPRA", rotulo: "Confirmação da compra", quando: "Logo depois da compra (voucher/confirmação).", editavel: true, variaveis: ["nome", "passeio", "data"], ligado: true, origemDoLigado: "TELA",
    padroes: { pt: "Olá, {nome}! Sua reserva no {passeio} para {data} está confirmada. Na véspera enviaremos o ponto e o horário de embarque.", en: "Hi {nome}! Your booking for the {passeio} on {data} is confirmed. The day before, we will send you the pickup point and time.", es: "¡Hola, {nome}! Tu reserva en el {passeio} para el {data} está confirmada. La víspera te enviaremos el punto y la hora de embarque." } },
  { codigo: "VESPERA", rotulo: "Véspera do passeio", quando: "Às 21h da véspera, junto do fechamento da lista (já existe).", editavel: false, variaveis: [], ligado: true, origemDoLigado: "FECHAMENTO", padroes: { pt: "Enviada pelo fechamento da lista (Operação › Fechamento).", en: "", es: "" } },
  { codigo: "AVALIACAO", rotulo: "Convite de avaliação (fila diária)", quando: "No dia seguinte ao passeio, para quem não recebe o NPS. O texto é editado em Marketing › Avaliações.", editavel: false, variaveis: [], ligado: false, origemDoLigado: "PADRAO", padroes: { pt: "Texto por idioma em Marketing › Avaliações.", en: "", es: "" } },
  { codigo: "POS_PASSEIO", rotulo: "Pós-passeio com NPS", quando: "No dia seguinte ao passeio.", editavel: true, variaveis: ["nome", "passeio", "data", "linkNps"], ligado: true, origemDoLigado: "TELA",
    padroes: { pt: "Olá, {nome}! Obrigado por passear com a By Bus no {passeio}. Em uma pergunta só: de 0 a 10, o quanto você nos recomendaria? {linkNps}", en: "Hi {nome}! Thank you for joining By Bus on the {passeio}. One quick question: from 0 to 10, how likely are you to recommend us? {linkNps}", es: "¡Hola, {nome}! Gracias por pasear con By Bus en el {passeio}. Una sola pregunta: de 0 a 10, ¿cuánto nos recomendarías? {linkNps}" } },
  { codigo: "CUPOM_RETORNO", rotulo: "Cupom de retorno", quando: "Na tela de agradecimento do NPS (opcional).", editavel: true, variaveis: ["nome", "cupom"], ligado: false, origemDoLigado: "PADRAO",
    padroes: { pt: "Para voltar com a gente, use o cupom {cupom} na sua próxima reserva.", en: "To come back with us, use the coupon {cupom} on your next booking.", es: "Para volver con nosotros, usa el cupón {cupom} en tu próxima reserva." } },
];
type Fluxo = (typeof FLUXOS)[number] & { textos: Record<Idioma, string>; personalizado: Record<Idioma, boolean>; extra: string | null };

let semeado = false;
let hoje = "";
let modelos = { ...MODELOS };
let linkTrip: string | null = TRIP;
let googleFln: string | null = GOOGLE_FLN;
let googleBc: string | null = null;
const pedidos: Pedido[] = [];
const externas: Externa[] = [];
const botoes: Botao[] = [];
let bio = { titulo: "By Bus Turismo", subtitulo: "Passeios em Florianópolis e Balneário Camboriú", corPrimaria: "#007ac8", corFundo: "#f4f6f8", cupomCodigo: "ILHA10" as string | null, cupomTexto: "10% de desconto no City Tour Toda Ilha" as string | null };
const cliquesDia: Array<{ dia: string; visitas: number; cliques: number }> = [];
const orcs: Orc[] = [];
const casos: Caso[] = [];
const fluxos: Fluxo[] = FLUXOS.map((f) => ({ ...f, textos: { ...f.padroes }, personalizado: { pt: false, en: false, es: false }, extra: null }));
const relatorios: Array<{ id: string; tipo: string; de: string; ate: string; unidadeId: string | null; praca: string; geradoEm: string; automatico: boolean; temResumoIa: boolean; dados: any; resumoNumeros: string; resumoIa: string | null }> = [];
const retornoCusto = new Map<string, { custo: number; cliques: number; impressoes: number }>();
let npsDemo: { respondido: boolean } = { respondido: false };

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const render = (m: string, v: Record<string, string>) => m.replace(/\{(\w+)\}/g, (x, k: string) => (k in v ? v[k]! : x)).replace(/ {2,}/g, " ").trim();
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, 60);

function textoPedido(p: { nome: string; passeio: string; data: string; idioma: Idioma; canal: string; escolhido?: string }) {
  if (p.canal === "VIATOR") return { canalAvaliacao: "VIATOR", link: null as string | null, texto: ({ pt: "Olá, {nome}! Como você reservou pela Viator, a avaliação é feita lá mesmo, pelo e-mail ou pelo app da Viator da sua reserva.", en: "Hi {nome}! Since you booked through Viator, you can leave your review there, from the Viator email or app for your booking.", es: "¡Hola, {nome}! Como reservaste por Viator, puedes dejar tu reseña allí, desde el correo o la app de Viator de tu reserva." } as const)[p.idioma].replace("{nome}", p.nome) };
  const link = p.escolhido === "TRIPADVISOR" ? linkTrip : googleFln ?? linkTrip;
  const canalAvaliacao = link ? (link === linkTrip && p.escolhido !== "GOOGLE" && (p.escolhido === "TRIPADVISOR" || !googleFln) ? "TRIPADVISOR" : "GOOGLE") : "NENHUM";
  return { canalAvaliacao, link, texto: render(modelos[p.idioma], { nome: p.nome, passeio: p.passeio, data: dataBr(p.data), link: link ?? "" }) };
}

function semear(dataMais: (n: number) => string) {
  if (semeado) return;
  semeado = true;
  hoje = dataMais(0);
  const pas = ["City Tour Toda Ilha", "City Tour Balneário Camboriú"];
  const gente: Array<[string, Idioma, string, string]> = [["Ana", "pt", "PAYTOUR", "pt"], ["John", "en", "VIATOR", "en"], ["Carla", "pt", "PAYTOUR", "pt"], ["Lucía", "es", "CIVITATIS", "es"], ["Pedro", "pt", "PAYTOUR", "pt"], ["Emma", "en", "VIATOR", "en"], ["Marta", "pt", "DECOLAR", "pt"], ["Diego", "es", "PAYTOUR", "es"]];
  const status = ["PENDENTE", "PENDENTE", "SIMULADA", "ENVIADA_MANUAL", "AVALIADA", "LEMBRADA", "SEM_TELEFONE", "PENDENTE"];
  gente.forEach(([nome, idioma, canal], i) => {
    const passeio = pas[i % 2]!, data = dataMais(-(1 + (i % 4)));
    const t = textoPedido({ nome, passeio, data, idioma, canal });
    pedidos.push({ id: `pd-${i + 1}`, reservaId: `rv-demo-${i + 1}`, status: status[i]!, idioma, canal, passeio, data, temTelefone: status[i] !== "SEM_TELEFONE", nps: i === 0 ? "ENVIADO" : i === 4 ? "RESPONDIDO" : null, pedidoEm: ["SIMULADA", "ENVIADA_MANUAL", "AVALIADA", "LEMBRADA"].includes(status[i]!) ? new Date(Date.now() - (i === 5 ? 9 : 2) * 86_400_000).toISOString() : null, ...t });
  });
  const seg = inicioDaSemana(hoje);
  const serie = (canal: string, alvo: string, base: number, qtd: number) => [5, 4, 3, 2, 1, 0].forEach((k, j) => externas.push({ id: `ex-${canal}-${alvo}-${k}`, semana: new Date(Date.parse(`${seg}T12:00:00Z`) - k * 7 * 86_400_000).toISOString().slice(0, 10), canal, alvo, unidadeId: null, notaCentesimos: base + [0, 1, 1, 3, 4, 5][j]!, quantidade: qtd + j * 3 }));
  serie("GOOGLE", "PROPRIA", 471, 318); serie("TRIPADVISOR", "PROPRIA", 455, 204); serie("GOOGLE", "Concorrente Exemplo", 432, 520);
  botoes.push(
    { id: "bb-1", rotulo: "Reservar na Paytour", url: "https://paytour.exemplo.test/bybus", tipo: "PAYTOUR", ordem: 1, destaque: true, ativo: true },
    { id: "bb-2", rotulo: "Falar no WhatsApp", url: "https://wa.me/5548900000000", tipo: "WHATSAPP", ordem: 2, destaque: false, ativo: true },
    { id: "bb-3", rotulo: "Nossos passeios", url: "https://loja.exemplo.test/passeios", tipo: "PASSEIOS", ordem: 3, destaque: false, ativo: true },
    { id: "bb-4", rotulo: "Avaliações no Tripadvisor", url: TRIP, tipo: "TRIPADVISOR", ordem: 4, destaque: false, ativo: true },
  );
  for (let i = 13; i >= 0; i--) cliquesDia.push({ dia: dataMais(-i), visitas: 40 + ((i * 7) % 23), cliques: 14 + ((i * 5) % 11) });
  const mk = (i: number, o: Partial<Orc>): Orc => ({ id: `oc-${i}`, protocolo: `A1B2C${i}D${i}`, nome: "Contato Fictício", organizacao: "", tipoGrupo: "ESCOLA", telefone: "+55 48 90000-0000", email: "contato@exemplo.test", contatosOcultos: false, dataPrevista: null, dataPretendida: dataMais(30), pessoas: 40, servico: pas[0]!, cidadeOrigem: null, mensagem: null, utmSource: null, utmCampaign: null, status: "NOVO", responsavelId: null, responsavel: null, anotacoes: null, anonimizado: false, criadoEm: new Date(Date.now() - i * 86_400_000).toISOString(), ...o });
  orcs.push(
    mk(1, { organizacao: "Escola Modelo (fictícia)", nome: "Coordenadora Exemplo", pessoas: 52, cidadeOrigem: "Chapecó", mensagem: "Passeio de fim de ano para 3 turmas.", utmSource: "instagram" }),
    mk(2, { organizacao: "Empresa Exemplo Ltda (fictícia)", tipoGrupo: "EMPRESA", pessoas: 28, servico: "Fretamento + City Tour", cidadeOrigem: "Joinville", status: "EM_CONTATO", responsavel: "Atendente Demo", responsavelId: "rs-1", anotacoes: "Pediu proposta com almoço." }),
    mk(3, { organizacao: "Excursão Amigos da Serra (fictícia)", tipoGrupo: "EXCURSAO", pessoas: 46, servico: pas[1]!, cidadeOrigem: "Lages", status: "PROPOSTA_ENVIADA", responsavel: "Supervisora Demo", responsavelId: "rs-2", utmSource: "google" }),
    mk(4, { organizacao: "Congresso Médico Exemplo (fictício)", tipoGrupo: "EVENTO", pessoas: 120, servico: "Transfer + passeios", status: "FECHADO", responsavel: "Atendente Demo", responsavelId: "rs-1" }),
    mk(5, { organizacao: "Colégio Exemplo Sul (fictício)", pessoas: 35, status: "PERDIDO", anotacoes: "Fechou com outra empresa." }),
  );
  const nomes = ["Bruno", "Fernanda", "Rafael"];
  nomes.forEach((n, i) => casos.push({ id: `cs-${i + 1}`, reservaId: `rv-c-${i}`, nota: [3, 5, 6][i]!, comentario: ["O ônibus atrasou 20 minutos no meu hotel.", "A explicação do guia foi difícil de ouvir no fundo.", null][i]!, titular: n, data: dataMais(-(i + 2)), passeio: pas[i % 2]!, guia: ["Guia Fictícia Ana", "Guia Fictícia Bia", null][i]!, casoStatus: ["ABERTO", "ABERTO", "RESOLVIDO"][i]!, casoNota: i === 2 ? "Liguei, pedi desculpas e ofereci cupom." : null, responsavel: i === 2 ? "Atendente Demo" : null }));
  const mensal = periodo("MENSAL", hoje), sem = periodo("SEMANAL", hoje);
  for (const [tipo, per, ia] of [["SEMANAL", sem, true], ["MENSAL", mensal, false], ["SEMANAL", periodo("SEMANAL", somarDiasIso(hoje, -7)), false]] as const) {
    const dados = dadosRelatorio(per, tipo === "MENSAL" ? 1 : 0.28);
    relatorios.push({ id: `rl-${relatorios.length + 1}`, tipo, de: per.de, ate: per.ate, unidadeId: null, praca: "Todas as praças", geradoEm: new Date(Date.parse(`${per.ate}T10:00:00Z`) + 86_400_000).toISOString(), automatico: true, temResumoIa: ia, dados, resumoNumeros: resumo(dados), resumoIa: ia ? "As reservas cresceram 12% sobre a semana anterior, puxadas pela Paytour e pela Civitatis. O Instagram trouxe 9 reservas a R$ 41 cada, o melhor custo do período. A nota do Google segue em 4,76. Atenção: 2 casos de NPS baixo (atraso de ônibus) ainda abertos. Sugestão: reforçar com os motoristas a pontualidade no pick-up e responder os dois casos hoje." : null });
  }
  const f = fluxos.find((x) => x.codigo === "CUPOM_RETORNO")!;
  f.extra = "VOLTE10";
}

function somarDiasIso(iso: string, n: number) { return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10); }
function periodo(tipo: "SEMANAL" | "MENSAL", ref: string) {
  if (tipo === "SEMANAL") { const seg = inicioDaSemana(ref); const de = somarDiasIso(seg, -7); return { de, ate: somarDiasIso(seg, -1), rotulo: `Semana de ${dataBr(de)} a ${dataBr(somarDiasIso(seg, -1))}` }; }
  const m = somarMeses(ref.slice(0, 7), -1);
  const ate = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const nome = new Date(`${m}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).replace(" de ", " de ");
  return { de: `${m}-01`, ate, rotulo: nome.charAt(0).toUpperCase() + nome.slice(1) };
}
function dadosRelatorio(per: { de: string; ate: string; rotulo: string }, esc: number) {
  const n = (v: number) => Math.round(v * esc);
  return {
    periodo: { ...per, anteriorDe: somarDiasIso(per.de, -diasEntre(per.de, per.ate) - 1), anteriorAte: somarDiasIso(per.de, -1) },
    vendas: { atual: { reservas: n(412), passageiros: n(1010), receitaCentavos: n(412) * 21_500 }, anterior: { reservas: n(368), passageiros: n(905), receitaCentavos: n(368) * 20_900 }, variacao: { reservas: 12, passageiros: 11.6, receita: 15.2 },
      porCanal: [["PAYTOUR", 212, 190], ["VIATOR", 74, 80], ["CIVITATIS", 41, 28], ["BALCAO", 51, 49], ["DECOLAR", 34, 21]].map(([canal, a, b]) => ({ canal, reservas: n(a as number), passageiros: n((a as number) * 2.4), receitaCentavos: n(a as number) * 21_000, reservasAnterior: n(b as number), variacaoReservas: Math.round((((a as number) - (b as number)) / (b as number)) * 1000) / 10 })) },
    origem: [["SC", 168], ["SP", 142], ["RS", 96], ["ARG", 52], ["USA", 28]].map(([origem, p]) => ({ origem, passageiros: n(p as number) })),
    campanhas: [{ nome: "Instagram — Balneário Camboriú", midia: "INSTAGRAM", reservas: n(9), receitaCentavos: n(9) * 22_000, investimentoCentavos: n(9) * 4_100, custoOrigem: "CSV", custoPorReservaCentavos: 4_100, retorno: 5.4 }, { nome: "Google Ads — City Tour Toda Ilha", midia: "GOOGLE_ADS", reservas: n(21), receitaCentavos: n(21) * 21_000, investimentoCentavos: n(21) * 5_800, custoOrigem: "CSV", custoPorReservaCentavos: 5_800, retorno: 3.6 }],
    avaliacoes: { pedidosFeitos: n(140), avaliados: n(31), pedidosFeitosAnterior: n(120), avaliadosAnterior: n(26), notaInterna: 4.7, notaInternaAnterior: 4.6, notasCanais: [{ canal: "GOOGLE", nota: 4.76, quantidade: 336 }, { canal: "TRIPADVISOR", nota: 4.6, quantidade: 219 }] },
    nps: { respostas: n(96), nps: 61, npsAnterior: 55, detratores: n(5) },
    orcamentos: { recebidos: n(7), recebidosAnterior: n(4), fechados: n(2) }, bio: { visitas: n(640), cliques: n(231), visitasAnterior: n(560), cliquesAnterior: n(190) },
  };
}
function resumo(d: ReturnType<typeof dadosRelatorio>) {
  return `${d.periodo.rotulo}.\nReservas: ${d.vendas.atual.reservas} (+12% sobre o período anterior), com ${d.vendas.atual.passageiros} passageiros (+11,6%).\nReceita das reservas: ${reais(d.vendas.atual.receitaCentavos)} (+15,2%).\nNPS: ${d.nps.nps} com ${d.nps.respostas} resposta(s) (antes ${d.nps.npsAnterior}).`;
}

const dataLonga = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" });

export const rotearMkt2: Rotear = (ctx, metodo, caminho, q, c) => {
  const ehPub = caminho.startsWith("/api/publico/bio") || caminho.startsWith("/api/publico/orcamento") || caminho.startsWith("/api/publico/nps/");
  const ehMkt = /^\/api\/marketing\/(avaliacoes|retorno|links|relatorios|bio|mensagens|nps|avisos)/.test(caminho) || /^\/api\/marketing\/campanhas\/[^/]+\/custos/.test(caminho) || caminho.startsWith("/api/orcamentos");
  if (!ehPub && !ehMkt) return NAO;
  semear(ctx.dataMais);
  let m: RegExpMatchArray | null;
  const r = (re: RegExp) => (m = caminho.match(re));
  const ver = () => ctx.exigir("marketing:ver");
  const gerir = () => ctx.exigir("marketing:gerenciar");
  const reservasPerm = () => ctx.exigir("reservas:editar");

  // ───────── Páginas públicas (sem login) ─────────
  if (metodo === "GET" && caminho === "/api/publico/bio") return { titulo: bio.titulo, subtitulo: bio.subtitulo, corPrimaria: bio.corPrimaria, corFundo: bio.corFundo, cupom: bio.cupomCodigo ? { codigo: bio.cupomCodigo, texto: bio.cupomTexto } : null, botoes: botoes.filter((b) => b.ativo).sort((a, b) => a.ordem - b.ordem).map(({ id, rotulo, url, tipo, destaque }) => ({ id, rotulo, url, tipo, destaque })) };
  if (metodo === "POST" && caminho === "/api/publico/bio/visita") { cliquesDia[cliquesDia.length - 1]!.visitas++; return { ok: true }; }
  if (metodo === "POST" && caminho === "/api/publico/bio/clique") { cliquesDia[cliquesDia.length - 1]!.cliques++; return { ok: true }; }
  if (metodo === "GET" && caminho === "/api/publico/orcamento/formulario") return { token: `${Date.now()}.demonstracao`, passeios: ["City Tour Toda Ilha", "City Tour Balneário Camboriú", "Fretamento"], tipos: ["ESCOLA", "EMPRESA", "EXCURSAO", "EVENTO", "OUTRO"], consentimentoVersao: "2026-11-06" };
  if (metodo === "POST" && caminho === "/api/publico/orcamento") {
    if (!c.consentimento) throw ctx.erro(400, "DADOS_INVALIDOS", "É preciso concordar com o uso dos seus dados.");
    const i = orcs.length + 1;
    orcs.unshift({ id: ctx.id("oc"), protocolo: `D3M0${String(i).padStart(4, "0")}`, nome: c.nome, organizacao: c.organizacao, tipoGrupo: c.tipoGrupo, telefone: c.telefone ?? null, email: c.email ?? null, contatosOcultos: false, dataPrevista: null, dataPretendida: c.dataPretendida ?? null, pessoas: c.pessoas, servico: c.servico, cidadeOrigem: c.cidadeOrigem ?? null, mensagem: c.mensagem ?? null, utmSource: c.utmSource ?? null, utmCampaign: c.utmCampaign ?? null, status: "NOVO", responsavelId: null, responsavel: null, anotacoes: null, anonimizado: false, criadoEm: ctx.agoraIso() });
    return { ok: true, protocolo: orcs[0]!.protocolo };
  }
  if (r(/^\/api\/publico\/nps\/([^/]+)$/)) {
    if (metodo === "GET") return { passeio: "City Tour Toda Ilha", data: ctx.dataMais(-1), titular: "Paula", idioma: new URLSearchParams(location.search).get("lang") === "en" ? "en" : "pt", respondido: npsDemo.respondido };
    if (npsDemo.respondido) throw ctx.erro(409, "JA_RESPONDIDO", "Esta pesquisa já foi respondida. Obrigado!");
    npsDemo = { respondido: true };
    if (c.nota <= 6) casos.unshift({ id: ctx.id("cs"), reservaId: "rv-demo-nps", nota: c.nota, comentario: c.comentario ?? null, titular: "Paula", data: ctx.dataMais(-1), passeio: "City Tour Toda Ilha", guia: null, casoStatus: "ABERTO", casoNota: null, responsavel: null });
    const cr = fluxos.find((x) => x.codigo === "CUPOM_RETORNO")!;
    return { ok: true, convite: c.aceitaConvite ? { viator: false, canais: [...(googleFln ? [{ tipo: "GOOGLE", link: googleFln }] : []), ...(linkTrip ? [{ tipo: "TRIPADVISOR", link: linkTrip }] : [])] } : null, cupom: cr.ligado && cr.extra ? { codigo: cr.extra, texto: render(cr.textos.pt, { cupom: cr.extra }) } : null };
  }

  // ───────── Avisos da Visão Geral ─────────
  if (metodo === "GET" && caminho === "/api/marketing/avisos") {
    ctx.exigir();
    return { orcamentosNovos: ctx.pode("reservas:editar") ? orcs.filter((o) => o.status === "NOVO").length : 0, casosNpsAbertos: ctx.pode("marketing:ver") ? casos.filter((x) => x.casoStatus === "ABERTO").length : 0 };
  }

  // ───────── Avaliações ─────────
  if (metodo === "GET" && caminho === "/api/marketing/avaliacoes/config") {
    ver();
    return { modelos, padroes: MODELOS, linkTripadvisor: linkTrip, linksGoogle: [{ unidadeId: UN_FLN, codigo: "FLN", nome: "Florianópolis", link: googleFln }, { unidadeId: UN_BC, codigo: "BC", nome: "Balneário Camboriú", link: googleBc }], envio: { real: false, nota: "Modo simulado: nada sai de verdade; o pedido fica como “Simulada”." } };
  }
  if (metodo === "PATCH" && caminho === "/api/marketing/avaliacoes/config") {
    gerir();
    if (c.modelos) modelos = { ...modelos, ...c.modelos };
    if ("linkTripadvisor" in c) linkTrip = c.linkTripadvisor;
    for (const l of c.linksGoogle ?? []) { if (l.unidadeId === UN_FLN) googleFln = l.link; else googleBc = l.link; }
    return rotearMkt2(ctx, "GET", "/api/marketing/avaliacoes/config", q, {});
  }
  if (metodo === "GET" && caminho === "/api/marketing/avaliacoes/resumo") {
    ver();
    const feitos = pedidos.filter((p) => ["ENVIADA_MANUAL", "SIMULADA", "ENVIADA", "LEMBRADA", "AVALIADA"].includes(p.status)).length;
    const avaliados = pedidos.filter((p) => p.status === "AVALIADA").length;
    const cont: Record<string, number> = {};
    for (const p of pedidos) cont[p.status] = (cont[p.status] ?? 0) + 1;
    const semana = inicioDaSemana(hoje);
    return {
      periodo: { de: q.get("de"), ate: q.get("ate") },
      notas: { quantidade: 8, media: 4.5, distribuicao: [{ nota: 1, quantidade: 0 }, { nota: 2, quantidade: 0 }, { nota: 3, quantidade: 1 }, { nota: 4, quantidade: 2 }, { nota: 5, quantidade: 5 }], porGuia: [{ chave: "Guia Fictícia Ana", quantidade: 4, media: 4.8 }, { chave: "Guia Fictícia Bia", quantidade: 4, media: 4.3 }], porCanal: [{ chave: "PAYTOUR", quantidade: 5, media: 4.6 }, { chave: "VIATOR", quantidade: 1, media: 5 }] },
      pedidos: cont,
      funil: { elegiveis: 128, pedidos: pedidos.length, feitos, avaliados, lembretesSugeridos: pedidos.filter((p) => p.status !== "AVALIADA" && p.status !== "LEMBRADA" && p.pedidoEm && Date.now() - Date.parse(p.pedidoEm) > 7 * 86_400_000).length, taxaPedidos: Math.round((feitos / 128) * 1000) / 10, taxaAvaliacao: feitos ? Math.round((avaliados / feitos) * 1000) / 10 : null },
      semanal: [3, 2, 1, 0].map((k) => ({ semana: somarDiasIso(semana, -7 * k), pedidos: 30 + k * 3, feitos: 24 + k * 2, avaliados: 6 + k })),
      tripadvisor: { reservasViator: 74, passageirosViator: 168, link: linkTrip },
    };
  }
  if (metodo === "GET" && caminho === "/api/marketing/avaliacoes/pedidos") {
    ver();
    return pedidos.filter((p) => !q.get("status") || p.status === q.get("status")).sort((a, b) => b.data.localeCompare(a.data)).map((p) => ({ ...p, lembreteSugerido: !!p.pedidoEm && ["ENVIADA_MANUAL", "SIMULADA", "ENVIADA"].includes(p.status) && Date.now() - Date.parse(p.pedidoEm) > 7 * 86_400_000 }));
  }
  if (metodo === "POST" && caminho === "/api/marketing/avaliacoes/pedidos/gerar") { gerir(); return { criados: 0, periodo: { de: c.de, ate: c.ate }, envio: "NAO_ENVIADO" }; }
  if (metodo === "POST" && caminho === "/api/marketing/avaliacoes/pedidos/enviar-pendentes") {
    gerir();
    let n = 0;
    for (const p of pedidos) if (p.status === "PENDENTE" && p.temTelefone && !p.nps) { p.status = "SIMULADA"; p.pedidoEm = ctx.agoraIso(); n++; }
    return { enviados: n, falhas: 0, simulado: true };
  }
  if (metodo === "POST" && r(/^\/api\/marketing\/avaliacoes\/pedidos\/([^/]+)\/enviar$/)) {
    gerir();
    const p = achar(pedidos, m![1]!, ctx, "Pedido de avaliação");
    if (c.lembrete) { p.status = "LEMBRADA"; return { status: "LEMBRADA", simulado: true }; }
    p.status = "SIMULADA"; p.pedidoEm = ctx.agoraIso();
    return { status: "SIMULADA", simulado: true };
  }
  if (metodo === "PATCH" && r(/^\/api\/marketing\/avaliacoes\/pedidos\/([^/]+)$/)) {
    gerir();
    const p = achar(pedidos, m![1]!, ctx, "Pedido de avaliação");
    if (c.status) { p.status = c.status; if (["ENVIADA_MANUAL", "AVALIADA", "LEMBRADA"].includes(c.status)) p.pedidoEm ??= ctx.agoraIso(); }
    if (c.texto) p.texto = c.texto;
    if (c.idioma || c.canalAvaliacao) {
      const nome = p.texto.match(/(?:Olá, |Hi |¡Hola, )([^!]+)!/)?.[1] ?? "cliente";
      Object.assign(p, textoPedido({ nome, passeio: p.passeio, data: p.data, idioma: (c.idioma ?? p.idioma) as Idioma, canal: p.canal, escolhido: c.canalAvaliacao }), { idioma: c.idioma ?? p.idioma });
    }
    return { ok: true };
  }
  if (metodo === "POST" && caminho === "/api/marketing/avaliacoes/notas") { gerir(); return { ok: true }; }
  if (metodo === "GET" && caminho === "/api/marketing/avaliacoes/notas") { ver(); return []; }
  if (metodo === "GET" && caminho === "/api/marketing/avaliacoes/externas") { ver(); return externas; }
  if (metodo === "POST" && caminho === "/api/marketing/avaliacoes/externas") {
    gerir();
    const semana = inicioDaSemana(c.data ?? hoje), alvo = c.concorrente || "PROPRIA";
    let x = externas.find((e) => e.semana === semana && e.canal === c.canal && e.alvo === alvo);
    if (!x) { x = { id: ctx.id("ex"), semana, canal: c.canal, alvo, unidadeId: c.unidadeId ?? null, notaCentesimos: 0, quantidade: 0 }; externas.push(x); }
    x.notaCentesimos = Math.round(c.nota * 100); x.quantidade = c.quantidade;
    return x;
  }
  if (metodo === "DELETE" && r(/^\/api\/marketing\/avaliacoes\/externas\/([^/]+)$/)) { gerir(); const x = achar(externas, m![1]!, ctx, "Lançamento"); externas.splice(externas.indexOf(x), 1); return { ok: true }; }

  // ───────── Retorno de campanhas e links ─────────
  if (metodo === "GET" && caminho === "/api/marketing/retorno") {
    ver();
    const linha = (id: string, nome: string, midia: string, utm: string | null, cupom: string | null, pedidosN: number, reservas: number, receita: number, invest: number, csv: boolean, porUtm: number) => {
      const cu = retornoCusto.get(id);
      const inv = cu ? cu.custo : invest;
      return { id, nome, midia, cupom, utmCampanha: utm, ativa: true, pedidos: pedidosN, reservas, passageiros: Math.round(reservas * 2.4), receitaCentavos: receita, porUtm, porCupom: pedidosN - porUtm, investimentoCentavos: inv, custoOrigem: cu || csv ? "CSV" : "TOTAL_DA_CAMPANHA", cliques: cu ? cu.cliques : csv ? 412 : null, impressoes: cu ? cu.impressoes : csv ? 18_400 : null, custoPorReservaCentavos: reservas ? Math.round(inv / reservas) : null, retorno: receita && inv ? Math.round((receita / inv) * 100) / 100 : null, semUtm: !utm && !cupom };
    };
    return {
      periodo: { de: q.get("de"), ate: q.get("ate") },
      campanhas: [linha("cp-1", "Google Ads — City Tour Toda Ilha", "GOOGLE_ADS", "ads-toda-ilha", "ILHA10", 18, 21, 441_000, 122_000, true, 14), linha("cp-2", "Instagram — Balneário Camboriú", "INSTAGRAM", "insta-bc", "BC15", 7, 9, 198_000, 37_000, false, 5), linha("cp-3", "Cartazes no aeroporto (offline)", "OFFLINE", null, null, 0, 0, 0, 80_000, false, 0)].map((x) => ({ ...x, receitaCentavos: x.reservas ? x.receitaCentavos : null })),
      afiliados: [{ id: "af-1", nome: "Hotel Mar Azul (fictício)", codigo: "HOTEL-MAR-AZUL", ativo: true, pedidos: 4, reservas: 5, passageiros: 11, receitaCentavos: 112_000, comissaoPontosBase: 1000 }, { id: "af-2", nome: "Pousada Lagoa (fictícia)", codigo: "POUSADA-LAGOA", ativo: true, pedidos: 1, reservas: 1, passageiros: 2, receitaCentavos: 21_000, comissaoPontosBase: 800 }],
      semAtribuicao: { pedidosComSinal: 34, semCampanhaNemAfiliado: 3 },
      apis: { situacao: "PROXIMA_ETAPA", nota: "Custo por importação de CSV do Google Ads e do Meta Ads. A integração direta pelas APIs (aprovação das plataformas) é a próxima etapa." },
    };
  }
  if (metodo === "POST" && caminho === "/api/marketing/links") {
    ver();
    const defs: Record<string, [string, string]> = { cp: ["google", "cpc"] };
    const destino = c.destino || "https://loja.exemplo.test";
    let origem = c.origem || "", midia = c.midia || "", campanha = c.campanha || "", ref: string | null = null;
    if (c.campanhaId) { origem ||= defs.cp![0]; midia ||= defs.cp![1]; campanha ||= c.campanhaId === "cp-2" ? "insta-bc" : "ads-toda-ilha"; }
    else if (c.afiliadoId) { const cod = c.afiliadoId === "af-2" ? "POUSADA-LAGOA" : "HOTEL-MAR-AZUL"; origem ||= "afiliado"; midia ||= "qrcode"; campanha ||= `afiliado-${cod.toLowerCase()}`; ref = cod; }
    if (!origem || !midia || !campanha) throw ctx.erro(400, "DADOS_INVALIDOS", "Informe campanha, origem e mídia (ou escolha uma campanha ou um afiliado).");
    const u = new URL(destino);
    u.searchParams.set("utm_source", norm(origem)); u.searchParams.set("utm_medium", norm(midia)); u.searchParams.set("utm_campaign", norm(campanha));
    if (ref) u.searchParams.set("ref", ref);
    return { url: u.toString(), utm: { origem: norm(origem), midia: norm(midia), campanha: norm(campanha) }, salvouUtm: false };
  }
  if (metodo === "POST" && r(/^\/api\/marketing\/campanhas\/([^/]+)\/custos\/csv$/)) {
    gerir();
    const linhas = String(c.csv ?? "").split(/\r?\n/).filter((l) => /\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/.test(l));
    if (linhas.length === 0) throw ctx.erro(400, "CSV_INVALIDO", "Não encontrei as colunas de dia e custo. Exporte o relatório por dia, com as colunas Dia e Custo (Google Ads) ou Dia e Valor gasto (Meta Ads).");
    const custo = linhas.reduce((s, l) => s + Math.round((Number((l.split(/[;,]/).at(-1) ?? "0").replace(",", ".")) || 0) * 100), 0);
    retornoCusto.set(m![1]!, { custo: custo || 150_000, cliques: 20 * linhas.length, impressoes: 500 * linhas.length });
    return { importados: linhas.length, ignoradas: [], custoCentavos: custo || 150_000 };
  }

  // ───────── Relatórios ─────────
  if (metodo === "GET" && caminho === "/api/marketing/relatorios") {
    ver();
    return { iaLigada: true, relatorios: relatorios.filter((x) => !q.get("tipo") || x.tipo === q.get("tipo")).sort((a, b) => b.de.localeCompare(a.de)).map(({ id, tipo, de, ate, unidadeId, praca, geradoEm, automatico, temResumoIa }) => ({ id, tipo, de, ate, unidadeId, praca, geradoEm, automatico, temResumoIa })) };
  }
  if (metodo === "POST" && caminho === "/api/marketing/relatorios/gerar") {
    gerir();
    const per = periodo(c.tipo, hoje);
    const existe = relatorios.some((x) => x.tipo === c.tipo && x.de === per.de);
    if (!existe) { const dados = dadosRelatorio(per, c.tipo === "MENSAL" ? 1 : 0.28); relatorios.push({ id: ctx.id("rl"), tipo: c.tipo, de: per.de, ate: per.ate, unidadeId: null, praca: "Todas as praças", geradoEm: ctx.agoraIso(), automatico: false, temResumoIa: false, dados, resumoNumeros: resumo(dados), resumoIa: null }); }
    return { gerados: existe ? 0 : 1, periodo: per };
  }
  if (metodo === "GET" && r(/^\/api\/marketing\/relatorios\/([^/]+)$/)) { ver(); const x = achar(relatorios, m![1]!, ctx, "Relatório"); return { id: x.id, tipo: x.tipo, de: x.de, ate: x.ate, unidadeId: x.unidadeId, praca: x.praca, geradoEm: x.geradoEm, dados: x.dados, resumoNumeros: x.resumoNumeros, resumoIa: x.resumoIa }; }

  // ───────── Link na bio ─────────
  if (metodo === "GET" && caminho === "/api/marketing/bio") { ver(); return { config: bio, botoes: [...botoes].sort((a, b) => a.ordem - b.ordem), caminhoPublico: "/bio", tipos: ["PAYTOUR", "WHATSAPP", "TRIPADVISOR", "PASSEIOS", "SITE", "OUTRO"] }; }
  if (metodo === "PATCH" && caminho === "/api/marketing/bio/config") { gerir(); bio = { ...bio, ...c, cupomCodigo: c.cupomCodigo ? String(c.cupomCodigo).toUpperCase() : null, cupomTexto: c.cupomTexto || null }; return bio; }
  if (metodo === "POST" && caminho === "/api/marketing/bio/botoes") { gerir(); const b: Botao = { id: ctx.id("bb"), rotulo: c.rotulo, url: c.url, tipo: c.tipo ?? "OUTRO", ordem: c.ordem ?? 0, destaque: !!c.destaque, ativo: c.ativo ?? true }; botoes.push(b); return b; }
  if (r(/^\/api\/marketing\/bio\/botoes\/([^/]+)$/)) {
    gerir();
    const b = achar(botoes, m![1]!, ctx, "Botão");
    if (metodo === "DELETE") { botoes.splice(botoes.indexOf(b), 1); return { ok: true }; }
    Object.assign(b, c); return b;
  }
  if (metodo === "GET" && caminho === "/api/marketing/bio/cliques") {
    ver();
    const visitas = cliquesDia.reduce((s, d) => s + d.visitas, 0), cliques = cliquesDia.reduce((s, d) => s + d.cliques, 0);
    return { periodo: { de: q.get("de"), ate: q.get("ate") }, visitas, cliques, taxaCliquePorVisita: Math.round((cliques / visitas) * 1000) / 10,
      porBotao: botoes.map((b, i) => ({ id: b.id, rotulo: b.rotulo, cliques: Math.round(cliques * [0.46, 0.27, 0.17, 0.1][i % 4]!) })).sort((a, b) => b.cliques - a.cliques), porDia: cliquesDia,
      porOrigem: [{ origem: "instagram", visitas: Math.round(visitas * 0.78), cliques: Math.round(cliques * 0.8) }, { origem: "direto", visitas: Math.round(visitas * 0.15), cliques: Math.round(cliques * 0.14) }, { origem: "tripadvisor", visitas: Math.round(visitas * 0.07), cliques: Math.round(cliques * 0.06) }] };
  }

  // ───────── Orçamentos ─────────
  if (metodo === "GET" && caminho === "/api/orcamentos") { reservasPerm(); return orcs.filter((o) => !q.get("status") || o.status === q.get("status")); }
  if (metodo === "GET" && caminho === "/api/orcamentos/resumo") { reservasPerm(); return { novos: orcs.filter((o) => o.status === "NOVO").length, porStatus: {} }; }
  if (metodo === "GET" && caminho === "/api/orcamentos/responsaveis") { reservasPerm(); return [{ id: "rs-1", nome: "Atendente Demo" }, { id: "rs-2", nome: "Supervisora Demo" }]; }
  if (metodo === "PATCH" && r(/^\/api\/orcamentos\/([^/]+)$/)) {
    reservasPerm();
    const o = achar(orcs, m![1]!, ctx, "Orçamento");
    if (c.status) o.status = c.status;
    if ("responsavelId" in c) { o.responsavelId = c.responsavelId; o.responsavel = c.responsavelId === "rs-1" ? "Atendente Demo" : c.responsavelId === "rs-2" ? "Supervisora Demo" : null; }
    if ("anotacoes" in c) o.anotacoes = c.anotacoes;
    return { ok: true };
  }
  if (metodo === "POST" && r(/^\/api\/orcamentos\/([^/]+)\/anonimizar$/)) { reservasPerm(); Object.assign(achar(orcs, m![1]!, ctx, "Orçamento"), { nome: "Anonimizado", organizacao: "Anonimizado", telefone: null, email: null, mensagem: null, anotacoes: null, anonimizado: true }); return { ok: true }; }

  // ───────── Mensagens automáticas e NPS ─────────
  if (metodo === "GET" && caminho === "/api/marketing/mensagens") { ver(); return { envio: { real: false, nota: "Modo simulado: as mensagens vão para a fila como “Simulada” e nada sai de verdade." }, fluxos }; }
  if (metodo === "POST" && caminho === "/api/marketing/mensagens/rodar") { gerir(); return { pedidosCriados: 3, compra: 5, posPasseio: 12, avaliacoesEnviadas: 0, simulado: true }; }
  if (metodo === "PATCH" && r(/^\/api\/marketing\/mensagens\/([^/]+)$/)) {
    gerir();
    const f = fluxos.find((x) => x.codigo === m![1]);
    if (!f) throw ctx.erro(404, "NAO_ENCONTRADO", "Fluxo não encontrado.");
    if (f.codigo === "VESPERA") throw ctx.erro(400, "FLUXO_FIXO", "A véspera é o fechamento da lista (Operação › Fechamento) e não é alterada aqui.");
    if (f.codigo === "POS_PASSEIO") for (const t of Object.values(c.textos ?? {})) if (t && !String(t).includes("{linkNps}")) throw ctx.erro(400, "FALTA_LINK", "O texto do pós-passeio precisa conter {linkNps}, o link da pesquisa.");
    if ("ligado" in c) { f.ligado = c.ligado; f.origemDoLigado = "TELA"; }
    for (const i of ["pt", "en", "es"] as Idioma[]) if (c.textos && i in c.textos) { f.textos[i] = c.textos[i] ?? f.padroes[i]; f.personalizado[i] = !!c.textos[i]; }
    if ("extra" in c) f.extra = c.extra ? String(c.extra).toUpperCase() : null;
    return { envio: { real: false, nota: "Modo simulado: as mensagens vão para a fila como “Simulada” e nada sai de verdade." }, fluxos };
  }
  if (metodo === "GET" && caminho === "/api/marketing/nps") {
    ver();
    const g = (chave: string, total: number, p: number, d: number) => ({ chave, total, promotores: p, neutros: total - p - d, detratores: d, nps: Math.round(((p - d) / total) * 100) });
    const mes = hoje.slice(0, 7);
    return { periodo: { de: q.get("de"), ate: q.get("ate") }, geral: { ...g("geral", 96, 66, 7), enviados: 214, taxaResposta: 44.9, aceitaramConvite: 58 },
      porMes: [g(somarMeses(mes, -2), 70, 44, 6), g(somarMeses(mes, -1), 88, 57, 7), g(mes, 96, 66, 7)], porPasseio: [g("City Tour Toda Ilha", 61, 42, 4), g("City Tour Balneário Camboriú", 35, 24, 3)], porGuia: [g("Guia Fictícia Ana", 38, 28, 1), g("Guia Fictícia Bia", 33, 21, 4), g("Sem guia", 25, 17, 2)] };
  }
  if (metodo === "GET" && caminho === "/api/marketing/nps/casos") { ver(); return casos.filter((x) => !q.get("status") || x.casoStatus === q.get("status")); }
  if (metodo === "PATCH" && r(/^\/api\/marketing\/nps\/casos\/([^/]+)$/)) { gerir(); const x = achar(casos, m![1]!, ctx, "Caso"); if (c.casoStatus) x.casoStatus = c.casoStatus; if ("casoNota" in c) x.casoNota = c.casoNota; x.responsavel = "Você"; return { ok: true }; }
  void UN_BC; void dataLonga;
  return NAO;
};
