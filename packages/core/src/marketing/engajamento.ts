import { nomeCurto, type MidiaCampanha } from "./marketing.js";

/**
 * Regras puras do marketing 2 (06/11/2026): idioma do cliente, mensagens, avaliações, UTM e atribuição,
 * NPS, leitura de CSV de anúncios, períodos de relatório, link na bio e orçamento de grupos.
 * Nada aqui acessa banco nem rede; tudo é testável.
 */

// ───────────── Idioma do cliente ─────────────

export const IDIOMAS = ["pt", "en", "es"] as const;
export type Idioma = (typeof IDIOMAS)[number];
export const ROTULO_IDIOMA: Record<Idioma, string> = { pt: "Português", en: "English", es: "Español" };

const UFS = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");

const PAISES_ES = new Set(["ARGENTINA", "CHILE", "URUGUAI", "URUGUAY", "PARAGUAI", "PARAGUAY", "COLOMBIA", "MEXICO", "PERU", "BOLIVIA", "VENEZUELA", "EQUADOR", "ECUADOR", "ESPANHA", "ESPANA", "SPAIN", "COSTA RICA", "PANAMA", "CUBA", "GUATEMALA"]);
const PAISES_EN = new Set(["EUA", "USA", "US", "ESTADOS UNIDOS", "UNITED STATES", "UK", "REINO UNIDO", "INGLATERRA", "ENGLAND", "CANADA", "AUSTRALIA", "NOVA ZELANDIA", "NEW ZEALAND", "IRLANDA", "IRELAND", "ALEMANHA", "GERMANY", "FRANCA", "FRANCE", "ITALIA", "ITALY", "HOLANDA", "PAISES BAIXOS", "NETHERLANDS", "SUICA", "SWITZERLAND", "SUECIA", "SWEDEN", "ISRAEL", "JAPAO", "CHINA", "INDIA"]);
const PAISES_PT = new Set(["BRASIL", "BRAZIL", "PORTUGAL", "ANGOLA", "MOCAMBIQUE"]);

/** Idioma pela origem do cliente (país por extenso; UF brasileira = português). Desconhecido → null. */
export function idiomaPelaOrigem(origem: string | null | undefined): Idioma | null {
  const o = semAcento((origem ?? "").trim()).toUpperCase();
  if (!o) return null;
  if (UFS.has(o) || PAISES_PT.has(o)) return "pt";
  if (PAISES_ES.has(o)) return "es";
  if (PAISES_EN.has(o)) return "en";
  return null;
}

// DDIs conhecidos (sem o "+"). Os de 3 dígitos vêm antes dos de 2 e 1 na busca.
const DDI_PT = ["55", "351", "244", "258"];
const DDI_ES = ["34", "52", "54", "56", "57", "51", "58", "591", "593", "595", "598", "506", "507", "502", "503", "504", "505", "53"];

/** Idioma pelo DDI do telefone. Sem "+" ou "00", número com 10 ou 11 dígitos é brasileiro (o DDD 54 não é a Argentina). DDI desconhecido → inglês. */
export function idiomaPeloTelefone(telefone: string | null | undefined): Idioma | null {
  const bruto = (telefone ?? "").trim();
  let d = bruto.replace(/\D/g, "");
  if (d.length < 8) return null;
  const internacional = bruto.startsWith("+") || d.startsWith("00");
  if (d.startsWith("00")) d = d.slice(2);
  if (!internacional && (d.length === 10 || d.length === 11)) return "pt";
  for (const n of [3, 2]) {
    const ddi = d.slice(0, n);
    if (DDI_PT.includes(ddi)) return "pt";
    if (DDI_ES.includes(ddi)) return "es";
  }
  if (d.startsWith("1") && d.length === 11) return "en"; // América do Norte
  return "en";
}

/** País (quando for estrangeiro e conhecido) manda; senão o DDI; senão português. */
export function idiomaDoCliente(c: { telefone?: string | null; origemCliente?: string | null }): Idioma {
  return idiomaPelaOrigem(c.origemCliente) ?? idiomaPeloTelefone(c.telefone) ?? "pt";
}

// ───────────── Modelos de mensagem ─────────────

