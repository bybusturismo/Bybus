import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { lerConfig } from "../src/config.js";
import { criarDb } from "../src/db/cliente.js";
import { mensagens, passageiros, passeios, pontosEmbarque, reservas, saidas } from "../src/db/schema.js";
import { rodarConfirmacaoVespera } from "../src/servicos/confirmacao.js";
import { fecharLista } from "../src/servicos/fechamento.js";
import { Cofre } from "../src/seguranca/cripto.js";
import { CHAVE, Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

// Véspera fixa: 10/03/2027 (quarta). "Amanhã" = 11/03/2027. Horas em Brasília (UTC−3).
const DATA = "2027-03-11";
const as = (hora: string) => new Date(`2027-03-10T${hora}:00-03:00`);
const config = lerConfig({ AMBIENTE: "testes", DATABASE_URL, CHAVE_CRIPTOGRAFIA: CHAVE, EXIGIR_MFA_ADMIN: "false", URL_PUBLICA: "https://gestao.exemplo.test" });

let app: FastifyInstance;
let fechar: () => Promise<void>;
const { db, pool } = criarDb(DATABASE_URL);
const ids = {} as { passeio: string; villa: string; saidaA: string; saidaB: string };

async function novaReserva(saidaId: string, n: number, pagamento: "PAGO" | "A_PAGAR", extra: Partial<typeof reservas.$inferInsert> = {}) {
  const [r] = await db.insert(reservas).values({ saidaId, canal: "BALCAO", origem: "FICTICIO", contatoNome: `Cliente Fictício ${n}`, contatoTelefone: `+55 48 90000-${String(n).padStart(4, "0")}`, pagamento, pontoEmbarqueId: ids.villa, ...extra }).returning();
  await db.insert(passageiros).values({ reservaId: r!.id, nome: `Cliente Fictício ${n}`, categoria: "ADULTO" });
  return r!.id;
}
const tipos = async (saidaId: string) => (await db.select({ tipo: mensagens.tipo, reservaId: mensagens.reservaId, texto: mensagens.texto }).from(mensagens).where(eq(mensagens.saidaId, saidaId)));

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp({ URL_PUBLICA: "https://gestao.exemplo.test" }));
  const [p] = await db.select().from(passeios).where(eq(passeios.codigo, "TODA_ILHA"));
  ids.passeio = p!.id;
  const [villa] = await db.select().from(pontosEmbarque).where(and(eq(pontosEmbarque.passeioId, p!.id), eq(pontosEmbarque.ehTransfer, false)));
  ids.villa = villa!.id;
  // Saída A: 6 pagas + 4 pendentes (não atinge os cortes). Saída B (outro passeio do mesmo dia não existe: usamos outra data depois).
  const [a] = await db.insert(saidas).values({ passeioId: p!.id, data: DATA, capacidade: 73 }).returning();
  ids.saidaA = a!.id;
  for (let i = 1; i <= 6; i++) await novaReserva(a!.id, i, "PAGO");
  for (let i = 7; i <= 10; i++) await novaReserva(a!.id, i, "A_PAGAR", i === 10 ? { pontoEmbarqueId: null } : {});
});
afterAll(async () => { await fechar(); await pool.end(); });

