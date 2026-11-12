import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { compararPontos } from "@bybus/core";
import { criarDb } from "../src/db/cliente.js";
import { mensagens, passeios, perfis, pessoas, pontosEmbarque, rastreioSessoes, reservas, saidas, transferDias, transferReservas, usuarios } from "../src/db/schema.js";
import { localizarHoteisTransfer } from "../src/servicos/rastreio.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

// Dois momentos do motorista (dono, 11/11/2026): VAN do transfer (hotéis) e depois o ÔNIBUS (pontos), com avisos de chegada.
let app: FastifyInstance;
let fechar: () => Promise<void>;
const KM = 0.0101;
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const pos = (lat: number, lng: number) => ({ lat, lng, precisaoM: 10, velocidade: 7, registradaEm: new Date().toISOString() });
const ids = { saida: "", hotelA: { lat: -27.45, lng: -48.40 }, hotelB: { lat: -27.45, lng: -48.40 + 6 * KM }, resA: "", resB: "", resOnibus: "", ponto: { lat: -27.6, lng: -48.5 } };
const comDb = async <T>(f: (db: ReturnType<typeof criarDb>["db"]) => Promise<T>) => {
  const { db, pool } = criarDb(DATABASE_URL);
  try { return await f(db); } finally { await pool.end(); }
};
const tipos = async (reservaId: string) => (await comDb((db) => db.select({ tipo: mensagens.tipo }).from(mensagens).where(eq(mensagens.reservaId, reservaId)))).map((m) => m.tipo).sort();

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp({ URL_PUBLICA: "https://gestao.exemplo.test" }));
  await comDb(async (db) => {
    await db.update(perfis).set({ permissoes: ["manifesto:ver", "rastreio:transmitir", "transfer:operar"] }).where(eq(perfis.codigo, "MOTORISTA"));
    const [uMot] = await db.select().from(usuarios).where(eq(usuarios.email, "motorista@bybus.test"));
    const [davi] = await db.select().from(pessoas).where(eq(pessoas.nome, "Motorista Fictício Davi"));
    await db.update(pessoas).set({ usuarioId: uMot!.id }).where(eq(pessoas.id, davi!.id));
    const [p] = await db.select({ id: passeios.id }).from(passeios).limit(1);
    const [s] = await db.insert(saidas).values({ passeioId: p!.id, data: hoje(), capacidade: 73, motoristaId: davi!.id, motorista: "Motorista Fictício Davi" }).returning();
    ids.saida = s!.id;
    // Um só ponto com coordenada (o primeiro da rota); os outros ficam sem, para a previsão parar nele.
    const pontos = (await db.select().from(pontosEmbarque).where(and(eq(pontosEmbarque.passeioId, p!.id), eq(pontosEmbarque.ativo, true)))).sort(compararPontos);
    for (const [i, pt] of pontos.entries()) await db.update(pontosEmbarque).set(i === 0 ? { latitude: ids.ponto.lat, longitude: ids.ponto.lng } : { latitude: null, longitude: null }).where(eq(pontosEmbarque.id, pt.id));
    const base = { saidaId: s!.id, canal: "BALCAO" as const, origem: "FICTICIO", pontoEmbarqueId: pontos[0]!.id };
    const [a] = await db.insert(reservas).values({ ...base, contatoNome: "Ana Hotel Fictícia", contatoTelefone: "+55 48 90000-0101" }).returning();
    const [b] = await db.insert(reservas).values({ ...base, contatoNome: "Bia Hotel Fictícia", contatoTelefone: "+55 48 90000-0102" }).returning();
    const [o] = await db.insert(reservas).values({ ...base, contatoNome: "Otto Ponto Fictício", contatoTelefone: "+55 48 90000-0103" }).returning();
    ids.resA = a!.id; ids.resB = b!.id; ids.resOnibus = o!.id;
    const [dia] = await db.insert(transferDias).values({ saidaId: s!.id, motoristaId: davi!.id, veiculoTexto: "Van fictícia" }).returning();
    await db.insert(transferReservas).values([
      { transferDiaId: dia!.id, reservaId: a!.id, ordem: 0, enderecoBusca: "Hotel Fictício A", latitude: ids.hotelA.lat, longitude: ids.hotelA.lng, localOrigem: "MANUAL" },
      { transferDiaId: dia!.id, reservaId: b!.id, ordem: 1, enderecoBusca: "Hotel Fictício B", latitude: ids.hotelB.lat, longitude: ids.hotelB.lng, localOrigem: "MANUAL" },
    ]);
  });
});
afterAll(async () => fechar());

