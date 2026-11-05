import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { and, eq, like } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { auditoria, mensagens, passageiros, passeios, perfis, pessoas, pontosEmbarque, reservas, saidas, transferBairros, usuarios, usuariosUnidades } from "../src/db/schema.js";
import { SENHA_DEMO } from "../src/db/ficticios.js";
import { gerarHashSenha } from "../src/seguranca/senha.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const ids = {} as { passeio: string; saida: string; davi: string; pontoVilla: string; pontoJur: string; pontoIng: string; pontoCach: string; pontoCana: string; r: Record<string, string> };

const comDb = async <T>(f: (db: ReturnType<typeof criarDb>["db"]) => Promise<T>) => {
  const { db, pool } = criarDb(DATABASE_URL);
  try { return await f(db); } finally { await pool.end(); }
};
async function logado(email: string) {
  const c = new Cliente(app);
  expect((await c.login(email)).statusCode).toBe(200);
  return c;
}
const adicionar = (perfil: string, perms: string[]) => comDb(async (db) => {
  const [p] = await db.select().from(perfis).where(eq(perfis.codigo, perfil));
  await db.update(perfis).set({ permissoes: [...new Set([...p!.permissoes, ...perms])] }).where(eq(perfis.codigo, perfil));
});
type Dto = { habilitado: boolean; saida: { id: string } | null; dia: { id: string; motorista: string | null; lugares: number | null } | null; encontro: { nome: string; horario: string } | null; candidatas: number; alertas: string[];
  reservas: Array<{ id: string; reservaId: string; titular: string; pax: number; assentos: number; telefone: string | null; bairro: string | null; endereco: string | null; horario: string | null; ordem: number; situacao: string; taxaCentavos: number; taxaForma: string | null; taxaSituacao: string; recebidoPor: string | null }>;
  totais: { reservas: number; pax: number; assentos: number; buscados: number; taxa: { total: number; aReceber: number; recebidoPix: number; recebidoDinheiro: number; incluidoNoPasseio: number } } };

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp({ URL_PUBLICA: "https://gestao.exemplo.test" }));
  // As permissões novas chegam aos perfis padrão pela migração de produção; aqui simulamos o mesmo UPDATE.
  await adicionar("MOTORISTA", ["transfer:operar"]);
  await adicionar("SUPERVISOR", ["transfer:gerenciar"]);
  await comDb(async (db) => {
    const [passeio] = await db.select().from(passeios).where(eq(passeios.codigo, "TODA_ILHA"));
    ids.passeio = passeio!.id;
    const pontos = await db.select().from(pontosEmbarque).where(eq(pontosEmbarque.passeioId, passeio!.id));
    const p = (t: string) => pontos.find((x) => x.nome.includes(t))!.id;
    Object.assign(ids, { pontoVilla: p("Villa Romana"), pontoJur: p("Jurerê"), pontoIng: p("Ingleses"), pontoCach: p("Cachoeira"), pontoCana: p("Canasvieiras") });
    const [uMot] = await db.select().from(usuarios).where(eq(usuarios.email, "motorista@bybus.test"));
    const [davi] = await db.select().from(pessoas).where(eq(pessoas.nome, "Motorista Fictício Davi"));
    await db.update(pessoas).set({ usuarioId: uMot!.id, telefone: "(48) 90000-0000" }).where(eq(pessoas.id, davi!.id));
    ids.davi = davi!.id;
    // Outro motorista com a mesma permissão, mas que não é o do transfer.
    const [perfilMot] = await db.select().from(perfis).where(eq(perfis.codigo, "MOTORISTA"));
    const [outro] = await db.insert(usuarios).values({ nome: "Outro Motorista Fictício", email: "outro.motorista@bybus.test", perfilId: perfilMot!.id, senhaHash: await gerarHashSenha(SENHA_DEMO), trocarSenha: false }).returning();
    await db.insert(usuariosUnidades).values({ usuarioId: outro!.id, unidadeId: passeio!.unidadeId });
    const [s] = await db.insert(saidas).values({ passeioId: passeio!.id, data: hoje(), capacidade: 73 }).returning();
    ids.saida = s!.id;
    const nova = async (chave: string, titular: string, pontoId: string | null, hospedagem: string | null, cats: Array<"ADULTO" | "INFANTIL" | "COLO">, extra: Partial<typeof reservas.$inferInsert> = {}) => {
      const [r] = await db.insert(reservas).values({ saidaId: s!.id, canal: "BALCAO", origem: "FICTICIO", contatoNome: titular, contatoTelefone: `+55 48 90000-${chave.padStart(4, "0")}`, pontoEmbarqueId: pontoId, hospedagemInformada: hospedagem, ...extra }).returning();
      await db.insert(passageiros).values(cats.map((categoria, i) => ({ reservaId: r!.id, nome: `${titular} ${i}`, categoria })));
      ids.r = { ...ids.r, [chave]: r!.id };
    };
    ids.r = {};
    await nova("1", "Paulo Jurere Fictício", ids.pontoJur, "Hotel Fictício Jurerê", ["ADULTO", "INFANTIL"], { pediuTransfer: true });
    await nova("2", "Marta Santinho Fictícia", ids.pontoIng, "Pousada Santinho Fictícia", ["ADULTO", "COLO"], { pediuTransfer: true });
    await nova("3", "Ana Ingleses Fictícia", ids.pontoIng, "Pousada Ingleses Fictícia", ["ADULTO"], { pediuTransfer: true });
    await nova("4", "Caio Cachoeira Fictício", ids.pontoCach, null, ["ADULTO", "ADULTO", "INFANTIL"], { pediuTransfer: true });
    await nova("5", "Vera Villa Fictícia", ids.pontoVilla, null, ["ADULTO"]);
    await nova("6", "Rui Canasvieiras Fictício", null, "Casa em Canasvieiras (fictícia)", ["ADULTO"], { pediuTransfer: true });
    await nova("7", "Cancelada Transfer Fictícia", ids.pontoJur, "Hotel cancelado", ["ADULTO"], { status: "CANCELADA", pediuTransfer: true });
  });
});
afterAll(async () => fechar());

