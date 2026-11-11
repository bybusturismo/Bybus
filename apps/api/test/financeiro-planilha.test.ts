import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { criarDb } from "../src/db/cliente.js";
import { SENHA_DEMO } from "../src/db/ficticios.js";
import { auditoria, finPlanilhaPendencias, perfis, unidades, usuarios, usuariosUnidades } from "../src/db/schema.js";
import { gerarHashSenha } from "../src/seguranca/senha.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

const NOVO = readFileSync(new URL("./fixtures/controle-financeiro-ficticio.csv", import.meta.url), "utf8");
const ANTIGO = readFileSync(new URL("./fixtures/controle-financeiro-antigo-ficticio.csv", import.meta.url), "utf8");
const VAZAMENTOS = ["12.345.678", "oficinateste", "99999-1234", "123.456.789", "12345678000195"];

let app: FastifyInstance;
let fechar: () => Promise<void>;
let admin: Cliente;
let usuarioFln: Cliente;
let usuarioBc: Cliente;
let leitor: Cliente;
let atendente: Cliente;
let fln = "";
let bc = "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (r: { json: () => unknown }) => r.json() as any;

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
  const { db, pool } = criarDb(DATABASE_URL);
  const hash = await gerarHashSenha(SENHA_DEMO);
  const lu = await db.select().from(unidades);
  fln = lu.find((x) => x.codigo === "FLN")!.id;
  bc = lu.find((x) => x.codigo === "BC")!.id;
  const novoPerfil = async (codigo: string, permissoes: string[]) => (await db.insert(perfis).values({ codigo, nome: codigo, permissoes }).returning())[0]!.id;
  const pFin = await novoPerfil("PLAN_FIN", ["financeiro:ver", "financeiro:gerenciar"]);
  const pLeitor = await novoPerfil("PLAN_LEITOR", ["financeiro:ver"]);
  const criar = async (email: string, perfilId: string, unidadeId: string) => {
    const [u] = await db.insert(usuarios).values({ nome: email, email, perfilId, senhaHash: hash, trocarSenha: false }).returning({ id: usuarios.id });
    await db.insert(usuariosUnidades).values({ usuarioId: u!.id, unidadeId });
  };
  await criar("plan.fln@bybus.test", pFin, fln);
  await criar("plan.bc@bybus.test", pFin, bc);
  await criar("plan.leitor@bybus.test", pLeitor, fln);
  await pool.end();
  const entrar = async (email: string) => { const c = new Cliente(app); expect((await c.login(email)).statusCode).toBe(200); return c; };
  admin = await entrar("admin@bybus.test");
  usuarioFln = await entrar("plan.fln@bybus.test");
  usuarioBc = await entrar("plan.bc@bybus.test");
  leitor = await entrar("plan.leitor@bybus.test");
  atendente = await entrar("atendente@bybus.test");
});
afterAll(async () => fechar());

