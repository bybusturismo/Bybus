import { and, eq, like, or, sql } from "drizzle-orm";
import { anonimizarReserva, type ReservaImportada, type VendaImportada } from "@bybus/core";
import type { Db } from "../db/cliente.js";
import { passageiros, passeios, pontosEmbarque, reservas, saidas, vendas } from "../db/schema.js";
import type { Cofre } from "../seguranca/cripto.js";
import { camposDocumento } from "./passageiro.js";
import { aplicarEscalaNaSaida } from "./escala.js";
import { podeUnidade } from "../seguranca/escopo.js";
import type { UsuarioSessao } from "../seguranca/sessao.js";

/** "Usuário" das importações automáticas (robô do Gmail, Paytour): alcança todas as praças, sem sessão nem login. */
export const USUARIO_INTEGRACAO: UsuarioSessao = {
  id: "integracao", nome: "Integração automática", email: "", perfil: "INTEGRACAO", perfilNome: "Integração",
  permissoes: ["importacoes:executar"], todasUnidades: true, unidadeIds: [], trocarSenha: false, totpAtivo: false, sessaoId: "",
};

/** Padrão de produto do passeio (regex digitada no cadastro). Padrão inválido não derruba a importação: não casa. */
export function casaProduto(padrao: string | null, produto: string): boolean {
  if (!padrao) return false;
  try {
    return new RegExp(padrao, "i").test(produto);
  } catch {
    return false;
  }
}

export type Acao = "CRIAR" | "ATUALIZAR" | "CANCELAR" | "IGNORAR";

export interface ItemPrevia {
  canal: string;
  codigoExterno: string;
  data: string;
  contatoNome: string;
  passageiros: number;
  pontoEmbarque: string | null;
  acao: Acao;
  avisos: string[];
}

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Casa o texto do ponto informado pelo canal com a tabela oficial (nome igual, ou palavras-chave contidas). */
export function casarPonto<T extends { id: string; nome: string }>(texto: string | null, pontos: T[]): T | null {
  if (!texto) return null;
  const alvo = normalizar(texto);
  const exato = pontos.find((p) => normalizar(p.nome) === alvo);
  if (exato) return exato;
  const ignorar = new Set(["hotel", "transfer", "e", "de", "da", "do", "fundos", "em", "frente", "ao", "praca", "praia"]);
  // Posição da primeira palavra-chave de cada ponto citada no texto.
  const posicoes = pontos.flatMap((p) => {
    const chaves = normalizar(p.nome).split(" ").filter((w) => w.length > 2 && !ignorar.has(w));
    const achadas = chaves.map((w) => alvo.search(new RegExp(`\\b${w}\\b`))).filter((i) => i >= 0);
    return achadas.length ? [{ p, pos: Math.min(...achadas) }] : [];
  });
  if (posicoes.length <= 1) return posicoes[0]?.p ?? null;
  // Vários pontos citados (ex.: "hotel Ibis (Av. Rio Branco…, próximo ao hotel Lumar)"): vale o citado primeiro.
  posicoes.sort((a, b) => a.pos - b.pos);
  return posicoes[0]!.pos < posicoes[1]!.pos ? posicoes[0]!.p : null;
}

/**
 * Importa reservas de qualquer canal para as saídas. Idempotente pela chave (canal, código externo):
 * reimportar o mesmo arquivo/e-mail não duplica. Com `confirmar=false` só calcula a prévia.
 */
