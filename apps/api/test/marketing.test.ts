import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { criarDb } from "../src/db/cliente.js";
import { semearBiblioteca, PAGINAS_SEMENTE } from "../src/db/biblioteca-seed.js";
import { auditoria, bibliotecaPaginas, passageiros, passeios, reservas, saidas } from "../src/db/schema.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
let admin: Cliente;
let gestor: Cliente; // marketing:ver + gerenciar, biblioteca:ver
let leitor: Cliente; // marketing:ver, biblioteca:ver
let semAcesso: Cliente;
let supBc: Cliente; // praça BC, marketing:ver + gerenciar
let flnId = "";
let bcId = "";
const { db, pool } = criarDb(DATABASE_URL);

function dias(n: number) {
  return new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
}

async function novoUsuario(perfil: string, permissoes: string[], email: string, unidadeIds: string[]) {
  const a = admin;
  expect((await a.req("POST", "/api/perfis", { codigo: perfil, nome: perfil, permissoes })).statusCode).toBe(200);
  const { senhaTemporaria } = (await a.req("POST", "/api/usuarios", { nome: `Usuário ${perfil}`, email, perfil, unidadeIds })).json();
  const c = new Cliente(app);
  await c.login(email, senhaTemporaria);
  await c.req("POST", "/api/auth/senha", { senhaAtual: senhaTemporaria, novaSenha: "MktTeste123456" });
  return c;
}

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
  admin = new Cliente(app);
  expect((await admin.login("admin@bybus.test")).statusCode).toBe(200);
  const unidades = (await admin.req("GET", "/api/unidades")).json() as Array<{ id: string; codigo: string }>;
  flnId = unidades.find((u) => u.codigo === "FLN")!.id;
  bcId = unidades.find((u) => u.codigo === "BC")!.id;
  gestor = await novoUsuario("MKT_GESTOR", ["marketing:ver", "marketing:gerenciar", "biblioteca:ver"], "mkt.gestor@bybus.test", [flnId]);
  leitor = await novoUsuario("MKT_LEITOR", ["marketing:ver", "biblioteca:ver"], "mkt.leitor@bybus.test", [flnId]);
  semAcesso = await novoUsuario("SEM_MKT", ["manifesto:ver"], "sem.mkt@bybus.test", [flnId]);
  supBc = await novoUsuario("MKT_BC", ["marketing:ver", "marketing:gerenciar"], "mkt.bc@bybus.test", [bcId]);
  await semearBiblioteca(db);
});
afterAll(async () => {
  await pool.end();
  await fechar();
});

describe("permissões do marketing", () => {
  it("sem login ou sem permissão não acessa", async () => {
    expect((await new Cliente(app).req("GET", "/api/marketing/campanhas")).statusCode).toBe(401);
    expect((await semAcesso.req("GET", "/api/marketing/painel/canais")).statusCode).toBe(403);
    expect((await semAcesso.req("GET", "/api/biblioteca/paginas")).statusCode).toBe(403);
  });

  it("quem só vê não grava", async () => {
    expect((await leitor.req("POST", "/api/marketing/campanhas", { nome: "X", midia: "OUTRA", inicio: "2026-11-01", investimentoCentavos: 100 })).statusCode).toBe(403);
    expect((await leitor.req("POST", "/api/marketing/afiliados", { nome: "Hotel X", codigo: "HOTEL-X" })).statusCode).toBe(403);
    expect((await leitor.req("PATCH", "/api/marketing/config", { urlLoja: "https://exemplo.test" })).statusCode).toBe(403);
    expect((await leitor.req("GET", "/api/marketing/campanhas")).statusCode).toBe(200);
  });
});

