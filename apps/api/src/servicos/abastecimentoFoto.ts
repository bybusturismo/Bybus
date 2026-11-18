import {
  configPagamentoPadrao, DOCUMENTO_MAX_BYTES, faltasAbastecimento, FORMA_FINANCEIRO_DO_COMBUSTIVEL, FORMAS_PAGAMENTO_COMBUSTIVEL, normalizarPlaca,
  ROTULO_FORMA_COMBUSTIVEL, tipoDoArquivo, vencimentoCombustivel,
  type ConfigPagamentoPraca, type FormaPagamentoCombustivel, type OrigemAbastecimento, type TipoFotoAbastecimento,
} from "@bybus/core";
import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { z, type ZodType } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import {
  configuracoes, finCategorias, finLancamentoAnexos, finLancamentos, unidades, veiculos, veiculosAbastecimentos, veiculosAbastecimentosFotos,
} from "../db/schema.js";
import type { Cofre } from "../seguranca/cripto.js";
import { ErroHttp } from "../seguranca/sessao.js";
import { garantirPlano } from "./financeiro.js";
import { hojeSp, registrarLeituraKm } from "./frota.js";
import { chamarEstruturado } from "./ia/avaliacao.js";
import { ErroIA, iaConfigurada, obterClienteIA, type BlocoIA, type FerramentaIA } from "./ia/cliente.js";

/**
 * Abastecimento pela foto (dono, 18/11/2026). O motorista manda a foto do cupom (e, se quiser, do painel) pelo app ou pelo
 * WhatsApp; o sistema guarda a foto cifrada, a IA lê os dados e abre um abastecimento PENDENTE. Quem gerencia a frota confere:
 * vira CONFERIDO, entra no km/l, sobe o km do veículo e gera a conta a pagar no Financeiro (com a foto do cupom anexada).
 * Pagar (baixa com comprovante) é com o Financeiro.
 */

type Abastecimento = typeof veiculosAbastecimentos.$inferSelect;
/** A IA aceita imagem de até 5 MB; o arquivo guardado pode ter até 15 MB (PDF do cupom, foto grande). */
const IA_MAX_BYTES = 5 * 1024 * 1024;
const MIMES_FOTO = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export interface FotoEntrada { nome: string; bytes: Buffer; tipo?: TipoFotoAbastecimento; mime?: string | null }