export async function importarReservas(
  db: Db,
  cofre: Cofre,
  itensRecebidos: ReservaImportada[],
  opcoes: { confirmar: boolean; passeioCodigo?: string; origem: string; usuario: UsuarioSessao; anonimizar: boolean },
): Promise<{ previa: ItemPrevia[]; resumo: Record<Acao, number> }> {
  // Fora da produção (LGPD): dados pessoais viram fictícios antes de qualquer gravação ou prévia.
  const itens = opcoes.anonimizar ? itensRecebidos.map(anonimizarReserva) : itensRecebidos;
  // Texto do ponto como veio no canal: casa com a tabela de pontos, mas fora da produção não aparece em avisos
  // (o campo de hospedagem pode ter o endereço do cliente).
  const textoPonto = (i: number) => itensRecebidos[i]!.pontoEmbarqueTexto;
  // Só passeios das praças de quem está importando.
  // Inclui passeios inativos (encerrados): o histórico de vendas também precisa entrar.
  const todosPasseios = (await db.select().from(passeios)).filter((p) => podeUnidade(opcoes.usuario, p.unidadeId));
  const previa: ItemPrevia[] = [];
  const vendasGravadas = new Map<string, string>();

  const executar = async (tx: Db) => {
    for (const [indice, item] of itens.entries()) {
      const avisos = [...item.avisos];
      const passeio = opcoes.passeioCodigo
        ? todosPasseios.find((p) => p.codigo === opcoes.passeioCodigo)
        : todosPasseios.find((p) => casaProduto(p.padraoProduto, item.produto));
      const base = { canal: item.canal, codigoExterno: item.codigoExterno, data: item.data, contatoNome: item.contatoNome, passageiros: item.passageiros.length };

      if (!passeio) {
        previa.push({ ...base, pontoEmbarque: null, acao: "IGNORAR", avisos: [...avisos, `Produto não reconhecido: "${item.produto}".`] });
        continue;
      }
      if (passeio.padraoProduto && item.produto && !casaProduto(passeio.padraoProduto, item.produto)) {
        previa.push({ ...base, pontoEmbarque: null, acao: "IGNORAR", avisos: [...avisos, `Produto "${item.produto}" não é ${passeio.nome}.`] });
        continue;
      }

      const pontos = await tx.select().from(pontosEmbarque).where(and(eq(pontosEmbarque.passeioId, passeio.id), eq(pontosEmbarque.ativo, true)));
      // Passeio com um único ponto (ex.: Bruxólico): quem não informou ou informou algo ilegível embarca nele.
      const textoDoCanal = textoPonto(indice);
      const ponto = casarPonto(textoDoCanal, pontos) ?? (pontos.length === 1 ? pontos[0]! : null);
      if (textoDoCanal && !ponto) avisos.push(opcoes.anonimizar ? "Ponto de embarque informado não reconhecido — definir manualmente." : `Ponto de embarque "${textoDoCanal}" não reconhecido — definir manualmente.`);
      if (!textoDoCanal && !ponto) avisos.push("Sem ponto de embarque — contatar o cliente no dia anterior.");

      const existente = await acharExistente(tx, item, passeio.id);
      if (existente) {
        const [s] = await tx.select({ passeioId: saidas.passeioId }).from(saidas).where(eq(saidas.id, existente.saidaId));
        if (!todosPasseios.some((p) => p.id === s?.passeioId)) {
          previa.push({ ...base, pontoEmbarque: null, acao: "IGNORAR", avisos: [...avisos, "Reserva não pode ser importada por este usuário."] });
          continue;
        }
      }

      let acao: Acao;
      if (item.cancelada) acao = existente && existente.status !== "CANCELADA" ? "CANCELAR" : "IGNORAR";
      else if (existente?.status === "CANCELADA") {
        // Cancelada pela equipe (ou pelo canal antes): não volta sozinha para a lista.
        acao = "IGNORAR";
        avisos.push("Reserva cancelada no sistema, mas ativa no canal — conferir.");
      } else acao = existente ? "ATUALIZAR" : "CRIAR";

      if (acao === "ATUALIZAR" && existente) {
        const qtd = (await tx.select({ id: passageiros.id }).from(passageiros).where(eq(passageiros.reservaId, existente.id))).length;
        if (qtd !== item.passageiros.length) avisos.push(`Quantidade mudou no canal (${qtd} → ${item.passageiros.length}). Ajuste os passageiros manualmente.`);
      }

      if (acao === "ATUALIZAR" && existente) {
        const [atual] = await tx.select({ data: saidas.data }).from(saidas).where(eq(saidas.id, existente.saidaId));
        if (atual && atual.data !== item.data) avisos.push(`Data mudou no canal (${atual.data} → ${item.data}): reserva movida, conferir de novo.`);
      }
      previa.push({ ...base, pontoEmbarque: ponto?.nome ?? null, acao, avisos });
      if (!opcoes.confirmar || acao === "IGNORAR") continue;

      if (acao === "CANCELAR") {
        await tx.update(reservas).set({ status: "CANCELADA", atualizadoEm: new Date() }).where(eq(reservas.id, existente!.id));
        continue;
      }
      if (acao === "ATUALIZAR") {
        // Data (ou passeio) mudou no canal: a reserva vai para a saída certa.
        const [atual] = await tx.select({ data: saidas.data, passeioId: saidas.passeioId }).from(saidas).where(eq(saidas.id, existente!.saidaId));
        const mudouSaida = atual && (atual.data !== item.data || atual.passeioId !== passeio.id);
        await tx.update(reservas).set({
          ...(mudouSaida ? { saidaId: (await obterSaida(tx, passeio, item.data)).id, conferencia: "PENDENTE" as const } : {}),
          codigoExterno: item.codigoExterno,
          contatoTelefone: existente!.contatoTelefone ?? item.contatoTelefone,
          contatoEmail: existente!.contatoEmail ?? item.contatoEmail,
          // O canal mudou o ponto (ex.: o cliente passou para o transfer): a reserva acompanha. Se o canal repete o mesmo
          // ponto, vale o que está no sistema (ajuste manual ou do link de embarque).
          ...(ponto && ponto.id !== existente!.pontoCanalId && (existente!.pontoCanalId !== null || !existente!.informadoPeloClienteEm) ? { pontoEmbarqueId: ponto.id, pontoCanalId: ponto.id } : { pontoEmbarqueId: existente!.pontoEmbarqueId ?? ponto?.id ?? null }),
          referencias: [...new Set([...existente!.referencias, ...item.referencias])],
          // Pagamento pode mudar no canal (ex.: "pagar no dia" quitado); só sobrescreve quando o canal informa.
          ...(item.pagamento !== undefined && item.pagamento !== null ? { pagamento: item.pagamento, formaPagamento: item.formaPagamento ?? null } : {}),
          origemCliente: existente!.origemCliente ?? item.origemCliente ?? null,
          // Valores: a cada sincronização o canal é a fonte (preenche também as reservas antigas, sem duplicar).
          ...(item.venda ? { vendaId: await gravarVenda(tx, item.venda, vendasGravadas) } : {}),
          ...(item.valorCentavos != null ? { valorCentavos: item.valorCentavos, descontoCentavos: item.descontoCentavos ?? 0 } : {}),
          status: "CONFIRMADA",
          atualizadoEm: new Date(),
        }).where(eq(reservas.id, existente!.id));
        continue;
      }

      const saida = await obterSaida(tx, passeio, item.data);
      const [nova] = await tx.insert(reservas).values({
        saidaId: saida!.id,
        canal: item.canal,
        canalOrigem: item.canal,
        codigoExterno: item.codigoExterno,
        referencias: item.referencias,
        contatoNome: item.contatoNome || "(sem nome)",
        contatoTelefone: item.contatoTelefone,
        contatoEmail: item.contatoEmail,
        pontoEmbarqueId: ponto?.id ?? null,
        pontoCanalId: ponto?.id ?? null,
        observacoes: item.observacoes,
        origem: opcoes.origem,
        pagamento: item.pagamento ?? null,
        formaPagamento: item.formaPagamento ?? null,
        origemCliente: item.origemCliente ?? null,
        vendaId: item.venda ? await gravarVenda(tx, item.venda, vendasGravadas) : null,
        valorCentavos: item.valorCentavos ?? null,
        descontoCentavos: item.descontoCentavos ?? 0,
      }).returning();
      if (item.passageiros.length) {
        await tx.insert(passageiros).values(
          item.passageiros.map((p) => ({ reservaId: nova!.id, nome: p.nome, categoria: p.categoria, ...camposDocumento(cofre, p.documentoTipo, p.documento) })),
        );
      }
    }
  };

  if (opcoes.confirmar) await db.transaction(async (tx) => executar(tx as unknown as Db));
  else await executar(db);

  const resumo: Record<Acao, number> = { CRIAR: 0, ATUALIZAR: 0, CANCELAR: 0, IGNORAR: 0 };
  previa.forEach((p) => resumo[p.acao]++);
  return { previa, resumo };
}