describe("painéis de vendas e origem", () => {
  it("vendas por canal usam o canal real e agregam passageiros", async () => {
    const [passeio] = await db.select().from(passeios).where(eq(passeios.codigo, "TODA_ILHA"));
    const data = "2031-03-10";
    const [saida] = await db.insert(saidas).values({ passeioId: passeio!.id, data, capacidade: 73 }).returning();
    const mk = async (codigo: string, canal: "PAYTOUR" | "VIATOR", canalOrigem: "VIATOR" | null, origemCliente: string | null, qtd: number, status: "CONFIRMADA" | "CANCELADA" = "CONFIRMADA") => {
      const [r] = await db.insert(reservas).values({ saidaId: saida!.id, canal, canalOrigem, codigoExterno: codigo, contatoNome: "Titular Fictício", origemCliente, status }).returning();
      await db.insert(passageiros).values(Array.from({ length: qtd }, () => ({ reservaId: r!.id, nome: "Passageiro Fictício", categoria: "ADULTO" as const })));
    };
    await mk("T-1", "PAYTOUR", null, "SP", 3);
    await mk("T-2", "PAYTOUR", "VIATOR", "eua ", 2); // espelho: conta como Viator
    await mk("T-3", "VIATOR", null, "sp", 1);
    await mk("T-4", "PAYTOUR", null, null, 4);
    await mk("T-5", "PAYTOUR", null, "RJ", 5, "CANCELADA"); // cancelada não conta

    const canais = (await gestor.req("GET", "/api/marketing/painel/canais?de=2031-03-01&ate=2031-03-31")).json();
    expect(canais.total).toEqual({ reservas: 4, passageiros: 10 });
    const por = Object.fromEntries(canais.porCanal.map((c: { canal: string; passageiros: number }) => [c.canal, c.passageiros]));
    expect(por).toEqual({ PAYTOUR: 7, VIATOR: 3 });
    expect(canais.porCanal.reduce((s: number, c: { percentual: number }) => s + c.percentual, 0)).toBe(100);
    expect(canais.porPasseioMes).toEqual([{ mes: "2031-03", passeioId: passeio!.id, passeio: passeio!.nome, reservas: 4, passageiros: 10 }]);

    const origem = (await gestor.req("GET", "/api/marketing/painel/origem?de=2031-03-01&ate=2031-03-31")).json();
    expect(origem.ranking.map((r: { origem: string; passageiros: number }) => [r.origem, r.passageiros])).toEqual([["SP", 4], ["EUA", 2]]);
    expect(origem.semInformacao.passageiros).toBe(4);
    expect(origem.totalInformado).toBe(6);
    expect(origem.ranking[0].percentual).toBeCloseTo(66.7, 1);
    // painel não expõe nenhum dado de cliente
    expect(JSON.stringify(canais) + JSON.stringify(origem)).not.toContain("Fictício");

    // escopo por praça: gestor de BC não vê as vendas de FLN
    const bc = (await supBc.req("GET", "/api/marketing/painel/canais?de=2031-03-01&ate=2031-03-31")).json();
    expect(bc.total).toEqual({ reservas: 0, passageiros: 0 });
    expect((await supBc.req("GET", `/api/marketing/painel/canais?de=2031-03-01&ate=2031-03-31&unidadeId=${flnId}`)).statusCode).toBe(404);
  });

  it("valida o período", async () => {
    expect((await gestor.req("GET", "/api/marketing/painel/canais?de=2031-04-01&ate=2031-03-01")).statusCode).toBe(400);
    expect((await gestor.req("GET", "/api/marketing/painel/canais?de=abc")).statusCode).toBe(400);
  });
});