describe("configuração do passeio", () => {
  it("bairros semeados dos pontos de transfer, taxa única a confirmar e Villa Romana como ponto de encontro", async () => {
    const sup = await logado("supervisor@bybus.test");
    const r = await sup.req("GET", `/api/passeios/${ids.passeio}/transfer`);
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json();
    expect(j.bairros.map((b: { nome: string }) => b.nome)).toEqual(["Ingleses", "Cachoeira do Bom Jesus", "Canasvieiras", "Jurerê"]); // bairros-base do dono (05/11); Santinho fica dentro de Ingleses
    expect(j.bairros.map((b: { ordemBusca: number }) => b.ordemBusca)).toEqual([1, 2, 3, 4]);
    expect(j.config).toMatchObject({ taxaAConfirmar: false, taxaPorPassageiroCentavos: 4500, pontoEncontroId: ids.pontoVilla });
    expect(j.bairros[0]).not.toHaveProperty("taxaCentavos"); // taxa única, não por bairro
  });

  it("só quem gerencia o transfer altera; valida ponto de encontro, motorista e nomes repetidos; audita antes e depois", async () => {
    const sup = await logado("supervisor@bybus.test");
    const atual = (await sup.req("GET", `/api/passeios/${ids.passeio}/transfer`)).json();
    const corpo = { config: { ...atual.config, motoristaPadraoId: ids.davi, veiculoPadraoTexto: "Van fictícia ZZZ0Z00", lugaresPadrao: 15, taxaPorPassageiroCentavos: 4500 }, bairros: atual.bairros };
    const atendente = await logado("atendente@bybus.test");
    expect((await atendente.req("PUT", `/api/passeios/${ids.passeio}/transfer`, corpo)).statusCode).toBe(403);
    expect((await sup.req("PUT", `/api/passeios/${ids.passeio}/transfer`, { ...corpo, config: { ...corpo.config, pontoEncontroId: ids.pontoJur } })).statusCode).toBe(400); // bairro não é ponto de encontro
    expect((await sup.req("PUT", `/api/passeios/${ids.passeio}/transfer`, { ...corpo, config: { ...corpo.config, taxaPorPassageiroCentavos: -1 } })).statusCode).toBe(400);
    expect((await sup.req("PUT", `/api/passeios/${ids.passeio}/transfer`, { ...corpo, bairros: [...atual.bairros, { nome: "ingleses", horarioReferencia: null, pontoEmbarqueId: null }] })).statusCode).toBe(400);
    expect((await sup.req("PUT", `/api/passeios/${ids.passeio}/transfer`, { ...corpo, bairros: [{ nome: "Fora", horarioReferencia: "25:99", pontoEmbarqueId: null }] })).statusCode).toBe(400);
    const ok = await sup.req("PUT", `/api/passeios/${ids.passeio}/transfer`, corpo);
    expect(ok.statusCode, ok.body).toBe(200);
    const trilha = await comDb((db) => db.select().from(auditoria).where(eq(auditoria.acao, "TRANSFER_CONFIG_ALTERADA")));
    expect(trilha).toHaveLength(1);
    expect(trilha[0]!.dados).toMatchObject({ antes: { taxaPorPassageiroCentavos: 4500 }, depois: { taxaPorPassageiroCentavos: 4500 } });
  });
});

