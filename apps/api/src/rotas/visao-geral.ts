import { and, eq, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../app.js";
import type { Db } from "../db/cliente.js";
import { passageiros, passeios, reservas, saidas, vendas } from "../db/schema.js";
import { filtroUnidade, garantirPasseio, podeUnidade } from "../seguranca/escopo.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir, type UsuarioSessao } from "../seguranca/sessao.js";

/**
 * Visão Geral (tela inicial). Tudo agregado no SQL: só números saem daqui (LGPD), nunca linhas de clientes.
 *
 * Permissões (documentadas em docs/produto/visao-geral.md):
 * - blocos operacionais (saídas de hoje, check-ins, pendências): `manifesto:ver`;
 * - blocos de análise de vendas (emissores, dia da semana, horário, passeios, pagamentos): `manifesto:ver` + (`marketing:ver` ou `financeiro:ver`);
 * - qualquer valor em R$ (faturamento, descontos, comissões, saldo): `financeiro:ver`. Sem ela o campo vem `null`;
 *   os blocos que só existem em R$ (comparativo de anos, faturamento por período) respondem 403.
 * Escopo de praça: sempre `filtroUnidade` do usuário; `unidadeId` só estreita (e é conferido).
 */

const uuid = z.string().uuid();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD").refine((d) => {
  const x = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d;
}, "Data inválida");

const FUSO = "America/Sao_Paulo";
const PASSEIO_DIAS_MAX = 800;

/** Canais do gráfico (ordem e rótulos fixos; a tela usa uma cor estável por canal). */
export const CANAIS_GRAFICO = ["SITE", "ADMIN", "AFILIADO", "BALCAO", "PARCEIRO", "VIATOR", "DECOLAR", "CIVITATIS", "OTA", "SEM_CANAL"] as const;
export type CanalGrafico = (typeof CANAIS_GRAFICO)[number];

export function hojeSp(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(agora);
}
export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
/** Mesma data N anos antes (29/02 vira 28/02). */
export function mesmoDiaAnoAnterior(iso: string, anos: number): string {
  const [a, m, d] = iso.split("-").map(Number) as [number, number, number];
  const alvo = new Date(Date.UTC(a - anos, m - 1, d, 12));
  if (alvo.getUTCMonth() !== m - 1) alvo.setUTCDate(0);
  return alvo.toISOString().slice(0, 10);
}

const filtros = z.object({
  de: dataIso.optional(),
  ate: dataIso.optional(),
  unidadeId: uuid.optional(),
  passeioId: uuid.optional(),
  canal: z.enum(CANAIS_GRAFICO).optional(),
});

/** Período padrão: últimos 30 dias (inclui hoje). */
function lerFiltros(consulta: unknown) {
  const q = filtros.parse(consulta);
  const ate = q.ate ?? hojeSp();
  const de = q.de ?? somarDias(ate, -29);
  if (de > ate) throw new ErroHttp(400, "PERIODO_INVALIDO", "A data inicial deve ser anterior à final.");
  if ((Date.parse(ate) - Date.parse(de)) / 86_400_000 > PASSEIO_DIAS_MAX) throw new ErroHttp(400, "PERIODO_LONGO", `Período longo demais (máximo de ${PASSEIO_DIAS_MAX} dias).`);
  return { de, ate, unidadeId: q.unidadeId, passeioId: q.passeioId, canal: q.canal };
}
type Filtros = ReturnType<typeof lerFiltros>;

// ---------- Fragmentos de SQL (nomes de tabela sem apelido: o escopo usa passeios.unidade_id) ----------
const origemVendas = sql`from ${reservas}
  inner join ${saidas} on ${saidas.id} = ${reservas.saidaId}
  inner join ${passeios} on ${passeios.id} = ${saidas.passeioId}
  left join ${vendas} on ${vendas.id} = ${reservas.vendaId}`;

