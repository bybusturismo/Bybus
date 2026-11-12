/**
 * Rastreio da demonstração: um ônibus FICTÍCIO anda entre pontos fictícios de Florianópolis (simulação acelerada).
 * Nenhuma posição vem de GPS real: o "celular do motorista" da demonstração gera as posições pelo relógio.
 */
import { distanciaKm, preverChegada, type Coordenada } from "@bybus/core";
import { NAO, type Rotear } from "./comum";

export const TOKEN_DEMO = "demonstracao-rastreio-ficticio-0000";
const SAIDA_1 = "rastreio-saida-1";
const SAIDA_2 = "rastreio-saida-2";
const SAIDA_ONTEM = "rastreio-saida-ontem";

/** Histórico fictício de ontem: horários reais de passagem (minutos de diferença do previsto; null = pulou). */
const ATRASOS_ONTEM = [2, 4, null, 7, 5, 3];
function historicoDeOntem(dia: string) {
  const em = (horario: string, min: number) => new Date(new Date(`${dia}T${horario}:00-03:00`).getTime() + min * 60_000).toISOString();
  const pontos = PONTOS.map((x, i) => {
    const d = ATRASOS_ONTEM[i];
    return { id: x.id, nome: x.nome, horario: x.horario, lat: x.lat, lng: x.lng, passou: d !== null, passouEm: d === null || d === undefined ? null : em(x.horario, d), pulou: d === null };
  });
  const inicio = pontos[0]!.passouEm!;
  const fim = pontos[pontos.length - 1]!.passouEm!;
  const t0 = new Date(inicio).getTime();
  const t1 = new Date(fim).getTime();
  const trajeto: Array<{ lat: number; lng: number; em: string }> = [];
  for (let k = 0; k <= 120; k++) {
    const p = pontoNaRota((TOTAL * k) / 120);
    trajeto.push({ lat: p.lat, lng: p.lng, em: new Date(t0 + ((t1 - t0) * k) / 120).toISOString() });
  }
  const km = Math.round(TOTAL / 100) / 10;
  const duracaoMin = Math.round((t1 - t0) / 60_000);
  return { pontos, trajeto, resumo: { inicio, fim, duracaoMin, km, velocidadeMediaKmh: Math.round((km / duracaoMin) * 60), velocidadeMaximaKmh: 62 } };
}
/** Metros por segundo do ônibus fictício (108 km/h: simulação acelerada para a demonstração ser visível). */
const VELOCIDADE_MS = 30;
const PONTO_DO_CLIENTE = 3;

const PONTOS = [
  { id: "rp-1", nome: "Centro (fictício)", horario: "08:00", lat: -27.5969, lng: -48.5495 },
  { id: "rp-2", nome: "Beira-Mar Norte (fictício)", horario: "08:15", lat: -27.5832, lng: -48.539 },
  { id: "rp-3", nome: "Trindade (fictício)", horario: "08:30", lat: -27.5875, lng: -48.5236 },
  { id: "rp-4", nome: "Lagoa da Conceição (fictício)", horario: "08:50", lat: -27.6047, lng: -48.4663 },
  { id: "rp-5", nome: "Barra da Lagoa (fictício)", horario: "09:10", lat: -27.5742, lng: -48.4278 },
  { id: "rp-6", nome: "Joaquina (fictício)", horario: "09:30", lat: -27.6283, lng: -48.4496 },
];
const PONTOS_BC = [
  { id: "rp-bc-1", nome: "Ponto sem coordenadas (fictício)", horario: "09:00" },
  { id: "rp-bc-2", nome: "Outro ponto sem coordenadas (fictício)", horario: "09:20" },
];

/** Distância acumulada (m) em cada ponto, seguindo a linha entre eles. */
const ACUMULADA = PONTOS.reduce<number[]>((acc, p, i) => [...acc, i === 0 ? 0 : acc[i - 1]! + distanciaKm(PONTOS[i - 1]!, p) * 1000 * 1.3], []);
const TOTAL = ACUMULADA[ACUMULADA.length - 1]!;