const importar = (c: Cliente, corpo: Record<string, unknown>) => c.req("POST", "/api/financeiro/planilha/importar", corpo);
const contas = async (c: Cliente) => json(await c.req("GET", "/api/financeiro/contas")) as Array<{ id: string; nome: string; tipo: string; saldoCentavos: number; saldoInicialCentavos: number; saldoInicialEm: string | null }>;
const conta = async (c: Cliente, nome: string) => (await contas(c)).find((x) => x.nome === nome)!;
const lancamentos = async (c: Cliente) => json(await c.req("GET", "/api/financeiro/lancamentos?limite=500")).itens as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("importação da planilha (layout novo)", () => {
  it("permissões e escopo", async () => {
    const corpo = { conteudo: NOVO, unidadeId: fln };
    expect((await importar(leitor, corpo)).statusCode).toBe(403);
    expect((await importar(atendente, corpo)).statusCode).toBe(403);
    expect((await importar(usuarioFln, { conteudo: NOVO })).json().codigo).toBe("PRACA_OBRIGATORIA");
    expect((await importar(usuarioFln, { conteudo: NOVO, unidadeId: bc })).statusCode).toBe(403);
    expect((await importar(usuarioFln, { conteudo: "a,b\n1,2", unidadeId: fln })).json().codigo).toBe("PLANILHA_INVALIDA");
  });

  it("prévia: lê o cabeçalho, ignora o resumo, mostra o que não reconheceu e não grava nada", async () => {
    const r = json(await importar(usuarioFln, { conteudo: NOVO, unidadeId: fln }));
    expect(r).toMatchObject({ previa: true, layout: "NOVO", cabecalhoLinha: 14, novos: { lancamentos: 13, transferencias: 1 }, jaExistentes: 0, abertos: 1, realizados: 12 });
    expect(r.naoReconhecidos).toEqual([{ chave: "AGENDA|LEMBRETE", grupo: "AGENDA", categoria: "LEMBRETE", qtd: 1, totalCentavos: 1000 }]);
    expect(r.contasACriar.sort()).toEqual(["Cartão", "Quiosque", "Sicredi", "Unilos"]);
    expect(r.saldos.map((s: { coluna: string; valorCentavos: number; data: string; aplicar: boolean }) => [s.coluna, s.valorCentavos, s.data, s.aplicar])).toEqual([
      ["SICREDI", 1000000, "2026-10-02", true], ["UNILOS", 500000, "2026-10-02", true], ["QUIOSQUE", 30000, "2026-10-02", true],
    ]);
    expect(r.qualidade.duplicadas.total).toBe(1); // as duas linhas "Gelo": só avisa, não descarta
    expect(r.qualidade.grafias.find((g: { canonico: string }) => g.canonico === "FROTA").variantes).toEqual(expect.arrayContaining([{ texto: "FOTA", qtd: 1 }, { texto: "FROTA", qtd: 2 }]));
    expect(r.qualidade.grafias.find((g: { canonico: string }) => g.canonico === "RECEITA").variantes).toEqual(expect.arrayContaining([{ texto: "RECEIRA", qtd: 1 }]));
    expect(r.qualidade.pessoaFisica.total).toBe(1);
    expect(r.qualidade.previstas).toBe(0);
    expect((await contas(usuarioFln)).length).toBe(0);
    expect((await lancamentos(usuarioFln)).length).toBe(0);
  });

  it("confirmar: lançamentos baixados na conta da coluna, A PAGAR em aberto, transferência, saldo inicial e contas padrão", async () => {
    const r = json(await importar(usuarioFln, { conteudo: NOVO, unidadeId: fln, confirmar: true }));
    expect(r.resultado).toMatchObject({ lancamentos: 13, transferencias: 1, jaExistentes: 0, saldosAplicados: 3 });
    expect(r.resultado.contasCriadas.sort()).toEqual(["Cartão", "Quiosque", "Sicredi", "Unilos"]);
    const itens = await lancamentos(usuarioFln);
    const por = (d: string) => itens.find((x) => x.descricao.startsWith(d))!;
    expect(por("Revisão QJQ2A16")).toMatchObject({ tipo: "PAGAR", situacao: "REALIZADO", valorCentavos: 150000, valorPagoCentavos: 150000, categoriaNome: "Manutenção", contaNome: "Sicredi", veiculo: "QJQ2A16", vencimento: "2026-10-05", origem: "PLANILHA" });
    expect(por("Diesel ABC-1D23")).toMatchObject({ valorCentavos: 80025, categoriaNome: "Combustível", veiculo: "ABC1D23" });
    expect(por("Parcela de outubro")).toMatchObject({ situacao: "ABERTO", tipo: "PAGAR", valorCentavos: 90000, contaId: null, valorPagoCentavos: null, categoriaNome: "Consórcio" });
    expect(por("Fretamento de outubro")).toMatchObject({ tipo: "RECEBER", categoriaNome: "Clientes (canal não informado)", valorPagoCentavos: 500000 });
    expect(itens.filter((x) => x.descricao === "Gelo")).toHaveLength(2);
    expect(por("Folha de outubro")).toMatchObject({ categoriaNome: "Salários CLT e encargos", contaNome: "Unilos" });
    expect(por("Despesa pessoal")).toMatchObject({ categoriaNome: "Despesa direta (pessoal)" });
    expect(por("Lavagem ABC-1D23")).toMatchObject({ contaNome: "Cartão", valorCentavos: 6000 });
    // Saldos: saldo inicial + movimentos (a transferência move R$ 1.000 do Sicredi para a Unilos)
    expect((await conta(usuarioFln, "Sicredi"))).toMatchObject({ saldoInicialCentavos: 1000000, saldoInicialEm: "2026-10-02", saldoCentavos: 1247197 });
    expect((await conta(usuarioFln, "Unilos")).saldoCentavos).toBe(500000 - 200000 + 100000);
    expect((await conta(usuarioFln, "Quiosque"))).toMatchObject({ tipo: "CAIXA", saldoCentavos: 30000 + 25000 - 4000 - 4000 });
    expect((await conta(usuarioFln, "Cartão")).saldoCentavos).toBe(-6000);
  });

  it("reimportar a mesma aba não duplica nada", async () => {
    const antes = (await lancamentos(usuarioFln)).length;
    const previa = json(await importar(usuarioFln, { conteudo: NOVO, unidadeId: fln }));
    expect(previa.novos).toEqual({ lancamentos: 0, transferencias: 0 });
    expect(previa.jaExistentes).toBe(14);
    const r = json(await importar(usuarioFln, { conteudo: NOVO, unidadeId: fln, confirmar: true }));
    expect(r.resultado).toMatchObject({ lancamentos: 0, transferencias: 0, contasCriadas: [], saldosAplicados: 0 });
    expect((await lancamentos(usuarioFln)).length).toBe(antes);
    const sic = await conta(usuarioFln, "Sicredi");
    expect(sic.saldoCentavos).toBe(1247197);
    expect(previa.saldos.every((s: { aplicar: boolean; divergenciaCentavos: number }) => !s.aplicar && s.divergenciaCentavos === 0)).toBe(true);
  });

  it("OBS com CPF/CNPJ/e-mail/telefone não vaza para descrição, observação, auditoria nem respostas; vira dado do favorecido", async () => {
    const { pool, db } = { ...criarDb(DATABASE_URL) };
    const linhas = (await pool.query("select row_to_json(l)::text as t from fin_lancamentos l")).rows.map((r: { t: string }) => r.t).join("\n");
    const aud = JSON.stringify((await db.select().from(auditoria)).map((a) => a.dados));
    await pool.end();
    const previa = JSON.stringify(json(await importar(usuarioFln, { conteudo: NOVO, unidadeId: fln })));
    const lista = JSON.stringify(await lancamentos(usuarioFln));
    const forn = json(await usuarioFln.req("GET", "/api/financeiro/fornecedores")) as Array<{ id: string; nome: string; temContato: boolean }>;
    for (const trecho of VAZAMENTOS) for (const alvo of [linhas, aud, previa, lista, JSON.stringify(forn)]) expect(alvo.toLowerCase()).not.toContain(trecho.toLowerCase());
    const oficina = forn.find((f) => f.nome === "Oficina Teste")!;
    expect(oficina.temContato).toBe(true);
    const consorcio = forn.find((f) => f.nome === "Consórcio Teste")!;
    // contato só para quem tem financeiro:ver
    expect((await atendente.req("GET", `/api/financeiro/fornecedores/${oficina.id}`)).statusCode).toBe(403);
    const contato = json(await leitor.req("GET", `/api/financeiro/fornecedores/${oficina.id}`)).contato;
    expect(contato.documentos).toEqual(["12.345.678/0001-95"]);
    expect(contato.emails).toEqual(["contato@oficinateste.example"]);
    expect(contato.telefones).toHaveLength(1);
    expect(json(await leitor.req("GET", `/api/financeiro/fornecedores/${consorcio.id}`)).contato.documentos).toEqual(["123.456.789-09"]);
  });

  it("DRE e resumo do mês: pessoal fora do resultado, receita por conta, transferência fora", async () => {
    const r = json(await usuarioFln.req("GET", `/api/financeiro/resumo?mes=2026-10&unidadeId=${fln}&ref=2026-10-31`));
    expect(r.dre.receitaCentavos).toBe(500000 + 123456 + 25000);
    // Consórcio (90000) é investimento: fica abaixo da linha desde a DRE de 10/11/2026.
    expect(r.dre.despesaCentavos).toBe(150000 + 80025 + 200000 + 8000 + 30000 + 1234 + 6000);
    expect(r.dre.resultadoCentavos).toBe(648456 - 475259);
    expect(r.dre.pessoalCentavos).toBe(15000);
    expect(r.dre.resultadoAposPessoalCentavos).toBe(648456 - 475259 - 15000);
    expect(r.dre.foraDoResultado.map((g: { grupo: string }) => g.grupo).sort()).toEqual(["Investimentos (fora do resultado)", "Pessoal (despesas pessoais pagas pela empresa)"]);
    expect(r.dre.grupos.map((g: { grupo: string }) => g.grupo)).toEqual(["Passeios regulares", "Impostos sobre o faturamento", "Comissões e taxas de venda", "Combustível", "Manutenção e peças", "Pessoal fixo", "Administrativo e comercial"]);
    // Aba DRE (12 meses): outubro fecha com o mesmo resultado do resumo; consórcio e pessoal ficam abaixo da linha.
    const dre = json(await usuarioFln.req("GET", `/api/financeiro/dre?ano=2026&unidadeId=${fln}`));
    expect(dre.meses).toHaveLength(12);
    expect(dre.resultadoLiquido[9]).toBe(r.dre.resultadoCentavos);
    expect(dre.receitaBruta[9]).toBe(r.dre.receitaCentavos);
    expect(dre.abaixoDaLinha.filter((l: { nivel: string }) => l.nivel === "GRUPO").map((l: { nome: string; total: number }) => [l.nome, l.total])).toEqual([
      ["Investimentos (fora do resultado)", -90000], ["Pessoal (despesas pessoais pagas pela empresa)", -15000],
    ]);
    const caixa = json(await usuarioFln.req("GET", `/api/financeiro/dre?ano=2026&unidadeId=${fln}&regime=CAIXA`));
    expect(caixa.regime).toBe("CAIXA");
    expect(r.receitaPorConta).toEqual([{ contaId: expect.any(String), nome: "Quiosque", totalCentavos: 25000 }, { contaId: expect.any(String), nome: "Sicredi", totalCentavos: 623456 }]);
    expect(r.saldoCaixaCentavos).toBe(1247197 + 400000 + 47000);
  });

  it("filtros da lista (11/11/2026): fornecedor, banco, faixa de valor e totais com vencidas", async () => {
    const lista = async (q: string) => json(await usuarioFln.req("GET", `/api/financeiro/lancamentos?limite=500&${q}`));
    const porForn = await lista("fornecedor=oficina");
    expect(porForn.itens.map((x: { descricao: string }) => x.descricao)).toEqual(["Revisão QJQ2A16"]);
    const faixa = await lista("tipo=PAGAR&valorMin=100000&valorMax=150000");
    expect(faixa.itens.every((x: { valorCentavos: number }) => x.valorCentavos >= 100000 && x.valorCentavos <= 150000)).toBe(true);
    expect(faixa.itens.length).toBeGreaterThan(0);
    const sic = (await conta(usuarioFln, "Sicredi")).id;
    const doBanco = await lista(`contaId=${sic}`);
    expect(doBanco.itens.every((x: { contaId: string }) => x.contaId === sic)).toBe(true);
    expect(doBanco).toMatchObject({ somaVencidoCentavos: expect.any(Number), qtdVencido: expect.any(Number) });
  });

  it("saldos: a linha AAA SALDO de uma aba seguinte só confere com o saldo calculado e mostra a divergência, sem sobrescrever", async () => {
    const aba = `MÊS,CONTA,DATA,,CAT,FORNECEDOR,DESCRIÇÃO, A PAGAR , SICREDI , UNILOS , QUIOSQUE , CARTÃO ,OBS\nNOV,,01/11/2026,,AAA SALDO,,,," R$  12.500,00 "," R$  4.000,00 ",,,\n`;
    const r = json(await importar(usuarioFln, { conteudo: aba, unidadeId: fln }));
    const sic = r.saldos.find((s: { coluna: string }) => s.coluna === "SICREDI");
    expect(sic).toMatchObject({ aplicar: false, calculadoCentavos: 1247197, divergenciaCentavos: 1250000 - 1247197 });
    expect(r.saldos.find((s: { coluna: string }) => s.coluna === "UNILOS")).toMatchObject({ calculadoCentavos: 400000, divergenciaCentavos: 0 });
    json(await importar(usuarioFln, { conteudo: aba, unidadeId: fln, confirmar: true }));
    expect((await conta(usuarioFln, "Sicredi")).saldoInicialCentavos).toBe(1000000); // não sobrescreveu
  });

  it("mapear o que não foi reconhecido na hora, lembrar como sinônimo e reimportar sem repetir o mapeamento", async () => {
    const cats = json(await usuarioFln.req("GET", "/api/financeiro/categorias")) as Array<{ id: string; codigo: string }>;
    const outras = cats.find((c) => c.codigo === "DESP_OUTRAS")!.id;
    const mapeamentos = { "AGENDA|LEMBRETE": outras };
    const previa = json(await importar(usuarioFln, { conteudo: NOVO, unidadeId: fln, mapeamentos }));
    expect(previa.naoReconhecidos).toEqual([]);
    expect(previa.novos.lancamentos).toBe(1);
    const r = json(await importar(usuarioFln, { conteudo: NOVO, unidadeId: fln, mapeamentos, confirmar: true, salvarSinonimos: true }));
    expect(r.resultado).toMatchObject({ lancamentos: 1, sinonimosSalvos: 1 });
    const de_novo = json(await importar(usuarioFln, { conteudo: NOVO, unidadeId: fln }));
    expect(de_novo.naoReconhecidos).toEqual([]);
    expect(de_novo.novos).toEqual({ lancamentos: 0, transferencias: 0 });
  });

  it("'não importar ainda' fica guardado em Pendências e é resolvido sem importar de novo", async () => {
    const aba = NOVO.replace("AGENDA", "AGENDA NOVA");
    const r = json(await importar(usuarioFln, { conteudo: aba, unidadeId: fln, arquivo: "outubro.csv", confirmar: true }));
    expect(r.resultado.pendentes).toBe(1);
    const p = json(await usuarioFln.req("GET", "/api/financeiro/planilha/pendencias"));
    expect(p.itens).toEqual([{ chave: "AGENDA NOVA|LEMBRETE", grupo: "AGENDA NOVA", categoria: "LEMBRETE", qtd: 1, totalCentavos: 1000, abas: 1 }]);
    expect(p.abas[0]).toMatchObject({ arquivo: "outubro.csv", linhas: 1 });
    // Outra praça não vê as pendências de Florianópolis.
    expect(json(await usuarioBc.req("GET", "/api/financeiro/planilha/pendencias")).itens).toEqual([]);
    const cats = json(await usuarioFln.req("GET", "/api/financeiro/categorias")) as Array<{ id: string; codigo: string }>;
    const outras = cats.find((c) => c.codigo === "DESP_OUTRAS")!.id;
    const antes = (await lancamentos(usuarioFln)).length;
    const res = json(await usuarioFln.req("POST", "/api/financeiro/planilha/pendencias/resolver", { mapeamentos: { "AGENDA NOVA|LEMBRETE": outras } }));
    expect(res).toMatchObject({ lancamentos: 1, abas: 1, restantes: 0 });
    expect((await lancamentos(usuarioFln)).length).toBe(antes + 1); // só a linha pendente; o resto da aba não duplicou
    expect(json(await usuarioFln.req("GET", "/api/financeiro/planilha/pendencias")).itens).toEqual([]);
    const { db, pool } = criarDb(DATABASE_URL);
    try {
      const regs = await db.select().from(finPlanilhaPendencias);
      expect(regs.every((x) => x.conteudoCifrado === null && x.resolvidoEm !== null)).toBe(true); // a aba guardada é apagada ao resolver
    } finally { await pool.end(); }
  });

  it("linha com valor inválido bloqueia a confirmação", async () => {
    const ruim = NOVO.replace('" R$  5.000,00 "', '" R$  abc "');
    const previa = json(await importar(usuarioFln, { conteudo: ruim, unidadeId: fln }));
    expect(previa.totalErros).toBe(1);
    expect((await importar(usuarioFln, { conteudo: ruim, unidadeId: fln, confirmar: true })).json().codigo).toBe("PLANILHA_COM_ERROS");
  });
});