describe("montagem do transfer do dia", () => {
  it("antes de montar mostra as reservas candidatas; leitura exige manifesto:ver e montar exige transfer:gerenciar", async () => {
    const atendente = await logado("atendente@bybus.test");
    const r = await atendente.req("GET", `/api/transfer?passeioId=${ids.passeio}&data=${hoje()}`);
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Dto;
    expect(j.habilitado).toBe(true);
    expect(j.dia).toBeNull();
    expect(j.candidatas).toBe(5); // confirmadas de transfer; a de ponto comum e a cancelada ficam de fora
    expect((await atendente.req("POST", "/api/transfer/montar", { saidaId: ids.saida })).statusCode).toBe(403);
    expect((await new Cliente(app).req("GET", `/api/transfer?passeioId=${ids.passeio}`)).statusCode).toBe(401);
  });

  it("monta em ordem de busca (do mais longe ao mais perto), com bairro, horário, taxa por passageiro com assento e padrões do passeio", async () => {
    const sup = await logado("supervisor@bybus.test");
    const r = await sup.req("POST", "/api/transfer/montar", { saidaId: ids.saida });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Dto;
    expect(j.reservas.map((x) => x.titular)).toEqual(["Ana Ingleses Fictícia", "Marta Santinho Fictícia", "Caio Cachoeira Fictício", "Rui Canasvieiras Fictício", "Paulo Jurere Fictício"]);
    expect(j.reservas.map((x) => x.bairro)).toEqual(["Ingleses", "Ingleses", "Cachoeira do Bom Jesus", "Canasvieiras", "Jurerê"]);
    // Duas buscas em Ingleses (base 06:40): a segunda 5 min depois; os bairros seguintes nunca voltam no tempo.
    expect(j.reservas.map((x) => x.horario)).toEqual(["06:40", "06:45", "06:50", "07:00", "07:10"]);
    expect(j.reservas.map((x) => x.ordem)).toEqual([0, 1, 2, 3, 4]);
    // colo não paga: Marta (adulto + colo) = 1 assento
    expect(j.reservas.map((x) => x.taxaCentavos)).toEqual([4500, 4500, 13500, 4500, 9000]);
    expect(j.reservas.find((x) => x.titular.startsWith("Marta"))).toMatchObject({ pax: 2, assentos: 1, endereco: "Pousada Santinho Fictícia" });
    expect(j.totais).toMatchObject({ reservas: 5, pax: 9, assentos: 8, taxa: { total: 36000, aReceber: 36000 } });
    expect(j.dia).toMatchObject({ motorista: "Motorista Fictício Davi", lugares: 15 });
    expect(j.encontro?.nome).toBe("Villa Romana Shopping");
    expect(j.candidatas).toBe(0);
    // Montar de novo não duplica nem mexe no que já está.
    const de_novo = (await sup.req("POST", "/api/transfer/montar", { saidaId: ids.saida })).json() as Dto;
    expect(de_novo.reservas).toHaveLength(5);
    expect(de_novo.reservas.map((x) => x.id)).toEqual(j.reservas.map((x) => x.id));
  });

  it("escopo de praça: supervisor de outra praça não vê nem monta", async () => {
    const bc = await logado("supervisor.bc@bybus.test");
    expect((await bc.req("GET", `/api/transfer?passeioId=${ids.passeio}&data=${hoje()}`)).statusCode).toBe(404);
    expect((await bc.req("POST", "/api/transfer/montar", { saidaId: ids.saida })).statusCode).toBe(404);
    expect((await bc.req("GET", `/api/transfer/texto?saidaId=${ids.saida}`)).statusCode).toBe(404);
    expect(((await bc.req("GET", "/api/transfer/passeios")).json() as unknown[])).toHaveLength(0);
    const sup = await logado("supervisor@bybus.test");
    expect(((await sup.req("GET", "/api/transfer/passeios")).json() as Array<{ id: string }>).map((x) => x.id)).toContain(ids.passeio);
    const dto = (await sup.req("GET", `/api/transfer?passeioId=${ids.passeio}&data=${hoje()}`)).json() as Dto;
    const idParada = dto.reservas[0]!.id;
    expect((await bc.req("POST", `/api/transfer/reservas/${idParada}/situacao`, { situacao: "BUSCADO" })).statusCode).toBe(404);
    expect((await bc.req("PATCH", `/api/transfer/dias/${dto.dia!.id}`, { lugares: 10 })).statusCode).toBe(404);
  });
});