/** Grava (ou atualiza) o pedido de venda e devolve o id. Reimportar o mesmo pedido só atualiza: idempotente. */
async function gravarVenda(tx: Db, v: VendaImportada, cache: Map<string, string>): Promise<string> {
  const guardado = cache.get(v.pedidoCodigo);
  if (guardado) return guardado;
  const valores = {
    fonte: v.fonte, canalVenda: v.canalVenda, valorCentavos: v.valorCentavos, subtotalCentavos: v.subtotalCentavos, descontoCentavos: v.descontoCentavos,
    cupomExternoId: v.cupomExternoId, metodoPagamento: v.metodoPagamento, metodoPagamentoExterno: v.metodoPagamentoExterno, tipoPagamento: v.tipoPagamento,
    parcelas: v.parcelas, dataHoraCompra: v.dataHoraCompra ? new Date(v.dataHoraCompra) : null, operadorId: v.operadorId, afiliadoId: v.afiliadoId,
    afiliadoComissaoCentavos: v.afiliadoComissaoCentavos, parceiroId: v.parceiroId, parceiroComissaoCentavos: v.parceiroComissaoCentavos,
    pagamentoPendenteCentavos: v.pagamentoPendenteCentavos, utmSource: v.utmSource, utmMedium: v.utmMedium, utmCampaign: v.utmCampaign, clienteCidade: v.clienteCidade,
  };
  const [linha] = await tx.insert(vendas).values({ pedidoCodigo: v.pedidoCodigo, ...valores })
    .onConflictDoUpdate({ target: vendas.pedidoCodigo, set: { ...valores, atualizadoEm: new Date() } }).returning({ id: vendas.id });
  cache.set(v.pedidoCodigo, linha!.id);
  return linha!.id;
}