describe("importação da planilha (layout antigo, praça BC)", () => {
  it("prévia: layout antigo, qualidade dos dados e tipos fora do resultado", async () => {
    const r = json(await importar(usuarioBc, { conteudo: ANTIGO, unidadeId: bc }));
    expect(r).toMatchObject({ layout: "ANTIGO", cabecalhoLinha: 4, novos: { lancamentos: 13, transferencias: 2 } });
    expect(r.naoReconhecidos.map((n: { chave: string }) => n.chave)).toEqual(["?|MANUTENCAO"]);
    const q = r.qualidade;
    expect(q.dataInvalida).toEqual({ total: 1, linhas: [{ linha: 14, texto: "03/06" }] });
    expect(q.mesDiferente.total).toBe(1);
    expect(q.anoFora).toEqual({ total: 1, linhas: [{ linha: 22, data: "2025-09-15" }] });
    expect(q.grupoVazio.total).toBe(1);
    expect(q.duplicadas.total).toBe(1);
    expect(q.pessoaFisica.total).toBe(1);
    expect(q.previstas).toBe(1);
    expect(q.apagarDiferente).toBe(1);
    expect(r.avisos.join(" ")).toMatch(/Layout antigo/);
    expect(r.contasACriar.sort()).toEqual(["Aplicação", "Cartão", "Sicredi", "Unilos"]);
  });

  it("confirmar: A PAGAR com valor pago menor vira desconto; aplicação, transferência, empréstimo e devolução fora da operação", async () => {
    const r = json(await importar(usuarioBc, { conteudo: ANTIGO, unidadeId: bc, confirmar: true }));
    expect(r.resultado).toMatchObject({ lancamentos: 13, transferencias: 2 });
    const itens = await lancamentos(usuarioBc);
    expect(itens.find((x) => x.descricao.startsWith("Revisão ABC-1D23"))).toMatchObject({ valorCentavos: 100000, valorPagoCentavos: 80000, descontoCentavos: 20000, jurosCentavos: 0, situacao: "REALIZADO" });
    expect(itens.find((x) => x.descricao === "Parcela futura")).toMatchObject({ situacao: "ABERTO", vencimento: "2026-12-30" });
    expect(itens.filter((x) => x.descricao === "Diária de motorista")).toHaveLength(2);
    const sic = await conta(usuarioBc, "Sicredi");
    // saldo +8.000 (ENTR) + 4.000 − 800 − 600 + 3.000 − 100 + 50 − 300 (transferência) − 500 (aplicação) − 300 (diárias) − 40 − 20 (lançamentos em aberto não contam)
    expect(sic.saldoInicialCentavos).toBe(800000);
    expect(sic.saldoCentavos).toBe(800000 + 400000 - 80000 - 60000 + 300000 - 10000 + 5000 - 30000 - 50000 - 30000 - 4000 - 2000);
    expect((await conta(usuarioBc, "Aplicação"))).toMatchObject({ tipo: "APLICACAO", saldoCentavos: 50000 });
    expect((await conta(usuarioBc, "Unilos")).saldoCentavos).toBe(200000 - 70000 + 30000);
    // DRE de setembro: empréstimo e pessoal ficam à parte; aplicação/transferência não entram
    const d = json(await usuarioBc.req("GET", `/api/financeiro/resumo?mes=2026-09&unidadeId=${bc}&ref=2026-09-30`)).dre;
    expect(d.foraDoResultado.map((g: { grupo: string }) => g.grupo).sort()).toEqual(["Empréstimos (fora do resultado)", "Pessoal (despesas pessoais pagas pela empresa)"]);
    const emp = d.foraDoResultado.find((g: { grupo: string }) => g.grupo.startsWith("Empréstimos"));
    expect(emp).toMatchObject({ entradasCentavos: 300000, saidasCentavos: 60000 });
    expect(d.pessoalCentavos).toBe(12000);
    expect(d.grupos.map((g: { grupo: string }) => g.grupo)).toContain("Cancelamentos e devoluções");
    expect(d.receitaCentavos).toBe(400000 + 5000);
  });
});

