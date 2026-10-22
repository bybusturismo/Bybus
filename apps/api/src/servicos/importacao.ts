import { and, eq } from "drizzle-orm";
import type { ReservaImportada } from "@bybus/core";
import type { Db } from "../db/cliente.js";
import { passageiros, passeios, pontosEmbarque, reservas, saidas } from "../db/schema.js";
import type { Cofre } from "../seguranca/cripto.js";
import { camposDocumento } from "./passageiro.js";
import { podeUnidade } from "../seguranca/escopo.js";
import type { UsuarioSessao } from "../seguranca/sessao.js";

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
  const candidatos = pontos.filter((p) => {
    const chaves = normalizar(p.nome).split(" ").filter((w) => w.length > 2 && !ignorar.has(w));
    return chaves.length > 0 && chaves.some((w) => alvo.includes(w));
  });
  return candidatos.length === 1 ? candidatos[0]! : null;
}

/**
 * Importa reservas de qualquer canal para as saídas. Idempotente pela chave (canal, código externo):
 * reimportar o mesmo arquivo/e-mail não duplica. Com `confirmar=false` só calcula a prévia.
 */
export async function importarReservas(
  db: Db,
  cofre: Cofre,
  itens: ReservaImportada[],
  opcoes: { confirmar: boolean; passeioCodigo?: string; origem: string; usuario: UsuarioSessao },
): Promise<{ previa: ItemPrevia[]; resumo: Record<Acao, number> }> {
  // Só passeios das praças de quem está importando.
  const todosPasseios = (await db.select().from(passeios).where(eq(passeios.ativo, true))).filter((p) => podeUnidade(opcoes.usuario, p.unidadeId));
  const previa: ItemPrevia[] = [];

  const executar = async (tx: Db) => {
    for (const item of itens) {
      const avisos = [...item.avisos];
      const passeio = opcoes.passeioCodigo
        ? todosPasseios.find((p) => p.codigo === opcoes.passeioCodigo)
        : todosPasseios.find((p) => p.padraoProduto && new RegExp(p.padraoProduto, "i").test(item.produto));
      const base = { canal: item.canal, codigoExterno: item.codigoExterno, data: item.data, contatoNome: item.contatoNome, passageiros: item.passageiros.length };

      if (!passeio) {
        previa.push({ ...base, pontoEmbarque: null, acao: "IGNORAR", avisos: [...avisos, `Produto não reconhecido: "${item.produto}".`] });
        continue;
      }
      if (passeio.padraoProduto && item.produto && !new RegExp(passeio.padraoProduto, "i").test(item.produto)) {
        previa.push({ ...base, pontoEmbarque: null, acao: "IGNORAR", avisos: [...avisos, `Produto "${item.produto}" não é ${passeio.nome}.`] });
        continue;
      }

      const pontos = await tx.select().from(pontosEmbarque).where(and(eq(pontosEmbarque.passeioId, passeio.id), eq(pontosEmbarque.ativo, true)));
      const ponto = casarPonto(item.pontoEmbarqueTexto, pontos);
      if (item.pontoEmbarqueTexto && !ponto) avisos.push(`Ponto de embarque "${item.pontoEmbarqueTexto}" não reconhecido — definir manualmente.`);
      if (!item.pontoEmbarqueTexto) avisos.push("Sem ponto de embarque — contatar o cliente no dia anterior.");

      const [existente] = await tx.select().from(reservas).where(and(eq(reservas.canal, item.canal), eq(reservas.codigoExterno, item.codigoExterno)));
      if (existente) {
        const [s] = await tx.select({ passeioId: saidas.passeioId }).from(saidas).where(eq(saidas.id, existente.saidaId));
        if (!todosPasseios.some((p) => p.id === s?.passeioId)) {
          previa.push({ ...base, pontoEmbarque: null, acao: "IGNORAR", avisos: [...avisos, "Reserva já existe em outra praça."] });
          continue;
        }
      }

      let acao: Acao;
      if (item.cancelada) acao = existente && existente.status !== "CANCELADA" ? "CANCELAR" : "IGNORAR";
      else acao = existente ? "ATUALIZAR" : "CRIAR";

      if (acao === "ATUALIZAR" && existente) {
        const qtd = (await tx.select({ id: passageiros.id }).from(passageiros).where(eq(passageiros.reservaId, existente.id))).length;
        if (qtd !== item.passageiros.length) avisos.push(`Quantidade mudou no canal (${qtd} → ${item.passageiros.length}). Ajuste os passageiros manualmente.`);
      }

      previa.push({ ...base, pontoEmbarque: ponto?.nome ?? null, acao, avisos });
      if (!opcoes.confirmar || acao === "IGNORAR") continue;

      if (acao === "CANCELAR") {
        await tx.update(reservas).set({ status: "CANCELADA", atualizadoEm: new Date() }).where(eq(reservas.id, existente!.id));
        continue;
      }
      if (acao === "ATUALIZAR") {
        await tx.update(reservas).set({
          contatoTelefone: existente!.contatoTelefone ?? item.contatoTelefone,
          contatoEmail: existente!.contatoEmail ?? item.contatoEmail,
          pontoEmbarqueId: existente!.pontoEmbarqueId ?? ponto?.id ?? null,
          referencias: [...new Set([...existente!.referencias, ...item.referencias])],
          status: "CONFIRMADA",
          atualizadoEm: new Date(),
        }).where(eq(reservas.id, existente!.id));
        continue;
      }

      let [saida] = await tx.select().from(saidas).where(and(eq(saidas.passeioId, passeio.id), eq(saidas.data, item.data)));
      if (!saida) {
        [saida] = await tx.insert(saidas).values({ passeioId: passeio.id, data: item.data, capacidade: passeio.capacidadePadrao }).returning();
      }
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
        observacoes: item.observacoes,
        origem: opcoes.origem,
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