/** Preenche {variavel}; variável desconhecida fica como está; espaços duplos e vazios sobrando são limpos. */
export function renderizarModelo(modelo: string, valores: Record<string, string | null | undefined>): string {
  return modelo
    .replace(/\{(\w+)\}/g, (inteiro, k: string) => (k in valores ? (valores[k] ?? "") : inteiro))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .trim();
}

export type ModelosPorIdioma = Record<Idioma, string>;

export const MODELOS_AVALIACAO: ModelosPorIdioma = {
  pt: "Olá, {nome}! Obrigado por passear com a By Bus no {passeio} em {data}. Sua opinião ajuda muito: pode nos avaliar? {link}",
  en: "Hi {nome}! Thank you for joining By Bus on the {passeio} on {data}. Your feedback helps a lot: would you leave us a review? {link}",
  es: "¡Hola, {nome}! Gracias por pasear con By Bus en el {passeio} el {data}. Tu opinión ayuda mucho: ¿nos dejas una reseña? {link}",
};
/** Quem comprou na Viator avalia na própria Viator (regra da plataforma): a mensagem só orienta, sem link de outro canal. */
export const MODELOS_AVALIACAO_VIATOR: ModelosPorIdioma = {
  pt: "Olá, {nome}! Obrigado por passear com a By Bus no {passeio} em {data}. Como você reservou pela Viator, a avaliação é feita lá mesmo, pelo e-mail ou pelo app da Viator da sua reserva. Ela ajuda muito!",
  en: "Hi {nome}! Thank you for joining By Bus on the {passeio} on {data}. Since you booked through Viator, you can leave your review there, from the Viator email or app for your booking. It helps a lot!",
  es: "¡Hola, {nome}! Gracias por pasear con By Bus en el {passeio} el {data}. Como reservaste por Viator, puedes dejar tu reseña allí, desde el correo o la app de Viator de tu reserva. ¡Ayuda mucho!",
};
export const MODELOS_LEMBRETE_AVALIACAO: ModelosPorIdioma = {
  pt: "Olá, {nome}! Passando só para lembrar, sem compromisso: se puder, conte como foi o {passeio}. {link}",
  en: "Hi {nome}! Just a friendly reminder, no pressure: if you can, tell us how the {passeio} was. {link}",
  es: "¡Hola, {nome}! Solo un recordatorio, sin compromiso: si puedes, cuéntanos cómo fue el {passeio}. {link}",
};

export const CODIGOS_FLUXO = ["COMPRA", "VESPERA", "AVALIACAO", "POS_PASSEIO", "CUPOM_RETORNO"] as const;
export type CodigoFluxo = (typeof CODIGOS_FLUXO)[number];

export interface DefinicaoFluxo { codigo: CodigoFluxo; rotulo: string; quando: string; editavel: boolean; variaveis: string[]; modelos: ModelosPorIdioma }

