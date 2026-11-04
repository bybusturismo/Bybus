import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { compararPontos } from "@bybus/core";
import { criarDb } from "../src/db/cliente.js";
import { auditoria, mensagens, passeios, perfis, pessoas, pontosEmbarque, rastreioLinks, rastreioPosicoes, rastreioSessoes, reservas, saidas, usuarios, usuariosUnidades } from "../src/db/schema.js";
import { SENHA_DEMO } from "../src/db/ficticios.js";
import { gerarHashSenha } from "../src/seguranca/senha.js";
import { hashToken } from "../src/servicos/linkEmbarque.js";
import { limparRastreio } from "../src/servicos/rastreio.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
const ids: { saida: string; saidaAmanha: string; passeio: string; reservaComPonto: string; reservaSemPonto: string; pessoaDavi: string; rota: Array<{ id: string; lat: number; lng: number }> } = {} as never;

const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const somar = (dias: number) => new Date(Date.parse(`${hoje()}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const KM = 0.0101; // graus de longitude por km, na latitude de Florianópolis
const iso = (msAtras: number) => new Date(Date.now() - msAtras).toISOString();
const pos = (lat: number, lng: number, msAtras = 0, extra: Record<string, unknown> = {}) => ({ lat, lng, precisaoM: 10, velocidade: 6, registradaEm: iso(msAtras), ...extra });

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp({ URL_PUBLICA: "https://gestao.exemplo.test" }));
  const { db, pool } = criarDb(DATABASE_URL);
  // O perfil MOTORISTA ganha a permissão pela migração de produção; aqui simulamos o mesmo UPDATE.
  await db.update(perfis).set({ permissoes: ["manifesto:ver", "rastreio:transmitir"] }).where(eq(perfis.codigo, "MOTORISTA"));
  const [perfilMot] = await db.select().from(perfis).where(eq(perfis.codigo, "MOTORISTA"));
  const [fln] = await db.select({ id: passeios.unidadeId, passeio: passeios.id }).from(passeios).limit(1);
  const hash = await gerarHashSenha(SENHA_DEMO);
  const [outro] = await db.insert(usuarios).values({ nome: "Outro Motorista Fictício", email: "outro.motorista@bybus.test", perfilId: perfilMot!.id, senhaHash: hash, trocarSenha: false }).returning();
  await db.insert(usuariosUnidades).values({ usuarioId: outro!.id, unidadeId: fln!.id });
  const [uMot] = await db.select().from(usuarios).where(eq(usuarios.email, "motorista@bybus.test"));
  const [davi] = await db.select().from(pessoas).where(eq(pessoas.nome, "Motorista Fictício Davi"));
  await db.update(pessoas).set({ usuarioId: uMot!.id }).where(eq(pessoas.id, davi!.id));
  await db.insert(pessoas).values({ nome: "Motorista Fictício Outro", papeis: ["MOTORISTA"], unidadeId: fln!.id, usuarioId: outro!.id });
  ids.pessoaDavi = davi!.id;
  ids.passeio = fln!.passeio;

  const [s] = await db.insert(saidas).values({ passeioId: ids.passeio, data: hoje(), capacidade: 73, veiculo: "ZZZ0Z00 (fictício)", motorista: "Motorista Fictício Davi", motoristaId: davi!.id }).returning();
  const [s2] = await db.insert(saidas).values({ passeioId: ids.passeio, data: somar(10), capacidade: 73, motoristaId: davi!.id, motorista: "Motorista Fictício Davi" }).returning();
  ids.saida = s!.id;
  ids.saidaAmanha = s2!.id;

  // Rota fictícia em linha reta: pontos ativos na ordem de embarque, a 2 km um do outro.
  const pontos = (await db.select().from(pontosEmbarque).where(and(eq(pontosEmbarque.passeioId, ids.passeio), eq(pontosEmbarque.ativo, true)))).sort(compararPontos);
  ids.rota = [];
  for (const [i, p] of pontos.entries()) {
    const c = { lat: -27.6, lng: -48.5 + i * 2 * KM };
    await db.update(pontosEmbarque).set({ latitude: c.lat, longitude: c.lng }).where(eq(pontosEmbarque.id, p.id));
    ids.rota.push({ id: p.id, ...c });
  }
  const base = { saidaId: s!.id, canal: "BALCAO" as const, origem: "FICTICIO" };
  const [r1] = await db.insert(reservas).values({ ...base, contatoNome: "Paulo Rastreavel Fictício", contatoTelefone: "+55 48 90000-0001", pontoEmbarqueId: ids.rota[3]!.id }).returning();
  const [r2] = await db.insert(reservas).values({ ...base, contatoNome: "Marta Semponto Fictícia", contatoTelefone: "+55 48 90000-0002" }).returning();
  await db.insert(reservas).values({ ...base, contatoNome: "Cancelada Fictícia", contatoTelefone: "+55 48 90000-0003", status: "CANCELADA" });
  ids.reservaComPonto = r1!.id;
  ids.reservaSemPonto = r2!.id;
  await pool.end();
});
afterAll(async () => fechar());

async function logado(email: string) {
  const c = new Cliente(app);
  expect((await c.login(email)).statusCode).toBe(200);
  return c;
}
const comDb = async <T>(f: (db: ReturnType<typeof criarDb>["db"]) => Promise<T>) => {
  const { db, pool } = criarDb(DATABASE_URL);
  try { return await f(db); } finally { await pool.end(); }
};
let sessaoId = "";
let tokenCliente = "";

describe("coordenadas dos pontos", () => {
  it("valida faixa e exige latitude e longitude juntas; audita antes e depois", async () => {
    const admin = await logado("admin@bybus.test");
    const id = ids.rota[0]!.id;
    expect((await admin.req("PATCH", `/api/pontos/${id}`, { latitude: 91, longitude: -48.5 })).statusCode).toBe(400);
    expect((await admin.req("PATCH", `/api/pontos/${id}`, { latitude: -27.6, longitude: 181 })).statusCode).toBe(400);
    expect((await admin.req("PATCH", `/api/pontos/${id}`, { latitude: -27.6 })).statusCode).toBe(400);
    const ok = await admin.req("PATCH", `/api/pontos/${id}`, { latitude: -27.6, longitude: -48.5 });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ latitude: -27.6, longitude: -48.5 });
    const limpa = await admin.req("PATCH", `/api/pontos/${id}`, { latitude: null, longitude: null });
    expect(limpa.json()).toMatchObject({ latitude: null, longitude: null });
    await admin.req("PATCH", `/api/pontos/${id}`, { latitude: -27.6, longitude: -48.5 });
    const trilha = await comDb((db) => db.select().from(auditoria).where(eq(auditoria.acao, "PONTO_ALTERADO")));
    expect(trilha.some((a) => (a.dados as { antes?: unknown })?.antes !== undefined)).toBe(true);
  });
});

describe("motorista", () => {
  it("só quem tem a permissão acessa; cada motorista vê só as saídas de hoje em que está escalado", async () => {
    const sup = await logado("supervisor@bybus.test");
    expect((await sup.req("GET", "/api/rastreio/minhas-saidas")).statusCode).toBe(403);
    const m = await logado("motorista@bybus.test");
    const r = await m.req("GET", "/api/rastreio/minhas-saidas");
    expect(r.statusCode).toBe(200);
    const lista = r.json() as Array<{ saidaId: string; sessao: unknown }>;
    expect(lista.map((x) => x.saidaId)).toEqual([ids.saida]); // a saída de daqui a 10 dias não entra
    const outro = await logado("outro.motorista@bybus.test");
    expect((await outro.req("GET", "/api/rastreio/minhas-saidas")).json()).toEqual([]);
    expect((await new Cliente(app).req("GET", "/api/rastreio/minhas-saidas")).statusCode).toBe(401);
  });

  it("só o motorista da saída inicia; fora do dia do passeio é recusado", async () => {
    const outro = await logado("outro.motorista@bybus.test");
    const r = await outro.req("POST", `/api/rastreio/saidas/${ids.saida}/iniciar`);
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe("NAO_E_O_MOTORISTA");
    const sup = await logado("supervisor@bybus.test");
    expect((await sup.req("POST", `/api/rastreio/saidas/${ids.saida}/iniciar`)).statusCode).toBe(403);
    const m = await logado("motorista@bybus.test");
    const fora = await m.req("POST", `/api/rastreio/saidas/${ids.saidaAmanha}/iniciar`);
    expect(fora.statusCode).toBe(409);
    expect(fora.json().codigo).toBe("FORA_DO_DIA");
    expect((await m.req("POST", "/api/rastreio/saidas/nao-e-uuid/iniciar")).statusCode).toBe(400);
  });

  it("iniciar enfileira UMA mensagem RASTREIO por reserva confirmada, audita, e reiniciar não reenvia", async () => {
    const m = await logado("motorista@bybus.test");
    const r = await m.req("POST", `/api/rastreio/saidas/${ids.saida}/iniciar`);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ retomada: false, linksEnfileirados: 2 });
    sessaoId = r.json().sessaoId;
    const msgs = await comDb((db) => db.select().from(mensagens).where(and(eq(mensagens.saidaId, ids.saida), eq(mensagens.tipo, "RASTREIO"))));
    expect(msgs).toHaveLength(2);
    expect(msgs.every((x) => x.status === "SIMULADA")).toBe(true); // WhatsApp simulado
    const doPonto = msgs.find((x) => x.reservaId === ids.reservaComPonto)!;
    const achado = /https:\/\/gestao\.exemplo\.test\/rastreio\/([A-Za-z0-9_-]{20,})/.exec(doPonto.texto);
    expect(achado).not.toBeNull();
    tokenCliente = achado![1]!;
    // O banco guarda só o hash.
    const links = await comDb((db) => db.select().from(rastreioLinks).where(inArray(rastreioLinks.reservaId, [ids.reservaComPonto, ids.reservaSemPonto])));
    expect(links).toHaveLength(2);
    expect(links.some((l) => l.tokenHash === tokenCliente)).toBe(false);
    expect(links.some((l) => l.tokenHash === hashToken(tokenCliente))).toBe(true);
    const trilha = await comDb((db) => db.select().from(auditoria).where(eq(auditoria.acao, "RASTREIO_INICIADO")));
    expect(trilha).toHaveLength(1);

    const de_novo = await m.req("POST", `/api/rastreio/saidas/${ids.saida}/iniciar`);
    expect(de_novo.json()).toMatchObject({ retomada: true, sessaoId, linksEnfileirados: 0 });
    expect(await comDb((db) => db.select().from(mensagens).where(eq(mensagens.tipo, "RASTREIO")))).toHaveLength(2);
  });

  it("posições: lote de até 20, faixa, precisão, horário, duplicadas e dono da sessão", async () => {
    const m = await logado("motorista@bybus.test");
    const url = `/api/rastreio/sessoes/${sessaoId}/posicoes`;
    const A = ids.rota[0]!;
    const t0 = Date.now();
    const v = (n: number) => Array.from({ length: n }, (_, i) => ({ ...pos(A.lat, A.lng), registradaEm: new Date(t0 - 120_000 - i * 1000).toISOString() }));
    expect((await m.req("POST", url, { posicoes: v(21) })).statusCode).toBe(400); // mais de 20
    expect((await m.req("POST", url, { posicoes: [] })).statusCode).toBe(400);
    expect((await m.req("POST", url, { posicoes: [pos(91, 0)] })).statusCode).toBe(400);
    expect((await m.req("POST", url, { posicoes: [pos(0, 181)] })).statusCode).toBe(400);
    expect((await m.req("POST", url, { posicoes: [{ lat: 1, lng: 1 }] })).statusCode).toBe(400);
    const lote20 = await m.req("POST", url, { posicoes: v(20) });
    expect(lote20.json()).toEqual({ aceitas: 20, descartadas: { precisao: 0, horario: 0, duplicadas: 0 } });
    // Reenvio do mesmo lote (fila local depois de falha de rede): nada duplica.
    expect((await m.req("POST", url, { posicoes: v(3) })).json()).toEqual({ aceitas: 0, descartadas: { precisao: 0, horario: 0, duplicadas: 3 } });
    const mistas = await m.req("POST", url, {
      posicoes: [
        pos(A.lat, A.lng, 5000, { precisaoM: 200 }), // limite: aceita
        pos(A.lat, A.lng, 6000, { precisaoM: 200.5 }), // acima de 200 m: descarta
        pos(A.lat, A.lng, 7000, { precisaoM: 900 }),
        pos(A.lat, A.lng, 3 * 86_400_000), // dia errado
        { ...pos(A.lat, A.lng), registradaEm: new Date(Date.now() + 10 * 60_000).toISOString() }, // relógio no futuro
      ],
    });
    expect(mistas.json()).toEqual({ aceitas: 1, descartadas: { precisao: 2, horario: 2, duplicadas: 0 } });
    // Outro motorista (mesmo perfil) não envia na sessão alheia.
    const outro = await logado("outro.motorista@bybus.test");
    expect((await outro.req("POST", url, { posicoes: [pos(A.lat, A.lng)] })).statusCode).toBe(403);
    const sup = await logado("supervisor@bybus.test");
    expect((await sup.req("POST", url, { posicoes: [pos(A.lat, A.lng)] })).statusCode).toBe(403);
  });

  it("não aceita posição de sessão cujo dia já passou", async () => {
    const m = await logado("motorista@bybus.test");
    // Sessão de ontem esquecida aberta (saída de ontem): não recebe posições.
    const { sessao } = await comDb(async (db) => {
      const [dav] = await db.select().from(usuarios).where(eq(usuarios.email, "motorista@bybus.test"));
      const [ontem] = await db.insert(saidas).values({ passeioId: ids.passeio, data: somar(-1), capacidade: 10, motoristaId: ids.pessoaDavi }).returning();
      const [s] = await db.insert(rastreioSessoes).values({ saidaId: ontem!.id, motoristaUsuarioId: dav!.id }).returning();
      return { sessao: s! };
    });
    const r = await m.req("POST", `/api/rastreio/sessoes/${sessao.id}/posicoes`, { posicoes: [pos(-27.6, -48.5)] });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe("FORA_DO_DIA");
  });
});

describe("equipe", () => {
  it("vê situação, última posição e trajeto; escopo de praça e permissão são respeitados", async () => {
    const sup = await logado("supervisor@bybus.test");
    const lista = (await sup.req("GET", "/api/rastreio/saidas")).json() as Array<{ saidaId: string; situacao: string; ultimaPosicao: unknown; pontos: { total: number; comCoordenadas: number } }>;
    const minha = lista.find((x) => x.saidaId === ids.saida)!;
    expect(minha.situacao).toBe("TRANSMITINDO");
    expect(minha.ultimaPosicao).not.toBeNull();
    expect(minha.pontos.comCoordenadas).toBe(minha.pontos.total);
    const det = (await sup.req("GET", `/api/rastreio/saidas/${ids.saida}`)).json();
    expect(det.trajeto.length).toBeGreaterThan(5);
    expect(det.pontos[0]).toMatchObject({ lat: ids.rota[0]!.lat });
    // Supervisor de BC não enxerga a saída de Florianópolis.
    const bc = await logado("supervisor.bc@bybus.test");
    expect((await bc.req("GET", `/api/rastreio/saidas/${ids.saida}`)).statusCode).toBe(404);
    expect(((await bc.req("GET", "/api/rastreio/saidas")).json() as unknown[]).length).toBe(0);
    expect((await new Cliente(app).req("GET", "/api/rastreio/saidas")).statusCode).toBe(401);
  });

  it("sem sinal: passados 3 minutos da última posição, a saída aparece como SEM_SINAL", async () => {
    await comDb((db) => db.update(rastreioSessoes).set({ ultimaPosicaoEm: new Date(Date.now() - 7 * 60_000) }).where(eq(rastreioSessoes.id, sessaoId)));
    const sup = await logado("supervisor@bybus.test");
    const minha = ((await sup.req("GET", "/api/rastreio/saidas")).json() as Array<{ saidaId: string; situacao: string; minutosSemSinal: number }>).find((x) => x.saidaId === ids.saida)!;
    expect(minha.situacao).toBe("SEM_SINAL");
    expect(minha.minutosSemSinal).toBeGreaterThanOrEqual(7);
    await comDb((db) => db.update(rastreioSessoes).set({ ultimaPosicaoEm: new Date() }).where(eq(rastreioSessoes.id, sessaoId)));
  });
});

describe("rota pública", () => {
  const publico = (t: string) => new Cliente(app).req("GET", `/api/publico/rastreio/${t}`);

  it("token inválido ou mal formado não revela nada", async () => {
    expect((await publico("x".repeat(30))).statusCode).toBe(404);
    expect((await publico("curto")).statusCode).toBe(400);
    expect((await publico("x".repeat(30))).json().codigo).toBe("LINK_INVALIDO");
  });

  it("antes do primeiro sinal não mostra o ônibus; depois mostra posição, rota e previsão, sem vazar dados internos", async () => {
    // Zera as posições para testar "aguardando sinal".
    await comDb(async (db) => { await db.delete(rastreioPosicoes).where(eq(rastreioPosicoes.sessaoId, sessaoId)); await db.update(rastreioSessoes).set({ ultimaPosicaoEm: null, ultimoPontoVisitado: -1, iniciadaEm: new Date() }).where(eq(rastreioSessoes.id, sessaoId)); });
    const antes = await publico(tokenCliente);
    expect(antes.statusCode).toBe(200);
    expect(antes.json()).toMatchObject({ situacao: "AGUARDANDO_SINAL", onibus: null, previsao: null, jaPassou: false });

    const m = await logado("motorista@bybus.test");
    const P = ids.rota;
    // O ônibus está no ponto 0 (visitado) e já anda em direção ao ponto 1: o cliente (ponto 3) está a ~4,5 km.
    const r = await m.req("POST", `/api/rastreio/sessoes/${sessaoId}/posicoes`, { posicoes: [pos(P[0]!.lat, P[0]!.lng, 20_000), pos(P[0]!.lat, P[0]!.lng + 0.5 * KM, 10_000, { velocidade: 7 })] });
    expect(r.json().aceitas).toBe(2);
    const dep = await publico(tokenCliente);
    const corpo = dep.json();
    expect(corpo).toMatchObject({ situacao: "TRANSMITINDO", jaPassou: false, passeio: expect.any(String) });
    expect(corpo.onibus).toMatchObject({ lat: P[0]!.lat });
    expect(corpo.ponto).toMatchObject({ lat: P[3]!.lat, lng: P[3]!.lng });
    expect(corpo.previsao).toMatchObject({ situacao: "A_CAMINHO", estimativa: true });
    expect(corpo.previsao.minutos).toBeGreaterThan(5);
    expect(corpo.previsao.minutos).toBeLessThan(40);
    expect(corpo.rota.length).toBe(P.length);
    expect(corpo.rota.filter((x: { doCliente: boolean }) => x.doCliente)).toHaveLength(1);
    expect(corpo.rota[0].passou).toBe(true);
    // Nada de motorista, placa, outros passageiros, telefones ou ids internos.
    const texto = JSON.stringify(corpo);
    for (const proibido of ["Davi", "Fictício Outro", "ZZZ0Z00", "Marta", "Cancelada", "Paulo", "90000", ids.saida, ids.reservaComPonto, sessaoId, "motorista", "veiculo"]) expect(texto, proibido).not.toContain(proibido);
    expect(Object.keys(corpo).sort()).toEqual(["cidade", "data", "jaPassou", "minutosSemSinal", "onibus", "passeio", "ponto", "previsao", "rota", "situacao"]);
  });

  it("reserva sem ponto não tem previsão; depois do ponto do cliente, já passou", async () => {
    const sem = await comDb(async (db) => {
      const t = "semponto-token-ficticio-0000000001";
      await db.insert(rastreioLinks).values({ reservaId: ids.reservaSemPonto, tokenHash: hashToken(t), expiraEm: new Date(Date.now() + 3_600_000) })
        .onConflictDoUpdate({ target: rastreioLinks.reservaId, set: { tokenHash: hashToken(t) } });
      return t;
    });
    const r = (await publico(sem)).json();
    expect(r.ponto).toBeNull();
    expect(r.previsao).toMatchObject({ situacao: "SEM_PREVISAO", minutos: null, motivo: "SEM_PONTO" });

    const m = await logado("motorista@bybus.test");
    const P = ids.rota;
    await m.req("POST", `/api/rastreio/sessoes/${sessaoId}/posicoes`, { posicoes: [pos(P[3]!.lat, P[3]!.lng + 0.05 * KM, 4000)] });
    const dep = (await publico(tokenCliente)).json();
    expect(dep.jaPassou).toBe(true);
    expect(dep.previsao).toMatchObject({ situacao: "JA_PASSOU" });
    expect(dep.rota.slice(0, 4).every((x: { passou: boolean }) => x.passou)).toBe(true);
  });

  it("ponto sem coordenadas: sem previsão (mas mapa continua)", async () => {
    await comDb(async (db) => {
      await db.update(pontosEmbarque).set({ latitude: null, longitude: null }).where(eq(pontosEmbarque.id, ids.rota[3]!.id));
      await db.update(rastreioSessoes).set({ ultimoPontoVisitado: 0 }).where(eq(rastreioSessoes.id, sessaoId)); // volta o ônibus ao ponto 0
    });
    const m = await logado("motorista@bybus.test");
    await m.req("POST", `/api/rastreio/sessoes/${sessaoId}/posicoes`, { posicoes: [pos(ids.rota[0]!.lat, ids.rota[0]!.lng + KM, 500)] });
    const r = (await publico(tokenCliente)).json();
    expect(r.ponto).toEqual({ nome: expect.any(String), horario: expect.any(String) }); // nome e horário sim; sem coordenadas não há onde marcar
    expect(r.previsao).toMatchObject({ situacao: "SEM_PREVISAO", minutos: null, motivo: "SEM_COORDENADAS" });
    expect(r.rota.length).toBe(ids.rota.length - 1);
    await comDb((db) => db.update(pontosEmbarque).set({ latitude: ids.rota[3]!.lat, longitude: ids.rota[3]!.lng }).where(eq(pontosEmbarque.id, ids.rota[3]!.id)));
  });

  it("encerrar tira o ônibus do mapa; supervisão também pode encerrar; só o dono ou a supervisão", async () => {
    const outro = await logado("outro.motorista@bybus.test");
    expect((await outro.req("POST", `/api/rastreio/sessoes/${sessaoId}/encerrar`)).statusCode).toBe(403);
    const bc = await logado("supervisor.bc@bybus.test");
    expect((await bc.req("POST", `/api/rastreio/sessoes/${sessaoId}/encerrar`)).statusCode).toBe(404);
    const m = await logado("motorista@bybus.test");
    const e = await m.req("POST", `/api/rastreio/sessoes/${sessaoId}/encerrar`);
    expect(e.json()).toEqual({ ok: true, jaEncerrado: false });
    expect((await m.req("POST", `/api/rastreio/sessoes/${sessaoId}/encerrar`)).json().jaEncerrado).toBe(true);
    expect((await m.req("POST", `/api/rastreio/sessoes/${sessaoId}/posicoes`, { posicoes: [pos(-27.6, -48.5)] })).statusCode).toBe(409);
    const r = (await publico(tokenCliente)).json();
    expect(r).toMatchObject({ situacao: "ENCERRADO", onibus: null, previsao: null });
    const trilha = await comDb((db) => db.select().from(auditoria).where(eq(auditoria.acao, "RASTREIO_ENCERRADO")));
    expect(trilha).toHaveLength(1);
    // Cada posição NÃO é auditada: só início e fim.
    expect(await comDb((db) => db.select().from(auditoria).where(eq(auditoria.entidade, "posicao")))).toHaveLength(0);
  });

  it("um novo início no mesmo dia mantém o mesmo link válido", async () => {
    const m = await logado("motorista@bybus.test");
    const r = await m.req("POST", `/api/rastreio/saidas/${ids.saida}/iniciar`);
    expect(r.statusCode).toBe(201);
    expect(r.json().linksEnfileirados).toBe(0);
    expect((await publico(tokenCliente)).json().situacao).toBe("AGUARDANDO_SINAL");
    await m.req("POST", `/api/rastreio/sessoes/${r.json().sessaoId}/encerrar`);
  });

  it("expira: link vencido, reserva cancelada e saída cancelada respondem 404", async () => {
    await comDb((db) => db.update(rastreioLinks).set({ expiraEm: new Date(Date.now() - 1000) }).where(eq(rastreioLinks.reservaId, ids.reservaComPonto)));
    expect((await publico(tokenCliente)).statusCode).toBe(404);
    await comDb((db) => db.update(rastreioLinks).set({ expiraEm: new Date(Date.now() + 3_600_000) }).where(eq(rastreioLinks.reservaId, ids.reservaComPonto)));
    expect((await publico(tokenCliente)).statusCode).toBe(200);
    await comDb((db) => db.update(reservas).set({ status: "CANCELADA" }).where(eq(reservas.id, ids.reservaComPonto)));
    expect((await publico(tokenCliente)).statusCode).toBe(404);
    await comDb((db) => db.update(reservas).set({ status: "CONFIRMADA" }).where(eq(reservas.id, ids.reservaComPonto)));
  });

  it("o link expira no fim do dia do passeio (00:00 de Brasília)", async () => {
    const [l] = await comDb((db) => db.select().from(rastreioLinks).where(eq(rastreioLinks.reservaId, ids.reservaComPonto)));
    // Já foi estendido no teste anterior; confere a regra no momento da geração com outra reserva nova.
    const nova = await comDb(async (db) => {
      const [r] = await db.insert(reservas).values({ saidaId: ids.saida, canal: "BALCAO", origem: "FICTICIO", contatoNome: "Nova Fictícia", contatoTelefone: "+55 48 90000-0009" }).returning();
      return r!;
    });
    const m = await logado("motorista@bybus.test");
    const r = await m.req("POST", `/api/rastreio/saidas/${ids.saida}/iniciar`);
    expect(r.json().linksEnfileirados).toBe(1);
    const [novo] = await comDb((db) => db.select().from(rastreioLinks).where(eq(rastreioLinks.reservaId, nova.id)));
    expect(novo!.expiraEm.toISOString()).toBe(new Date(Date.parse(`${hoje()}T03:00:00Z`) + 86_400_000).toISOString());
    expect(l).toBeDefined();
    await m.req("POST", `/api/rastreio/sessoes/${r.json().sessaoId}/encerrar`);
  });
});

describe("limpeza (LGPD)", () => {
  it("apaga posições com mais de 30 dias e encerra sessões esquecidas de dias anteriores", async () => {
    const r = await comDb(async (db) => {
      const [s] = await db.select().from(rastreioSessoes).limit(1);
      const velho = new Date(Date.now() - 31 * 86_400_000);
      await db.insert(rastreioPosicoes).values([
        { sessaoId: s!.id, lat: -27.6, lng: -48.5, registradaEm: velho },
        { sessaoId: s!.id, lat: -27.6, lng: -48.5, registradaEm: new Date(Date.now() - 29 * 86_400_000) },
      ]);
      const antes = (await db.select().from(rastreioPosicoes)).length;
      // Sessão de ontem ainda aberta (criada no teste anterior) deve ser encerrada.
      const resultado = await limparRastreio(db);
      const depois = (await db.select().from(rastreioPosicoes)).length;
      return { resultado, antes, depois };
    });
    expect(r.resultado.apagadas).toBe(1);
    expect(r.depois).toBe(r.antes - 1);
    expect(r.resultado.encerradas).toBeGreaterThanOrEqual(1);
  });
});