/** Tipo do arquivo pelos bytes (JPG, PNG, PDF; WEBP pelo cabeçalho RIFF). Recusa o resto. */
export function mimeDaFoto(bytes: Buffer): (typeof MIMES_FOTO)[number] | null {
  const base = tipoDoArquivo(bytes);
  if (base) return base;
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

// ------------------------------------------------------------------ leitura pela IA

export const FERRAMENTA_LEITURA_CUPOM: FerramentaIA = {
  name: "registrar_abastecimento",
  description: "Registra os dados lidos das fotos de um abastecimento (cupom fiscal do posto e, se houver, foto do painel/hodômetro).",
  input_schema: {
    type: "object",
    properties: {
      legivel: { type: "boolean", description: "true se as fotos são de um cupom de combustível ou de um painel legível." },
      data: { type: ["string", "null"], description: "Data do abastecimento no formato AAAA-MM-DD, ou null." },
      litros: { type: ["number", "null"], description: "Quantidade total de litros (soma das linhas de combustível), ou null." },
      valor_total: { type: ["number", "null"], description: "Valor total pago em reais (ex.: 312.45), ou null." },
      preco_litro: { type: ["number", "null"], description: "Preço por litro em reais, ou null." },
      combustivel: { type: ["string", "null"], description: "Tipo de combustível (ex.: Diesel S10, Gasolina), ou null." },
      posto: { type: ["string", "null"], description: "Nome do posto (razão social ou fantasia), ou null." },
      cnpj_posto: { type: ["string", "null"], description: "CNPJ do posto, só dígitos, ou null." },
      km_painel: { type: ["integer", "null"], description: "Quilometragem do hodômetro, se houver foto do painel ou estiver escrita no cupom, ou null." },
      placa: { type: ["string", "null"], description: "Placa do veículo se aparecer no cupom, ou null." },
      observacao: { type: ["string", "null"], description: "Algo que precise de atenção (ilegível, rasurado, duas notas), ou null." },
    },
    required: ["legivel", "data", "litros", "valor_total", "preco_litro", "combustivel", "posto", "cnpj_posto", "km_painel", "placa", "observacao"],
    additionalProperties: false,
  },
};
const zLeitura = z.object({
  legivel: z.boolean(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  litros: z.number().positive().max(2000).nullable().catch(null),
  valor_total: z.number().positive().max(100_000).nullable().catch(null),
  preco_litro: z.number().positive().max(100).nullable().catch(null),
  combustivel: z.string().max(60).nullable().catch(null),
  posto: z.string().max(120).nullable().catch(null),
  cnpj_posto: z.string().max(20).nullable().catch(null),
  km_painel: z.number().int().min(0).max(5_000_000).nullable().catch(null),
  placa: z.string().max(10).nullable().catch(null),
  observacao: z.string().max(300).nullable().catch(null),
});
export type LeituraCupom = z.infer<typeof zLeitura>;

const SISTEMA_LEITURA = `Você lê fotos de abastecimento de uma empresa de ônibus de turismo: cupom fiscal (NFC-e) do posto e, às vezes, a foto do painel com o hodômetro.
Extraia só o que estiver escrito, sem inventar: data, litros, valor total, preço por litro, combustível, posto, CNPJ do posto, km do painel e placa (se o cupom trouxer).
Números: use ponto como separador decimal na resposta (o cupom usa vírgula). Se houver mais de uma linha de combustível no mesmo cupom, some os litros e use o total do cupom.
Nunca devolva CPF, nome de pessoa ou dados de cartão que apareçam no cupom.
Entregue sempre pela ferramenta registrar_abastecimento; o que não der para ler, mande null.`;

/** Lê as fotos com a IA. Devolve null quando a IA está desligada (o pendente segue sem leitura) ou não há foto legível pela IA. */
export async function lerFotosComIa(db: Db, config: Config, fotos: Array<{ mime: string; bytes: Buffer; tipo: string }>, usuarioId?: string | null): Promise<LeituraCupom | null> {
  if (!iaConfigurada(config)) return null;
  const blocos: BlocoIA[] = [];
  for (const f of fotos) {
    if (f.bytes.length > IA_MAX_BYTES) continue;
    const data = f.bytes.toString("base64");
    blocos.push(f.mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: f.mime, data } });
  }
  if (!blocos.length) return null;
  blocos.push({ type: "text", text: `Fotos: ${fotos.map((f, i) => `${i + 1}) ${f.tipo === "HODOMETRO" ? "painel/hodômetro" : "cupom"}`).join(", ")}. Registre os dados do abastecimento.` });
  try {
    const { resultado } = await chamarEstruturado({
      db, config, cliente: obterClienteIA(config), modelo: config.IA_MODELO, esforco: "low", sistema: SISTEMA_LEITURA, ferramenta: FERRAMENTA_LEITURA_CUPOM,
      parser: zLeitura as unknown as ZodType<LeituraCupom>, usuario: blocos, uso: { tipo: "ABASTECIMENTO", usuarioId: usuarioId ?? null }, maxTokens: 4000,
    });
    return resultado;
  } catch (e) {
    if (e instanceof ErroIA) { console.error("[abastecimento] leitura pela IA falhou:", e.codigo); return null; }
    throw e;
  }
}

// ------------------------------------------------------------------ forma de pagamento por praça

const CHAVE_PAGAMENTO = "frota.pagamento_combustivel";
const zConfigPagamento = z.record(z.string().uuid(), z.object({ forma: z.enum(FORMAS_PAGAMENTO_COMBUSTIVEL), prazoDias: z.number().int().min(0).max(120) }));