export const FLUXOS: Record<CodigoFluxo, DefinicaoFluxo> = {
  COMPRA: {
    codigo: "COMPRA", rotulo: "Confirmação da compra", quando: "Logo depois da compra (voucher/confirmação).", editavel: true, variaveis: ["nome", "passeio", "data"],
    modelos: {
      pt: "Olá, {nome}! Sua reserva no {passeio} para {data} está confirmada. Na véspera enviaremos o ponto e o horário de embarque. Qualquer dúvida, é só responder esta mensagem.",
      en: "Hi {nome}! Your booking for the {passeio} on {data} is confirmed. The day before, we will send you the pickup point and time. Any questions, just reply to this message.",
      es: "¡Hola, {nome}! Tu reserva en el {passeio} para el {data} está confirmada. La víspera te enviaremos el punto y la hora de embarque. Cualquier duda, responde a este mensaje.",
    },
  },
  VESPERA: {
    codigo: "VESPERA", rotulo: "Véspera do passeio", quando: "Às 21h da véspera, junto do fechamento da lista (já existe).", editavel: false, variaveis: [],
    modelos: { pt: "Enviada pelo fechamento da lista (Operação › Fechamento).", en: "", es: "" },
  },
  AVALIACAO: {
    codigo: "AVALIACAO", rotulo: "Convite de avaliação (fila diária)", quando: "No dia seguinte ao passeio, para quem não recebe o NPS. O texto é editado em Marketing › Avaliações.", editavel: false, variaveis: [],
    modelos: { pt: "Texto por idioma em Marketing › Avaliações.", en: "", es: "" },
  },
  POS_PASSEIO: {
    codigo: "POS_PASSEIO", rotulo: "Pós-passeio com NPS", quando: "No dia seguinte ao passeio.", editavel: true, variaveis: ["nome", "passeio", "data", "linkNps"],
    modelos: {
      pt: "Olá, {nome}! Obrigado por passear com a By Bus no {passeio}. Em uma pergunta só: de 0 a 10, o quanto você nos recomendaria? {linkNps}",
      en: "Hi {nome}! Thank you for joining By Bus on the {passeio}. One quick question: from 0 to 10, how likely are you to recommend us? {linkNps}",
      es: "¡Hola, {nome}! Gracias por pasear con By Bus en el {passeio}. Una sola pregunta: de 0 a 10, ¿cuánto nos recomendarías? {linkNps}",
    },
  },
  CUPOM_RETORNO: {
    codigo: "CUPOM_RETORNO", rotulo: "Cupom de retorno", quando: "Na tela de agradecimento do NPS (opcional).", editavel: true, variaveis: ["nome", "cupom"],
    modelos: {
      pt: "Para voltar com a gente, use o cupom {cupom} na sua próxima reserva.",
      en: "To come back with us, use the coupon {cupom} on your next booking.",
      es: "Para volver con nosotros, usa el cupón {cupom} en tu próxima reserva.",
    },
  },
};

export interface LinksAvaliacao { google: string | null; tripadvisor: string | null }
export type CanalAvaliacao = "GOOGLE" | "TRIPADVISOR" | "VIATOR" | "NENHUM";

/**
 * Canal e link do pedido de avaliação. Quem comprou na Viator é orientado a avaliar na Viator (sem link de outro canal).
 * Os demais recebem o Google da praça (ou o Tripadvisor, se for o escolhido ou se não houver Google). Escolha sem link cadastrado cai no outro.
 */
export function canalDeAvaliacao(o: { canalReal: string; links: LinksAvaliacao; escolhido?: CanalAvaliacao | null }): { canal: CanalAvaliacao; link: string | null } {
  if (o.canalReal === "VIATOR") return { canal: "VIATOR", link: null };
  const ordem: CanalAvaliacao[] = o.escolhido === "TRIPADVISOR" ? ["TRIPADVISOR", "GOOGLE"] : ["GOOGLE", "TRIPADVISOR"];
  for (const c of ordem) {
    const link = c === "GOOGLE" ? o.links.google : o.links.tripadvisor;
    if (link) return { canal: c, link };
  }
  return { canal: "NENHUM", link: null };
}

export function montarPedidoAvaliacao(o: {
  nome: string; passeio: string; data: string; idioma: Idioma; canalReal: string; links: LinksAvaliacao;
  escolhido?: CanalAvaliacao | null; modelos?: Partial<ModelosPorIdioma>;
}): { canal: CanalAvaliacao; link: string | null; texto: string } {
  const { canal, link } = canalDeAvaliacao(o);
  const modelo = canal === "VIATOR" ? MODELOS_AVALIACAO_VIATOR[o.idioma] : (o.modelos?.[o.idioma] ?? MODELOS_AVALIACAO[o.idioma]);
  const texto = renderizarModelo(modelo, { nome: nomeCurto(o.nome) || (o.idioma === "pt" ? "tudo bem" : o.idioma === "es" ? "hola" : "there"), passeio: o.passeio, data: o.data, link, linkTripadvisor: link });
  return { canal, link, texto };
}

/** Lembrete sugerido 7 dias depois do pedido (regra de convite da Viator e boa prática nos demais canais). */
export const DIAS_LEMBRETE_AVALIACAO = 7;
export function lembreteDevido(pedidoEmIso: string | null, status: string, agora: Date): boolean {
  if (!pedidoEmIso || !["ENVIADA_MANUAL", "SIMULADA", "ENVIADA"].includes(status)) return false;
  return agora.getTime() - new Date(pedidoEmIso).getTime() >= DIAS_LEMBRETE_AVALIACAO * 86_400_000;
}