describe("ordem e edição", () => {
  const pegar = async (c: Cliente) => (await c.req("GET", `/api/transfer?passeioId=${ids.passeio}&data=${hoje()}`)).json() as Dto;

  it("mover para outra posição recalcula horários; recalcular ordem volta ao automático; limites validados", async () => {
    const sup = await logado("supervisor@bybus.test");
    let j = await pegar(sup);
    const jurere = j.reservas.find((x) => x.bairro === "Jurerê")!;
    expect((await sup.req("POST", `/api/transfer/reservas/${jurere.id}/mover`, { posicao: -1 })).statusCode).toBe(400);
    const m = await sup.req("POST", `/api/transfer/reservas/${jurere.id}/mover`, { posicao: 0 });
    expect(m.statusCode, m.body).toBe(200);
    j = m.json() as Dto;
    expect(j.reservas[0]!.bairro).toBe("Jurerê");
    expect(j.reservas.map((x) => x.ordem)).toEqual([0, 1, 2, 3, 4]);
    // Posição além do fim vai para o último lugar.
    j = (await sup.req("POST", `/api/transfer/reservas/${jurere.id}/mover`, { posicao: 99 })).json() as Dto;
    expect(j.reservas.at(-1)!.bairro).toBe("Jurerê");
    // Subir um (Canasvieiras antes de Cachoeira) e voltar ao automático.
    const cana = j.reservas.find((x) => x.bairro === "Canasvieiras")!;
    j = (await sup.req("POST", `/api/transfer/reservas/${cana.id}/mover`, { posicao: 2 })).json() as Dto;
    expect(j.reservas.map((x) => x.bairro)).toEqual(["Ingleses", "Ingleses", "Canasvieiras", "Cachoeira do Bom Jesus", "Jurerê"]);
    const rec = await sup.req("POST", `/api/transfer/dias/${j.dia!.id}/recalcular-ordem`);
    expect((rec.json() as Dto).reservas.map((x) => x.bairro)).toEqual(["Ingleses", "Ingleses", "Cachoeira do Bom Jesus", "Canasvieiras", "Jurerê"]);
    expect((await comDb((db) => db.select().from(auditoria).where(eq(auditoria.acao, "TRANSFER_ORDEM_ALTERADA")))).length).toBeGreaterThanOrEqual(3);
  });

  it("horário e hotel digitados à mão sobrevivem ao recálculo; voltar para vazio retorna ao automático", async () => {
    const sup = await logado("supervisor@bybus.test");
    const j = await pegar(sup);
    const ana = j.reservas.find((x) => x.titular.startsWith("Ana"))!;
    expect((await sup.req("PATCH", `/api/transfer/reservas/${ana.id}`, { horarioBusca: "6:42" })).statusCode).toBe(400);
    const ok = await sup.req("PATCH", `/api/transfer/reservas/${ana.id}`, { horarioBusca: "06:42", enderecoBusca: "Pousada Ingleses Fictícia — portão azul" });
    expect(ok.statusCode, ok.body).toBe(200);
    let n = (await sup.req("POST", `/api/transfer/dias/${j.dia!.id}/recalcular-ordem`)).json() as Dto;
    expect(n.reservas.find((x) => x.id === ana.id)).toMatchObject({ horario: "06:42", endereco: "Pousada Ingleses Fictícia — portão azul" });
    n = (await sup.req("PATCH", `/api/transfer/reservas/${ana.id}`, { horarioBusca: null })).json() as Dto;
    expect(n.reservas.find((x) => x.id === ana.id)!.horario).toBe("06:40"); // volta ao automático: primeira busca de Ingleses
  });
});