describe("campanhas e cupons", () => {
  it("cria, lança resultado e calcula custo x retorno", async () => {
    const r = await gestor.req("POST", "/api/marketing/campanhas", { nome: "Google Ads (teste)", midia: "GOOGLE_ADS", inicio: "2026-11-01", fim: "2026-11-30", investimentoCentavos: 100000, cupom: "GADS10", metaReservas: 40, unidadeId: flnId });
    expect(r.statusCode).toBe(200);
    const id = r.json().id;
    let lista = (await gestor.req("GET", "/api/marketing/campanhas")).json();
    expect(lista.atribuicao.situacao).toBe("AUTOMATICA_QUANDO_HA_VENDA");
    let c = lista.campanhas.find((x: { id: string }) => x.id === id);
    expect(c.indicadores.temAtribuicao).toBe(false);
    expect(c.indicadores.retorno).toBeNull();

    expect((await gestor.req("POST", `/api/marketing/campanhas/${id}/resultados`, { mes: "2026-11", reservas: 10, passageiros: 25, receitaCentavos: 350000, fonte: "Relatório do cupom (teste)" })).statusCode).toBe(200);
    // reenviar o mês substitui
    expect((await gestor.req("POST", `/api/marketing/campanhas/${id}/resultados`, { mes: "2026-11", reservas: 20, passageiros: 50, receitaCentavos: 350000, fonte: "Relatório do cupom (teste)" })).statusCode).toBe(200);
    lista = (await gestor.req("GET", "/api/marketing/campanhas")).json();
    c = lista.campanhas.find((x: { id: string }) => x.id === id);
    expect(c.resultados).toHaveLength(1);
    expect(c.indicadores).toMatchObject({ temAtribuicao: true, custoPorReservaCentavos: 5000, retorno: 3.5, atingimentoMeta: 0.5 });

    expect((await gestor.req("PATCH", `/api/marketing/campanhas/${id}`, { fim: "2026-10-01" })).statusCode).toBe(400);
    expect((await gestor.req("PATCH", `/api/marketing/campanhas/${id}`, { investimentoCentavos: 120000 })).statusCode).toBe(200);
    expect((await gestor.req("DELETE", `/api/marketing/campanhas/${id}/resultados/2026-11`)).statusCode).toBe(200);
    expect((await gestor.req("DELETE", `/api/marketing/campanhas/${id}`)).statusCode).toBe(200);
  });

  it("valida entrada e respeita a praça", async () => {
    expect((await gestor.req("POST", "/api/marketing/campanhas", { nome: "A", midia: "TV", inicio: "2026-11-01", investimentoCentavos: 1 })).statusCode).toBe(400);
    expect((await gestor.req("POST", "/api/marketing/campanhas", { nome: "Campanha ok", midia: "OUTRA", inicio: "2026-11-01", investimentoCentavos: 10.5 })).statusCode).toBe(400);
    // campanha de todas as praças só quem enxerga todas cria
    expect((await gestor.req("POST", "/api/marketing/campanhas", { nome: "Geral", midia: "OUTRA", inicio: "2026-11-01", investimentoCentavos: 0 })).statusCode).toBe(403);
    expect((await gestor.req("POST", "/api/marketing/campanhas", { nome: "Em BC", midia: "OUTRA", inicio: "2026-11-01", investimentoCentavos: 0, unidadeId: bcId })).statusCode).toBe(403);
    const geral = (await admin.req("POST", "/api/marketing/campanhas", { nome: "Geral admin", midia: "OUTRA", inicio: "2026-11-01", investimentoCentavos: 0 })).json();
    expect((await gestor.req("PATCH", `/api/marketing/campanhas/${geral.id}`, { nome: "Invadida" })).statusCode).toBe(403);
    const bc = (await supBc.req("POST", "/api/marketing/campanhas", { nome: "Campanha BC", midia: "OUTRA", inicio: "2026-11-01", investimentoCentavos: 0, unidadeId: bcId })).json();
    // gestor de FLN não vê nem altera a campanha de BC
    const visiveis = (await gestor.req("GET", "/api/marketing/campanhas")).json().campanhas.map((x: { nome: string }) => x.nome);
    expect(visiveis).toContain("Geral admin");
    expect(visiveis).not.toContain("Campanha BC");
    expect((await gestor.req("DELETE", `/api/marketing/campanhas/${bc.id}`)).statusCode).toBe(404);
  });
});