// ───────────── UTM e atribuição ─────────────

/** Valor de UTM: minúsculas, sem acento, só letras/números/hífen/sublinhado (espaço vira hífen), até 60 caracteres. */
export function normalizarUtm(valor: string | null | undefined): string {
  return semAcento((valor ?? "").trim().toLowerCase()).replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export const UTM_PADRAO_POR_MIDIA: Record<MidiaCampanha, { origem: string; midia: string }> = {
  GOOGLE_ADS: { origem: "google", midia: "cpc" },
  META_ADS: { origem: "facebook", midia: "paid_social" },
  INSTAGRAM: { origem: "instagram", midia: "social" },
  TRIPADVISOR: { origem: "tripadvisor", midia: "referral" },
  PARCEIRO: { origem: "parceiro", midia: "referral" },
  OFFLINE: { origem: "offline", midia: "qrcode" },
  OUTRA: { origem: "outra", midia: "link" },
};

/** Monta o link com utm_source, utm_medium, utm_campaign (e ref do afiliado), mantendo o que já houver no endereço. Só https. */
export function montarLinkUtm(destino: string, p: { origem: string; midia: string; campanha: string; ref?: string | null; conteudo?: string | null }): string {
  const url = new URL(destino);
  if (url.protocol !== "https:") throw new Error("Use um endereço https://");
  const origem = normalizarUtm(p.origem), midia = normalizarUtm(p.midia), campanha = normalizarUtm(p.campanha);
  if (!origem || !midia || !campanha) throw new Error("Informe campanha, origem e mídia.");
  url.searchParams.set("utm_source", origem);
  url.searchParams.set("utm_medium", midia);
  url.searchParams.set("utm_campaign", campanha);
  if (p.conteudo && normalizarUtm(p.conteudo)) url.searchParams.set("utm_content", normalizarUtm(p.conteudo));
  if (p.ref) url.searchParams.set("ref", p.ref);
  return url.toString();
}

/** UTM do afiliado: o código vira a campanha ("afiliado-<codigo>"), origem "afiliado", mídia "qrcode". */
export function utmDoAfiliado(codigo: string) {
  return { origem: "afiliado", midia: "qrcode", campanha: `afiliado-${normalizarUtm(codigo)}` };
}

export interface CampanhaAtribuivel { id: string; utmCampanha: string | null; cupom: string | null; inicio: string; fim: string | null }
export interface VendaAtribuivel { utmCampaign?: string | null; cupomExternoId?: string | null; afiliadoId?: string | null; /** AAAA-MM-DD (dia da compra em Brasília). */ dia: string | null }
export interface AfiliadoAtribuivel { id: string; codigo: string; paytourAfiliadoId: string | null }
export interface Atribuicao { campanhaId: string | null; regraCampanha: "UTM" | "CUPOM" | null; afiliadoId: string | null }

const normCupom = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

/**
 * Liga uma venda à campanha e ao afiliado pelos campos importados da Paytour.
 * Campanha: 1º utm_campaign igual ao UTM da campanha; 2º cupom igual ao cupom da campanha. Só vale com a compra dentro do período da
 * campanha (início ≤ dia ≤ fim; fim vazio = aberta). Empate: a campanha que começou por último, depois o id (resultado estável).
 * Afiliado: o afiliado da Paytour cadastrado na ficha ou o UTM "afiliado-<código>".
 */
export function atribuirVenda(v: VendaAtribuivel, campanhas: CampanhaAtribuivel[], afiliados: AfiliadoAtribuivel[] = []): Atribuicao {
  const noPeriodo = (c: CampanhaAtribuivel) => v.dia == null || (v.dia >= c.inicio && (!c.fim || v.dia <= c.fim));
  const ordenadas = campanhas.filter(noPeriodo).sort((a, b) => b.inicio.localeCompare(a.inicio) || a.id.localeCompare(b.id));
  const utm = normalizarUtm(v.utmCampaign);
  const cupom = normCupom(v.cupomExternoId);
  const porUtm = utm ? ordenadas.find((c) => c.utmCampanha && normalizarUtm(c.utmCampanha) === utm) : undefined;
  const porCupom = !porUtm && cupom ? ordenadas.find((c) => c.cupom && normCupom(c.cupom) === cupom) : undefined;
  const afiliado = afiliados.find((a) => (v.afiliadoId && a.paytourAfiliadoId && a.paytourAfiliadoId === v.afiliadoId) || (utm && utm === `afiliado-${normalizarUtm(a.codigo)}`));
  return { campanhaId: (porUtm ?? porCupom)?.id ?? null, regraCampanha: porUtm ? "UTM" : porCupom ? "CUPOM" : null, afiliadoId: afiliado?.id ?? null };
}

// ───────────── NPS ─────────────

export type ClasseNps = "PROMOTOR" | "NEUTRO" | "DETRATOR";
export const notaNpsValida = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 10;
export function classificarNps(nota: number): ClasseNps {
  if (!notaNpsValida(nota)) throw new Error("Nota do NPS deve ser um inteiro de 0 a 10.");
  return nota >= 9 ? "PROMOTOR" : nota >= 7 ? "NEUTRO" : "DETRATOR";
}
/** Nota 0 a 6 abre um caso interno de atendimento. */
export const abreCasoInterno = (nota: number) => classificarNps(nota) === "DETRATOR";

export interface ResumoNps { total: number; promotores: number; neutros: number; detratores: number; nps: number | null }
/** NPS = % de promotores − % de detratores (inteiro, de −100 a 100). Sem respostas → nulo. */
export function calcularNps(notas: number[]): ResumoNps {
  const total = notas.length;
  const promotores = notas.filter((n) => classificarNps(n) === "PROMOTOR").length;
  const detratores = notas.filter((n) => classificarNps(n) === "DETRATOR").length;
  return { total, promotores, neutros: total - promotores - detratores, detratores, nps: total ? Math.round(((promotores - detratores) / total) * 100) : null };
}

/**
 * Convite para avaliar em público. REGRA (review gating): o convite vai para TODOS que concordarem em recebê-lo;
 * a nota do NPS não decide quem recebe (as OTAs e o Google proíbem filtrar quem pode avaliar).
 * O segundo parâmetro existe só para documentar e testar que a nota é ignorada.
 */
export function conviteDeAvaliacaoPublica(aceitou: boolean, _nota?: number | null): boolean {
  return aceitou;
}

// ───────────── Custos de anúncios (CSV do Google Ads / Meta Ads) ─────────────

export interface LinhaCustoAds { dia: string; custoCentavos: number; cliques: number | null; impressoes: number | null }
export interface LeituraCsvAds { linhas: LinhaCustoAds[]; erros: string[] }

const chaveColuna = (t: string) => semAcento(t).toLowerCase().replace(/\s+/g, " ").trim();
const ehDia = (c: string) => /^(dia|day|data|date|reporting starts|inicio dos relatorios)$/.test(c);
const ehCusto = (c: string) => /^(custo|cost|valor gasto|amount spent|valor usado)( \((brl|r\$)\))?$/.test(c);
const ehCliques = (c: string) => /^(cliques|clicks|cliques no link|link clicks)$/.test(c);
const ehImpressoes = (c: string) => /^(impressoes|impr\.?|impressions)$/.test(c);

/** Número em formato brasileiro ou americano ("1.234,56", "1,234.56", "12,5", "R$ 10"). Inválido → null. */
export function lerNumero(texto: string): number | null {
  let t = texto.trim().replace(/[^\d.,-]/g, "");
  if (!/\d/.test(t)) return null;
  const virgula = t.lastIndexOf(","), ponto = t.lastIndexOf(".");
  if (virgula >= 0 && ponto >= 0) t = virgula > ponto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (virgula >= 0) t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  else if (ponto >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function dividirCsv(linha: string, sep: string): string[] {
  const out: string[] = [];
  let atual = "", aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i]!;
    if (aspas) {
      if (ch === '"' && linha[i + 1] === '"') { atual += '"'; i++; } else if (ch === '"') aspas = false; else atual += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { out.push(atual); atual = ""; } else atual += ch;
  }
  out.push(atual);
  return out.map((c) => c.trim());
}

function lerDia(t: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  const [a, m, d] = iso ? [iso[1]!, iso[2]!, iso[3]!] : br ? [br[3]!, br[2]!, br[1]!] : [null, null, null];
  if (!a || !m || !d) return null;
  const x = new Date(`${a}-${m}-${d}T00:00:00Z`);
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === `${a}-${m}-${d}` ? `${a}-${m}-${d}` : null;
}

/**
 * Lê o CSV exportado do Google Ads ou do Meta Ads (por dia): acha a linha de cabeçalho (o Google põe título e período antes),
 * aceita ; , ou tab, números brasileiros ou americanos e ignora linhas de total. Custo vira centavos inteiros.
 */
export function lerCsvAds(texto: string): LeituraCsvAds {
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/);
  const erros: string[] = [];
  let cab = -1, sep = ",";
  let cols: string[] = [];
  for (let i = 0; i < Math.min(linhas.length, 15) && cab < 0; i++) {
    for (const s of [";", ",", "\t"]) {
      const c = dividirCsv(linhas[i]!, s).map(chaveColuna);
      if (c.some(ehDia) && c.some(ehCusto)) { cab = i; sep = s; cols = c; break; }
    }
  }
  if (cab < 0) return { linhas: [], erros: ["Não encontrei as colunas de dia e custo. Exporte o relatório por dia, com as colunas Dia e Custo (Google Ads) ou Dia e Valor gasto (Meta Ads)."] };
  const iDia = cols.findIndex(ehDia), iCusto = cols.findIndex(ehCusto), iCli = cols.findIndex(ehCliques), iImp = cols.findIndex(ehImpressoes);
  const porDia = new Map<string, LinhaCustoAds>();
  for (let i = cab + 1; i < linhas.length; i++) {
    if (!linhas[i]!.trim()) continue;
    const c = dividirCsv(linhas[i]!, sep);
    const dia = lerDia(c[iDia] ?? "");
    if (!dia) {
      if (!/^(total|totals)/i.test(chaveColuna(c[0] ?? ""))) erros.push(`Linha ${i + 1}: data inválida.`);
      continue;
    }
    const custo = lerNumero(c[iCusto] ?? "");
    if (custo == null || custo < 0) { erros.push(`Linha ${i + 1}: custo inválido.`); continue; }
    const cliques = iCli >= 0 ? lerNumero(c[iCli] ?? "") : null;
    const impressoes = iImp >= 0 ? lerNumero(c[iImp] ?? "") : null;
    const ant = porDia.get(dia);
    const centavos = Math.round(custo * 100);
    porDia.set(dia, {
      dia, custoCentavos: (ant?.custoCentavos ?? 0) + centavos,
      cliques: cliques == null ? ant?.cliques ?? null : Math.round(cliques) + (ant?.cliques ?? 0),
      impressoes: impressoes == null ? ant?.impressoes ?? null : Math.round(impressoes) + (ant?.impressoes ?? 0),
    });
  }
  return { linhas: [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia)), erros };
}