/** Configuração salva por praça, completada com o padrão (BC faturado; demais cartão) para as que não foram salvas. */
export async function configPagamentoPorPraca(db: Db): Promise<Record<string, ConfigPagamentoPraca & { codigo: string; nome: string }>> {
  const [linha] = await db.select({ valor: configuracoes.valor }).from(configuracoes).where(eq(configuracoes.chave, CHAVE_PAGAMENTO));
  let salvo: z.infer<typeof zConfigPagamento> = {};
  try { salvo = linha ? zConfigPagamento.parse(JSON.parse(linha.valor)) : {}; } catch { salvo = {}; }
  const pracas = await db.select({ id: unidades.id, codigo: unidades.codigo, nome: unidades.nome }).from(unidades);
  return Object.fromEntries(pracas.map((p) => [p.id, { ...(salvo[p.id] ?? configPagamentoPadrao(p.codigo)), codigo: p.codigo, nome: p.nome }]));
}
export async function salvarConfigPagamento(db: Db, valor: Record<string, ConfigPagamentoPraca>, usuarioId: string) {
  const v = JSON.stringify(zConfigPagamento.parse(valor));
  await db.insert(configuracoes).values({ chave: CHAVE_PAGAMENTO, valor: v, atualizadoPor: usuarioId })
    .onConflictDoUpdate({ target: configuracoes.chave, set: { valor: v, atualizadoPor: usuarioId, atualizadoEm: new Date() } });
}

// ------------------------------------------------------------------ criar pendente

export async function guardarFotos(db: Db, cofre: Cofre, abastecimentoId: string, fotos: FotoEntrada[], usuarioId?: string | null) {
  const guardadas: Array<{ mime: string; bytes: Buffer; tipo: string }> = [];
  for (const f of fotos) {
    if (!f.bytes.length) continue;
    if (f.bytes.length > DOCUMENTO_MAX_BYTES) throw new ErroHttp(400, "ARQUIVO_GRANDE", "A foto pode ter até 15 MB.");
    const mime = mimeDaFoto(f.bytes);
    if (!mime) throw new ErroHttp(400, "ARQUIVO_TIPO", "Envie foto (JPG, PNG ou WEBP) ou o PDF do cupom.");
    const tipo = f.tipo ?? "CUPOM";
    await db.insert(veiculosAbastecimentosFotos).values({
      abastecimentoId, tipo, nomeArquivo: f.nome.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 160) || "foto", mime, tamanho: f.bytes.length,
      dadosCifrados: cofre.cifrar(f.bytes.toString("base64")), enviadoPor: usuarioId ?? null,
    });
    guardadas.push({ mime, bytes: f.bytes, tipo });
  }
  return guardadas;
}

/**
 * Abre um abastecimento PENDENTE com as fotos e o que já se sabe (placa, km digitados ou da legenda). Lê as fotos com a IA e
 * preenche o que estiver vazio (o que o motorista digitou vale mais que a leitura). Devolve o registro gravado.
 */
export async function criarPendente(db: Db, config: Config, cofre: Cofre, e: {
  origem: OrigemAbastecimento; fotos: FotoEntrada[]; veiculoId?: string | null; km?: number | null; litros?: number | null; valorCentavos?: number | null;
  data?: string | null; tanqueCheio?: boolean; observacao?: string | null; pessoaId?: string | null; usuarioId?: string | null;
}): Promise<Abastecimento> {
  if (!e.fotos.length) throw new ErroHttp(400, "FOTO_OBRIGATORIA", "Envie a foto do cupom.");
  const [a] = await db.insert(veiculosAbastecimentos).values({
    veiculoId: e.veiculoId ?? null, data: e.data ?? hojeSp(), km: e.km ?? null, litros: e.litros ?? null, valorCentavos: e.valorCentavos ?? null,
    tanqueCheio: e.tanqueCheio ?? true, situacao: "PENDENTE", origem: e.origem, observacao: e.observacao ?? null, pessoaId: e.pessoaId ?? null, criadoPor: e.usuarioId ?? null,
  }).returning();
  const guardadas = await guardarFotos(db, cofre, a!.id, e.fotos, e.usuarioId);
  const leitura = await lerFotosComIa(db, config, guardadas, e.usuarioId);
  if (!leitura) return a!;
  return aplicarLeitura(db, a!, leitura);
}