describe("cobrança da taxa", () => {
  const pegar = async (c: Cliente) => (await c.req("GET", `/api/transfer?passeioId=${ids.passeio}&data=${hoje()}`)).json() as Dto;

  it("gestão altera o valor com auditoria antes/depois; valor negativo ou fora do limite é recusado; incluído no passeio zera o a receber", async () => {
    const sup = await logado("supervisor@bybus.test");
    const j = await pegar(sup);
    const rui = j.reservas.find((x) => x.titular.startsWith("Rui"))!;
    expect((await sup.req("PATCH", `/api/transfer/reservas/${rui.id}`, { taxaCentavos: -5 })).statusCode).toBe(400);
    expect((await sup.req("PATCH", `/api/transfer/reservas/${rui.id}`, { taxaCentavos: 99_999_999 })).statusCode).toBe(400);
    const ok = await sup.req("PATCH", `/api/transfer/reservas/${rui.id}`, { taxaCentavos: 3500 });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json() as Dto).reservas.find((x) => x.id === rui.id)!.taxaCentavos).toBe(3500);
    const trilha = await comDb((db) => db.select().from(auditoria).where(eq(auditoria.acao, "TRANSFER_COBRANCA_ALTERADA")));
    expect(trilha.some((a) => (a.dados as { taxaAntes?: number; taxaDepois?: number })?.taxaAntes === 4500 && (a.dados as { taxaDepois?: number }).taxaDepois === 3500)).toBe(true);
    // Valor ajustado à mão não é sobrescrito quando a reserva é recalculada.
    await comDb((db) => db.update(reservas).set({ contatoNome: "Rui Canasvieiras Fictício" }).where(eq(reservas.id, rui.reservaId)));
    const montar = (await sup.req("POST", "/api/transfer/montar", { saidaId: ids.saida })).json() as Dto;
    expect(montar.reservas.find((x) => x.id === rui.id)!.taxaCentavos).toBe(3500);
    // Cobrado junto do passeio.
    const inc = (await sup.req("PATCH", `/api/transfer/reservas/${rui.id}`, { incluidoNoPasseio: true })).json() as Dto;
    expect(inc.reservas.find((x) => x.id === rui.id)).toMatchObject({ taxaForma: "INCLUIDO_NO_PASSEIO", taxaSituacao: "RECEBIDO", recebidoPor: null });
    expect(inc.totais.taxa.incluidoNoPasseio).toBe(3500);
    expect((await sup.req("PATCH", `/api/transfer/reservas/${rui.id}`, { taxaCentavos: 100 })).statusCode).toBe(409);
    const volta = (await sup.req("PATCH", `/api/transfer/reservas/${rui.id}`, { incluidoNoPasseio: false })).json() as Dto;
    expect(volta.reservas.find((x) => x.id === rui.id)).toMatchObject({ taxaForma: null, taxaSituacao: "A_RECEBER" });
  });
});