// ───────────── Relatórios (períodos e variação) ─────────────

export type TipoRelatorio = "SEMANAL" | "MENSAL";
export interface PeriodoRelatorio { de: string; ate: string; anteriorDe: string; anteriorAte: string; rotulo: string }

const somarDiasIso = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Último período fechado antes de `hoje`: semana de segunda a domingo, ou mês civil anterior; e o período imediatamente anterior a ele. */
export function periodoDoRelatorio(tipo: TipoRelatorio, hoje: string): PeriodoRelatorio {
  if (tipo === "SEMANAL") {
    const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay();
    const segunda = somarDiasIso(hoje, -((dow + 6) % 7));
    const de = somarDiasIso(segunda, -7), ate = somarDiasIso(segunda, -1);
    return { de, ate, anteriorDe: somarDiasIso(de, -7), anteriorAte: somarDiasIso(de, -1), rotulo: `Semana de ${dataBr(de)} a ${dataBr(ate)}` };
  }
  const [a, m] = hoje.split("-").map(Number) as [number, number];
  const primeiro = (ano: number, mes: number) => new Date(Date.UTC(ano, mes - 1, 1)).toISOString().slice(0, 10);
  const ultimo = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
  const ref = new Date(Date.UTC(a, m - 2, 1)), ant = new Date(Date.UTC(a, m - 3, 1));
  const [ra, rm] = [ref.getUTCFullYear(), ref.getUTCMonth() + 1], [aa, am] = [ant.getUTCFullYear(), ant.getUTCMonth() + 1];
  return { de: primeiro(ra, rm), ate: ultimo(ra, rm), anteriorDe: primeiro(aa, am), anteriorAte: ultimo(aa, am), rotulo: `${MESES[rm - 1]![0]!.toUpperCase()}${MESES[rm - 1]!.slice(1)} de ${ra}` };
}

