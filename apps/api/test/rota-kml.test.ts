import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { passeios, pontosEmbarque } from "../src/db/schema.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

// Rota do mapa (.kml do Google My Maps, 11/11/2026). Coordenadas fictícias.
let app: FastifyInstance;
let fechar: () => Promise<void>;
let passeioId = "";
const KML = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>Rota</name><Placemark><name>Trajeto</name><LineString><coordinates>-48.515,-27.590,0 -48.530,-27.586,0 -48.544,-27.583,0 -48.550,-27.587,0 -48.555,-27.592,0</coordinates></LineString></Placemark></Folder>
<Folder><name>Pontos de embarque</name>
<Placemark><name>1 - Início do Passeio às 8h no Villa Romana shopping</name><Point><coordinates>-48.5154,-27.5902,0</coordinates></Point></Placemark>
<Placemark><name>2 - Embarque às 8h15 nos fundos do Hotel Majestic</name><Point><coordinates>-48.5443,-27.5836,0</coordinates></Point></Placemark>
<Placemark><name>Mirante fictício</name><Point><coordinates>-48.43,-27.59,0</coordinates></Point></Placemark>
</Folder></Document></kml>`;

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
  const { db, pool } = criarDb(DATABASE_URL);
  passeioId = (await db.select().from(passeios).where(eq(passeios.codigo, "TODA_ILHA")))[0]!.id;
  await pool.end();
});
afterAll(async () => fechar());

describe("rota do mapa (.kml)", () => {
  it("prévia casa os pontos pelo nome; confirmar grava as coordenadas e o traçado; quem não gerencia pontos não importa", async () => {
    const admin = new Cliente(app);
    await admin.login("admin@bybus.test");
    const previa = (await admin.req("POST", `/api/passeios/${passeioId}/rota-kml`, { conteudo: KML })).json();
    expect(previa.gravado).toBe(false);
    const villa = previa.pontos.find((p: { nome: string }) => p.nome === "Villa Romana Shopping");
    expect(villa.novo).toMatchObject({ lat: -27.5902, lng: -48.5154 });
    expect(previa.pontos.find((p: { nome: string }) => p.nome === "Hotel Majestic (fundos)").novo).toMatchObject({ lat: -27.5836 });
    expect(previa.pontos.find((p: { nome: string }) => p.nome === "Hotel Ibis").novo).toBeNull();
    expect(previa.naoUsados).toEqual(["Mirante fictício"]);
    expect(previa.tracado.pontos).toBe(5);
    const g = await admin.req("POST", `/api/passeios/${passeioId}/rota-kml`, { conteudo: KML, confirmar: true });
    expect(g.json().gravado).toBe(true);
    const { db, pool } = criarDb(DATABASE_URL);
    const [p] = await db.select().from(pontosEmbarque).where(eq(pontosEmbarque.id, villa.id));
    const [ps] = await db.select({ tracado: passeios.tracado }).from(passeios).where(eq(passeios.id, passeioId));
    await pool.end();
    expect(p).toMatchObject({ latitude: -27.5902, longitude: -48.5154 });
    expect(ps!.tracado).toHaveLength(5);
    expect((await admin.req("POST", `/api/passeios/${passeioId}/rota-kml`, { conteudo: "<kml></kml> sem nada aqui dentro" })).statusCode).toBe(400);
    const atendente = new Cliente(app);
    await atendente.login("atendente@bybus.test");
    expect((await atendente.req("POST", `/api/passeios/${passeioId}/rota-kml`, { conteudo: KML })).statusCode).toBe(403);
  });
});