/** Instante da compra: o do pedido; reserva sem pedido (manual ou sem valores) usa a criação no sistema. */
const compra = sql`coalesce(${vendas.dataHoraCompra}, ${reservas.criadoEm})`;
const compraLocal = sql`(${compra} at time zone ${FUSO})`;
const compraDia = sql`(${compraLocal})::date`;
/** Valor da reserva em centavos (sem valor conta como zero na soma; `semValor` mostra quantas ficaram sem). */
const valor = sql`coalesce(${reservas.valorCentavos}, 0)`;
const pessoas = sql`(select count(*)::int from ${passageiros} where ${passageiros.reservaId} = ${reservas.id})`;

/**
 * Canal do gráfico: reserva de OTA manda; senão o canal de venda do pedido; reserva lançada à mão = balcão;
 * importada sem pedido (sem valores) = sem canal identificado.
 */
const canalGrafico = sql`(case
  when ${reservas.canalOrigem} in ('VIATOR','DECOLAR','CIVITATIS') then ${reservas.canalOrigem}::text
  when ${reservas.canal} in ('VIATOR','DECOLAR','CIVITATIS') then ${reservas.canal}::text
  when ${vendas.canalVenda} is not null then ${vendas.canalVenda}
  when ${reservas.origem} = 'MANUAL' then 'BALCAO'
  else 'SEM_CANAL' end)`;

/** Forma de pagamento agrupada (Pagar no dia, Pagamento externo, Pix, Cartão 1x, 2–6x…). */
const formaPagamento = sql`(case
  when ${canalGrafico} in ('VIATOR','DECOLAR','CIVITATIS','OTA') then 'CANAL'
  when ${vendas.metodoPagamento} = 'cortesia' or ${reservas.pagamento} = 'CORTESIA' then 'CORTESIA'
  when ${vendas.metodoPagamento} = 'pagamento_no_dia' then 'NO_DIA'
  when ${vendas.metodoPagamento} = 'dinheiro' or ${vendas.metodoPagamentoExterno} = 'dinheiro' then 'DINHEIRO'
  when ${vendas.metodoPagamento} = 'pagamento_externo' then 'EXTERNO'
  when ${vendas.metodoPagamento} in ('pix','zoop_pix') then 'PIX'
  when ${vendas.metodoPagamento} = 'cielo' or ${vendas.tipoPagamento} ilike '%card%' then
    (case when coalesce(${vendas.parcelas}, 1) <= 1 then 'CARTAO_1X' when ${vendas.parcelas} <= 6 then 'CARTAO_2_6X' else 'CARTAO_7X' end)
  when ${vendas.id} is null and ${reservas.pagamento} = 'A_PAGAR' then 'NO_DIA'
  when ${vendas.id} is null and ${reservas.formaPagamento} ilike 'pix%' then 'PIX'
  when ${vendas.id} is null and ${reservas.formaPagamento} ilike 'cart%' then 'CARTAO_1X'
  else 'OUTROS' end)`;

type Linha = Record<string, unknown>;
async function consultar<T = Linha>(db: Db, q: SQL): Promise<T[]> {
  return (await db.execute(q)).rows as T[];
}
const n = (v: unknown) => Number(v ?? 0);
/** Percentual com uma casa decimal; total zero → 0. */
const pct = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 1000) / 10 : 0);
const juntar = (cond: Array<SQL | undefined>) => and(...cond) ?? sql`true`;