async function obterSaida(tx: Db, passeio: { id: string; capacidadePadrao: number }, data: string) {
  const [s] = await tx.select().from(saidas).where(and(eq(saidas.passeioId, passeio.id), eq(saidas.data, data)));
  if (s) return s;
  const [nova] = await tx.insert(saidas).values({ passeioId: passeio.id, data, capacidade: passeio.capacidadePadrao }).returning();
  await aplicarEscalaNaSaida(tx, passeio.id, data, false);
  return nova!;
}

/**
 * Reserva já importada do mesmo pedido. Procura, nesta ordem:
 * 1. o mesmo código (o canal detectado pode mudar entre sincronizações na Paytour, então o código manda);
 * 2. Paytour com código antigo do mesmo pedido e item (PAYTOUR-<id> ou PAYTOUR-<id>-<data>-<n>) no mesmo passeio e data;
 * 3. mesmo canal e mesma origem do código, com uma referência em comum (ex.: Decolar com ID de compra num e-mail e só o PAM em outro).
 */
async function acharExistente(tx: Db, item: ReservaImportada, passeioId: string) {
  const mesmoCodigo = item.codigoExterno.startsWith("PAYTOUR-")
    ? eq(reservas.codigoExterno, item.codigoExterno)
    : and(eq(reservas.canal, item.canal), eq(reservas.codigoExterno, item.codigoExterno));
  const [porCodigo] = await tx.select().from(reservas).where(mesmoCodigo);
  if (porCodigo) return porCodigo;
  const pedido = /^PAYTOUR-(\d+)-\d{4}-\d{2}-\d{2}-/.exec(item.codigoExterno)?.[1] ?? (/^PAYTOUR-(\d+)$/.exec(item.codigoExterno)?.[1]);
  if (pedido) {
    const [antigo] = await tx.select({ r: reservas }).from(reservas).innerJoin(saidas, eq(saidas.id, reservas.saidaId))
      .where(and(
        or(eq(reservas.codigoExterno, `PAYTOUR-${pedido}`), like(reservas.codigoExterno, `PAYTOUR-${pedido}-${item.data}-%`)),
        eq(saidas.passeioId, passeioId), eq(saidas.data, item.data),
      ));
    if (antigo) return antigo.r;
  }
  if (item.referencias.length) {
    const [porReferencia] = await tx.select().from(reservas)
      // Só entre códigos da mesma origem (DEC- com DEC-): a cópia de uma Viator na Paytour não pode "virar" a original.
      .where(and(eq(reservas.canal, item.canal), like(reservas.codigoExterno, `${item.codigoExterno.split("-")[0]}-%`), sql`${reservas.referencias} && ${sql.param(item.referencias)}::text[]`));
    if (porReferencia) return porReferencia;
  }
  return undefined;
}