/** Quando a rotina deve gerar: segunda-feira (semanal) ou dia 1 (mensal), a partir das 07:00 em Brasília. */
export function relatoriosDevidos(hoje: string, hora: string): TipoRelatorio[] {
  if (hora < "07:00") return [];
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay();
  const r: TipoRelatorio[] = [];
  if (dow === 1) r.push("SEMANAL");
  if (hoje.endsWith("-01")) r.push("MENSAL");
  return r;
}

/** Variação percentual com 1 casa; anterior zero → nulo (não existe %), exceto zero contra zero (0). */
export function variacaoPercentual(atual: number, anterior: number): number | null {
  if (anterior === 0) return atual === 0 ? 0 : null;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

// ───────────── Link na bio ─────────────

export const TIPOS_BOTAO_BIO = ["PAYTOUR", "WHATSAPP", "TRIPADVISOR", "PASSEIOS", "SITE", "OUTRO"] as const;
export type TipoBotaoBio = (typeof TIPOS_BOTAO_BIO)[number];
export const ROTULO_BOTAO_BIO: Record<TipoBotaoBio, string> = { PAYTOUR: "Reservar na Paytour", WHATSAPP: "Falar no WhatsApp", TRIPADVISOR: "Tripadvisor", PASSEIOS: "Nossos passeios", SITE: "Site", OUTRO: "Outro link" };

/** Origem do clique para estatística: o utm_source normalizado (até 40 caracteres) ou "direto". Nunca guarda IP nem dado pessoal. */
export function origemDoClique(utmSource: string | null | undefined): string {
  return normalizarUtm(utmSource).slice(0, 40) || "direto";
}
export const urlHttpsValida = (u: string) => { try { return new URL(u).protocol === "https:"; } catch { return false; } };
export const corHexValida = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);

