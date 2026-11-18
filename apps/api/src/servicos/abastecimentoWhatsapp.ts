import { faltasAbastecimento, lerLegendaAbastecimento, normalizarPlaca } from "@bybus/core";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { escalas, pessoas, saidas, veiculos, veiculosAbastecimentos } from "../db/schema.js";
import { Cofre } from "../seguranca/cripto.js";
import { aplicarLeitura, criarPendente, guardarFotos, lerFotosComIa, pendenteAguardandoDados } from "./abastecimentoFoto.js";
import { hojeSp } from "./frota.js";
import { chaveTelefone, enviarWhatsapp, normalizarDestino } from "./whatsapp.js";
import { gravarSaida } from "./whatsappConversas.js";

/**
 * Abastecimento pelo WhatsApp (dono, 18/11/2026). O motorista (pessoa do cadastro da equipe com papel MOTORISTA e o telefone do
 * WhatsApp) manda a foto do cupom — com a placa e o km na legenda, se quiser ("TST1A11 120500"). O sistema guarda a foto, a IA lê
 * e abre um abastecimento PENDENTE; a placa sai da legenda, do cupom ou da escala do dia; o que faltar o sistema pergunta e o
 * motorista responde em texto. Mensagens de quem não é motorista seguem normais na caixa de conversas.
 */

export interface MidiaBaixada { bytes: Buffer; mime?: string | null; nome?: string | null }
export interface MensagemMotorista {
  telefone: string;
  conversaId: string;
  tipo: string;
  texto: string | null;
  /** Baixa a foto/PDF do provedor (Evolution ou Meta). */
  baixarMidia?: () => Promise<MidiaBaixada | null>;
}

/** Fila das tarefas em andamento (o webhook responde na hora; os testes esperam por aqui). */
const emAndamento = new Set<Promise<unknown>>();
export function emSegundoPlano(p: Promise<unknown>) {
  const t = p.catch((e) => console.error("[abastecimento-whatsapp] falha:", e instanceof Error ? e.message.slice(0, 200) : "erro")).finally(() => emAndamento.delete(t));
  emAndamento.add(t);
}
export async function aguardarAbastecimentosWhatsapp() {
  while (emAndamento.size) await Promise.all([...emAndamento]);
}

/** Motorista do cadastro da equipe pelo telefone (mesma chave usada nas conversas: ignora o 9 extra). */
export async function motoristaDoTelefone(db: Db, telefone: string) {
  const chave = chaveTelefone(telefone);
  const lista = await db.select({ id: pessoas.id, nome: pessoas.nome, telefone: pessoas.telefone, usuarioId: pessoas.usuarioId }).from(pessoas)
    .where(and(eq(pessoas.ativo, true), sql`'MOTORISTA' = any(${pessoas.papeis})`, sql`${pessoas.telefone} is not null`));
  return lista.find((p) => { const n = normalizarDestino(p.telefone); return !!n && chaveTelefone(n) === chave; }) ?? null;
}

/** Placa do dia pela escala: as saídas de hoje em que a pessoa é o motorista; só vale se for uma placa só. */
export async function veiculoDaEscala(db: Db, pessoaId: string, data = hojeSp()): Promise<string | null> {
  const linhas = await db.select({ placa: saidas.veiculo }).from(escalas)
    .innerJoin(saidas, and(eq(saidas.passeioId, escalas.passeioId), eq(saidas.data, escalas.data)))
    .where(and(eq(escalas.motoristaId, pessoaId), eq(escalas.data, data)));
  const placas = [...new Set(linhas.map((l) => (l.placa ? normalizarPlaca(l.placa) : "")).filter(Boolean))];
  if (placas.length !== 1) return null;
  const [v] = await db.select({ id: veiculos.id }).from(veiculos).where(eq(veiculos.placa, placas[0]!));
  return v?.id ?? null;
}

const kmBr = (n: number) => n.toLocaleString("pt-BR");
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Texto de retorno ao motorista: o que foi entendido e o que falta. */
export function textoRetorno(a: typeof veiculosAbastecimentos.$inferSelect, placa: string | null, iaLigada: boolean): string {
  const lido = [
    placa ? `placa ${placa}` : null,
    a.km != null ? `km ${kmBr(a.km)}` : null,
    a.litros ? `${a.litros.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} L` : null,
    a.valorCentavos ? brl(a.valorCentavos) : null,
    a.posto,
  ].filter(Boolean).join(" · ");
  const faltas = faltasAbastecimento(a);
  const pedir = faltas.filter((f) => f === "placa" || f === "km do painel");
  const partes = [`Abastecimento recebido${lido ? `: ${lido}` : ""}.`];
  if (pedir.length) partes.push(`Falta: ${pedir.join(" e ")}. Responda com a placa e o km do painel, por exemplo: ABC1D23 120500`);
  else if (faltas.length) partes.push(iaLigada ? "A equipe da frota completa o resto na conferência." : "A leitura automática está desligada: a equipe da frota completa litros e valor na conferência.");
  partes.push("Fica pendente até a conferência da frota.");
  return partes.join("\n");
}

