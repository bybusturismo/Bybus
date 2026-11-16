import { and, desc, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../app.js";
import { afiliados, gruposFechados, orcamentosRota, passageiros, passeios, pessoas, reservas, saidas, veiculos } from "../db/schema.js";
import { filtroUnidade } from "../seguranca/escopo.js";
import { pode } from "../seguranca/permissoes.js";
import { exigir, type UsuarioSessao } from "../seguranca/sessao.js";

export interface ResultadoBusca { grupo: string; titulo: string; detalhe: string | null; para: string }

const POR_GRUPO = 6;

/**
 * Busca geral do topo (dono, 16/11/2026): reservas (cliente, passageiro, código), grupos fechados, orçamentos com rota,
 * guias e equipe, veículos e afiliados. Cada grupo só aparece para quem tem a permissão da tela dele, e só com dados
 * das praças do usuário. Não devolve documentos, telefones nem e-mails (LGPD): só o necessário para abrir o cadastro.
 */
export async function rotasBusca(app: FastifyInstance, { db, config }: Contexto) {
  // Comum a qualquer usuário logado; cada grupo confere a própria permissão.
  app.get("/api/busca", { preHandler: exigir(config), config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(80) }).parse(req.query);
    const u = req.usuario!;
    const padrao = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const daPraca = (coluna: AnyPgColumn): SQL | undefined =>
      u.todasUnidades ? undefined : u.unidadeIds.length ? or(isNull(coluna), inArray(coluna, u.unidadeIds)) : isNull(coluna);
    const tarefas: Array<Promise<ResultadoBusca[]>> = [];

    if (pode(u, "manifesto:ver")) tarefas.push(buscarReservas(u, padrao));
    if (pode(u, "reservas:editar")) {
      tarefas.push(db.select({ id: gruposFechados.id, nome: gruposFechados.nome, data: gruposFechados.dataPasseio, rep: gruposFechados.representanteNome }).from(gruposFechados)
        .where(and(daPraca(gruposFechados.unidadeId), sql`(${gruposFechados.nome} ilike ${padrao} or ${gruposFechados.representanteNome} ilike ${padrao} or ${gruposFechados.razaoSocial} ilike ${padrao})`))
        .orderBy(desc(gruposFechados.dataPasseio)).limit(POR_GRUPO)
        .then((l) => l.map((g) => ({ grupo: "Grupos fechados", titulo: g.nome, detalhe: [g.data ? dataBr(g.data) : "data a definir", g.rep].filter(Boolean).join(" · "), para: `/grupos/${g.id}` }))));
      tarefas.push(db.select({ id: orcamentosRota.id, numero: orcamentosRota.numero, cliente: orcamentosRota.cliente, data: orcamentosRota.dataPasseio }).from(orcamentosRota)
        .where(and(daPraca(orcamentosRota.unidadeId), sql`(${orcamentosRota.cliente} ilike ${padrao} or ${orcamentosRota.numero} ilike ${padrao} or ${orcamentosRota.contato} ilike ${padrao})`))
        .orderBy(desc(orcamentosRota.criadoEm)).limit(POR_GRUPO)
        .then((l) => l.map((o) => ({ grupo: "Orçamentos com rota", titulo: `${o.numero} · ${o.cliente}`, detalhe: o.data ? dataBr(o.data) : null, para: `/orcamentos-rota/${o.id}` }))));
    }
    if (pode(u, "pessoas:ver")) {
      tarefas.push(db.select({ nome: pessoas.nome, papeis: pessoas.papeis }).from(pessoas)
        .where(and(daPraca(pessoas.unidadeId), sql`${pessoas.ativo} and ${pessoas.nome} ilike ${padrao}`)).orderBy(pessoas.nome).limit(POR_GRUPO)
        .then((l) => l.map((p) => ({ grupo: "Guias e equipe", titulo: p.nome, detalhe: p.papeis.map((x) => x.toLowerCase()).join(", ") || null, para: `/equipe?busca=${encodeURIComponent(p.nome)}` }))));
    }
    if (pode(u, "frota:ver")) {
      tarefas.push(db.select({ placa: veiculos.placa, apelido: veiculos.apelido, modelo: veiculos.modelo }).from(veiculos)
        .where(and(filtroUnidade(u, veiculos.unidadeId as never), sql`(${veiculos.placa} ilike ${padrao.replace(/-/g, "")} or ${veiculos.apelido} ilike ${padrao} or ${veiculos.modelo} ilike ${padrao})`))
        .orderBy(veiculos.placa).limit(POR_GRUPO)
        .then((l) => l.map((v) => ({ grupo: "Veículos", titulo: v.apelido ? `${v.placa} · ${v.apelido}` : v.placa, detalhe: v.modelo, para: `/frota/veiculos` }))));
    }
    if (pode(u, "marketing:ver")) {
      tarefas.push(db.select({ nome: afiliados.nome, codigo: afiliados.codigo }).from(afiliados)
        .where(and(daPraca(afiliados.unidadeId), sql`(${afiliados.nome} ilike ${padrao} or ${afiliados.codigo} ilike ${padrao})`)).orderBy(afiliados.nome).limit(POR_GRUPO)
        .then((l) => l.map((a) => ({ grupo: "Afiliados", titulo: a.nome, detalhe: `código ${a.codigo}`, para: "/marketing/afiliados" }))));
    }
    return { resultados: (await Promise.all(tarefas)).flat() };
  });

  /** Reservas pelo titular, código do canal, referência ou nome de passageiro; as mais próximas de hoje primeiro. */
  async function buscarReservas(u: UsuarioSessao, padrao: string): Promise<ResultadoBusca[]> {
    const onde = and(filtroUnidade(u), sql`(${reservas.contatoNome} ilike ${padrao} or ${reservas.codigoExterno} ilike ${padrao}
      or exists (select 1 from unnest(${reservas.referencias}) ref where ref ilike ${padrao})
      or exists (select 1 from ${passageiros} where ${passageiros.reservaId} = ${reservas.id} and ${passageiros.nome} ilike ${padrao}))`);
    const linhas = (await db.execute(sql`select ${reservas.saidaId} as "saidaId", to_char(${saidas.data}, 'YYYY-MM-DD') as data, ${passeios.nome} as passeio,
        ${reservas.contatoNome} as nome, ${reservas.codigoExterno} as codigo, ${reservas.status} as status
      from ${reservas} inner join ${saidas} on ${saidas.id} = ${reservas.saidaId} inner join ${passeios} on ${passeios.id} = ${saidas.passeioId}
      where ${onde} order by abs(${saidas.data} - (now() at time zone 'America/Sao_Paulo')::date), ${saidas.data} desc limit ${POR_GRUPO}`)).rows as Array<{ saidaId: string; data: string; passeio: string; nome: string; codigo: string | null; status: string }>;
    return linhas.map((r) => ({
      grupo: "Reservas", titulo: r.nome,
      detalhe: [`${dataBr(r.data)} · ${r.passeio}`, r.codigo, r.status === "CANCELADA" ? "cancelada" : null].filter(Boolean).join(" · "),
      para: `/saidas/${r.saidaId}/reservas?busca=${encodeURIComponent(r.codigo || r.nome)}`,
    }));
  }
}

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
