import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";
import { casaProduto } from "../src/servicos/importacao.js";

// Regressões da revisão de código: importação reconhece a mesma reserva e respeita a equipe.
let app: FastifyInstance;
let fechar: () => Promise<void>;
const banco = new pg.Client({ connectionString: DATABASE_URL });

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
  await banco.connect();
});
afterAll(async () => {
  await banco.end();
  await fechar();
});

const email = (ref: string, dia = "Sat 24.Oct '26") => `| Booking ref. | ${ref} |
| Product | 165696P2 - Floripa City Tour by Bus - Whole Island |
| Sold by | Viator.com |
| Booking channel | Viator.com |
| Customer | Teste, Pessoa |
| Date | ${dia} @ 08:00 |
| PAX | 2 Adult |`;

async function importar(c: Cliente, assunto: string, corpo: string) {
  const r = await c.req("POST", "/api/importacoes/bokun-email", { emails: [{ assunto, corpo }], confirmar: true });
  expect(r.statusCode).toBe(200);
  return r.json() as { resumo: Record<string, number>; previa: Array<{ avisos: string[] }> };
}
const dataDaReserva = async (codigo: string) =>
  (await banco.query("select s.data::text as data, r.status from reservas r join saidas s on s.id = r.saida_id where r.codigo_externo = $1", [codigo])).rows;

describe("importação depois da revisão", () => {
  it("data mudada no canal move a reserva para a saída certa, sem duplicar", async () => {
    const c = new Cliente(app);
    await c.login("atendente@bybus.test");
    await importar(c, "New booking", email("VIA-777000111"));
    const r = await importar(c, "Updated booking", email("VIA-777000111", "Sun 25.Oct '26"));
    expect(r.resumo.ATUALIZAR).toBe(1);
    expect(r.previa[0]!.avisos.join(" ")).toMatch(/Data mudou no canal/);
    expect(await dataDaReserva("VIA-777000111")).toEqual([{ data: "2026-10-25", status: "CONFIRMADA" }]);
  });

  it("ponto mudado no canal (ex.: passou para o transfer) atualiza a reserva; ajuste feito no sistema fica se o canal repete o ponto", async () => {
    const c = new Cliente(app);
    await c.login("atendente@bybus.test");
    const comPonto = (ponto: string) => `${email("VIA-777000333")}\n| Pick-up | ${ponto} |`;
    const ponto = async () => (await banco.query("select p.nome from reservas r join pontos_embarque p on p.id = r.ponto_embarque_id where r.codigo_externo = $1", ["VIA-777000333"])).rows[0]?.nome;
    await importar(c, "New booking", comPonto("Villa Romana Shopping"));
    expect(await ponto()).toBe("Villa Romana Shopping");
    await importar(c, "Updated booking", comPonto("7h - Transfer partindo de Canasvieiras (Possui custo adicional)"));
    expect(await ponto()).toBe("Transfer — Canasvieiras");
    // Ajuste no sistema (ex.: atendente corrigiu): o canal repetindo o mesmo ponto não desfaz.
    await banco.query("update reservas set ponto_embarque_id = (select id from pontos_embarque where nome = 'Hotel Ibis' limit 1) where codigo_externo = $1", ["VIA-777000333"]);
    await importar(c, "Updated booking", comPonto("7h - Transfer partindo de Canasvieiras (Possui custo adicional)"));
    expect(await ponto()).toBe("Hotel Ibis");
  });

  it("check-in pelo QR Code do voucher: marca o embarque, avisa a cobrança e recusa voucher de outra saída", async () => {
    const c = new Cliente(app);
    await c.login("atendente@bybus.test");
    await importar(c, "New booking", email("VIA-777000555", "Mon 26.Oct '26"));
    await importar(c, "New booking", email("VIA-777000666", "Tue 27.Oct '26"));
    await banco.query("update passageiros set voucher = '924074225171781496807' where reserva_id = (select id from reservas where codigo_externo = 'VIA-777000555')");
    await banco.query("update reservas set pagamento = 'A_PAGAR', valor_centavos = 17000 where codigo_externo = 'VIA-777000555'");
    const saida = async (cod: string) => (await banco.query("select saida_id from reservas where codigo_externo = $1", [cod])).rows[0].saida_id as string;
    const s1 = await saida("VIA-777000555");
    const s2 = await saida("VIA-777000666");
    const guia = new Cliente(app);
    await guia.login("guia@bybus.test");
    const r = await guia.req("POST", `/api/saidas/${s1}/embarque/voucher`, { codigo: "924074225171781496807" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ jaEmbarcados: 0, pagamento: "A_PAGAR", valorACobrarCentavos: 17000 });
    expect(r.json().embarcados).toHaveLength(2);
    expect((await guia.req("POST", `/api/saidas/${s1}/embarque/voucher`, { codigo: "924074225171781496807" })).json()).toMatchObject({ embarcados: [], jaEmbarcados: 2 });
    const outra = await guia.req("POST", `/api/saidas/${s2}/embarque/voucher`, { codigo: "924074225171781496807" });
    expect(outra.statusCode).toBe(409);
    expect(outra.json().mensagem).toMatch(/outra saída.*26\/10\/2026/);
    expect((await guia.req("POST", `/api/saidas/${s2}/embarque/voucher`, { codigo: "000000000000" })).statusCode).toBe(404);
  });

  it("reserva cancelada no sistema não volta sozinha quando o canal ainda a mostra ativa", async () => {
    const c = new Cliente(app);
    await c.login("atendente@bybus.test");
    await importar(c, "New booking", email("VIA-777000222"));
    await importar(c, "Cancelled booking", email("VIA-777000222"));
    const r = await importar(c, "New booking", email("VIA-777000222"));
    expect(r.resumo.IGNORAR).toBe(1);
    expect(r.previa[0]!.avisos.join(" ")).toMatch(/cancelada no sistema/);
    expect((await dataDaReserva("VIA-777000222"))[0]!.status).toBe("CANCELADA");
  });

  it("padrão de produto inválido no cadastro não derruba a importação", () => {
    expect(casaProduto("Toda Ilha (", "City Tour Toda Ilha")).toBe(false);
    expect(casaProduto("toda ilha", "City Tour Toda Ilha")).toBe(true);
    expect(casaProduto(null, "x")).toBe(false);
  });
});