describe("confirmação da véspera em duas etapas", () => {
  it("antes da hora da prévia não faz nada", async () => {
    await rodarConfirmacaoVespera(db, config, as("08:30"));
    expect(await tipos(ids.saidaA)).toHaveLength(0);
  });

  it("abaixo dos cortes: manda a prévia uma vez e pede o ponto a quem não tem", async () => {
    const r = await rodarConfirmacaoVespera(db, config, as("09:00"));
    expect(r.confirmadas).toBe(0);
    const m = await tipos(ids.saidaA);
    expect(m).toHaveLength(10);
    expect(m.every((x) => x.tipo === "PREVIA")).toBe(true);
    expect(m.filter((x) => x.texto.includes("/embarque/"))).toHaveLength(1);
    await rodarConfirmacaoVespera(db, config, as("09:30"));
    expect(await tipos(ids.saidaA)).toHaveLength(10); // não repete
    const [s] = await db.select().from(saidas).where(eq(saidas.id, ids.saidaA));
    expect(s!.confirmadaEm).toBeNull();
  });

  it("ao atingir o corte durante o dia, confirma sozinha e manda a confirmação completa (sem gerar outro link)", async () => {
    for (let i = 11; i <= 14; i++) await novaReserva(ids.saidaA, i, "PAGO"); // 10 pagas
    const r = await rodarConfirmacaoVespera(db, config, as("13:00"));
    expect(r.confirmadas).toBe(1);
    const [s] = await db.select().from(saidas).where(eq(saidas.id, ids.saidaA));
    expect(s!.confirmadaEm).not.toBeNull();
    expect(s!.confirmadaAutomatica).toBe(true);
    const conf = (await tipos(ids.saidaA)).filter((x) => x.tipo === "CONFIRMACAO");
    expect(conf).toHaveLength(14);
    expect(conf.some((x) => x.texto.includes("link que enviamos mais cedo"))).toBe(true);
    expect(conf.some((x) => x.texto.includes("/embarque/"))).toBe(false);
    expect(conf.every((x) => x.texto.includes("está confirmado"))).toBe(true);
    // Os 4 novos não recebem prévia (já foram direto para a confirmação).
    expect((await tipos(ids.saidaA)).filter((x) => x.tipo === "PREVIA")).toHaveLength(10);
  });

  it("venda nova depois da confirmação recebe a confirmação na rodada seguinte", async () => {
    const nova = await novaReserva(ids.saidaA, 15, "A_PAGAR");
    await rodarConfirmacaoVespera(db, config, as("15:00"));
    expect((await tipos(ids.saidaA)).filter((x) => x.tipo === "CONFIRMACAO" && x.reservaId === nova)).toHaveLength(1);
  });

  it("o fechamento das 21h não reenvia a quem já recebeu", async () => {
    const antes = (await tipos(ids.saidaA)).filter((x) => x.tipo === "CONFIRMACAO").length;
    await fecharLista(db, new Cofre(CHAVE), config, ids.saidaA, { usuarioId: null, automatico: true });
    expect((await tipos(ids.saidaA)).filter((x) => x.tipo === "CONFIRMACAO").length).toBe(antes);
  });

  it("tela: regras editáveis por quem decide; confirmar manualmente; situação na lista", async () => {
    const [b] = await db.insert(saidas).values({ passeioId: ids.passeio, data: "2027-03-12", capacidade: 73 }).returning();
    ids.saidaB = b!.id;
    await novaReserva(b!.id, 21, "A_PAGAR");
    const admin = new Cliente(app);
    expect((await admin.login("admin@bybus.test")).statusCode).toBe(200);
    const sit = (await admin.req("GET", "/api/fechamento?data=2027-03-12")).json();
    expect(sit.regrasConfirmacao.pagasParaConfirmar).toBe(10);
    const linha = sit.saidas.find((x: { saidaId: string }) => x.saidaId === b!.id);
    expect(linha.confirmacao).toMatchObject({ pagas: 0, pendentes: 1 });
    expect(["AGUARDAR", "DECIDIR"]).toContain(linha.confirmacao.decisao);

    const regras = { ligado: true, contarPor: "PASSAGEIROS", pagasParaConfirmar: 12, totalParaConfirmar: 20, pagasMinimasNoTotal: 10, horaPrevia: "08:30", horaLimite: "17:30" };
    expect((await admin.req("PUT", "/api/confirmacao/regras", { ...regras, horaPrevia: "18:00" })).statusCode).toBe(400);
    expect((await admin.req("PUT", "/api/confirmacao/regras", { ...regras, horaLimite: "22:00", horaPrevia: "21:30" })).statusCode).toBe(400);
    expect((await admin.req("PUT", "/api/confirmacao/regras", regras)).statusCode).toBe(200);
    expect((await admin.req("GET", "/api/fechamento?data=2027-03-12")).json().regrasConfirmacao).toMatchObject(regras);

    const guia = new Cliente(app);
    expect((await guia.login("guia@bybus.test")).statusCode).toBe(200);
    expect((await guia.req("PUT", "/api/confirmacao/regras", regras)).statusCode).toBe(403);
    expect((await guia.req("POST", `/api/saidas/${b!.id}/confirmar`)).statusCode).toBe(403);

    const c = (await admin.req("POST", `/api/saidas/${b!.id}/confirmar`)).json();
    expect(c).toMatchObject({ jaEstava: false, enviadas: 1 });
    const [sb] = await db.select().from(saidas).where(eq(saidas.id, b!.id));
    expect(sb!.confirmadaAutomatica).toBe(false);
    expect((await admin.req("POST", `/api/saidas/${b!.id}/confirmar`)).json()).toMatchObject({ jaEstava: true, enviadas: 0 });
  });

  it("regras desligadas: nada é avaliado", async () => {
    const admin = new Cliente(app);
    await admin.login("admin@bybus.test");
    await admin.req("PUT", "/api/confirmacao/regras", { ligado: false, contarPor: "RESERVAS", pagasParaConfirmar: 10, totalParaConfirmar: 16, pagasMinimasNoTotal: 8, horaPrevia: "09:00", horaLimite: "18:00" });
    const [d] = await db.insert(saidas).values({ passeioId: ids.passeio, data: "2027-03-11", capacidade: 73 }).onConflictDoNothing().returning();
    expect(d).toBeUndefined();
    const r = await rodarConfirmacaoVespera(db, config, as("10:00"));
    expect(r.avaliadas).toBe(0);
  });
});