describe("calendário de conteúdo", () => {
  it("cria, move de status e filtra", async () => {
    const r = await gestor.req("POST", "/api/marketing/conteudos", { titulo: "Reels do pôr do sol", rede: "INSTAGRAM", dataPrevista: "2026-11-20", unidadeId: flnId });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("IDEIA");
    const id = r.json().id;
    expect((await gestor.req("PATCH", `/api/marketing/conteudos/${id}`, { status: "AGENDADO" })).statusCode).toBe(200);
    const lista = (await leitor.req("GET", "/api/marketing/conteudos?status=AGENDADO&rede=INSTAGRAM")).json();
    expect(lista.map((x: { id: string }) => x.id)).toContain(id);
    expect((await gestor.req("POST", "/api/marketing/conteudos", { titulo: "Post", rede: "MYSPACE" })).statusCode).toBe(400);
    expect((await gestor.req("POST", "/api/marketing/conteudos", { titulo: "Post com link ruim", rede: "BLOG", link: "javascript:alert(1)" })).statusCode).toBe(400);
    expect((await gestor.req("POST", "/api/marketing/conteudos", { titulo: "Resp inexistente", rede: "BLOG", responsavelId: "00000000-0000-4000-8000-000000000000", unidadeId: flnId })).statusCode).toBe(400);
    expect((await gestor.req("DELETE", `/api/marketing/conteudos/${id}`)).statusCode).toBe(200);
  });

  it("lista só quem pode ser responsável", async () => {
    const lista = (await leitor.req("GET", "/api/marketing/responsaveis")).json() as Array<{ nome: string }>;
    const nomes = lista.map((x) => x.nome);
    expect(nomes).toContain("Usuário MKT_GESTOR");
    expect(nomes).not.toContain("Usuário MKT_LEITOR");
  });
});