describe("sinônimos editáveis", () => {
  it("lista o dicionário padrão, cria, edita e apaga; valida o alvo", async () => {
    const lista = json(await leitor.req("GET", "/api/financeiro/sinonimos")) as Array<{ id: string; texto: string; alvo: string; tipo: string }>;
    expect(lista.length).toBeGreaterThan(100);
    expect(lista.find((s) => s.tipo === "GRUPO" && s.texto === "FOTA")?.alvo).toBe("FROTA");
    expect((await leitor.req("POST", "/api/financeiro/sinonimos", { tipo: "GRUPO", texto: "XX", alvo: "FROTA" })).statusCode).toBe(403);
    const novo = json(await usuarioFln.req("POST", "/api/financeiro/sinonimos", { tipo: "CATEGORIA", texto: "frota|manut.", alvo: "DESP_MANUTENCAO" }));
    expect(novo.texto).toBe("FROTA|MANUT.");
    expect((await usuarioFln.req("POST", "/api/financeiro/sinonimos", { tipo: "CATEGORIA", texto: "frota|manut.", alvo: "DESP_MANUTENCAO" })).json().codigo).toBe("SINONIMO_EXISTE");
    expect((await usuarioFln.req("POST", "/api/financeiro/sinonimos", { tipo: "CATEGORIA", texto: "SEM BARRA", alvo: "DESP_MANUTENCAO" })).json().codigo).toBe("TEXTO_INVALIDO");
    expect((await usuarioFln.req("POST", "/api/financeiro/sinonimos", { tipo: "CATEGORIA", texto: "A|B", alvo: "NAO_EXISTE" })).json().codigo).toBe("ALVO_INVALIDO");
    expect((await usuarioFln.req("POST", "/api/financeiro/sinonimos", { tipo: "GRUPO", texto: "ZZ", alvo: "INVENTADO" })).json().codigo).toBe("ALVO_INVALIDO");
    expect(json(await usuarioFln.req("PATCH", `/api/financeiro/sinonimos/${novo.id}`, { alvo: "DESP_PNEUS" })).alvo).toBe("DESP_PNEUS");
    expect((await usuarioFln.req("DELETE", `/api/financeiro/sinonimos/${novo.id}`)).statusCode).toBe(200);
    expect((await usuarioFln.req("DELETE", `/api/financeiro/sinonimos/${novo.id}`)).statusCode).toBe(404);
  });
});