function pontoNaRota(metros: number): Coordenada & { direcao: number } {
  const d = Math.min(Math.max(metros, 0), TOTAL);
  let i = 1;
  while (i < PONTOS.length - 1 && ACUMULADA[i]! < d) i++;
  const a = PONTOS[i - 1]!;
  const b = PONTOS[i]!;
  const f = (d - ACUMULADA[i - 1]!) / (ACUMULADA[i]! - ACUMULADA[i - 1]!);
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, direcao: (Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180) / Math.PI + (b.lng < a.lng ? 360 : 0) };
}

interface Sessao { id: string; iniciadaEm: number; encerradaEm: number | null }
let sessao: Sessao | null = { id: "rastreio-sessao-demo", iniciadaEm: Date.now() - 4 * 60_000, encerradaEm: null };
let contador = 1;

/** Reinicia a volta quando o ônibus chega ao fim (a demonstração nunca fica parada). */
function percorrido(agora = Date.now()): number {
  if (!sessao || sessao.encerradaEm) return 0;
  let m = ((agora - sessao.iniciadaEm) / 1000) * VELOCIDADE_MS;
  if (m >= TOTAL) {
    sessao.iniciadaEm = agora;
    m = 0;
  }
  return m;
}
/** Último ponto já alcançado (raio de 150 m) para a distância percorrida. */
const visitadoEm = (m: number) => ACUMULADA.reduce((v, a, i) => (a <= m + 150 ? i : v), -1);

export function posicaoDoOnibus(agora = Date.now()) {
  const m = ((agora - (sessao?.iniciadaEm ?? agora)) / 1000) * VELOCIDADE_MS;
  return pontoNaRota(m % TOTAL);
}

/** "Celular do motorista" sem GPS: gera as posições do ônibus fictício a cada 5 s. */
export function iniciarGpsSimulado(aoPosicao: (p: { lat: number; lng: number; precisaoM: number; velocidade: number; direcao: number; registradaEm: string }) => void): () => void {
  const emitir = () => {
    const p = posicaoDoOnibus();
    aoPosicao({ lat: p.lat, lng: p.lng, precisaoM: 8, velocidade: VELOCIDADE_MS, direcao: p.direcao, registradaEm: new Date().toISOString() });
  };
  emitir();
  const id = setInterval(emitir, 5000);
  return () => clearInterval(id);
}

function situacao(agora: number) {
  if (!sessao) return { situacao: "NAO_INICIADO" as const, minutosSemSinal: null };
  if (sessao.encerradaEm) return { situacao: "ENCERRADO" as const, minutosSemSinal: null };
  return { situacao: "TRANSMITINDO" as const, minutosSemSinal: 0, agora };
}

function trajeto(agora: number): Array<{ lat: number; lng: number; em: string }> {
  if (!sessao) return [];
  const fim = sessao.encerradaEm ?? agora;
  const saida: Array<{ lat: number; lng: number; em: string }> = [];
  for (let t = Math.max(sessao.iniciadaEm, fim - 25 * 60_000); t <= fim; t += 15_000) {
    const m = (((t - sessao.iniciadaEm) / 1000) * VELOCIDADE_MS) % TOTAL;
    const p = pontoNaRota(m);
    saida.push({ lat: p.lat, lng: p.lng, em: new Date(t).toISOString() });
  }
  return saida;
}