describe("rastreio da van e do ônibus, com avisos de chegada", () => {
  it("o motorista vê os dois momentos; a van avisa 'chegando' e 'chegou' por hotel, uma vez só; o ônibus encerra a van e não avisa quem está nela", async () => {
    const mot = new Cliente(app);
    expect((await mot.login("motorista@bybus.test")).statusCode).toBe(200);
    const minhas = (await mot.req("GET", "/api/rastreio/minhas-saidas")).json() as Array<{ saidaId: string; tipo: string }>;
    expect(minhas.filter((x) => x.saidaId === ids.saida).map((x) => x.tipo)).toEqual(["TRANSFER", "ONIBUS"]);

    const van = await mot.req("POST", `/api/rastreio/saidas/${ids.saida}/iniciar`, { tipo: "TRANSFER" });
    expect(van.statusCode, van.body).toBe(201);
    expect(van.json().linksEnfileirados).toBe(0); // link do mapa do ônibus só sai com o ônibus
    const vanId = van.json().sessaoId as string;
    // A ~1 km do hotel A: chega em ~4 min → "chegando" só para o A (o B está 6 km depois).
    await mot.req("POST", `/api/rastreio/sessoes/${vanId}/posicoes`, { posicoes: [pos(ids.hotelA.lat, ids.hotelA.lng - 1 * KM)] });
    expect(await tipos(ids.resA)).toEqual(["VAN_CHEGANDO"]);
    expect(await tipos(ids.resB)).toEqual([]);
    // No hotel A: "chegou"; repetir a posição não manda de novo.
    await mot.req("POST", `/api/rastreio/sessoes/${vanId}/posicoes`, { posicoes: [{ ...pos(ids.hotelA.lat, ids.hotelA.lng), registradaEm: new Date(Date.now() + 1000).toISOString() }] });
    await mot.req("POST", `/api/rastreio/sessoes/${vanId}/posicoes`, { posicoes: [{ ...pos(ids.hotelA.lat, ids.hotelA.lng), registradaEm: new Date(Date.now() + 2000).toISOString() }] });
    expect(await tipos(ids.resA)).toEqual(["VAN_CHEGANDO", "VAN_CHEGOU"]);
    expect(await tipos(ids.resOnibus)).toEqual([]); // cliente do ponto não recebe aviso da van

    await comDb((db) => db.update(transferReservas).set({ situacao: "BUSCADO" }).where(eq(transferReservas.reservaId, ids.resA)));
    const onibus = await mot.req("POST", `/api/rastreio/saidas/${ids.saida}/iniciar`, { tipo: "ONIBUS" });
    expect(onibus.statusCode, onibus.body).toBe(201);
    const [sVan] = await comDb((db) => db.select().from(rastreioSessoes).where(eq(rastreioSessoes.id, vanId)));
    expect(sVan!.encerradaEm).not.toBeNull();
    // Ônibus a ~1 km do ponto: avisa o cliente do ponto, não os do transfer (estão na van).
    await mot.req("POST", `/api/rastreio/sessoes/${onibus.json().sessaoId}/posicoes`, { posicoes: [pos(ids.ponto.lat, ids.ponto.lng - 1 * KM)] });
    expect(await tipos(ids.resOnibus)).toEqual(["ONIBUS_CHEGANDO", "RASTREIO"]);
    expect((await tipos(ids.resA)).filter((t) => t.startsWith("ONIBUS") || t === "RASTREIO")).toEqual([]); // buscado pela van: já está a bordo
    const [m] = await comDb((db) => db.select().from(mensagens).where(and(eq(mensagens.reservaId, ids.resOnibus), eq(mensagens.tipo, "ONIBUS_CHEGANDO"))));
    expect(m!.texto).toMatch(/^Olá, Otto! O City Tour \*.+\* chega em cerca de 5 minutos ao ponto de embarque \*.+\*\.\nEsteja no ponto agora: não há tolerância para atrasos\. /);
    const [v] = await comDb((db) => db.select().from(mensagens).where(and(eq(mensagens.reservaId, ids.resA), eq(mensagens.tipo, "VAN_CHEGOU"))));
    expect(v!.texto).toMatch(/^Olá, .+! O transfer da By Bus chegou em .+ e está te esperando\./);
    expect(v!.texto).not.toMatch(/van|ônibus/i);
  });

  it("a equipe corrige o ponto do hotel no mapa colando as coordenadas; endereço novo apaga o ponto antigo", async () => {
    const admin = new Cliente(app);
    await admin.login("admin@bybus.test");
    const [tr] = await comDb((db) => db.select().from(transferReservas).where(eq(transferReservas.reservaId, ids.resB)));
    expect((await admin.req("PATCH", `/api/transfer/reservas/${tr!.id}`, { localMapa: "abc" })).statusCode).toBe(400);
    expect((await admin.req("PATCH", `/api/transfer/reservas/${tr!.id}`, { localMapa: "-27.4376, -48.4977" })).statusCode).toBe(200);
    let [x] = await comDb((db) => db.select().from(transferReservas).where(eq(transferReservas.id, tr!.id)));
    expect(x).toMatchObject({ latitude: -27.4376, longitude: -48.4977, localOrigem: "MANUAL" });
    await admin.req("PATCH", `/api/transfer/reservas/${tr!.id}`, { enderecoBusca: "Outro Hotel Fictício" });
    [x] = await comDb((db) => db.select().from(transferReservas).where(eq(transferReservas.id, tr!.id)));
    expect(x).toMatchObject({ latitude: null, longitude: null, localOrigem: null });
  });

  it("acha no mapa (OpenStreetMap) só os hotéis sem ponto, mandando só o endereço e a cidade", async () => {
    const pedidos: string[] = [];
    const buscar = (async (url: string, init?: RequestInit) => {
      pedidos.push(url);
      expect(String((init?.headers as Record<string, string>)["User-Agent"])).toMatch(/^BybusGestao\//);
      return new Response(JSON.stringify([{ lat: "-27.5", lon: "-48.45" }]), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await comDb((db) => localizarHoteisTransfer(db, ids.saida, "Florianópolis", buscar, 0));
    expect(r).toEqual({ procurados: 1, achados: 1 }); // só o B (o A já tinha ponto)
    expect(decodeURIComponent(pedidos[0]!)).toContain("q=Outro Hotel Fictício, Florianópolis, SC");
    expect(pedidos[0]).not.toMatch(/Bia|90000/);
    const [x] = await comDb((db) => db.select().from(transferReservas).where(eq(transferReservas.reservaId, ids.resB)));
    expect(x).toMatchObject({ latitude: -27.5, longitude: -48.45, localOrigem: "OSM" });
  });
});