async function responder(db: Db, config: Config, m: MensagemMotorista, texto: string) {
  const r = await enviarWhatsapp(config, m.telefone, texto, fetch, { janelaAberta: true });
  await gravarSaida(db, { conversaId: m.conversaId, texto, status: r.status === "FALHA" ? "FALHA" : r.status, idExterno: r.idExterno ?? null });
}

async function placaDe(db: Db, veiculoId: string | null) {
  if (!veiculoId) return null;
  const [v] = await db.select({ placa: veiculos.placa }).from(veiculos).where(eq(veiculos.id, veiculoId));
  return v?.placa ?? null;
}

/**
 * Trata uma mensagem recebida. Devolve false quando não é de motorista (ou não é sobre abastecimento) e a mensagem segue só na
 * caixa de conversas. Foto/PDF: abre o pendente (ou junta a uma foto mandada há menos de 10 minutos, ex.: a do painel).
 * Texto: completa placa/km do último pendente que esperava resposta.
 */
export async function tratarMensagemDoMotorista(db: Db, config: Config, m: MensagemMotorista): Promise<boolean> {
  const motorista = await motoristaDoTelefone(db, m.telefone);
  if (!motorista) return false;
  const legenda = lerLegendaAbastecimento(m.texto);
  const veiculoDaLegenda = legenda.placa
    ? (await db.select({ id: veiculos.id }).from(veiculos).where(eq(veiculos.placa, legenda.placa)))[0]?.id ?? null
    : null;

  if (m.tipo === "IMAGEM" || m.tipo === "DOCUMENTO") {
    const midia = m.baixarMidia ? await m.baixarMidia() : null;
    if (!midia?.bytes.length) {
      await responder(db, config, m, "Não consegui baixar a foto. Mande de novo, por favor.");
      return true;
    }
    const cofre = new Cofre(config.CHAVE_CRIPTOGRAFIA);
    const foto = { nome: midia.nome || `whatsapp-${Date.now()}.${midia.mime?.includes("pdf") ? "pdf" : "jpg"}`, bytes: midia.bytes };
    // segunda foto em seguida (ex.: o painel): junta ao pendente que acabou de abrir
    const [recente] = await db.select().from(veiculosAbastecimentos)
      .where(and(eq(veiculosAbastecimentos.pessoaId, motorista.id), eq(veiculosAbastecimentos.situacao, "PENDENTE"), eq(veiculosAbastecimentos.origem, "WHATSAPP"),
        gte(veiculosAbastecimentos.criadoEm, new Date(Date.now() - 10 * 60_000))))
      .orderBy(desc(veiculosAbastecimentos.criadoEm)).limit(1);
    let a;
    try {
      if (recente) {
        const guardadas = await guardarFotos(db, cofre, recente.id, [{ ...foto, tipo: "OUTRO" }], motorista.usuarioId);
        const atual = await db.update(veiculosAbastecimentos).set({
          ...(veiculoDaLegenda && !recente.veiculoId ? { veiculoId: veiculoDaLegenda } : {}), ...(legenda.km != null && recente.km == null ? { km: legenda.km } : {}),
        }).where(eq(veiculosAbastecimentos.id, recente.id)).returning();
        const leitura = await lerFotosComIa(db, config, guardadas, motorista.usuarioId);
        a = leitura ? await aplicarLeitura(db, atual[0] ?? recente, leitura) : (atual[0] ?? recente);
      } else {
        a = await criarPendente(db, config, cofre, {
          origem: "WHATSAPP", fotos: [foto], veiculoId: veiculoDaLegenda ?? (await veiculoDaEscala(db, motorista.id)), km: legenda.km,
          pessoaId: motorista.id, usuarioId: motorista.usuarioId,
        });
      }
    } catch (e) {
      const msg = e instanceof Error && "codigo" in e && (e as { codigo: string }).codigo === "ARQUIVO_TIPO" ? "Esse arquivo não é foto nem PDF. Mande a foto do cupom, por favor." : "Não consegui registrar a foto. Tente de novo em instantes.";
      await responder(db, config, m, msg);
      throw e;
    }
    await responder(db, config, m, textoRetorno(a, await placaDe(db, a.veiculoId), !!a.leituraIa || !!config.ANTHROPIC_API_KEY));
    return true;
  }

  if (m.tipo === "TEXTO") {
    if (!legenda.placa && legenda.km == null) return false;
    const pend = await pendenteAguardandoDados(db, motorista.id);
    if (!pend) return false;
    if (legenda.placa && !veiculoDaLegenda) {
      await responder(db, config, m, `Não achei a placa ${legenda.placa} na frota. Confira e mande de novo (placa e km, ex.: ABC1D23 120500).`);
      return true;
    }
    const [a] = await db.update(veiculosAbastecimentos).set({
      ...(veiculoDaLegenda ? { veiculoId: veiculoDaLegenda } : {}), ...(legenda.km != null ? { km: legenda.km } : {}),
    }).where(and(eq(veiculosAbastecimentos.id, pend.id), eq(veiculosAbastecimentos.situacao, "PENDENTE"))).returning();
    if (!a) return false;
    await responder(db, config, m, textoRetorno(a, await placaDe(db, a.veiculoId), true));
    return true;
  }
  return false;
}