export async function rotasVisaoGeral(app: FastifyInstance, { db, config }: Contexto) {
  const operacional = { preHandler: exigir(config, "manifesto:ver") };

  function verValores(u: UsuarioSessao) {
    return pode(u, "financeiro:ver");
  }
  function exigirAnalise(u: UsuarioSessao) {
    if (!pode(u, "marketing:ver") && !pode(u, "financeiro:ver")) throw new ErroHttp(403, "SEM_PERMISSAO", "Seu perfil não tem acesso a esta análise de vendas.");
  }
  function exigirValores(u: UsuarioSessao) {
    if (!verValores(u)) throw new ErroHttp(403, "SEM_PERMISSAO", "Valores em reais exigem permissão de ver o financeiro.");
  }

  /** Escopo de praça + filtros comuns (praça pedida e passeio conferidos: fora do escopo é 404). */
  async function escopo(u: UsuarioSessao, f: Pick<Filtros, "unidadeId" | "passeioId">): Promise<Array<SQL | undefined>> {
    if (f.unidadeId && !podeUnidade(u, f.unidadeId)) throw new ErroHttp(404, "NAO_ENCONTRADO", "Praça não encontrada.");
    const c: Array<SQL | undefined> = [eq(reservas.status, "CONFIRMADA"), filtroUnidade(u)];
    if (f.unidadeId) c.push(eq(passeios.unidadeId, f.unidadeId));
    if (f.passeioId) {
      await garantirPasseio(db, u, f.passeioId);
      c.push(eq(passeios.id, f.passeioId));
    }
    return c;
  }
  /** Vendas do período (por data da compra, em Brasília), com o canal opcional. */
  async function condicoesVendas(u: UsuarioSessao, f: Filtros, opcoes: { ignorarCanal?: boolean } = {}) {
    const c = await escopo(u, f);
    c.push(sql`${compraDia} between ${f.de}::date and ${f.ate}::date`);
    if (f.canal && !opcoes.ignorarCanal) c.push(sql`${canalGrafico} = ${f.canal}`);
    return juntar(c);
  }

  // ---------- Resumo: cartões, pendências e operação de hoje ----------
  app.get("/api/visao-geral/resumo", operacional, async (req) => {
    const u = req.usuario!;
    const { unidadeId } = z.object({ unidadeId: uuid.optional() }).parse(req.query);
    const valores = verValores(u);
    const base = await escopo(u, { unidadeId, passeioId: undefined });
    const hoje = hojeSp();
    const mes = hoje.slice(0, 7);
    const inicioMes = `${mes}-01`;
    const inicioMesAnterior = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5)) - 2, 1)).toISOString().slice(0, 10);
    // Mês anterior até o mesmo dia do mês (comparação justa); mês mais curto limita ao último dia dele.
    const fimMesAnterior = somarDias(inicioMes, -1);
    const mesmoDia = somarDias(inicioMesAnterior, Number(hoje.slice(8)) - 1);
    const fimAnterior = mesmoDia < fimMesAnterior ? mesmoDia : fimMesAnterior;

    const doMes = juntar([...base, sql`${compraDia} between ${inicioMes}::date and ${hoje}::date`]);
    const [mesAtual] = await consultar(db, sql`select count(distinct ${reservas.id})::int as reservas, coalesce(sum(${valor}), 0)::bigint as valor,
      count(*) filter (where ${reservas.valorCentavos} is null)::int as sem_valor ${origemVendas} where ${doMes}`);
    const [mesPassado] = await consultar(db, sql`select coalesce(sum(${valor}), 0)::bigint as valor ${origemVendas}
      where ${juntar([...base, sql`${compraDia} between ${inicioMesAnterior}::date and ${fimAnterior}::date`])}`);

    // Cupons usados no mês (pedido com cupom_id). O cadastro de cupons vem depois: por ora, o id da Paytour.
    const cupons = await consultar(db, sql`select ${vendas.cupomExternoId} as cupom, count(distinct ${vendas.id})::int as usos, coalesce(sum(${reservas.descontoCentavos}), 0)::bigint as desconto
      ${origemVendas} where ${juntar([...base, sql`${vendas.cupomExternoId} is not null`, sql`${compraDia} between ${inicioMes}::date and ${hoje}::date`])}
      group by ${vendas.cupomExternoId} order by usos desc, desconto desc limit 5`);
    const [cuponsTotal] = await consultar(db, sql`select count(distinct ${vendas.id})::int as usos, coalesce(sum(${reservas.descontoCentavos}), 0)::bigint as desconto
      ${origemVendas} where ${juntar([...base, sql`${vendas.cupomExternoId} is not null`, sql`${compraDia} between ${inicioMes}::date and ${hoje}::date`])}`);

    // Pendências de passeios de hoje em diante.
    const futuras = juntar([...base, sql`${saidas.status} <> 'CANCELADA'`, sql`${saidas.data} >= ${hoje}::date`]);
    const [pend] = await consultar(db, sql`select
      count(*) filter (where ${reservas.conferencia} = 'PENDENTE')::int as a_conferir,
      count(*) filter (where ${reservas.pontoEmbarqueId} is null)::int as sem_ponto,
      count(*) filter (where ${reservas.pagamento} = 'A_PAGAR')::int as a_pagar,
      count(*) filter (where ${reservas.tokenEmbarqueHash} is not null and ${reservas.informadoPeloClienteEm} is null)::int as formulario
      ${origemVendas} where ${futuras}`);

    // Saídas de hoje: ocupação, equipe e check-ins pendentes.
    const condHoje = juntar([filtroUnidade(u), unidadeId ? eq(passeios.unidadeId, unidadeId) : undefined, sql`${saidas.data} = ${hoje}::date`, sql`${saidas.status} <> 'CANCELADA'`]);
    const saidasHoje = await consultar(db, sql`select ${saidas.id} as id, ${passeios.nome} as passeio, ${saidas.status} as status, ${saidas.capacidade} as capacidade,
      ${saidas.veiculo} as veiculo, ${saidas.guia} as guia, ${saidas.motorista} as motorista,
      coalesce((select count(*) from ${passageiros} join ${reservas} on ${reservas.id} = ${passageiros.reservaId} where ${reservas.saidaId} = ${saidas.id} and ${reservas.status} = 'CONFIRMADA' and ${passageiros.categoria} <> 'COLO'), 0)::int as vendidos,
      coalesce((select count(*) from ${passageiros} join ${reservas} on ${reservas.id} = ${passageiros.reservaId} where ${reservas.saidaId} = ${saidas.id} and ${reservas.status} = 'CONFIRMADA' and ${passageiros.categoria} <> 'COLO' and ${passageiros.embarque} = 'PENDENTE'), 0)::int as checkins_pendentes
      from ${saidas} inner join ${passeios} on ${passeios.id} = ${saidas.passeioId} where ${condHoje} order by ${passeios.nome}`);

    // Saldo a receber (pagamento pendente) e comissão de afiliados: por pedido, sem contar duas vezes.
    const peds = await consultar(db, sql`select count(*)::int as pedidos, coalesce(sum(pendente), 0)::bigint as saldo from (
      select distinct ${vendas.id} as id, ${vendas.pagamentoPendenteCentavos} as pendente ${origemVendas}
      where ${juntar([...base, sql`${vendas.pagamentoPendenteCentavos} > 0`])}) x`);
    const comissao = await consultar(db, sql`select count(*)::int as pedidos, coalesce(sum(c), 0)::bigint as total from (
      select distinct ${vendas.id} as id, coalesce(${vendas.afiliadoComissaoCentavos}, 0) as c ${origemVendas}
      where ${juntar([...base, sql`${vendas.afiliadoId} is not null`, sql`${compraDia} between ${inicioMes}::date and ${hoje}::date`])}) x`);

    const reaisOuNulo = (v: unknown) => (valores ? n(v) : null);
    return {
      hoje,
      faturamentoMes: {
        mes, reservas: n(mesAtual?.reservas), semValor: n(mesAtual?.sem_valor),
        valorCentavos: reaisOuNulo(mesAtual?.valor), mesAnteriorCentavos: reaisOuNulo(mesPassado?.valor),
      },
      cupons: {
        usos: n(cuponsTotal?.usos), descontoCentavos: reaisOuNulo(cuponsTotal?.desconto),
        porCupom: cupons.map((c) => ({ cupomId: String(c.cupom), usos: n(c.usos), descontoCentavos: reaisOuNulo(c.desconto) })),
      },
      pendencias: { aConferir: n(pend?.a_conferir), semPonto: n(pend?.sem_ponto), aPagarNoEmbarque: n(pend?.a_pagar), formularioPendente: n(pend?.formulario) },
      saidasHoje: saidasHoje.map((s) => ({
        id: String(s.id), passeio: String(s.passeio), status: String(s.status), capacidade: n(s.capacidade), vendidos: n(s.vendidos),
        ocupacao: pct(n(s.vendidos), n(s.capacidade)), veiculo: (s.veiculo as string | null) ?? null, guia: (s.guia as string | null) ?? null,
        motorista: (s.motorista as string | null) ?? null, checkinsPendentes: n(s.checkins_pendentes),
      })),
      aguardandoPagamento: { pedidos: n(peds[0]?.pedidos), saldoCentavos: reaisOuNulo(peds[0]?.saldo) },
      comissaoAfiliados: { pedidos: n(comissao[0]?.pedidos), totalCentavos: reaisOuNulo(comissao[0]?.total) },
      // Central de conversas do WhatsApp ainda não existe nesta versão: o bloco fica preparado e oculto.
      whatsapp: { disponivel: false, naoLidas: null },
      ota: { naoIntegradas: ["GetYourGuide"] },
    };
  });

  // ---------- Maiores emissores (cidade/UF) ----------
  app.get("/api/visao-geral/emissores", operacional, async (req) => {
    const u = req.usuario!;
    exigirAnalise(u);
    const f = lerFiltros(req.query);
    const valores = verValores(u);
    const where = await condicoesVendas(u, f);
    const linhas = await consultar(db, sql`select coalesce(nullif(${vendas.clienteCidade}, ''), 'Cidade não informada') as cidade, coalesce(${reservas.origemCliente}, '—') as uf,
      count(distinct ${reservas.id})::int as reservas, coalesce(sum(${pessoas}), 0)::int as passageiros, coalesce(sum(${valor}), 0)::bigint as valor
      ${origemVendas} where ${where} group by 1, 2 order by ${valores ? sql`valor desc,` : sql``} reservas desc, cidade limit 15`);
    const [tot] = await consultar(db, sql`select count(distinct ${reservas.id})::int as reservas, coalesce(sum(${valor}), 0)::bigint as valor ${origemVendas} where ${where}`);
    const baseValor = valores && n(tot?.valor) > 0;
    return {
      periodo: { de: f.de, ate: f.ate },
      baseDoPercentual: baseValor ? "valor" : "reservas",
      total: { reservas: n(tot?.reservas), valorCentavos: valores ? n(tot?.valor) : null },
      emissores: linhas.map((l) => ({
        cidade: String(l.cidade), uf: String(l.uf), reservas: n(l.reservas), passageiros: n(l.passageiros),
        valorCentavos: valores ? n(l.valor) : null,
        percentual: baseValor ? pct(n(l.valor), n(tot?.valor)) : pct(n(l.reservas), n(tot?.reservas)),
      })),
    };
  });

  // ---------- Comparativo dos últimos 3 anos no mesmo período (R$) ----------
  app.get("/api/visao-geral/comparativo", operacional, async (req) => {
    const u = req.usuario!;
    exigirAnalise(u);
    exigirValores(u);
    const f = lerFiltros(req.query);
    const anos = await Promise.all([0, 1, 2].map(async (atras) => {
      const de = mesmoDiaAnoAnterior(f.de, atras);
      const ate = mesmoDiaAnoAnterior(f.ate, atras);
      const where = await condicoesVendas(u, { ...f, de, ate });
      const [r] = await consultar(db, sql`select count(distinct ${reservas.id})::int as reservas, coalesce(sum(${valor}), 0)::bigint as valor ${origemVendas} where ${where}`);
      return { ano: Number(ate.slice(0, 4)), de, ate, reservas: n(r?.reservas), valorCentavos: n(r?.valor) };
    }));
    return { periodo: { de: f.de, ate: f.ate }, anos, semHistorico: anos.slice(1).every((a) => a.reservas === 0) };
  });

  // ---------- Reservas por dia da semana, empilhadas por canal ----------
  app.get("/api/visao-geral/dia-semana", operacional, async (req) => {
    const u = req.usuario!;
    exigirAnalise(u);
    const f = lerFiltros(req.query);
    const where = await condicoesVendas(u, f);
    const linhas = await consultar(db, sql`select extract(dow from ${compraLocal})::int as dia, ${canalGrafico} as canal, count(distinct ${reservas.id})::int as reservas
      ${origemVendas} where ${where} group by 1, 2`);
    // 0 = domingo … 6 = sábado (a tela mostra segunda a domingo).
    const dias = Array.from({ length: 7 }, (_, dia) => {
      const porCanal: Record<string, number> = {};
      for (const l of linhas.filter((x) => n(x.dia) === dia)) porCanal[String(l.canal)] = n(l.reservas);
      return { dia, total: Object.values(porCanal).reduce((t, v) => t + v, 0), porCanal };
    });
    return { periodo: { de: f.de, ate: f.ate }, dias, canais: CANAIS_GRAFICO.filter((c) => dias.some((d) => (d.porCanal[c] ?? 0) > 0)) };
  });

  // ---------- Reservas por horário da compra (Site × Admin) ----------
  const FAIXAS = ["02–06", "06–10", "10–14", "14–18", "18–22", "22–02"];
  app.get("/api/visao-geral/horario-compra", operacional, async (req) => {
    const u = req.usuario!;
    exigirAnalise(u);
    const f = lerFiltros(req.query);
    const where = await condicoesVendas(u, f, { ignorarCanal: true });
    // Faixas de 4 h começando às 02h: (hora − 2) mod 24 ÷ 4.
    const linhas = await consultar(db, sql`select (((extract(hour from ${compraLocal})::int - 2 + 24) % 24) / 4)::int as faixa,
      (case when ${canalGrafico} = 'SITE' then 'site' when ${canalGrafico} in ('ADMIN','BALCAO') then 'admin' else 'outros' end) as grupo,
      count(distinct ${reservas.id})::int as reservas ${origemVendas} where ${where} group by 1, 2`);
    return {
      periodo: { de: f.de, ate: f.ate },
      faixas: FAIXAS.map((rotulo, i) => {
        const v = (g: string) => n(linhas.find((l) => n(l.faixa) === i && l.grupo === g)?.reservas);
        return { rotulo, site: v("site"), admin: v("admin"), outros: v("outros") };
      }),
      nota: "Site = compra pelo site; Admin = venda pelo painel (operador) ou balcão. Outros canais não entram nas linhas.",
    };
  });

  // ---------- Passeios mais vendidos ----------
  app.get("/api/visao-geral/passeios", operacional, async (req) => {
    const u = req.usuario!;
    exigirAnalise(u);
    const f = lerFiltros(req.query);
    const valores = verValores(u);
    const where = await condicoesVendas(u, f);
    const linhas = await consultar(db, sql`select ${passeios.id} as id, ${passeios.nome} as passeio, count(distinct ${reservas.id})::int as reservas,
      coalesce(sum(${pessoas}), 0)::int as passageiros, coalesce(sum(${valor}), 0)::bigint as valor
      ${origemVendas} where ${where} group by ${passeios.id}, ${passeios.nome} order by ${valores ? sql`valor desc,` : sql``} passageiros desc limit 10`);
    const [tot] = await consultar(db, sql`select count(distinct ${reservas.id})::int as reservas, coalesce(sum(${pessoas}), 0)::int as passageiros, coalesce(sum(${valor}), 0)::bigint as valor ${origemVendas} where ${where}`);
    const baseValor = valores && n(tot?.valor) > 0;
    return {
      periodo: { de: f.de, ate: f.ate },
      baseDoPercentual: baseValor ? "valor" : "passageiros",
      total: { reservas: n(tot?.reservas), passageiros: n(tot?.passageiros), valorCentavos: valores ? n(tot?.valor) : null },
      passeios: linhas.map((l) => ({
        passeioId: String(l.id), passeio: String(l.passeio), reservas: n(l.reservas), passageiros: n(l.passageiros), valorCentavos: valores ? n(l.valor) : null,
        percentual: baseValor ? pct(n(l.valor), n(tot?.valor)) : pct(n(l.passageiros), n(tot?.passageiros)),
      })),
    };
  });

  // ---------- Métodos de pagamento ----------
  app.get("/api/visao-geral/pagamentos", operacional, async (req) => {
    const u = req.usuario!;
    exigirAnalise(u);
    const f = lerFiltros(req.query);
    const valores = verValores(u);
    const where = await condicoesVendas(u, f);
    const linhas = await consultar(db, sql`select ${formaPagamento} as forma, count(distinct ${reservas.id})::int as reservas, coalesce(sum(${valor}), 0)::bigint as valor
      ${origemVendas} where ${where} group by 1 order by reservas desc`);
    const totalReservas = linhas.reduce((t, l) => t + n(l.reservas), 0);
    const totalValor = linhas.reduce((t, l) => t + n(l.valor), 0);
    const baseValor = valores && totalValor > 0;
    return {
      periodo: { de: f.de, ate: f.ate },
      baseDoPercentual: baseValor ? "valor" : "reservas",
      total: { reservas: totalReservas, valorCentavos: valores ? totalValor : null },
      formas: linhas.map((l) => ({
        forma: String(l.forma), reservas: n(l.reservas), valorCentavos: valores ? n(l.valor) : null,
        percentual: baseValor ? pct(n(l.valor), totalValor) : pct(n(l.reservas), totalReservas),
      })),
    };
  });

  // ---------- Faturamento por período (barras por canal) ----------
  app.get("/api/visao-geral/faturamento", operacional, async (req) => {
    const u = req.usuario!;
    exigirAnalise(u);
    exigirValores(u);
    const f = lerFiltros(req.query);
    const where = await condicoesVendas(u, f);
    // Mais de ~2 meses: barras mensais, para a tela continuar legível.
    const porMes = (Date.parse(f.ate) - Date.parse(f.de)) / 86_400_000 > 62;
    const chave = porMes ? sql`to_char(${compraDia}, 'YYYY-MM')` : sql`to_char(${compraDia}, 'YYYY-MM-DD')`;
    const linhas = await consultar(db, sql`select ${chave} as chave, ${canalGrafico} as canal, coalesce(sum(${valor}), 0)::bigint as valor, count(distinct ${reservas.id})::int as reservas
      ${origemVendas} where ${where} group by 1, 2 order by 1`);
    const chaves = [...new Set(linhas.map((l) => String(l.chave)))].sort();
    const totais: Record<string, number> = {};
    for (const l of linhas) totais[String(l.canal)] = (totais[String(l.canal)] ?? 0) + n(l.valor);
    return {
      periodo: { de: f.de, ate: f.ate },
      agrupamento: porMes ? "mes" : "dia",
      pontos: chaves.map((c) => {
        const porCanal: Record<string, number> = {};
        for (const l of linhas.filter((x) => String(x.chave) === c)) porCanal[String(l.canal)] = n(l.valor);
        return { chave: c, total: Object.values(porCanal).reduce((t, v) => t + v, 0), porCanal };
      }),
      totaisPorCanal: totais,
      totalCentavos: Object.values(totais).reduce((t, v) => t + v, 0),
      canais: CANAIS_GRAFICO.filter((c) => (totais[c] ?? 0) > 0),
    };
  });
}
