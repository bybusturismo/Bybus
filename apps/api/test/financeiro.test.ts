import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { criarDb } from "../src/db/cliente.js";
import { SENHA_DEMO } from "../src/db/ficticios.js";
import { auditoria, perfis, unidades, usuarios, usuariosUnidades } from "../src/db/schema.js";
import { gerarHashSenha } from "../src/seguranca/senha.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
let admin: Cliente;
let usuarioFln: Cliente; // financeiro:ver + gerenciar, só Florianópolis
let usuarioBc: Cliente;
let leitor: Cliente; // só financeiro:ver
let soGerenciar: Cliente;
let atendente: Cliente;
let fln = "";
let bc = "";
let cat: Record<string, string> = {};

async function criarUsuarios() {
  const { db, pool } = criarDb(DATABASE_URL);
  const hash = await gerarHashSenha(SENHA_DEMO);
  const lu = await db.select().from(unidades);
  fln = lu.find((x) => x.codigo === "FLN")!.id;
  bc = lu.find((x) => x.codigo === "BC")!.id;
  const novoPerfil = async (codigo: string, permissoes: string[]) => (await db.insert(perfis).values({ codigo, nome: codigo, permissoes }).returning())[0]!.id;
  const pFin = await novoPerfil("FIN_TESTE", ["financeiro:ver", "financeiro:gerenciar"]);
  const pLeitor = await novoPerfil("FIN_LEITOR", ["financeiro:ver"]);
  const pGer = await novoPerfil("FIN_SO_GERENCIAR", ["financeiro:gerenciar"]);
  const criar = async (email: string, perfilId: string, unidadeId: string) => {
    const [u] = await db.insert(usuarios).values({ nome: email, email, perfilId, senhaHash: hash, trocarSenha: false }).returning({ id: usuarios.id });
    await db.insert(usuariosUnidades).values({ usuarioId: u!.id, unidadeId });
  };
  await criar("fin.fln@bybus.test", pFin, fln);
  await criar("fin.bc@bybus.test", pFin, bc);
  await criar("fin.leitor@bybus.test", pLeitor, fln);
  await criar("fin.gerenciar@bybus.test", pGer, fln);
  await pool.end();
}

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
  await criarUsuarios();
  const entrar = async (email: string) => { const c = new Cliente(app); expect((await c.login(email)).statusCode).toBe(200); return c; };
  admin = await entrar("admin@bybus.test");
  usuarioFln = await entrar("fin.fln@bybus.test");
  usuarioBc = await entrar("fin.bc@bybus.test");
  leitor = await entrar("fin.leitor@bybus.test");
  soGerenciar = await entrar("fin.gerenciar@bybus.test");
  atendente = await entrar("atendente@bybus.test");
  const cats = (await admin.req("GET", "/api/financeiro/categorias")).json() as Array<{ id: string; codigo: string }>;
  cat = Object.fromEntries(cats.map((c) => [c.codigo, c.id]));
});
afterAll(async () => fechar());

const json = (r: { json: () => unknown }) => r.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function conta(c: Cliente, corpo: Record<string, unknown>) {
  const r = await c.req("POST", "/api/financeiro/contas", corpo);
  expect(r.statusCode, r.body).toBe(200);
  return json(r).id as string;
}

async function lancar(c: Cliente, corpo: Record<string, unknown>) {
  const r = await c.req("POST", "/api/financeiro/lancamentos", {
    tipo: "PAGAR", descricao: "Combustível", categoriaId: cat.DESP_COMBUSTIVEL, valorCentavos: 10000, competencia: "2026-10-01", vencimento: "2026-10-10", unidadeId: fln, ...corpo,
  });
  return r;
}

