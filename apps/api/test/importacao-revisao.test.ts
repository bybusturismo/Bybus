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