describe("avaliações", () => {
  it("gera pedidos só de reservas realizadas, sem duplicar e sem enviar nada", async () => {
    const [passeio] = await db.select().from(passeios).where(eq(passeios.codigo, "TODA_ILHA"));
    const data = dias(-3);
    const [saida] = await db.insert(saidas).values({ passeioId: passeio!.id, data, capacidade: 73 }).returning();
    const mk = async (codigo: string, telefone: string | null, embarque: "EMBARCOU" | "NO_SHOW") => {
      const [r] = await db.insert(reservas).values({ saidaId: saida!.id, canal: "PAYTOUR", codigoExterno: codigo, contatoNome: "Maria Fictícia Teste", contatoTelefone: telefone }).returning();
      await db.insert(passageiros).values({ reservaId: r!.id, nome: "Passageira Fictícia", categoria: "ADULTO", embarque });
      return r!.id;
    };
    const comTel = await mk("AV-1", "+55 48 90000-0001", "EMBARCOU");
    await mk("AV-2", null, "EMBARCOU");
    await mk("AV-3", "+55 48 90000-0003", "NO_SHOW");
    // a saída de amanhã (semente) nunca gera pedido
    const periodo = { de: dias(-10), ate: dias(5) };

    expect((await leitor.req("POST", "/api/marketing/avaliacoes/pedidos/gerar", periodo)).statusCode).toBe(403);
    const g1 = (await gestor.req("POST", "/api/marketing/avaliacoes/pedidos/gerar", periodo)).json();
    expect(g1.criados).toBe(2);
    expect(g1.envio).toBe("NAO_ENVIADO");
    expect((await gestor.req("POST", "/api/marketing/avaliacoes/pedidos/gerar", periodo)).json().criados).toBe(0);
    // Regressão: sem corpo e sem datas usa os últimos 7 dias até ontem (não dá 400); janela explícita > 31 dias é recusada.
    const semCorpo = await gestor.req("POST", "/api/marketing/avaliacoes/pedidos/gerar");
    expect(semCorpo.statusCode).toBe(200);
    expect(semCorpo.json().periodo).toEqual({ de: dias(-7), ate: dias(-1) });
    expect((await gestor.req("POST", "/api/marketing/avaliacoes/pedidos/gerar", {})).statusCode).toBe(200);
    expect((await gestor.req("POST", "/api/marketing/avaliacoes/pedidos/gerar", { de: dias(-60), ate: dias(-1) })).statusCode).toBe(400);

    const pedidos = (await gestor.req("GET", `/api/marketing/avaliacoes/pedidos?de=${periodo.de}&ate=${periodo.ate}`)).json() as Array<{ id: string; status: string; texto: string; reservaId: string }>;
    expect(pedidos.map((p) => p.status).sort()).toEqual(["PENDENTE", "SEM_TELEFONE"]);
    const pedido = pedidos.find((p) => p.reservaId === comTel)!;
    expect(pedido.texto).toContain("Maria");
    expect(pedido.texto).not.toContain("Fictícia");
    expect(JSON.stringify(pedidos)).not.toContain("90000"); // telefone nunca sai
    expect((await gestor.req("PATCH", `/api/marketing/avaliacoes/pedidos/${pedido.id}`, { status: "ENVIADA_MANUAL" })).statusCode).toBe(200);
    expect((await gestor.req("PATCH", `/api/marketing/avaliacoes/pedidos/${pedido.id}`, { status: "SIMULADA" })).statusCode).toBe(400);

    // nota interna (uma por reserva; registrar de novo atualiza)
    expect((await gestor.req("POST", "/api/marketing/avaliacoes/notas", { reservaId: comTel, nota: 5, comentario: "Adorou" })).statusCode).toBe(200);
    expect((await gestor.req("POST", "/api/marketing/avaliacoes/notas", { reservaId: comTel, nota: 4 })).statusCode).toBe(200);
    expect((await gestor.req("POST", "/api/marketing/avaliacoes/notas", { reservaId: comTel, nota: 6 })).statusCode).toBe(400);
    expect((await supBc.req("POST", "/api/marketing/avaliacoes/notas", { reservaId: comTel, nota: 3 })).statusCode).toBe(404);

    const resumo = (await leitor.req("GET", `/api/marketing/avaliacoes/resumo?de=${periodo.de}&ate=${periodo.ate}`)).json();
    expect(resumo.notas).toMatchObject({ quantidade: 1, media: 4 });
    expect(resumo.pedidos).toMatchObject({ ENVIADA_MANUAL: 1, SEM_TELEFONE: 1, PENDENTE: 0 });
    expect(resumo.tripadvisor.link).toBeNull();
  });

  it("modelo e link do Tripadvisor", async () => {
    const antes = (await leitor.req("GET", "/api/marketing/config")).json();
    expect(antes.modeloAvaliacao).toContain("{nome}");
    expect(antes.envioWhatsapp.ligado).toBe(false);
    expect((await gestor.req("PATCH", "/api/marketing/config", { linkTripadvisor: "http://inseguro.test" })).statusCode).toBe(400);
    expect((await gestor.req("PATCH", "/api/marketing/config", { linkTripadvisor: "javascript:alert(1)" })).statusCode).toBe(400);
    const depois = (await gestor.req("PATCH", "/api/marketing/config", { linkTripadvisor: "https://www.tripadvisor.com.br/exemplo-teste", modeloAvaliacao: "Obrigado, {nome}! Avalie: {linkTripadvisor}" })).json();
    expect(depois.linkTripadvisor).toContain("tripadvisor");
    expect((await gestor.req("PATCH", "/api/marketing/config", { linkTripadvisor: null })).json().linkTripadvisor).toBeNull();
  });
});