describe("motorista do transfer (celular)", () => {
  const pegar = async (c: Cliente) => (await c.req("GET", `/api/transfer?passeioId=${ids.passeio}&data=${hoje()}`)).json() as Dto;

  it("vê só o transfer em que está escalado, sem telefone dos clientes", async () => {
    const m = await logado("motorista@bybus.test");
    const r = await m.req("GET", "/api/transfer/motorista");
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as { transfers: Dto[] };
    expect(j.transfers).toHaveLength(1);
    expect(j.transfers[0]!.reservas).toHaveLength(5);
    expect(j.transfers[0]!.reservas.every((x) => x.telefone === null)).toBe(true);
    const outro = await logado("outro.motorista@bybus.test");
    expect(((await outro.req("GET", "/api/transfer/motorista")).json() as { transfers: unknown[] }).transfers).toHaveLength(0);
    // Quem não tem a permissão de operar não acessa a tela do motorista.
    const atendente = await logado("atendente@bybus.test");
    expect((await atendente.req("GET", "/api/transfer/motorista")).statusCode).toBe(403);
  });

  it("marca buscado e não apareceu; só o motorista do dia; não mexe em ordem, valores nem situação administrativa", async () => {
    const sup = await logado("supervisor@bybus.test");
    const m = await logado("motorista@bybus.test");
    const outro = await logado("outro.motorista@bybus.test");
    const j = await pegar(sup);
    const [p1, p2, p3] = j.reservas;
    expect((await outro.req("POST", `/api/transfer/reservas/${p1!.id}/situacao`, { situacao: "BUSCADO" })).statusCode).toBe(403);
    expect((await m.req("POST", `/api/transfer/reservas/${p1!.id}/situacao`, { situacao: "INVENTADA" })).statusCode).toBe(400);
    expect((await m.req("POST", `/api/transfer/reservas/${p1!.id}/situacao`, { situacao: "A_CONFIRMAR" })).statusCode).toBe(403);
    const ok = await m.req("POST", `/api/transfer/reservas/${p1!.id}/situacao`, { situacao: "BUSCADO" });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json() as Dto).totais.buscados).toBe(1);
    expect((await m.req("POST", `/api/transfer/reservas/${p2!.id}/situacao`, { situacao: "NAO_APARECEU" })).statusCode).toBe(200);
    expect((await sup.req("POST", `/api/transfer/reservas/${p3!.id}/situacao`, { situacao: "CONFIRMADO" })).statusCode).toBe(200);
    // O motorista não edita nem reordena.
    expect((await m.req("PATCH", `/api/transfer/reservas/${p1!.id}`, { taxaCentavos: 1 })).statusCode).toBe(403);
    expect((await m.req("POST", `/api/transfer/reservas/${p1!.id}/mover`, { posicao: 0 })).statusCode).toBe(403);
    expect((await m.req("POST", "/api/transfer/montar", { saidaId: ids.saida })).statusCode).toBe(403);
    const trilha = await comDb((db) => db.select().from(auditoria).where(eq(auditoria.acao, "TRANSFER_SITUACAO_ALTERADA")));
    expect(trilha.some((a) => (a.dados as { antes?: string; depois?: string })?.antes === "A_CONFIRMAR" && (a.dados as { depois?: string }).depois === "BUSCADO")).toBe(true);
  });

  it("registra a taxa recebida (PIX ou dinheiro), uma vez só, com o valor exato; gestão estorna", async () => {
    const sup = await logado("supervisor@bybus.test");
    const m = await logado("motorista@bybus.test");
    const outro = await logado("outro.motorista@bybus.test");
    const j = await pegar(sup);
    const caio = j.reservas.find((x) => x.titular.startsWith("Caio"))!;
    expect(caio.taxaCentavos).toBe(13500);
    expect((await outro.req("POST", `/api/transfer/reservas/${caio.id}/recebimento`, { forma: "PIX" })).statusCode).toBe(403);
    expect((await m.req("POST", `/api/transfer/reservas/${caio.id}/recebimento`, { forma: "CARTAO" })).statusCode).toBe(400);
    expect((await m.req("POST", `/api/transfer/reservas/${caio.id}/recebimento`, { forma: "PIX", valorCentavos: 13499 })).statusCode).toBe(400);
    const ok = await m.req("POST", `/api/transfer/reservas/${caio.id}/recebimento`, { forma: "PIX", valorCentavos: 13500 });
    expect(ok.statusCode, ok.body).toBe(200);
    const d = ok.json() as Dto;
    expect(d.reservas.find((x) => x.id === caio.id)).toMatchObject({ taxaSituacao: "RECEBIDO", taxaForma: "PIX", recebidoPor: "Motorista Demo" });
    expect(d.totais.taxa.recebidoPix).toBe(13500);
    expect((await m.req("POST", `/api/transfer/reservas/${caio.id}/recebimento`, { forma: "DINHEIRO" })).statusCode).toBe(409);
    // Em dinheiro, outra reserva.
    const ana = j.reservas.find((x) => x.titular.startsWith("Ana"))!;
    const din = (await m.req("POST", `/api/transfer/reservas/${ana.id}/recebimento`, { forma: "DINHEIRO" })).json() as Dto;
    expect(din.totais.taxa).toMatchObject({ recebidoPix: 13500, recebidoDinheiro: 4500 });
    // Estorno só pela gestão.
    expect((await m.req("POST", `/api/transfer/reservas/${ana.id}/estornar`)).statusCode).toBe(403);
    const est = (await sup.req("POST", `/api/transfer/reservas/${ana.id}/estornar`)).json() as Dto;
    expect(est.reservas.find((x) => x.id === ana.id)).toMatchObject({ taxaSituacao: "A_RECEBER", taxaForma: null });
    expect((await sup.req("POST", `/api/transfer/reservas/${ana.id}/estornar`)).statusCode).toBe(409);
    const trilha = await comDb((db) => db.select().from(auditoria).where(like(auditoria.acao, "TRANSFER_TAXA_%")));
    expect(trilha.map((a) => a.acao).sort()).toEqual(["TRANSFER_TAXA_ESTORNADA", "TRANSFER_TAXA_RECEBIDA", "TRANSFER_TAXA_RECEBIDA"]);
    expect(trilha.find((a) => a.acao === "TRANSFER_TAXA_RECEBIDA")!.dados).toMatchObject({ forma: "PIX", valorCentavos: 13500 });
  });
});