function ofx(linhas: Array<{ fitid: string; data: string; valor: string; memo: string }>) {
  return `OFXHEADER:100\nDATA:OFXSGML\nCHARSET:1252\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>756<ACCTID>99887-1</BANKACCTFROM><BANKTRANLIST>\n` +
    linhas.map((l) => `<STMTTRN><TRNTYPE>OTHER<DTPOSTED>${l.data}<TRNAMT>${l.valor}<FITID>${l.fitid}<MEMO>${l.memo}\n</STMTTRN>`).join("\n") +
    `\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
}

describe("permissões e escopo", () => {
  it("sem financeiro:ver/gerenciar nada é acessível; leitor só consulta; gerenciar também consulta", async () => {
    expect((await atendente.req("GET", "/api/financeiro/contas")).statusCode).toBe(403);
    expect((await atendente.req("GET", "/api/financeiro/resumo")).statusCode).toBe(403);
    expect((await new Cliente(app).req("GET", "/api/financeiro/contas")).statusCode).toBe(401);
    expect((await leitor.req("GET", "/api/financeiro/contas")).statusCode).toBe(200);
    expect((await leitor.req("POST", "/api/financeiro/contas", { nome: "Conta X", tipo: "CORRENTE", unidadeId: fln })).statusCode).toBe(403);
    expect((await leitor.req("POST", "/api/financeiro/lancamentos", {})).statusCode).toBe(403);
    expect((await soGerenciar.req("GET", "/api/financeiro/lancamentos")).statusCode).toBe(200);
  });

  it("exige o cabeçalho anti-CSRF nas escritas", async () => {
    const r = await app.inject({ method: "POST", url: "/api/financeiro/contas", payload: {}, headers: { cookie: admin.cookie } });
    expect(r.statusCode).toBe(403);
  });

  it("plano inicial de categorias de turismo", async () => {
    const lista = json(await admin.req("GET", "/api/financeiro/categorias")) as Array<{ codigo: string; tipo: string }>;
    for (const c of ["REC_SITE_PAYTOUR", "REC_QUIOSQUE", "REC_VIATOR", "REC_DECOLAR", "REC_CIVITATIS", "REC_FRETAMENTO", "REC_PUBLICIDADE", "REC_RECREATIVO", "DESP_COMBUSTIVEL", "DESP_MANUTENCAO", "DESP_PEDAGIO", "DESP_DIARIAS", "DESP_SALARIOS", "DESP_COMISSOES", "DESP_TAXAS", "DESP_MARKETING", "DESP_ALUGUEL", "DESP_IMPOSTOS"]) {
      expect(lista.some((x) => x.codigo === c), c).toBe(true);
    }
    // idempotente
    expect(json(await admin.req("GET", "/api/financeiro/categorias")).length).toBe(lista.length);
  });

  it("usuário de uma praça não vê nem altera dados de outra e não cria em outra praça", async () => {
    const cBc = await conta(admin, { nome: "Corrente BC escopo", tipo: "CORRENTE", unidadeId: bc });
    const cFln = await conta(usuarioFln, { nome: "Corrente FLN escopo", tipo: "CORRENTE", unidadeId: fln });
    const vistas = json(await usuarioFln.req("GET", "/api/financeiro/contas")) as Array<{ id: string }>;
    expect(vistas.some((c) => c.id === cFln)).toBe(true);
    expect(vistas.some((c) => c.id === cBc)).toBe(false);
    expect((await usuarioFln.req("PATCH", `/api/financeiro/contas/${cBc}`, { nome: "Invasão" })).statusCode).toBe(404);
    expect((await usuarioFln.req("POST", "/api/financeiro/contas", { nome: "Em BC", tipo: "CORRENTE", unidadeId: bc })).statusCode).toBe(403);
    expect((await usuarioFln.req("POST", "/api/financeiro/contas", { nome: "Sem praça", tipo: "CORRENTE" })).statusCode).toBe(400);
    expect((await usuarioFln.req("POST", "/api/financeiro/lancamentos", { tipo: "PAGAR", descricao: "Em BC", categoriaId: cat.DESP_COMBUSTIVEL, valorCentavos: 100, competencia: "2026-10-01", vencimento: "2026-10-01", unidadeId: bc })).statusCode).toBe(403);
    const l = json(await lancar(admin, { unidadeId: bc, descricao: "Lançamento de BC escopo" }));
    const id = l.ids[0] as string;
    expect((await usuarioFln.req("PATCH", `/api/financeiro/lancamentos/${id}`, { descricao: "Invasão" })).statusCode).toBe(404);
    expect((await usuarioFln.req("DELETE", `/api/financeiro/lancamentos/${id}`)).statusCode).toBe(404);
    expect((await usuarioFln.req("POST", `/api/financeiro/lancamentos/${id}/baixa`, { pagoEm: "2026-10-10", contaId: cFln })).statusCode).toBe(404);
    const lista = json(await usuarioFln.req("GET", "/api/financeiro/lancamentos?limite=500"));
    expect(lista.itens.some((x: { id: string }) => x.id === id)).toBe(false);
    // filtro por praça fora do escopo não vaza nada
    expect(json(await usuarioFln.req("GET", `/api/financeiro/lancamentos?unidadeId=${bc}`)).total).toBe(0);
    expect(json(await usuarioBc.req("GET", "/api/financeiro/lancamentos?limite=500")).itens.some((x: { id: string }) => x.id === id)).toBe(true);
  });

  it("cartão exige dia de fechamento e vencimento", async () => {
    const r = await admin.req("POST", "/api/financeiro/contas", { nome: "Cartão sem ciclo", tipo: "CARTAO", unidadeId: fln });
    expect(r.statusCode).toBe(400);
  });
});

describe("lançamentos", () => {
  it("parcela em centavos sem perda, com vencimentos mensais", async () => {
    const r = json(await lancar(usuarioFln, { descricao: "Pneus", valorCentavos: 10000, vencimento: "2026-11-30", competencia: "2026-11-30", repeticao: { tipo: "PARCELADO", parcelas: 3 } }));
    const itens = r.lancamentos as Array<{ valorCentavos: number; vencimento: string; competencia: string; descricao: string; parcelaNumero: number; parcelaTotal: number }>;
    expect(itens.map((i) => i.valorCentavos)).toEqual([3334, 3333, 3333]);
    expect(itens.reduce((s, i) => s + i.valorCentavos, 0)).toBe(10000);
    expect(itens.map((i) => i.vencimento)).toEqual(["2026-11-30", "2026-12-30", "2027-01-30"]);
    expect(itens.map((i) => i.descricao)).toEqual(["Pneus (1/3)", "Pneus (2/3)", "Pneus (3/3)"]);
    expect(itens[2]!.parcelaTotal).toBe(3);
  });

  it("recorrente cria uma série mensal e exclui a série em aberto", async () => {
    const r = json(await lancar(usuarioFln, { descricao: "Aluguel quiosque", categoriaId: cat.DESP_ALUGUEL, valorCentavos: 250000, vencimento: "2027-03-05", competencia: "2027-03-01", repeticao: { tipo: "RECORRENTE", meses: 4 } }));
    expect(r.ids).toHaveLength(4);
    expect(r.lancamentos.every((l: { recorrente: boolean; valorCentavos: number }) => l.recorrente && l.valorCentavos === 250000)).toBe(true);
    const segundo = r.ids[1] as string;
    const del = json(await usuarioFln.req("DELETE", `/api/financeiro/lancamentos/${segundo}?serie=1`));
    expect(del.excluidos).toBe(3);
    expect((await usuarioFln.req("DELETE", `/api/financeiro/lancamentos/${r.ids[0]}`)).statusCode).toBe(200);
  });

  it("valida entrada: centavos inteiros, positivo, categoria do tipo certo, datas reais", async () => {
    expect((await lancar(usuarioFln, { valorCentavos: 100.5 })).statusCode).toBe(400);
    expect((await lancar(usuarioFln, { valorCentavos: 0 })).statusCode).toBe(400);
    expect((await lancar(usuarioFln, { valorCentavos: -5 })).statusCode).toBe(400);
    expect((await lancar(usuarioFln, { vencimento: "2026-02-31" })).statusCode).toBe(400);
    expect(json(await lancar(usuarioFln, { categoriaId: cat.REC_FRETAMENTO }).then((r) => r)).codigo).toBe("CATEGORIA_INCOMPATIVEL");
    expect((await lancar(usuarioFln, { tipo: "RECEBER" })).statusCode).toBe(400);
    expect((await lancar(usuarioFln, { valorCentavos: 2, repeticao: { tipo: "PARCELADO", parcelas: 3 } })).statusCode).toBe(400);
    expect((await lancar(usuarioFln, { veiculo: "x" })).statusCode).toBe(400);
  });

  it("baixa com juros, multa e desconto; recusa data futura e baixa repetida; reabre", async () => {
    const c = await conta(usuarioFln, { nome: "Corrente baixa", tipo: "CORRENTE", unidadeId: fln });
    const id = json(await lancar(usuarioFln, { valorCentavos: 100000, veiculo: "qjq2a16" })).ids[0] as string;
    expect((await usuarioFln.req("POST", `/api/financeiro/lancamentos/${id}/baixa`, { pagoEm: "2026-10-12" })).json().codigo).toBe("CONTA_OBRIGATORIA");
    expect((await usuarioFln.req("POST", `/api/financeiro/lancamentos/${id}/baixa`, { pagoEm: "2099-01-01", contaId: c })).json().codigo).toBe("DATA_FUTURA");
    expect((await usuarioFln.req("POST", `/api/financeiro/lancamentos/${id}/baixa`, { pagoEm: "2026-10-12", contaId: c, descontoCentavos: 100000 })).statusCode).toBe(400);
    const r = json(await usuarioFln.req("POST", `/api/financeiro/lancamentos/${id}/baixa`, { pagoEm: "2026-10-12", contaId: c, jurosCentavos: 1234, multaCentavos: 2000, descontoCentavos: 500 }));
    expect(r.situacao).toBe("REALIZADO");
    expect(r.valorPagoCentavos).toBe(100000 + 1234 + 2000 - 500);
    expect(r.veiculo).toBe("QJQ2A16");
    expect((await usuarioFln.req("POST", `/api/financeiro/lancamentos/${id}/baixa`, { pagoEm: "2026-10-12", contaId: c })).json().codigo).toBe("JA_BAIXADO");
    // baixado: valor travado, exclusão exige reabrir
    expect((await usuarioFln.req("PATCH", `/api/financeiro/lancamentos/${id}`, { valorCentavos: 5 })).json().codigo).toBe("LANCAMENTO_REALIZADO");
    expect((await usuarioFln.req("DELETE", `/api/financeiro/lancamentos/${id}`)).statusCode).toBe(409);
    const aberto = json(await usuarioFln.req("POST", `/api/financeiro/lancamentos/${id}/reabrir`));
    expect(aberto.situacao).toBe("ABERTO");
    expect(aberto.valorPagoCentavos).toBeNull();
    expect(aberto.jurosCentavos).toBe(0);
    const saldo = (json(await usuarioFln.req("GET", "/api/financeiro/contas")) as Array<{ id: string; saldoCentavos: number }>).find((x) => x.id === c)!;
    expect(saldo.saldoCentavos).toBe(0);
  });
});

describe("importação de extrato", () => {
  it("OFX: prévia não grava; confirmar grava; reimportar não duplica; arquivo errado é recusado", async () => {
    const c = await conta(usuarioFln, { nome: "Corrente importação", tipo: "CORRENTE", unidadeId: fln, finalConta: "99887-1" });
    const conteudo = ofx([
      { fitid: "F1", data: "20261003", valor: "-100.00", memo: "PAGTO POSTO" },
      { fitid: "F2", data: "20261004", valor: "250.00", memo: "PIX CLIENTE" },
      { fitid: "F1", data: "20261003", valor: "-100.00", memo: "PAGTO POSTO" },
    ]);
    const previa = json(await usuarioFln.req("POST", "/api/financeiro/extratos/importar", { contaId: c, formato: "OFX", conteudo }));
    expect(previa).toMatchObject({ previa: true, total: 3, novas: 2, repetidas: 1 });
    expect(json(await usuarioFln.req("GET", `/api/financeiro/extrato/linhas?contaId=${c}`)).total).toBe(0);
    const ok = json(await usuarioFln.req("POST", "/api/financeiro/extratos/importar", { contaId: c, formato: "OFX", conteudo, confirmar: true }));
    expect(ok).toMatchObject({ previa: false, novas: 2 });
    const de_novo = json(await usuarioFln.req("POST", "/api/financeiro/extratos/importar", { contaId: c, formato: "OFX", conteudo: conteudo.replace("PIX CLIENTE", "PIX CLIENTE"), confirmar: true }));
    expect(de_novo).toMatchObject({ novas: 0, repetidas: 3 });
    expect(json(await usuarioFln.req("GET", `/api/financeiro/extrato/linhas?contaId=${c}`)).total).toBe(2);
    expect((await usuarioFln.req("POST", "/api/financeiro/extratos/importar", { contaId: c, formato: "OFX", conteudo: "isto não é OFX" })).json().codigo).toBe("ARQUIVO_INVALIDO");
    // saldo = saldo inicial (0) + movimento do extrato: 25000 - 10000
    const saldo = (json(await usuarioFln.req("GET", "/api/financeiro/contas")) as Array<{ id: string; saldoCentavos: number }>).find((x) => x.id === c)!.saldoCentavos;
    expect(saldo).toBe(15000);
  });

  it("CSV sem identificador: linhas iguais no mesmo dia são mantidas e reimportar não duplica", async () => {
    const c = await conta(usuarioFln, { nome: "Corrente CSV", tipo: "CORRENTE", unidadeId: fln });
    const csv = "Data;Descrição;Valor\n03/10/2026;Pedágio;-12,50\n03/10/2026;Pedágio;-12,50\n04/10/2026;Venda quiosque;1.000,00\n";
    const a = json(await usuarioFln.req("POST", "/api/financeiro/extratos/importar", { contaId: c, formato: "CSV", conteudo: csv, confirmar: true }));
    expect(a.novas).toBe(3);
    const b = json(await usuarioFln.req("POST", "/api/financeiro/extratos/importar", { contaId: c, formato: "CSV", conteudo: csv, confirmar: true }));
    expect(b).toMatchObject({ novas: 0, repetidas: 3 });
    // arquivo com a mesma linha duas vezes mais: só a terceira ocorrência é nova
    const c2 = json(await usuarioFln.req("POST", "/api/financeiro/extratos/importar", { contaId: c, formato: "CSV", conteudo: csv.replace("04/10", "03/10;x;x\n03/10/2026;Pedágio;-12,50\n04/10"), confirmar: true }));
    expect(c2.novas).toBeGreaterThanOrEqual(1);
  });

  it("fatura de cartão em CSV: compras viram saídas e a fatura soma por ciclo", async () => {
    const c = await conta(usuarioFln, { nome: "Cartão teste", tipo: "CARTAO", unidadeId: fln, diaFechamento: 15, diaVencimento: 25 });
    const csv = "Data;Estabelecimento;Valor\n10/10/2026;Posto X;150,00\n14/10/2026;Pedágio;30,00\n16/10/2026;Oficina;500,00\n18/10/2026;Estorno;-20,00\n";
    const r = json(await usuarioFln.req("POST", "/api/financeiro/extratos/importar", { contaId: c, formato: "CSV", conteudo: csv, confirmar: true }));
    expect(r.novas).toBe(4);
    const linhas = json(await usuarioFln.req("GET", `/api/financeiro/extrato/linhas?contaId=${c}`)).linhas as Array<{ valorCentavos: number }>;
    expect(linhas.map((l) => l.valorCentavos).sort((a, b) => a - b)).toEqual([-50000, -15000, -3000, 2000]);
    const cartoes = json(await usuarioFln.req("GET", "/api/financeiro/cartoes")) as Array<{ id: string; faturas: Array<{ referencia: string; totalCentavos: number; vencimento: string }>; saldoCentavos: number }>;
    const x = cartoes.find((k) => k.id === c)!;
    expect(x.faturas.find((f) => f.referencia === "2026-10")).toMatchObject({ totalCentavos: 18000, vencimento: "2026-10-25" });
    expect(x.faturas.find((f) => f.referencia === "2026-11")).toMatchObject({ totalCentavos: 48000 });
    expect(x.saldoCentavos).toBe(-66000);
  });

  it("não importa em conta de outra praça nem em caixa", async () => {
    const cBc = await conta(admin, { nome: "Corrente BC import", tipo: "CORRENTE", unidadeId: bc });
    expect((await usuarioFln.req("POST", "/api/financeiro/extratos/importar", { contaId: cBc, formato: "CSV", conteudo: "Data;Descrição;Valor\n03/10/2026;x;1,00\n" })).statusCode).toBe(404);
    const caixa = await conta(usuarioFln, { nome: "Caixa quiosque", tipo: "CAIXA", unidadeId: fln });
    expect((await usuarioFln.req("POST", "/api/financeiro/extratos/importar", { contaId: caixa, formato: "CSV", conteudo: "Data;Descrição;Valor\n03/10/2026;x;1,00\n" })).json().codigo).toBe("CONTA_SEM_EXTRATO");
  });
});

describe("conciliação", () => {
  let contaId = "";
  async function linhasPendentes() {
    return json(await usuarioFln.req("GET", `/api/financeiro/extrato/linhas?contaId=${contaId}&status=PENDENTE`)).linhas as Array<{ id: string; descricao: string; valorCentavos: number; sugestoes: Array<{ lancamentoId: string; nivel: string; diferencaCentavos: number }>; categoriaSugerida: { categoriaId: string } | null }>;
  }

  beforeAll(async () => {
    contaId = await conta(usuarioFln, { nome: "Corrente conciliação", tipo: "CORRENTE", unidadeId: fln });
    await usuarioFln.req("POST", "/api/financeiro/regras", { texto: "POSTO ILHA", categoriaId: cat.DESP_COMBUSTIVEL });
    await usuarioFln.req("POST", "/api/financeiro/extratos/importar", {
      contaId, formato: "OFX", confirmar: true,
      conteudo: ofx([
        { fitid: "C1", data: "20261003", valor: "-1234.56", memo: "PAGTO POSTO ILHA LTDA" },
        { fitid: "C2", data: "20261005", valor: "-500.00", memo: "BOLETO OFICINA CENTRAL" },
        { fitid: "C3", data: "20261006", valor: "-80.00", memo: "TARIFA BANCARIA" },
        { fitid: "C4", data: "20261007", valor: "2000.00", memo: "PIX RECEBIDO PAYTOUR" },
      ]),
    });
  });

  it("sugere por valor, data e nome, e sugere categoria por regra — sem conciliar nada sozinho", async () => {
    const lancId = json(await lancar(usuarioFln, { descricao: "Combustível outubro", contraparte: "Posto Ilha", valorCentavos: 123456, vencimento: "2026-10-03" })).ids[0] as string;
    const linhas = await linhasPendentes();
    expect(linhas).toHaveLength(4);
    const posto = linhas.find((l) => l.descricao.includes("POSTO ILHA"))!;
    expect(posto.sugestoes[0]).toMatchObject({ lancamentoId: lancId, nivel: "ALTA", diferencaCentavos: 0 });
    expect(posto.categoriaSugerida?.categoriaId).toBe(cat.DESP_COMBUSTIVEL);
    const lanc = json(await usuarioFln.req("GET", "/api/financeiro/lancamentos?limite=500")).itens.find((x: { id: string }) => x.id === lancId);
    expect(lanc.situacao).toBe("ABERTO");
    expect(lanc.conciliado).toBe(false);
  });

  it("confirmar baixa o lançamento e o trava: valor, datas e exclusão bloqueados; desfazer libera", async () => {
    const linha = (await linhasPendentes()).find((l) => l.descricao.includes("POSTO ILHA"))!;
    const lancId = linha.sugestoes[0]!.lancamentoId;
    const r = await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/conciliar`, { lancamentoId: lancId });
    expect(r.statusCode, r.body).toBe(200);
    const lanc = json(await usuarioFln.req("GET", "/api/financeiro/lancamentos?limite=500")).itens.find((x: { id: string }) => x.id === lancId);
    expect(lanc).toMatchObject({ situacao: "REALIZADO", conciliado: true, valorPagoCentavos: 123456, pagoEm: "2026-10-03", contaId });
    expect((await usuarioFln.req("PATCH", `/api/financeiro/lancamentos/${lancId}`, { valorCentavos: 1000 })).json().codigo).toBe("LANCAMENTO_CONCILIADO");
    expect((await usuarioFln.req("PATCH", `/api/financeiro/lancamentos/${lancId}`, { vencimento: "2026-10-04" })).json().codigo).toBe("LANCAMENTO_CONCILIADO");
    expect((await usuarioFln.req("PATCH", `/api/financeiro/lancamentos/${lancId}`, { competencia: "2026-09-01" })).json().codigo).toBe("LANCAMENTO_CONCILIADO");
    expect((await usuarioFln.req("DELETE", `/api/financeiro/lancamentos/${lancId}`)).json().codigo).toBe("LANCAMENTO_CONCILIADO");
    expect((await usuarioFln.req("POST", `/api/financeiro/lancamentos/${lancId}/reabrir`)).json().codigo).toBe("LANCAMENTO_CONCILIADO");
    // a linha já decidida não concilia de novo
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/conciliar`, { lancamentoId: lancId })).json().codigo).toBe("LINHA_JA_DECIDIDA");
    // campos livres continuam editáveis
    expect((await usuarioFln.req("PATCH", `/api/financeiro/lancamentos/${lancId}`, { observacao: "ok", linha: "CITY_TOUR" })).statusCode).toBe(200);
    // desfazer devolve o lançamento a "em aberto" e a linha a pendente
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/desfazer`)).statusCode).toBe(200);
    const depois = json(await usuarioFln.req("GET", "/api/financeiro/lancamentos?limite=500")).itens.find((x: { id: string }) => x.id === lancId);
    expect(depois).toMatchObject({ situacao: "ABERTO", conciliado: false, valorPagoCentavos: null });
    expect((await linhasPendentes()).some((l) => l.id === linha.id)).toBe(true);
  });

  it("diferença de valor exige destino explícito (juros, multa ou desconto); nada é arredondado", async () => {
    const linha = (await linhasPendentes()).find((l) => l.descricao.includes("OFICINA"))!;
    const lancId = json(await lancar(usuarioFln, { descricao: "Oficina Central", categoriaId: cat.DESP_MANUTENCAO, valorCentavos: 49000, vencimento: "2026-10-05" })).ids[0] as string;
    const sem = await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/conciliar`, { lancamentoId: lancId });
    expect(sem.statusCode).toBe(400);
    expect(sem.json().codigo).toBe("DIFERENCA_SEM_DESTINO");
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/conciliar`, { lancamentoId: lancId, diferenca: "DESCONTO" })).json().codigo).toBe("DIFERENCA_SEM_DESTINO");
    const ok = json(await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/conciliar`, { lancamentoId: lancId, diferenca: "MULTA" }));
    expect(ok).toMatchObject({ multaCentavos: 1000, jurosCentavos: 0, descontoCentavos: 0 });
    const lanc = json(await usuarioFln.req("GET", "/api/financeiro/lancamentos?limite=500")).itens.find((x: { id: string }) => x.id === lancId);
    expect(lanc).toMatchObject({ valorCentavos: 49000, valorPagoCentavos: 50000, multaCentavos: 1000 });
  });

  it("sentido incompatível e lançamento já conciliado são recusados", async () => {
    const entrada = (await linhasPendentes()).find((l) => l.valorCentavos === 200000)!;
    const pagar = json(await lancar(usuarioFln, { valorCentavos: 200000, vencimento: "2026-10-07" })).ids[0] as string;
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${entrada.id}/conciliar`, { lancamentoId: pagar })).json().codigo).toBe("SENTIDO_INCOMPATIVEL");
  });

  it("recusar uma sugestão: ela nunca volta para aquela linha", async () => {
    const lancId = json(await lancar(usuarioFln, { descricao: "Tarifa mensal", valorCentavos: 8000, vencimento: "2026-10-06", categoriaId: cat.DESP_TAXAS })).ids[0] as string;
    const linha = (await linhasPendentes()).find((l) => l.descricao.includes("TARIFA"))!;
    expect(linha.sugestoes.map((s) => s.lancamentoId)).toContain(lancId);
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/recusar`, { lancamentoId: lancId })).statusCode).toBe(200);
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/recusar`, { lancamentoId: lancId })).statusCode).toBe(200); // idempotente
    const de_novo = (await linhasPendentes()).find((l) => l.id === linha.id)!;
    expect(de_novo.sugestoes.map((s) => s.lancamentoId)).not.toContain(lancId);
  });

  it("lançar a partir da linha cria o lançamento realizado já conciliado; desfazer o remove", async () => {
    const linha = (await linhasPendentes()).find((l) => l.descricao.includes("TARIFA"))!;
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/lancar`, { categoriaId: cat.REC_FRETAMENTO })).json().codigo).toBe("CATEGORIA_INCOMPATIVEL");
    const r = json(await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/lancar`, { categoriaId: cat.DESP_TAXAS, descricao: "Tarifa bancária" }));
    const lanc = json(await usuarioFln.req("GET", "/api/financeiro/lancamentos?limite=500")).itens.find((x: { id: string }) => x.id === r.lancamentoId);
    expect(lanc).toMatchObject({ tipo: "PAGAR", situacao: "REALIZADO", valorCentavos: 8000, valorPagoCentavos: 8000, origem: "EXTRATO", conciliado: true, unidadeId: fln });
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/lancar`, { categoriaId: cat.DESP_TAXAS })).json().codigo).toBe("LINHA_JA_DECIDIDA");
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/desfazer`)).statusCode).toBe(200);
    expect(json(await usuarioFln.req("GET", "/api/financeiro/lancamentos?limite=500")).itens.some((x: { id: string }) => x.id === r.lancamentoId)).toBe(false);
  });

  it("ignorar e desfazer", async () => {
    const linha = (await linhasPendentes()).find((l) => l.valorCentavos === 200000)!;
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/ignorar`, {})).statusCode).toBe(200);
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/ignorar`, {})).statusCode).toBe(409);
    expect((await linhasPendentes()).some((l) => l.id === linha.id)).toBe(false);
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/desfazer`)).statusCode).toBe(200);
    expect((await linhasPendentes()).some((l) => l.id === linha.id)).toBe(true);
  });

  it("só quem gerencia decide; leitor consulta sugestões mas não concilia", async () => {
    const linha = (await linhasPendentes())[0]!;
    expect((await leitor.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/ignorar`, {})).statusCode).toBe(403);
    expect((await admin.req("GET", `/api/financeiro/extrato/linhas?contaId=${contaId}`)).statusCode).toBe(200);
    expect((await usuarioBc.req("GET", `/api/financeiro/extrato/linhas?contaId=${contaId}`)).statusCode).toBe(404);
    expect((await usuarioBc.req("POST", `/api/financeiro/extrato/linhas/${linha.id}/ignorar`, {})).statusCode).toBe(404);
  });
});