/** Preenche com a leitura da IA só o que está vazio; placa só se for de um veículo cadastrado. */
export async function aplicarLeitura(db: Db, a: Abastecimento, l: LeituraCupom): Promise<Abastecimento> {
  let veiculoId = a.veiculoId;
  if (!veiculoId && l.placa) {
    const [v] = await db.select({ id: veiculos.id }).from(veiculos).where(eq(veiculos.placa, normalizarPlaca(l.placa)));
    veiculoId = v?.id ?? null;
  }
  const hoje = hojeSp();
  const dataLida = l.data && l.data <= hoje && l.data >= somar(hoje, -60) ? l.data : null;
  const [r] = await db.update(veiculosAbastecimentos).set({
    veiculoId,
    km: a.km ?? l.km_painel ?? null,
    litros: a.litros ?? (l.litros != null ? Math.round(l.litros * 1000) / 1000 : null),
    valorCentavos: a.valorCentavos ?? (l.valor_total != null ? Math.round(l.valor_total * 100) : null),
    posto: a.posto ?? l.posto ?? null,
    data: a.origem === "WHATSAPP" && dataLida ? dataLida : a.data,
    leituraIa: { ...l, cnpj_posto: l.cnpj_posto?.replace(/\D/g, "") || null, lidoEm: new Date().toISOString() },
  }).where(eq(veiculosAbastecimentos.id, a.id)).returning();
  return r!;
}
const somar = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------------ conferir e gerar a conta a pagar

/** Gera a conta a pagar do abastecimento conferido (categoria Combustível, praça e placa do veículo) com a foto do cupom anexada. */
export async function gerarContaCombustivel(db: Db, a: Abastecimento & { veiculoId: string; litros: number; valorCentavos: number }, usuarioId: string | null): Promise<string> {
  await garantirPlano(db);
  const [v] = await db.select({ placa: veiculos.placa, unidadeId: veiculos.unidadeId }).from(veiculos).where(eq(veiculos.id, a.veiculoId));
  const cfgs = await configPagamentoPorPraca(db);
  const cfg = cfgs[v!.unidadeId] ?? configPagamentoPadrao("");
  const forma = (a.formaPagamento as FormaPagamentoCombustivel | null) ?? cfg.forma;
  const codigos = cfgs[v!.unidadeId]?.codigo === "BC" ? ["DESP_COMBUSTIVEL_BC", "DESP_COMBUSTIVEL"] : ["DESP_COMBUSTIVEL"];
  const cats = await db.select({ id: finCategorias.id, codigo: finCategorias.codigo }).from(finCategorias).where(inArray(finCategorias.codigo, codigos));
  const categoria = codigos.map((c) => cats.find((x) => x.codigo === c)).find(Boolean);
  if (!categoria) throw new ErroHttp(500, "SEM_CATEGORIA", "Categoria Combustível não encontrada no plano de contas.");
  const litros = a.litros.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const [l] = await db.insert(finLancamentos).values({
    tipo: "PAGAR", descricao: `Combustível ${v!.placa} · ${litros} L`, contraparte: a.posto ?? null, categoriaId: categoria.id, unidadeId: v!.unidadeId,
    veiculo: v!.placa, forma: FORMA_FINANCEIRO_DO_COMBUSTIVEL[forma], valorCentavos: a.valorCentavos, competencia: a.data,
    vencimento: vencimentoCombustivel(a.data, { forma, prazoDias: cfg.prazoDias }),
    observacao: `Gerado pela Frota ao conferir o abastecimento de ${a.data.split("-").reverse().join("/")} (${ROTULO_FORMA_COMBUSTIVEL[forma]}).`, criadoPor: usuarioId,
  }).returning({ id: finLancamentos.id });
  // a foto do cupom vai junto, como nota fiscal da conta (o Financeiro acha tudo na própria conta)
  const fotos = await db.select().from(veiculosAbastecimentosFotos).where(and(eq(veiculosAbastecimentosFotos.abastecimentoId, a.id), eq(veiculosAbastecimentosFotos.tipo, "CUPOM")));
  for (const f of fotos) {
    // a foto já está cifrada com a mesma chave do sistema: copia sem decifrar
    await db.insert(finLancamentoAnexos).values({ lancamentoId: l!.id, tipo: "NF", nomeArquivo: `Cupom ${v!.placa} ${a.data} - ${f.nomeArquivo}`.slice(0, 160), mime: f.mime, tamanho: f.tamanho, dadosCifrados: f.dadosCifrados, enviadoPor: usuarioId });
  }
  return l!.id;
}