describe("ligação com a frota", () => {
  it("custos do financeiro (grupos Frota e Posto) com a placa entram no custo por veículo, só para quem vê o financeiro", async () => {
    for (const placa of ["QJQ2A16", "ABC1D23"]) {
      const r = await admin.req("POST", "/api/frota/veiculos", { unidadeId: fln, placa, tipo: "VAN", capacidade: 15, ano: 2020, kmAtual: 1000 });
      expect(r.statusCode, r.body).toBe(201);
    }
    const painel = json(await admin.req("GET", "/api/frota/painel?mes=2026-10"));
    const custo = (placa: string) => painel.custos.find((c: { placa: string }) => c.placa === placa);
    expect(custo("QJQ2A16")).toMatchObject({ financeiroCentavos: 150000, totalCentavos: 150000 });
    expect(custo("ABC1D23")).toMatchObject({ financeiroCentavos: 80025 + 6000 });
    expect(painel.totais.financeiroCentavos).toBe(150000 + 86025);
  });
});

describe("saldo dia a dia e fechamento do caixa em dinheiro", () => {
  it("saldo diário do caixa do quiosque", async () => {
    const q = await conta(usuarioFln, "Quiosque");
    const r = json(await usuarioFln.req("GET", `/api/financeiro/contas/${q.id}/saldo-diario?de=2026-10-08&ate=2026-10-10`));
    expect(r.saldoInicialCentavos).toBe(30000);
    expect(r.dias).toEqual([
      { data: "2026-10-08", entradasCentavos: 0, saidasCentavos: 0, saldoFinalCentavos: 30000 },
      { data: "2026-10-09", entradasCentavos: 25000, saidasCentavos: 8000, saldoFinalCentavos: 47000 },
      { data: "2026-10-10", entradasCentavos: 0, saidasCentavos: 0, saldoFinalCentavos: 47000 },
    ]);
    expect((await usuarioFln.req("GET", `/api/financeiro/contas/${q.id}/saldo-diario?de=2026-01-01&ate=2026-12-31`)).json().codigo).toBe("PERIODO_GRANDE");
    expect((await usuarioBc.req("GET", `/api/financeiro/contas/${q.id}/saldo-diario?de=2026-10-08&ate=2026-10-10`)).statusCode).toBe(404);
  });

  it("fechar o dia: saldo inicial, entradas, saídas, contado e diferença; bloqueia depois de fechado", async () => {
    const q = await conta(usuarioFln, "Quiosque");
    const dia = json(await usuarioFln.req("GET", `/api/financeiro/caixa/dia?contaId=${q.id}&data=2026-10-09`));
    expect(dia).toMatchObject({ saldoInicialCentavos: 30000, entradasCentavos: 25000, saidasCentavos: 8000, saldoCalculadoCentavos: 47000, fechamento: null });
    expect(dia.lancamentos).toHaveLength(3);
    expect((await leitor.req("POST", "/api/financeiro/caixa/fechar", { contaId: q.id, data: "2026-10-09", saldoContadoCentavos: 46000 })).statusCode).toBe(403);
    const f = json(await usuarioFln.req("POST", "/api/financeiro/caixa/fechar", { contaId: q.id, data: "2026-10-09", saldoContadoCentavos: 46500, observacao: "Faltou troco" }));
    expect(f).toMatchObject({ saldoCalculadoCentavos: 47000, saldoContadoCentavos: 46500, diferencaCentavos: -500 });
    expect((await usuarioFln.req("POST", "/api/financeiro/caixa/fechar", { contaId: q.id, data: "2026-10-09", saldoContadoCentavos: 47000 })).json().codigo).toBe("CAIXA_JA_FECHADO");
    // um lançamento em aberto não pode ser baixado no caixa de um dia fechado
    const novo = json(await usuarioFln.req("POST", "/api/financeiro/lancamentos", { tipo: "PAGAR", descricao: "Gelo atrasado", categoriaId: json(await usuarioFln.req("GET", "/api/financeiro/categorias")).find((c: { codigo: string }) => c.codigo === "DESP_QUIOSQUE").id, valorCentavos: 1000, competencia: "2026-10-09", vencimento: "2026-10-09", unidadeId: fln }));
    expect((await usuarioFln.req("POST", `/api/financeiro/lancamentos/${novo.ids[0]}/baixa`, { pagoEm: "2026-10-09", contaId: q.id })).json().codigo).toBe("CAIXA_FECHADO");
    expect((await usuarioFln.req("POST", `/api/financeiro/lancamentos/${novo.ids[0]}/baixa`, { pagoEm: "2026-10-12", contaId: q.id })).statusCode).toBe(200);
    expect((await usuarioFln.req("POST", "/api/financeiro/caixa/fechar", { contaId: (await conta(usuarioFln, "Sicredi")).id, data: "2026-10-09", saldoContadoCentavos: 0 })).json().codigo).toBe("NAO_E_CAIXA");
  });
});