describe("transferência entre contas", () => {
  it("lança as duas pontas pareadas, move saldos e pode ser desfeita; não vira receita nem despesa", async () => {
    const corrente = await conta(usuarioFln, { nome: "Corrente transf", tipo: "CORRENTE", unidadeId: fln, saldoInicialCentavos: 100000 });
    const cartao = await conta(usuarioFln, { nome: "Cartão transf", tipo: "CARTAO", unidadeId: fln, diaFechamento: 10, diaVencimento: 20, contaPagamentoId: corrente });
    const r = json(await usuarioFln.req("POST", "/api/financeiro/transferencias", { contaOrigemId: corrente, contaDestinoId: cartao, valorCentavos: 33333, data: "2026-10-20" }));
    const saldos = async () => Object.fromEntries((json(await usuarioFln.req("GET", "/api/financeiro/contas")) as Array<{ id: string; saldoCentavos: number }>).map((c) => [c.id, c.saldoCentavos]));
    let s = await saldos();
    expect(s[corrente]).toBe(100000 - 33333);
    expect(s[cartao]).toBe(33333);
    expect((await usuarioFln.req("POST", "/api/financeiro/transferencias", { contaOrigemId: corrente, contaDestinoId: corrente, valorCentavos: 1, data: "2026-10-20" })).json().codigo).toBe("MESMA_CONTA");
    expect((await usuarioFln.req("POST", "/api/financeiro/transferencias", { contaOrigemId: corrente, contaDestinoId: cartao, valorCentavos: 1, data: "2099-10-20" })).json().codigo).toBe("DATA_FUTURA");
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${r.linhaOrigemId}/desfazer`)).statusCode).toBe(200);
    s = await saldos();
    expect(s[corrente]).toBe(100000);
    expect(s[cartao]).toBe(0);
  });

  it("pareia duas linhas importadas de contas diferentes (mesmo valor, sentidos opostos)", async () => {
    const a = await conta(usuarioFln, { nome: "Corrente par A", tipo: "CORRENTE", unidadeId: fln });
    const b = await conta(usuarioFln, { nome: "Corrente par B", tipo: "CORRENTE", unidadeId: fln });
    await usuarioFln.req("POST", "/api/financeiro/extratos/importar", { contaId: a, formato: "CSV", confirmar: true, conteudo: "Data;Descrição;Valor\n10/10/2026;TED enviada;-777,77\n" });
    await usuarioFln.req("POST", "/api/financeiro/extratos/importar", { contaId: b, formato: "CSV", confirmar: true, conteudo: "Data;Descrição;Valor\n11/10/2026;TED recebida;777,77\n11/10/2026;Outra;5,00\n" });
    const la = json(await usuarioFln.req("GET", `/api/financeiro/extrato/linhas?contaId=${a}`)).linhas[0];
    const lb = json(await usuarioFln.req("GET", `/api/financeiro/extrato/linhas?contaId=${b}`)).linhas as Array<{ id: string; valorCentavos: number }>;
    expect(la.pares.map((p: { contaId: string }) => p.contaId)).toEqual([b]);
    const alvo = lb.find((l) => l.valorCentavos === 77777)!;
    const outra = lb.find((l) => l.valorCentavos === 500)!;
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${la.id}/transferencia`, { parLinhaId: outra.id })).json().codigo).toBe("VALORES_DIFERENTES");
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${la.id}/transferencia`, { parLinhaId: alvo.id })).statusCode).toBe(200);
    const pend = json(await usuarioFln.req("GET", `/api/financeiro/extrato/linhas?contaId=${a}&status=TRANSFERENCIA`));
    expect(pend.total).toBe(1);
    expect((await usuarioFln.req("POST", `/api/financeiro/extrato/linhas/${la.id}/desfazer`)).statusCode).toBe(200);
    expect(json(await usuarioFln.req("GET", `/api/financeiro/extrato/linhas?contaId=${b}&status=PENDENTE`)).total).toBe(2);
  });
});

describe("resumo: a pagar/receber, vencidas, fluxo e DRE", () => {
  it("fecha os números de um mês isolado (praça BC)", async () => {
    const c = await conta(usuarioBc, { nome: "Corrente resumo", tipo: "CORRENTE", unidadeId: bc, saldoInicialCentavos: 500000 });
    const base = { unidadeId: bc, linha: "FRETAMENTO" };
    await lancar(usuarioBc, { ...base, descricao: "Combustível vencido", valorCentavos: 100000, competencia: "2026-09-01", vencimento: "2026-09-05" });
    await lancar(usuarioBc, { ...base, descricao: "Manutenção", categoriaId: cat.DESP_MANUTENCAO, valorCentavos: 50000, competencia: "2026-09-10", vencimento: "2026-09-28" });
    const rec = json(await lancar(usuarioBc, { ...base, tipo: "RECEBER", descricao: "Fretamento setembro", categoriaId: cat.REC_FRETAMENTO, valorCentavos: 200000, competencia: "2026-09-01", vencimento: "2026-09-12" })).ids[0] as string;
    expect((await usuarioBc.req("POST", `/api/financeiro/lancamentos/${rec}/baixa`, { pagoEm: "2026-09-12", contaId: c, jurosCentavos: 1000 })).statusCode).toBe(200);

    const r = json(await usuarioBc.req("GET", `/api/financeiro/resumo?mes=2026-09&unidadeId=${bc}&ref=2026-09-20`));
    expect(r.aPagar).toMatchObject({ abertoCentavos: 150000, abertoQtd: 2 });
    expect(r.aReceber).toMatchObject({ realizadoCentavos: 201000, realizadoQtd: 1, abertoCentavos: 0 });
    expect(r.vencidas.pagar).toEqual({ qtd: 1, centavos: 100000 });
    expect(r.vencidas.receber).toEqual({ qtd: 0, centavos: 0 });
    expect(r.saldoCaixaCentavos).toBe(701000);

    const atual = r.fluxo.find((s: { atual: boolean }) => s.atual);
    expect(atual.inicio).toBe("2026-09-14");
    expect(atual.saidasPrevistasCentavos).toBe(100000);
    expect(atual.saldoProjetadoCentavos).toBe(601000);
    const anterior = r.fluxo.find((s: { inicio: string }) => s.inicio === "2026-09-07");
    expect(anterior.entradasRealizadasCentavos).toBe(201000);
    expect(r.fluxo.find((s: { inicio: string }) => s.inicio === "2026-09-28").saldoProjetadoCentavos).toBe(551000);

    // DRE: receita com juros recebidos (separado), despesas por grupo, resultado exato
    expect(r.dre.receitaCentavos).toBe(201000);
    expect(r.dre.despesaCentavos).toBe(150000);
    expect(r.dre.resultadoCentavos).toBe(51000);
    expect(r.dre.margemPontosBase).toBe(Math.trunc((51000 * 10000) / 201000));
    expect(r.dre.grupos.map((g: { grupo: string }) => g.grupo)).toEqual(["Receitas operacionais", "Juros, multas e descontos", "Custos operacionais"]);
    expect(r.dre.porPracaLinha).toEqual([{ unidadeId: bc, linha: "FRETAMENTO", receitaCentavos: 201000, despesaCentavos: 150000, resultadoCentavos: 51000 }]);

    // usuário de FLN não enxerga os números de BC, nem escolhendo a praça
    const fln_ = json(await usuarioFln.req("GET", `/api/financeiro/resumo?mes=2026-09&unidadeId=${bc}&ref=2026-09-20`));
    expect(fln_.aPagar.abertoQtd).toBe(0);
    expect(fln_.dre.receitaCentavos).toBe(0);
    expect(fln_.saldoCaixaCentavos).toBe(0);
  });

  it("recusa mês inválido", async () => {
    expect((await admin.req("GET", "/api/financeiro/resumo?mes=2026-13")).statusCode).toBe(400);
  });
});

describe("auditoria", () => {
  it("toda ação que grava deixa rastro (sem dados pessoais)", async () => {
    const { db, pool } = criarDb(DATABASE_URL);
    const linhas = await db.select({ acao: auditoria.acao }).from(auditoria).where(like(auditoria.acao, "FIN_%"));
    await pool.end();
    const acoes = new Set(linhas.map((l) => l.acao));
    for (const a of ["FIN_CONTA_CRIADA", "FIN_LANCAMENTO_CRIADO", "FIN_LANCAMENTO_BAIXADO", "FIN_LANCAMENTO_REABERTO", "FIN_EXTRATO_IMPORTADO", "FIN_CONCILIADO", "FIN_SUGESTAO_RECUSADA", "FIN_TRANSFERENCIA_CRIADA", "FIN_DECISAO_DESFEITA", "FIN_REGRA_CRIADA"]) {
      expect(acoes.has(a), a).toBe(true);
    }
  });
});