export const zConferencia = z.object({
  veiculoId: z.string().uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  km: z.number().int().min(0).max(5_000_000),
  litros: z.number().positive().max(2000),
  valorCentavos: z.number().int().min(0).max(100_000_000),
  posto: z.string().trim().max(120).nullish().transform((v) => v || null),
  tanqueCheio: z.boolean().default(true),
  formaPagamento: z.enum(FORMAS_PAGAMENTO_COMBUSTIVEL).nullish().transform((v) => v ?? null),
  observacao: z.string().trim().max(300).nullish().transform((v) => v || null),
  /** Gera a conta a pagar no Financeiro (padrão: sim). */
  gerarConta: z.boolean().default(true),
});

/** Confere um pendente: grava os dados finais, sobe o km do veículo e gera a conta a pagar. Só uma vez (corrida segura). */
export async function conferirAbastecimento(db: Db, id: string, c: z.infer<typeof zConferencia>, usuarioId: string): Promise<Abastecimento> {
  if (c.data > hojeSp()) throw new ErroHttp(400, "DATA_FUTURA", "A data do abastecimento não pode ser futura.");
  const faltas = faltasAbastecimento(c);
  if (faltas.length) throw new ErroHttp(400, "DADOS_FALTANDO", `Falta: ${faltas.join(", ")}.`);
  const r = await db.transaction(async (tx) => {
    const [a] = await tx.update(veiculosAbastecimentos).set({
      veiculoId: c.veiculoId, data: c.data, km: c.km, litros: c.litros, valorCentavos: c.valorCentavos, posto: c.posto, tanqueCheio: c.tanqueCheio,
      formaPagamento: c.formaPagamento, observacao: c.observacao, situacao: "CONFERIDO", conferidoPor: usuarioId, conferidoEm: new Date(),
    }).where(and(eq(veiculosAbastecimentos.id, id), eq(veiculosAbastecimentos.situacao, "PENDENTE"))).returning();
    if (!a) throw new ErroHttp(409, "JA_CONFERIDO", "Este abastecimento já foi conferido.");
    if (c.gerarConta) {
      const lancamentoId = await gerarContaCombustivel(tx as unknown as Db, { ...a, veiculoId: c.veiculoId, litros: c.litros, valorCentavos: c.valorCentavos }, usuarioId);
      const [com] = await tx.update(veiculosAbastecimentos).set({ lancamentoId }).where(eq(veiculosAbastecimentos.id, id)).returning();
      return com!;
    }
    return a;
  });
  await registrarLeituraKm(db, { veiculoId: c.veiculoId, km: c.km, data: c.data, fonte: "ABASTECIMENTO", usuarioId });
  return r;
}

/** Último pendente do motorista que ainda espera placa ou km (para completar pela resposta no WhatsApp). */
export async function pendenteAguardandoDados(db: Db, pessoaId: string, horas = 12) {
  const desde = new Date(Date.now() - horas * 3_600_000);
  const [a] = await db.select().from(veiculosAbastecimentos)
    .where(and(eq(veiculosAbastecimentos.pessoaId, pessoaId), eq(veiculosAbastecimentos.situacao, "PENDENTE"), gte(veiculosAbastecimentos.criadoEm, desde),
      or(isNull(veiculosAbastecimentos.veiculoId), isNull(veiculosAbastecimentos.km))))
    .orderBy(desc(veiculosAbastecimentos.criadoEm)).limit(1);
  return a ?? null;
}