describe("revenda de serviços de terceiros", () => {
  it("venda, repasse e comissão: na DRE só a margem entra como receita própria", async () => {
    const corpo = { descricao: "Ingressos do parque (teste)", fornecedor: "Parque Teste", vendedor: "Vendedor Teste", dataVenda: "2026-08-10", vencimentoRepasse: "2026-08-20", valorVendaCentavos: 100000, valorRepasseCentavos: 80000, comissaoCentavos: 5000, unidadeId: bc };
    expect((await leitor.req("POST", "/api/financeiro/revendas", corpo)).statusCode).toBe(403);
    expect((await usuarioFln.req("POST", "/api/financeiro/revendas", corpo)).statusCode).toBe(403); // praça de outro usuário
    const r = json(await usuarioBc.req("POST", "/api/financeiro/revendas", corpo));
    expect(r).toMatchObject({ margemCentavos: 20000, comissaoCentavos: 5000 });
    expect(r.aviso).toMatch(/contador/);
    const itens = (await lancamentos(usuarioBc)).filter((x) => /Ingressos/.test(x.descricao));
    expect(itens.map((x) => [x.tipo, x.categoriaNome, x.valorCentavos, x.vencimento]).sort()).toEqual([
      ["PAGAR", "Comissões de vendedores", 5000, "2026-08-20"], ["PAGAR", "Revenda de terceiros: repasse ao fornecedor", 80000, "2026-08-20"], ["RECEBER", "Revenda de terceiros: valor recebido do cliente", 100000, "2026-08-10"],
    ]);
    const d = json(await usuarioBc.req("GET", `/api/financeiro/resumo?mes=2026-08&unidadeId=${bc}&ref=2026-08-31`)).dre;
    expect(d.receitaCentavos).toBe(20000);
    expect(d.grupos.find((g: { grupo: string }) => g.grupo === "Revenda de terceiros (margem)")).toMatchObject({ totalCentavos: 20000 });
    expect(d.despesaCentavos).toBe(5000); // só a comissão do vendedor (RH)
    expect(d.resultadoCentavos).toBe(15000);
    const lista = json(await usuarioBc.req("GET", "/api/financeiro/revendas"));
    expect(lista.itens[0]).toMatchObject({ margemCentavos: 20000 });
    expect(json(await usuarioFln.req("GET", "/api/financeiro/revendas")).itens).toHaveLength(0);
  });
});