describe("afiliados", () => {
  it("cadastra com código normalizado, gera o link e impede código repetido", async () => {
    const r = await gestor.req("POST", "/api/marketing/afiliados", { nome: "Hotel Fictício Mar", tipo: "HOTEL", codigo: "hotel mar", comissaoPontosBase: 1000, unidadeId: flnId });
    expect(r.statusCode).toBe(200);
    expect(r.json().codigo).toBe("HOTEL-MAR");
    expect((await gestor.req("POST", "/api/marketing/afiliados", { nome: "Outro", codigo: "HOTEL-MAR", unidadeId: flnId })).statusCode).toBe(409);
    expect((await gestor.req("POST", "/api/marketing/afiliados", { nome: "Curto", codigo: "A", unidadeId: flnId })).statusCode).toBe(400);
    expect((await gestor.req("POST", "/api/marketing/afiliados", { nome: "Comissão alta", codigo: "COM-ALTA", comissaoPontosBase: 20000, unidadeId: flnId })).statusCode).toBe(400);
    const lista = (await leitor.req("GET", "/api/marketing/afiliados")).json();
    expect(lista.ligacaoPaytour.situacao).toBe("PENDENTE");
    const a = lista.afiliados.find((x: { codigo: string }) => x.codigo === "HOTEL-MAR");
    expect(a.link).toBe(`${lista.urlLoja}/?ref=HOTEL-MAR`);
    expect((await gestor.req("PATCH", `/api/marketing/afiliados/${a.id}`, { ativo: false })).statusCode).toBe(200);
    expect((await gestor.req("DELETE", `/api/marketing/afiliados/${a.id}`)).statusCode).toBe(200);
  });
});

describe("auditoria do marketing", () => {
  it("registra as ações que gravam, sem conteúdo sensível", async () => {
    const linhas = await db.select({ acao: auditoria.acao, dados: auditoria.dados }).from(auditoria);
    const acoes = new Set(linhas.map((l) => l.acao));
    for (const a of ["CAMPANHA_CRIADA", "CAMPANHA_RESULTADO_LANCADO", "CONTEUDO_CRIADO", "AVALIACAO_PEDIDOS_GERADOS", "AVALIACAO_NOTA_REGISTRADA", "AFILIADO_CRIADO", "MARKETING_CONFIG_EDITADA"]) expect(acoes.has(a)).toBe(true);
    expect(JSON.stringify(linhas)).not.toContain("Maria");
  });
});

