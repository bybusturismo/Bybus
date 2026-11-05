import { and, eq, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { CANAIS } from "@bybus/core";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { passageiros, passeios, pontosEmbarque, reservas, saidas, vendas } from "../db/schema.js";
import { filtroUnidade, garantirPasseio, podeUnidade } from "../seguranca/escopo.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { hojeSp, somarDias } from "./visao-geral.js";

const uuid = z.string().uuid();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD").refine((d) => !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()), "Data inválida");

/** Pendências da Visão Geral que levam a esta listagem (passeios de hoje em diante). */
export const PENDENCIAS = ["a_conferir", "sem_ponto", "a_pagar", "formulario"] as const;

const consulta = z.object({
  de: dataIso.optional(),
  ate: dataIso.optional(),
  unidadeId: uuid.optional(),
  passeioId: uuid.optional(),
  canal: z.enum(CANAIS).optional(),
  situacao: z.enum(["CONFIRMADA", "CANCELADA"]).optional(),
  conferencia: z.enum(["PENDENTE", "CONFERIDA"]).optional(),
  pendencia: z.enum(PENDENCIAS).optional(),
  busca: z.string().trim().max(80).optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

/** Listagem geral de reservas (a lista por saída continua em /api/saidas/:id/reservas). */
export async function rotasReservasLista(app: FastifyInstance, { db, config }: Contexto) {
  app.get("/api/reservas", { preHandler: exigir(config, "manifesto:ver") }, async (req) => {
    const u = req.usuario!;
    const q = consulta.parse(req.query);
    const hoje = hojeSp();
    // Pendência olha passeios de hoje em diante; sem período informado, a listagem mostra os próximos 30 dias.
    const de = q.de ?? (q.pendencia ? hoje : q.ate ? somarDias(q.ate, -30) : hoje);
    const ate = q.ate ?? somarDias(de, 30);
    if (de > ate) throw new ErroHttp(400, "PERIODO_INVALIDO", "A data inicial deve ser anterior à final.");
    if ((Date.parse(ate) - Date.parse(de)) / 86_400_000 > 400) throw new ErroHttp(400, "PERIODO_LONGO", "Período longo demais (máximo de 400 dias).");
    if (q.unidadeId && !podeUnidade(u, q.unidadeId)) throw new ErroHttp(404, "NAO_ENCONTRADO", "Praça não encontrada.");
    if (q.passeioId) await garantirPasseio(db, u, q.passeioId);

    const c: Array<SQL | undefined> = [filtroUnidade(u), sql`${saidas.data} between ${de}::date and ${ate}::date`];
    if (q.unidadeId) c.push(eq(passeios.unidadeId, q.unidadeId));
    if (q.passeioId) c.push(eq(passeios.id, q.passeioId));
    if (q.canal) c.push(sql`coalesce(${reservas.canalOrigem}, ${reservas.canal}) = ${q.canal}`);
    if (q.situacao) c.push(eq(reservas.status, q.situacao));
    if (q.conferencia) c.push(eq(reservas.conferencia, q.conferencia));
    if (q.pendencia) {
      c.push(eq(reservas.status, "CONFIRMADA"), sql`${saidas.status} <> 'CANCELADA'`);
      if (q.pendencia === "a_conferir") c.push(eq(reservas.conferencia, "PENDENTE"));
      if (q.pendencia === "sem_ponto") c.push(sql`${reservas.pontoEmbarqueId} is null`);
      if (q.pendencia === "a_pagar") c.push(eq(reservas.pagamento, "A_PAGAR"));
      if (q.pendencia === "formulario") c.push(sql`${reservas.tokenEmbarqueHash} is not null and ${reservas.informadoPeloClienteEm} is null`);
    }
    if (q.busca) {
      const padrao = `%${q.busca.replace(/[\\%_]/g, "\\$&")}%`;
      c.push(sql`(${reservas.contatoNome} ilike ${padrao} or ${reservas.codigoExterno} ilike ${padrao}
        or exists (select 1 from unnest(${reservas.referencias}) ref where ref ilike ${padrao})
        or exists (select 1 from ${passageiros} where ${passageiros.reservaId} = ${reservas.id} and ${passageiros.nome} ilike ${padrao}))`);
    }
    const onde = and(...c) ?? sql`true`;
    const origem = sql`from ${reservas}
      inner join ${saidas} on ${saidas.id} = ${reservas.saidaId}
      inner join ${passeios} on ${passeios.id} = ${saidas.passeioId}
      left join ${vendas} on ${vendas.id} = ${reservas.vendaId}
      left join ${pontosEmbarque} on ${pontosEmbarque.id} = ${reservas.pontoEmbarqueId}`;

    const [total] = (await db.execute(sql`select count(*)::int as n ${origem} where ${onde}`)).rows as Array<{ n: number }>;
    const linhas = (await db.execute(sql`select ${reservas.id} as id, ${reservas.saidaId} as "saidaId", to_char(${saidas.data}, 'YYYY-MM-DD') as data, ${passeios.nome} as passeio, ${passeios.id} as "passeioId",
      coalesce(${reservas.canalOrigem}, ${reservas.canal}) as canal, ${reservas.codigoExterno} as "codigoExterno", ${reservas.contatoNome} as "contatoNome",
      (select count(*)::int from ${passageiros} where ${passageiros.reservaId} = ${reservas.id}) as passageiros,
      ${reservas.status} as status, ${reservas.conferencia} as conferencia, ${reservas.pagamento} as pagamento, ${reservas.formaPagamento} as "formaPagamento",
      ${pontosEmbarque.nome} as "pontoEmbarque",
      (${reservas.tokenEmbarqueHash} is not null and ${reservas.informadoPeloClienteEm} is null) as "formularioPendente",
      coalesce(${vendas.dataHoraCompra}, ${reservas.criadoEm}) as "compraEm", ${reservas.valorCentavos} as "valorCentavos"
      ${origem} where ${onde} order by ${saidas.data}, ${passeios.nome}, ${reservas.contatoNome}
      limit ${q.limite} offset ${(q.pagina - 1) * q.limite}`)).rows as Array<Record<string, unknown>>;

    // Sem metadados pessoais na auditoria: só o recorte pedido.
    await auditar(db, req, "RESERVAS_LISTADAS", { tipo: "reservas" }, { de, ate, canal: q.canal, pendencia: q.pendencia, comBusca: !!q.busca, pagina: q.pagina });
    const verValores = pode(u, "financeiro:ver");
    return {
      periodo: { de, ate },
      total: total?.n ?? 0, pagina: q.pagina, limite: q.limite,
      reservas: linhas.map((l) => ({ ...l, compraEm: l.compraEm instanceof Date ? l.compraEm.toISOString() : l.compraEm, valorCentavos: verValores ? (l.valorCentavos as number | null) : undefined })),
    };
  });
}