export const rotearRastreio: Rotear = (ctx, metodo, caminho, q, c) => {
  if (!caminho.startsWith("/api/rastreio/") && !caminho.startsWith("/api/publico/rastreio/")) return NAO;
  const agora = Date.now();
  let m: RegExpExecArray | null;
  const r = (re: RegExp) => (m = re.exec(caminho)) !== null;
  const aberta = sessao && !sessao.encerradaEm ? { id: sessao.id, iniciadaEm: new Date(sessao.iniciadaEm).toISOString() } : null;

  // ---------- Motorista ----------
  if (metodo === "GET" && caminho === "/api/rastreio/minhas-saidas") {
    ctx.exigir("rastreio:transmitir");
    percorrido(agora);
    return [
      { saidaId: SAIDA_1, tipo: "TRANSFER", passeio: "Toda a Ilha (demonstração)", data: ctx.dataMais(0), veiculo: "DEM1A23", sessao: null },
      { saidaId: SAIDA_1, tipo: "ONIBUS", passeio: "Toda a Ilha (demonstração)", data: ctx.dataMais(0), veiculo: "DEM1A23", sessao: aberta },
    ];
  }
  if (metodo === "POST" && r(/^\/api\/rastreio\/saidas\/([^/]+)\/iniciar$/)) {
    ctx.exigir("rastreio:transmitir");
    if (m![1] !== SAIDA_1) throw ctx.erro(403, "NAO_E_O_MOTORISTA", "Só o motorista escalado nesta saída pode transmitir a posição.");
    if (aberta) return { sessaoId: aberta.id, iniciadaEm: aberta.iniciadaEm, retomada: true, linksEnfileirados: 0 };
    sessao = { id: `rastreio-sessao-${++contador}`, iniciadaEm: agora, encerradaEm: null };
    ctx.auditar("RASTREIO_INICIADO", "saida", SAIDA_1, { sessaoId: sessao.id });
    return { sessaoId: sessao.id, iniciadaEm: new Date(agora).toISOString(), retomada: false, linksEnfileirados: 3 };
  }
  if (metodo === "POST" && r(/^\/api\/rastreio\/sessoes\/([^/]+)\/posicoes$/)) {
    ctx.exigir("rastreio:transmitir");
    const lista = Array.isArray(c.posicoes) ? c.posicoes : [];
    if (lista.length < 1 || lista.length > 20) throw ctx.erro(400, "DADOS_INVALIDOS", "Envie de 1 a 20 posições por vez.");
    if (!sessao || sessao.id !== m![1] || sessao.encerradaEm) throw ctx.erro(409, "SESSAO_ENCERRADA", "Este rastreio já foi encerrado.");
    return { aceitas: lista.length, descartadas: { precisao: 0, horario: 0, duplicadas: 0 } };
  }
  if (metodo === "POST" && r(/^\/api\/rastreio\/sessoes\/([^/]+)\/encerrar$/)) {
    ctx.exigir();
    if (!sessao || sessao.id !== m![1]) throw ctx.erro(404, "NAO_ENCONTRADO", "Rastreio não encontrado.");
    if (sessao.encerradaEm) return { ok: true, jaEncerrado: true };
    sessao.encerradaEm = agora;
    ctx.auditar("RASTREIO_ENCERRADO", "saida", SAIDA_1, { sessaoId: sessao.id });
    return { ok: true, jaEncerrado: false };
  }

  // ---------- Equipe ----------
  if (metodo === "GET" && caminho === "/api/rastreio/saidas") {
    ctx.exigir("manifesto:ver");
    if (q.get("data") === ctx.dataMais(-1)) {
      const h = historicoDeOntem(ctx.dataMais(-1));
      return [{ saidaId: SAIDA_ONTEM, passeio: "Toda a Ilha (demonstração)", data: ctx.dataMais(-1), motorista: "Motorista Fictício Davi", veiculo: "DEM1A23", situacao: "ENCERRADO", minutosSemSinal: null,
        sessao: { id: "rastreio-sessao-ontem", iniciadaEm: h.resumo.inicio, encerradaEm: h.resumo.fim }, ultimaPosicao: h.trajeto[h.trajeto.length - 1], pontos: { total: PONTOS.length, comCoordenadas: PONTOS.length } }];
    }
    if ((q.get("data") ?? ctx.dataMais(0)) !== ctx.dataMais(0)) return [];
    percorrido(agora);
    const s = situacao(agora);
    const p = posicaoDoOnibus(agora);
    return [
      { saidaId: SAIDA_1, passeio: "Toda a Ilha (demonstração)", data: ctx.dataMais(0), motorista: "Motorista Fictício Davi", veiculo: "DEM1A23", ...s, sessao: sessao ? { id: sessao.id, iniciadaEm: new Date(sessao.iniciadaEm).toISOString(), encerradaEm: sessao.encerradaEm ? new Date(sessao.encerradaEm).toISOString() : null } : null,
        ultimaPosicao: sessao ? { lat: p.lat, lng: p.lng, velocidade: VELOCIDADE_MS, em: new Date(sessao.encerradaEm ?? agora).toISOString() } : null, pontos: { total: PONTOS.length, comCoordenadas: PONTOS.length } },
      { saidaId: SAIDA_2, passeio: "City Tour Balneário Camboriú (demonstração)", data: ctx.dataMais(0), motorista: "Motorista Fictício Edu", veiculo: "DEM2B34", situacao: "NAO_INICIADO", minutosSemSinal: null, sessao: null, ultimaPosicao: null, pontos: { total: PONTOS_BC.length, comCoordenadas: 0 } },
    ];
  }
  if (metodo === "GET" && r(/^\/api\/rastreio\/saidas\/([^/]+)$/)) {
    ctx.exigir("manifesto:ver");
    if (m![1] === SAIDA_ONTEM) {
      const h = historicoDeOntem(ctx.dataMais(-1));
      return { saidaId: SAIDA_ONTEM, passeio: "Toda a Ilha (demonstração)", data: ctx.dataMais(-1), motorista: "Motorista Fictício Davi", veiculo: "DEM1A23", situacao: "ENCERRADO", minutosSemSinal: null,
        sessao: { id: "rastreio-sessao-ontem", iniciadaEm: h.resumo.inicio, encerradaEm: h.resumo.fim }, ultimaPosicao: h.trajeto[h.trajeto.length - 1], ...h };
    }
    if (m![1] === SAIDA_2) {
      return { saidaId: SAIDA_2, passeio: "City Tour Balneário Camboriú (demonstração)", data: ctx.dataMais(0), motorista: "Motorista Fictício Edu", veiculo: "DEM2B34", situacao: "NAO_INICIADO", minutosSemSinal: null, sessao: null, ultimaPosicao: null,
        pontos: PONTOS_BC.map((p) => ({ ...p, lat: null, lng: null, passou: false })), trajeto: [] };
    }
    if (m![1] !== SAIDA_1) throw ctx.erro(404, "NAO_ENCONTRADO", "Saída não encontrada.");
    const mt = percorrido(agora);
    const p = posicaoDoOnibus(agora);
    return { saidaId: SAIDA_1, passeio: "Toda a Ilha (demonstração)", data: ctx.dataMais(0), motorista: "Motorista Fictício Davi", veiculo: "DEM1A23", ...situacao(agora),
      sessao: sessao ? { id: sessao.id, iniciadaEm: new Date(sessao.iniciadaEm).toISOString(), encerradaEm: sessao.encerradaEm ? new Date(sessao.encerradaEm).toISOString() : null } : null,
      ultimaPosicao: sessao ? { lat: p.lat, lng: p.lng, em: new Date(sessao.encerradaEm ?? agora).toISOString() } : null,
      pontos: PONTOS.map((x, i) => ({ id: x.id, nome: x.nome, horario: x.horario, lat: x.lat, lng: x.lng, passou: !!sessao && !sessao.encerradaEm && i <= visitadoEm(mt) })),
      trajeto: trajeto(agora) };
  }

  // ---------- Público (cliente) ----------
  if (metodo === "GET" && r(/^\/api\/publico\/rastreio\/([^/]+)$/)) {
    if (m![1] !== TOKEN_DEMO) throw ctx.erro(404, "LINK_INVALIDO", "Este link não é válido ou já expirou. Fale com a By Bus pelo WhatsApp.");
    const mt = percorrido(agora);
    const s = situacao(agora);
    const cli = PONTOS[PONTO_DO_CLIENTE]!;
    const emServico = s.situacao === "TRANSMITINDO";
    const visitado = emServico ? visitadoEm(mt) : -1;
    const pos = posicaoDoOnibus(agora);
    const previsao = emServico ? preverChegada({ posicao: pos, pontos: PONTOS, visitado, alvo: PONTO_DO_CLIENTE, velocidadeKmh: VELOCIDADE_MS * 3.6 }) : null;
    return {
      passeio: "Toda a Ilha (demonstração)", cidade: "Florianópolis", data: ctx.dataMais(0),
      situacao: s.situacao, minutosSemSinal: null,
      ponto: { nome: cli.nome, horario: cli.horario, lat: cli.lat, lng: cli.lng },
      onibus: emServico ? { lat: pos.lat, lng: pos.lng, em: new Date(agora).toISOString() } : null,
      rota: PONTOS.map((x, i) => ({ nome: x.nome, lat: x.lat, lng: x.lng, passou: i <= visitado, doCliente: i === PONTO_DO_CLIENTE })),
      previsao: previsao ? { situacao: previsao.situacao, minutos: previsao.minutos, motivo: previsao.motivo ?? null, estimativa: true } : null,
      jaPassou: emServico && PONTO_DO_CLIENTE <= visitado,
    };
  }
  return NAO;
};