// ───────────── Orçamento de grupos ─────────────

export const TIPOS_GRUPO = ["ESCOLA", "EMPRESA", "EXCURSAO", "EVENTO", "OUTRO"] as const;
export type TipoGrupo = (typeof TIPOS_GRUPO)[number];
export const ROTULO_TIPO_GRUPO: Record<TipoGrupo, string> = { ESCOLA: "Escola", EMPRESA: "Empresa", EXCURSAO: "Excursão", EVENTO: "Evento", OUTRO: "Outro" };
export const STATUS_ORCAMENTO = ["NOVO", "EM_CONTATO", "PROPOSTA_ENVIADA", "FECHADO", "PERDIDO"] as const;
export type StatusOrcamento = (typeof STATUS_ORCAMENTO)[number];
export const ROTULO_STATUS_ORCAMENTO: Record<StatusOrcamento, string> = { NOVO: "Novo", EM_CONTATO: "Em contato", PROPOSTA_ENVIADA: "Proposta enviada", FECHADO: "Fechado", PERDIDO: "Perdido" };

/** Tempo mínimo (segundos) entre abrir e enviar o formulário público; robôs enviam em milissegundos. Máximo: 2 horas. */
export const FORMULARIO_TEMPO_MIN_S = 4;
export const FORMULARIO_TEMPO_MAX_S = 7200;
export function tempoDoFormularioOk(abertoEmMs: number, agoraMs: number): boolean {
  const s = (agoraMs - abertoEmMs) / 1000;
  return s >= FORMULARIO_TEMPO_MIN_S && s <= FORMULARIO_TEMPO_MAX_S;
}