describe("biblioteca", () => {
  it("a semente cria os manuais e é idempotente", async () => {
    const antes = (await db.select().from(bibliotecaPaginas)).length;
    expect(antes).toBe(PAGINAS_SEMENTE.length);
    expect(await semearBiblioteca(db)).toBe(0);
    expect((await db.select().from(bibliotecaPaginas)).length).toBe(antes);
    const lista = (await leitor.req("GET", "/api/biblioteca/paginas")).json();
    expect(lista.podeEditar).toBe(false);
    const titulos = lista.paginas.map((p: { titulo: string }) => p.titulo);
    expect(titulos).toEqual(expect.arrayContaining(["Manuais operacionais", "City Tour Toda Ilha (Florianópolis)", "Fluxo da lista das 21h", "Regras de embarque e confirmação de saída"]));
    const cityTour = lista.paginas.find((p: { titulo: string }) => p.titulo.startsWith("City Tour"));
    const pag = (await leitor.req("GET", `/api/biblioteca/paginas/${cityTour.id}`)).json();
    expect(pag.conteudo).toContain("Villa Romana Shopping");
    expect(pag.caminho.map((c: { titulo: string }) => c.titulo)).toEqual(["Manuais operacionais", "City Tour Toda Ilha (Florianópolis)"]);
  });

  it("leitor não edita; editor cria árvore, move sem criar ciclo e não apaga página com filhas", async () => {
    expect((await leitor.req("POST", "/api/biblioteca/paginas", { titulo: "Nada", paiId: null })).statusCode).toBe(403);
    const biblio = await novoUsuario("BIB_EDITOR", ["biblioteca:ver", "biblioteca:editar"], "bib.editor@bybus.test", [flnId]);
    const a = (await biblio.req("POST", "/api/biblioteca/paginas", { titulo: "Página A", paiId: null, conteudo: "# A\n\nTexto **forte**", formato: "markdown" })).json().id;
    const b = (await biblio.req("POST", "/api/biblioteca/paginas", { titulo: "Página B", paiId: a })).json().id;
    const c = (await biblio.req("POST", "/api/biblioteca/paginas", { titulo: "Página C", paiId: b })).json().id;
    expect((await biblio.req("PATCH", `/api/biblioteca/paginas/${a}`, { paiId: c })).json().codigo).toBe("CICLO");
    expect((await biblio.req("PATCH", `/api/biblioteca/paginas/${a}`, { paiId: a })).json().codigo).toBe("CICLO");
    // excluir leva a página e as subpáginas para a lixeira (com desfazer)
    expect((await biblio.req("DELETE", `/api/biblioteca/paginas/${b}`)).json().paginas).toBe(2);
    expect((await biblio.req("GET", `/api/biblioteca/paginas/${c}`)).statusCode).toBe(404);
    expect((await biblio.req("POST", `/api/biblioteca/lixeira/${b}/restaurar`)).json().paginas).toBe(2);
    expect((await biblio.req("POST", "/api/biblioteca/paginas", { titulo: "Sem pai", paiId: "00000000-0000-4000-8000-000000000000" })).statusCode).toBe(404);
    expect((await biblio.req("PATCH", `/api/biblioteca/paginas/${c}`, { paiId: null })).statusCode).toBe(200);
    expect((await biblio.req("DELETE", `/api/biblioteca/paginas/${c}`)).statusCode).toBe(200);
  });

  it("página restrita (e suas subpáginas) some para quem só lê, inclusive na busca", async () => {
    const biblio = await novoUsuario("BIB_EDITOR2", ["biblioteca:ver", "biblioteca:editar"], "bib.editor2@bybus.test", [flnId]);
    const pai = (await biblio.req("POST", "/api/biblioteca/paginas", { titulo: "Restrita zebra", paiId: null, acesso: "RESTRITO", conteudo: "segredo-operacional-xyz" })).json().id;
    const filha = (await biblio.req("POST", "/api/biblioteca/paginas", { titulo: "Filha da restrita", paiId: pai, conteudo: "segredo-operacional-xyz também" })).json().id;
    const publica = (await biblio.req("POST", "/api/biblioteca/paginas", { titulo: "Pública zebra", paiId: null, conteudo: "segredo-operacional-xyz aberto" })).json().id;

    const idsLeitor = (await leitor.req("GET", "/api/biblioteca/paginas")).json().paginas.map((p: { id: string }) => p.id);
    expect(idsLeitor).toContain(publica);
    expect(idsLeitor).not.toContain(pai);
    expect(idsLeitor).not.toContain(filha);
    expect((await leitor.req("GET", `/api/biblioteca/paginas/${pai}`)).statusCode).toBe(404);
    expect((await leitor.req("GET", `/api/biblioteca/paginas/${filha}`)).statusCode).toBe(404);

    const buscaLeitor = (await leitor.req("GET", "/api/biblioteca/busca?q=segredo-operacional")).json();
    expect(buscaLeitor.map((x: { id: string }) => x.id)).toEqual([publica]);
    const buscaEditor = (await biblio.req("GET", "/api/biblioteca/busca?q=segredo-operacional")).json();
    expect(buscaEditor.map((x: { id: string }) => x.id).sort()).toEqual([pai, filha, publica].sort());
    expect((await biblio.req("GET", `/api/biblioteca/paginas/${filha}`)).json().acessoEfetivo).toBe("RESTRITO");
  });

  it("busca por título e texto, com termo curto recusado e curingas literais", async () => {
    const porTitulo = (await leitor.req("GET", "/api/biblioteca/busca?q=lista%20das%2021h")).json();
    expect(porTitulo[0].noTitulo).toBe(true);
    const porTexto = (await leitor.req("GET", "/api/biblioteca/busca?q=Oceanic")).json();
    expect(porTexto.length).toBeGreaterThan(0);
    expect(porTexto[0].trecho.toLowerCase()).toContain("oceanic");
    expect((await leitor.req("GET", "/api/biblioteca/busca?q=a")).statusCode).toBe(400);
    expect((await leitor.req("GET", "/api/biblioteca/busca?q=%25%25")).json()).toEqual([]);
  });
});