describe("lista do transfer e lista de passageiros", () => {
  it("lista do transfer: telefone só para quem tem manifesto:contatos; mostra taxa a cobrar e paga", async () => {
    const sup = await logado("supervisor@bybus.test");
    const m = await logado("motorista@bybus.test");
    const comTel = (await sup.req("GET", `/api/transfer/texto?saidaId=${ids.saida}`)).json().texto as string;
    expect(comTel).toContain("+55 48 90000-");
    expect(comTel).toContain("Encontro com o ônibus: Villa Romana Shopping");
    expect(comTel).toMatch(/cobrar R\$ \d/);
    expect(comTel).toContain("pago (PIX)");
    const semTel = (await m.req("GET", `/api/transfer/texto?saidaId=${ids.saida}`)).json().texto as string;
    expect(semTel).not.toContain("+55");
    expect(semTel.indexOf("Santinho")).toBeLessThan(semTel.indexOf("Jurerê")); // ordem de busca
  });

  it("lista de passageiros: 'via transfer' e ponto de encontro (texto e manifesto), sem duplicar passageiro", async () => {
    const sup = await logado("supervisor@bybus.test");
    const t = (await sup.req("GET", `/api/saidas/${ids.saida}/texto-lista`)).json().texto as string;
    expect(t).toContain("via transfer (Jurerê)");
    expect(t).toContain("embarcam todos em Villa Romana Shopping");
    expect(t).toContain("09. Vera Villa Fictícia 0 · A\n"); // quem não é de transfer não ganha a marca
    expect(t.match(/Paulo Jurere Fictício 0/g)).toHaveLength(1);
    expect(t).toContain("Via transfer: 9 passageiro(s)");
    const man = (await sup.req("GET", `/api/saidas/${ids.saida}/manifesto`)).json();
    expect(man.transfer.encontro.nome).toBe("Villa Romana Shopping");
    expect(Object.keys(man.transfer.reservas)).toHaveLength(5);
    const nomes = man.manifesto.blocos.flatMap((b: { linhas: Array<{ passageiro: { id: string } }> }) => b.linhas.map((l) => l.passageiro.id));
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});

describe("o transfer acompanha mudanças da reserva", () => {
  const pegar = async (c: Cliente) => (await c.req("GET", `/api/transfer?passeioId=${ids.passeio}&data=${hoje()}`)).json() as Dto;

  it("trocar para um ponto comum tira do transfer; voltar traz de volta; cancelar tira", async () => {
    const sup = await logado("supervisor@bybus.test");
    const rid = ids.r["3"]!;
    expect((await sup.req("PATCH", `/api/reservas/${rid}`, { pontoEmbarqueId: ids.pontoVilla })).statusCode).toBe(200);
    expect((await pegar(sup)).reservas.some((x) => x.reservaId === rid)).toBe(false);
    expect((await sup.req("PATCH", `/api/reservas/${rid}`, { pontoEmbarqueId: ids.pontoIng })).statusCode).toBe(200);
    expect((await pegar(sup)).reservas.some((x) => x.reservaId === rid)).toBe(true);
    expect((await sup.req("PATCH", `/api/reservas/${rid}`, { status: "CANCELADA" })).statusCode).toBe(200);
    expect((await pegar(sup)).reservas.some((x) => x.reservaId === rid)).toBe(false);
    await sup.req("PATCH", `/api/reservas/${rid}`, { status: "CONFIRMADA" });
    expect((await pegar(sup)).reservas.some((x) => x.reservaId === rid)).toBe(true);
  });

  it("conferência troca de ponto: o bairro e a posição acompanham", async () => {
    const sup = await logado("supervisor@bybus.test");
    const rid = ids.r["4"]!; // Cachoeira
    const r = await sup.req("POST", `/api/reservas/${rid}/conferir`, { pontoEmbarqueId: ids.pontoCana });
    expect(r.statusCode, r.body).toBe(200);
    const j = await pegar(sup);
    expect(j.reservas.find((x) => x.reservaId === rid)!.bairro).toBe("Canasvieiras");
    const bairros = j.reservas.filter((x) => !x.titular.startsWith("Ana") || true).map((x) => x.bairro);
    const iCana = bairros.indexOf("Canasvieiras");
    expect(bairros.slice(iCana).every((b) => b === "Canasvieiras" || b === "Jurerê")).toBe(true);
  });

  it("cliente informa o hotel pelo link: o endereço de busca é atualizado (e o ajustado à mão, não)", async () => {
    const sup = await logado("supervisor@bybus.test");
    const rid = ids.r["6"]!;
    const link = await sup.req("POST", `/api/reservas/${rid}/link-embarque`);
    expect(link.statusCode, link.body).toBe(200);
    const token = String(link.json().caminho).split("/").pop()!;
    const pub = new Cliente(app);
    const resp = await pub.req("POST", `/api/publico/embarque/${token}`, { pontoId: ids.pontoCana, hospedagem: "Hotel Novo Fictício, Canasvieiras" });
    expect(resp.statusCode, resp.body).toBe(200);
    expect((await pegar(sup)).reservas.find((x) => x.reservaId === rid)).toMatchObject({ endereco: "Hotel Novo Fictício, Canasvieiras", bairro: "Canasvieiras" });
    // Ajuste manual do hotel passa a valer sobre o do cliente.
    const j = await pegar(sup);
    const par = j.reservas.find((x) => x.reservaId === rid)!;
    await sup.req("PATCH", `/api/transfer/reservas/${par.id}`, { enderecoBusca: "Hotel corrigido pela equipe" });
    await pub.req("POST", `/api/publico/embarque/${token}`, { pontoId: ids.pontoCana, hospedagem: "Outro texto do cliente" });
    expect((await pegar(sup)).reservas.find((x) => x.reservaId === rid)!.endereco).toBe("Hotel corrigido pela equipe");
  });

  it("passageiro de colo não aumenta a taxa; adulto novo aumenta (taxa automática)", async () => {
    const sup = await logado("supervisor@bybus.test");
    const rid = ids.r["2"]!; // Marta: adulto + colo = 4500
    const antes = (await pegar(sup)).reservas.find((x) => x.reservaId === rid)!;
    expect(antes.taxaCentavos).toBe(4500);
    await sup.req("POST", `/api/reservas/${rid}/passageiros`, { nome: "Bebê Fictício", categoria: "COLO" });
    expect((await pegar(sup)).reservas.find((x) => x.reservaId === rid)!.taxaCentavos).toBe(4500);
    await sup.req("POST", `/api/reservas/${rid}/passageiros`, { nome: "Adulto Fictício", categoria: "ADULTO" });
    expect((await pegar(sup)).reservas.find((x) => x.reservaId === rid)!.taxaCentavos).toBe(9000);
  });
});

describe("fechamento da lista", () => {
  it("o fechamento monta o transfer, manda a lista ao motorista do transfer (simulado) sem telefones e não duplica", async () => {
    const sup = await logado("supervisor@bybus.test");
    const r = await sup.req("POST", `/api/saidas/${ids.saida}/fechar`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().texto).toContain("via transfer");
    const msgs = await comDb((db) => db.select().from(mensagens).where(and(eq(mensagens.saidaId, ids.saida), like(mensagens.tipo, "TRANSFER_V%"))));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.status).toBe("SIMULADA"); // WhatsApp em modo simulado: nada sai de verdade
    expect(msgs[0]!.destino).toBe("5548900000000");
    expect(msgs[0]!.texto).toContain("TRANSFER —");
    expect(msgs[0]!.texto).not.toContain("+55");
    expect(msgs[0]!.texto).not.toMatch(/90000-\d{4}/);
  });

  it("saída sem reservas de transfer não cria transfer nem mensagem", async () => {
    const sup = await logado("supervisor@bybus.test");
    const data = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const saidaId = await comDb(async (db) => {
      const [s] = await db.insert(saidas).values({ passeioId: ids.passeio, data, capacidade: 73 }).returning();
      const [r] = await db.insert(reservas).values({ saidaId: s!.id, canal: "BALCAO", origem: "FICTICIO", contatoNome: "Sem Transfer Fictício", pontoEmbarqueId: ids.pontoVilla }).returning();
      await db.insert(passageiros).values({ reservaId: r!.id, nome: "Sem Transfer Fictício", categoria: "ADULTO" });
      return s!.id;
    });
    const r = await sup.req("POST", `/api/saidas/${saidaId}/fechar`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().texto).not.toContain("via transfer");
    expect(await comDb((db) => db.select().from(mensagens).where(and(eq(mensagens.saidaId, saidaId), like(mensagens.tipo, "TRANSFER_V%"))))).toHaveLength(0);
    const t = (await sup.req("GET", `/api/transfer?passeioId=${ids.passeio}&data=${data}`)).json() as Dto;
    expect(t.dia).toBeNull();
    expect((await sup.req("GET", `/api/transfer/texto?saidaId=${saidaId}`)).statusCode).toBe(404);
    // Sem saída na data: resposta vazia, sem erro.
    const vazio = (await sup.req("GET", `/api/transfer?passeioId=${ids.passeio}&data=2031-01-01`)).json() as Dto;
    expect(vazio.saida).toBeNull();
  });
});

describe("privacidade", () => {
  it("a auditoria do transfer não guarda hotel, nome nem telefone", async () => {
    const trilha = await comDb((db) => db.select().from(auditoria).where(like(auditoria.acao, "TRANSFER_%")));
    expect(trilha.length).toBeGreaterThan(5);
    const texto = JSON.stringify(trilha.map((a) => a.dados));
    expect(texto).not.toMatch(/Hotel|Pousada|Fictíci|\+55|90000-/);
    const bairros = await comDb((db) => db.select().from(transferBairros).where(eq(transferBairros.passeioId, ids.passeio)));
    expect(bairros).toHaveLength(4);
  });
});