describe("contas padrão", () => {
  it("cria Sicredi, Unilos, Quiosque, Cartão e Aplicação sem números de conta, sem duplicar", async () => {
    const r = json(await admin.req("POST", "/api/financeiro/contas/padrao", { unidadeId: null }));
    expect(r.criadas).toEqual(["Sicredi", "Unilos", "Quiosque", "Cartão", "Aplicação"]);
    expect(json(await admin.req("POST", "/api/financeiro/contas/padrao", { unidadeId: null })).criadas).toEqual([]);
    const pg_ = new pg.Client({ connectionString: DATABASE_URL });
    await pg_.connect();
    const { rows } = await pg_.query("select nome, tipo, final_conta, banco from fin_contas where unidade_id is null order by nome");
    await pg_.end();
    expect(rows.every((x: { final_conta: string | null; banco: string | null }) => x.final_conta === null && x.banco === null)).toBe(true);
    expect((await usuarioFln.req("POST", "/api/financeiro/contas/padrao", {})).json().codigo).toBe("PRACA_OBRIGATORIA");
  });
});

describe("desfazer importação (pedido do dono, 10/11/2026)", () => {
  it("lista as importações da praça, desfaz apagando lançamentos e transferências e volta o saldo inicial; não desfaz duas vezes", async () => {
    const lista = json(await usuarioBc.req("GET", "/api/financeiro/importacoes")).itens as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const imp = lista.find((x) => x.lancamentos === 13 && x.transferencias === 2 && !x.desfeitaEm)!;
    expect(imp).toMatchObject({ unidadeId: bc, origem: "PLANILHA", restantes: 13, criadoPor: "plan.bc@bybus.test" });
    // Outra praça não vê nem desfaz; quem só consulta o financeiro também não.
    expect(json(await usuarioFln.req("GET", "/api/financeiro/importacoes")).itens.some((x: { id: string }) => x.id === imp.id)).toBe(false);
    expect((await usuarioFln.req("POST", `/api/financeiro/importacoes/${imp.id}/desfazer`)).statusCode).toBe(403);
    expect((await leitor.req("POST", `/api/financeiro/importacoes/${imp.id}/desfazer`)).statusCode).toBe(403);

    const r = json(await usuarioBc.req("POST", `/api/financeiro/importacoes/${imp.id}/desfazer`));
    expect(r).toMatchObject({ lancamentosApagados: 13, mantidos: 0 });
    expect(r.transferenciasApagadas).toBeGreaterThan(0);
    expect(r.saldosRestaurados).toBeGreaterThan(0);
    expect((await lancamentos(usuarioBc)).filter((x) => x.origem === "PLANILHA")).toEqual([]);
    expect((await conta(usuarioBc, "Sicredi")).saldoInicialCentavos).toBe(0);
    const depois = json(await usuarioBc.req("GET", "/api/financeiro/importacoes")).itens.find((x: { id: string }) => x.id === imp.id);
    expect(depois).toMatchObject({ restantes: 0, desfeitaEm: expect.any(String) });
    expect((await usuarioBc.req("POST", `/api/financeiro/importacoes/${imp.id}/desfazer`)).json().codigo).toBe("JA_DESFEITA");
    // Importar a mesma aba de novo funciona (nada ficou preso).
    expect(json(await importar(usuarioBc, { conteudo: ANTIGO, unidadeId: bc, confirmar: true })).resultado).toMatchObject({ lancamentos: 13 });
  });
});
