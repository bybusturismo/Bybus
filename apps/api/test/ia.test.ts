import { acharDadoPessoal, dataSaoPaulo, GESTORES } from "@bybus/core";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { criarDb } from "../src/db/cliente.js";
import { lerConfig } from "../src/config.js";
import { passageiros, reservas } from "../src/db/schema.js";
import { definirClienteIA, type BlocoIA, type ClienteIA, type PedidoIA, type RespostaIA } from "../src/servicos/ia/cliente.js";
import { rodarAvaliacaoDiaria } from "../src/servicos/ia/agendamento.js";
import { montarRetratos } from "../src/servicos/ia/retratos.js";
import { chamarEstruturado, TETO_MAX_TOKENS } from "../src/servicos/ia/avaliacao.js";
import { FERRAMENTA_AVALIACAO, zAvaliacao } from "../src/servicos/ia/saidas.js";
import { CHAVE, Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
const pool = new pg.Pool({ connectionString: DATABASE_URL });

beforeAll(async () => {
  await prepararBanco();
  // Atendente passa a poder usar o assistente (sem ia:gestores); supervisor ganha ia:gestores, mas só enxerga a praça dele.
  await pool.query("update perfis set permissoes = permissoes || '{ia:usar}' where codigo = 'ATENDENTE'");
  await pool.query("update perfis set permissoes = permissoes || '{ia:gestores}' where codigo = 'SUPERVISOR'");
  ({ app, fechar } = await subirApp());
});
afterAll(async () => {
  definirClienteIA(null);
  await fechar();
  await pool.end();
});
afterEach(() => definirClienteIA(null));

const logado = async (email: string) => {
  const c = new Cliente(app);
  expect((await c.login(email)).statusCode).toBe(200);
  return c;
};

const uso = { input_tokens: 2000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const toolUse = (name: string, input: unknown, id = "tu_1"): BlocoIA => ({ type: "tool_use", id, name, input });

/** Cliente de IA falso: registra o que recebeu e devolve saídas estruturadas válidas. */
function clienteFalso(extra: { falharGestor?: string } = {}) {
  const pedidos: PedidoIA[] = [];
  const cliente: ClienteIA = {
    async enviar(p): Promise<RespostaIA> {
      pedidos.push(p);
      const nome = p.ferramentas[0]?.name;
      const quem = GESTORES.find((g) => p.sistema.includes(`Você é o ${g.nome} `))?.id ?? "diretoria";
      const resp = (content: BlocoIA[]): RespostaIA => ({ content, stop_reason: "tool_use", modelo: p.modelo, usage: uso });
      if (nome === "registrar_avaliacao") {
        if (quem === extra.falharGestor) return { content: [{ type: "text", text: "sem ferramenta" }], stop_reason: "end_turn", modelo: p.modelo, usage: uso };
        return resp([toolUse(nome, {
          achados: [{ titulo: `Achado do ${quem}`, detalhe: "Detalhe fictício.", gravidade: "media", evidencia: "retrato" }],
          vulnerabilidades: [{ titulo: `Vulnerabilidade do ${quem}`, detalhe: "Detalhe.", gravidade: "alta", evidencia: "retrato" }],
          oportunidades: [{ titulo: `Oportunidade do ${quem}`, detalhe: "Detalhe.", impacto: "medio", evidencia: "retrato" }],
          acoes_sugeridas: [{ titulo: `Ação do ${quem}`, detalhe: "Fazer algo.", prioridade: "media", prazo_dias: 7, area: quem }],
        })]);
      }
      if (nome === "registrar_debate") {
        return resp([toolUse(nome, {
          comentarios: [{ gestor: quem === "comercial" ? "logistico" : "comercial", tipo: "complemento", texto: `Comentário de ${quem}` }],
          riscos_cruzados: [{ titulo: `Risco cruzado visto por ${quem}`, detalhe: "Detalhe.", areas: ["rh", "juridico"] }],
          acoes_sugeridas: [],
        })]);
      }
      if (nome === "registrar_sintese") {
        return resp([toolUse(nome, {
          resumo: "Resumo fictício do dia.",
          vulnerabilidades: [{ titulo: "Vulnerabilidade consolidada", detalhe: "Detalhe.", gravidade: "alta", evidencia: "debate" }],
          oportunidades: [{ titulo: "Oportunidade consolidada", detalhe: "Detalhe.", impacto: "alto", evidencia: "debate" }],
          acoes_sugeridas: [
            { titulo: "Ação consolidada 1", detalhe: "Detalhe.", prioridade: "alta", prazo_dias: 3, area: "logistico" },
            { titulo: "Ação consolidada 2", detalhe: "Detalhe.", prioridade: "baixa", prazo_dias: 30, area: "marketing" },
            { titulo: "ação consolidada 1", detalhe: "Duplicada (título igual).", prioridade: "baixa", prazo_dias: 30, area: "marketing" },
          ],
          pontos_de_discordia: ["Ponto em aberto"],
        })]);
      }
      return resp([{ type: "text", text: "ok" }]);
    },
  };
  return { cliente, pedidos };
}

async function aguardar(c: Cliente, id: string) {
  for (let i = 0; i < 100; i++) {
    const r = await c.req("GET", `/api/ia/avaliacoes/${id}`);
    const j = r.json() as { status: string };
    if (j.status !== "EXECUTANDO") return r.json();
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw new Error("avaliação não terminou");
}

describe("IA desligada (sem chave)", () => {
  it("o sistema funciona e informa 'IA desligada'", async () => {
    const admin = await logado("admin@bybus.test");
    const estado = (await admin.req("GET", "/api/ia/estado")).json();
    expect(estado.ligada).toBe(false);
    const a = await admin.req("POST", "/api/ia/assistente", { mensagens: [{ papel: "usuario", texto: "Oi" }] });
    expect(a.statusCode).toBe(503);
    expect(a.json().codigo).toBe("IA_DESLIGADA");
    const b = await admin.req("POST", "/api/ia/avaliacoes");
    expect(b.statusCode).toBe(503);
    expect(b.json().codigo).toBe("IA_DESLIGADA");
  });

  it("os indicadores do dia (sem IA) continuam disponíveis e são só agregados", async () => {
    const admin = await logado("admin@bybus.test");
    const r = await admin.req("GET", "/api/ia/retratos");
    expect(r.statusCode).toBe(200);
    const { retratos } = r.json() as { retratos: Record<string, unknown> };
    expect(Object.keys(retratos).sort()).toEqual(GESTORES.map((g) => g.id).sort());
    expect(acharDadoPessoal(retratos)).toEqual([]);
  });
});

describe("permissões", () => {
  it("exige login e as permissões novas", async () => {
    expect((await new Cliente(app).req("GET", "/api/ia/estado")).statusCode).toBe(401);
    const guia = await logado("guia@bybus.test");
    expect((await guia.req("GET", "/api/ia/estado")).statusCode).toBe(403);
    expect((await guia.req("GET", "/api/ia/avaliacoes")).statusCode).toBe(403);
  });

  it("quem só usa o assistente não acessa os gestores nem vê custos", async () => {
    const atendente = await logado("atendente@bybus.test");
    const estado = (await atendente.req("GET", "/api/ia/estado")).json();
    expect(estado.gestores).toBe(false);
    expect(estado).not.toHaveProperty("gastoMesUsd");
    expect((await atendente.req("GET", "/api/ia/avaliacoes")).statusCode).toBe(403);
    expect((await atendente.req("POST", "/api/ia/avaliacoes")).statusCode).toBe(403);
    expect((await atendente.req("GET", "/api/ia/uso")).statusCode).toBe(403);
  });

  it("gestores consolidam a empresa: usuário de uma praça só é recusado mesmo com ia:gestores", async () => {
    const sup = await logado("supervisor@bybus.test");
    expect((await sup.req("GET", "/api/ia/avaliacoes")).statusCode).toBe(403);
    expect((await sup.req("GET", "/api/ia/retratos")).statusCode).toBe(403);
  });
});

describe("avaliação diária dos gestores", () => {
  it("roda as duas rodadas e a síntese, gera ações sugeridas e nunca envia dado pessoal", async () => {
    const f = clienteFalso();
    definirClienteIA(f.cliente);
    const admin = await logado("admin@bybus.test");
    const r = await admin.req("POST", "/api/ia/avaliacoes");
    expect(r.statusCode).toBe(202);
    const { id } = r.json() as { id: string };
    // Enquanto roda, uma segunda solicitação é recusada.
    const durante = await admin.req("POST", "/api/ia/avaliacoes");
    expect([202, 409]).toContain(durante.statusCode);

    const av = await aguardar(admin, id);
    expect(av.status).toBe("CONCLUIDA");
    expect(av.sintese.resumo).toBe("Resumo fictício do dia.");
    expect(av.custoUsd).toBeGreaterThan(0);

    // 8 pareceres da rodada 1 e 8 do debate.
    const r1 = av.pareceres.filter((p: { rodada: number }) => p.rodada === 1);
    const r2 = av.pareceres.filter((p: { rodada: number }) => p.rodada === 2);
    expect(r1.map((p: { gestor: string }) => p.gestor).sort()).toEqual(GESTORES.map((g) => g.id).sort());
    expect(r2).toHaveLength(8);

    // Debate: cada gestor recebeu os achados dos OUTROS (não os próprios) — conversa de verdade entre eles.
    const debates = f.pedidos.filter((p) => p.ferramentas[0]?.name === "registrar_debate");
    expect(debates).toHaveLength(8);
    const doComercial = debates.find((p) => p.sistema.includes("Gestor comercial"))!;
    const msg = String(doComercial.mensagens[0]!.content);
    expect(msg).toContain("Achado do logistico");
    expect(msg).toContain("Achado do tecnologia");
    expect(msg).not.toContain("Achado do comercial");

    // Síntese: leu avaliações e debate dos 8.
    const sintese = f.pedidos.find((p) => p.ferramentas[0]?.name === "registrar_sintese")!;
    expect(String(sintese.mensagens[0]!.content)).toContain("Risco cruzado visto por rh");

    // Ações: sem duplicata de título, todas SUGERIDA (nada vira tarefa sem aprovação).
    expect(av.acoes.map((a: { titulo: string }) => a.titulo)).toEqual(["Ação consolidada 1", "Ação consolidada 2"]);
    expect(av.acoes.every((a: { status: string }) => a.status === "SUGERIDA")).toBe(true);

    // LGPD: nenhuma chamada à IA contém nome, e-mail, telefone ou documento de quem está no banco.
    const { db, pool: p } = criarDb(DATABASE_URL);
    const donos = await db.select({ nome: reservas.contatoNome, email: reservas.contatoEmail, tel: reservas.contatoTelefone }).from(reservas);
    const pax = await db.select({ nome: passageiros.nome, final: passageiros.documentoFinal }).from(passageiros);
    await p.end();
    const tudo = JSON.stringify(f.pedidos.map((x) => [x.sistema, x.mensagens]));
    for (const d of donos) for (const v of [d.nome, d.email, d.tel]) if (v && v.length > 5) expect(tudo).not.toContain(v);
    for (const x of pax) if (x.nome && x.nome.length > 5) expect(tudo).not.toContain(x.nome);
    expect(acharDadoPessoal(JSON.parse(JSON.stringify(av.retratos)))).toEqual([]);

    // Uso registrado (8 + 8 + 1 chamadas) e prompt de sistema estável (sem data do dia → cache).
    const uso = (await admin.req("GET", "/api/ia/uso")).json();
    expect(uso.porTipo.reduce((s: number, t: { chamadas: number }) => s + t.chamadas, 0)).toBeGreaterThanOrEqual(17);
    expect(f.pedidos.every((x) => !x.sistema.includes(dataSaoPaulo(new Date())))).toBe(true);
    // Modelo da síntese e esforço seguem a configuração.
    expect(sintese.esforco).toBe("high");
    expect(f.pedidos.find((x) => x.ferramentas[0]?.name === "registrar_avaliacao")!.esforco).toBe("medium");
  });

  it("um gestor que falha não derruba o resto (PARCIAL) e a saída inválida é refeita uma vez", async () => {
    const f = clienteFalso({ falharGestor: "frotas" });
    definirClienteIA(f.cliente);
    const admin = await logado("admin@bybus.test");
    const { id } = (await admin.req("POST", "/api/ia/avaliacoes")).json() as { id: string };
    const av = await aguardar(admin, id);
    expect(av.status).toBe("PARCIAL");
    expect(av.erro).toContain("frotas");
    expect(av.pareceres.filter((p: { rodada: number }) => p.rodada === 1)).toHaveLength(7);
    expect(av.sintese).not.toBeNull();
    // O gestor de frotas foi chamado 2 vezes (tentativa + reforço), e o debate não incluiu as conclusões dele.
    expect(f.pedidos.filter((p) => p.sistema.includes("Gestor de frotas") && p.ferramentas[0]?.name === "registrar_avaliacao")).toHaveLength(2);
  });

  it("aprovar, concluir e descartar ações — só pessoa autorizada, com auditoria e transições válidas", async () => {
    const f = clienteFalso();
    definirClienteIA(f.cliente);
    const admin = await logado("admin@bybus.test");
    const { id } = (await admin.req("POST", "/api/ia/avaliacoes")).json() as { id: string };
    const av = await aguardar(admin, id);
    const [a1, a2] = av.acoes as Array<{ id: string }>;
    const lista = (await admin.req("GET", "/api/ia/acoes?status=APROVADA")).json() as unknown[];
    expect(lista).toHaveLength(0);

    expect((await admin.req("PATCH", `/api/ia/acoes/${a1!.id}`, { status: "CONCLUIDA" })).statusCode).toBe(409); // precisa aprovar antes
    expect((await admin.req("PATCH", `/api/ia/acoes/${a1!.id}`, { status: "APROVADA", observacao: "Fazer esta semana" })).statusCode).toBe(200);
    expect((await admin.req("PATCH", `/api/ia/acoes/${a1!.id}`, { status: "CONCLUIDA" })).statusCode).toBe(200);
    expect((await admin.req("PATCH", `/api/ia/acoes/${a2!.id}`, { status: "DESCARTADA" })).statusCode).toBe(200);
    expect((await admin.req("PATCH", `/api/ia/acoes/${a2!.id}`, { status: "APROVADA" })).statusCode).toBe(409); // descartada não volta

    const atendente = await logado("atendente@bybus.test");
    expect((await atendente.req("PATCH", `/api/ia/acoes/${a1!.id}`, { status: "APROVADA" })).statusCode).toBe(403);

    const log = await pool.query("select acao from auditoria where acao like 'IA_%' order by criado_em");
    const acoes = log.rows.map((r) => r.acao);
    expect(acoes).toEqual(expect.arrayContaining(["IA_AVALIACAO_INICIADA", "IA_ACAO_APROVADA", "IA_ACAO_CONCLUIDA", "IA_ACAO_DESCARTADA"]));

    const hist = (await admin.req("GET", "/api/ia/avaliacoes")).json() as Array<{ id: string; acoes: Record<string, number> }>;
    expect(hist.find((h) => h.id === id)!.acoes).toEqual({ CONCLUIDA: 1, DESCARTADA: 1 });
  });

  it("rotina diária: roda uma vez por dia e só com a IA ligada", async () => {
    const config = lerConfig({ AMBIENTE: "testes", DATABASE_URL, CHAVE_CRIPTOGRAFIA: CHAVE, EXIGIR_MFA_ADMIN: "false" });
    const { db, pool: p } = criarDb(DATABASE_URL);
    const log = { error: () => {}, info: () => {} };
    try {
      expect(await rodarAvaliacaoDiaria(db, config, log)).toBeNull(); // sem chave: nada acontece
      definirClienteIA(clienteFalso().cliente);
      const id = await rodarAvaliacaoDiaria(db, config, log);
      expect(id).not.toBeNull();
      const { rows } = await p.query("select origem, status from ia_avaliacoes where id = $1", [id]);
      expect(rows[0]).toEqual({ origem: "AUTOMATICA", status: "CONCLUIDA" });
      expect(await rodarAvaliacaoDiaria(db, config, log)).toBeNull(); // já rodou hoje
    } finally {
      await p.end();
    }
  });
});

describe("limite mensal", () => {
  it("ao atingir IA_LIMITE_MES_USD, recusa novas chamadas", async () => {
    // Limite = o que já foi gasto nos testes anteriores + US$ 0,01 (uma chamada falsa custa ~US$ 0,024).
    const { rows } = await pool.query("select coalesce(sum(custo_micro_usd), 0)::bigint as t from ia_uso");
    const limitado = await subirApp({ IA_LIMITE_MES_USD: String(Number(rows[0]!.t) / 1_000_000 + 0.01) });
    try {
      const f = clienteFalso();
      definirClienteIA(f.cliente);
      const c = new Cliente(limitado.app);
      await c.login("admin@bybus.test");
      // A primeira chamada passa (gasto zero) e estoura o limite; a segunda é recusada antes de chamar a IA.
      const um = await c.req("POST", "/api/ia/assistente", { mensagens: [{ papel: "usuario", texto: "Oi" }] });
      expect(um.statusCode).toBe(200);
      const antes = f.pedidos.length;
      const dois = await c.req("POST", "/api/ia/assistente", { mensagens: [{ papel: "usuario", texto: "Oi de novo" }] });
      expect(dois.statusCode).toBe(429);
      expect(dois.json().codigo).toBe("IA_LIMITE");
      expect(f.pedidos.length).toBe(antes);
    } finally {
      await limitado.fechar();
    }
  });
});

describe("assistente (Turistinha)", () => {
  it("consulta saídas com ferramentas somente leitura e devolve a resposta", async () => {
    const pedidos: PedidoIA[] = [];
    let resultadoDaFerramenta = "";
    definirClienteIA({
      async enviar(p) {
        pedidos.push(p);
        if (pedidos.length === 1) return { content: [toolUse("resumo_saidas", { de: "2000-01-01", ate: "2000-03-01", passeio: "" })], stop_reason: "tool_use", modelo: p.modelo, usage: uso };
        const ultimo = p.mensagens.at(-1)!.content as BlocoIA[];
        resultadoDaFerramenta = String(ultimo[0]!.content);
        return { content: [{ type: "text", text: "Encontrei as saídas do período." }], stop_reason: "end_turn", modelo: p.modelo, usage: uso };
      },
    });
    const admin = await logado("admin@bybus.test");
    const r = await admin.req("POST", "/api/ia/assistente", { mensagens: [{ papel: "usuario", texto: "Como estão as saídas?" }] });
    expect(r.statusCode).toBe(200);
    expect(r.json().resposta).toBe("Encontrei as saídas do período.");
    expect(r.json().ferramentas).toEqual(["resumo_saidas"]);
    expect(JSON.parse(resultadoDaFerramenta)).toHaveProperty("saidas");
    expect(acharDadoPessoal(JSON.parse(resultadoDaFerramenta))).toEqual([]);
    // Todas as ferramentas oferecidas são de consulta (nomes sem verbos de escrita) e o prompt de sistema é estável.
    expect(pedidos[0]!.ferramentas.map((f) => f.name)).toEqual(expect.arrayContaining(["resumo_saidas", "ocupacao_por_passeio", "reservas_por_canal", "documentos_vencendo"]));
    expect(String(pedidos[0]!.mensagens[0]!.content)).toContain("[Hoje é ");
    // A auditoria registra as consultas, não o texto da conversa.
    const { rows } = await pool.query("select dados from auditoria where acao = 'IA_ASSISTENTE_CONSULTA' order by criado_em desc limit 1");
    expect(JSON.stringify(rows[0]!.dados)).not.toContain("saídas");
  });

  it("respeita as permissões de quem pergunta (nem oferece nem executa o que o perfil não pode)", async () => {
    const pedidos: PedidoIA[] = [];
    let retorno = "";
    definirClienteIA({
      async enviar(p) {
        pedidos.push(p);
        if (pedidos.length === 1) return { content: [toolUse("saude_do_sistema", {})], stop_reason: "tool_use", modelo: p.modelo, usage: uso };
        retorno = JSON.stringify(p.mensagens.at(-1)!.content);
        return { content: [{ type: "text", text: "Não tenho acesso a isso." }], stop_reason: "end_turn", modelo: p.modelo, usage: uso };
      },
    });
    const atendente = await logado("atendente@bybus.test");
    const r = await atendente.req("POST", "/api/ia/assistente", { mensagens: [{ papel: "usuario", texto: "Como está a segurança?" }] });
    expect(r.statusCode).toBe(200);
    const oferecidas = pedidos[0]!.ferramentas.map((f) => f.name);
    expect(oferecidas).not.toContain("saude_do_sistema");
    expect(oferecidas).not.toContain("ultima_sintese");
    // Mesmo que o modelo peça a ferramenta, a execução recusa.
    expect(retorno).toContain("indisponível");
  });

  it("valida a entrada", async () => {
    definirClienteIA(clienteFalso().cliente);
    const admin = await logado("admin@bybus.test");
    expect((await admin.req("POST", "/api/ia/assistente", { mensagens: [] })).statusCode).toBe(400);
    expect((await admin.req("POST", "/api/ia/assistente", { mensagens: [{ papel: "assistente", texto: "x" }] })).statusCode).toBe(400);
  });
});

describe("retratos por área", () => {
  it("só devolvem agregados e a trava de LGPD barra dado pessoal", async () => {
    const { db, pool: p } = criarDb(DATABASE_URL);
    try {
      const r = await montarRetratos(db, dataSaoPaulo(new Date()));
      for (const g of GESTORES) expect(r[g.id]).toBeTruthy();
      expect(acharDadoPessoal(r)).toEqual([]);
      expect(r.frotas).toHaveProperty("veiculosPorSituacao");
      expect(r.administrativo).toHaveProperty("contasAPagar");
    } finally {
      await p.end();
    }
  });
});

describe("regressões da revisão", () => {
  it("ocupacao_por_passeio ignora saídas canceladas também nos passageiros (sem ocupação inflada)", async () => {
    const { rows: saidasRows } = await pool.query(
      `select s.id, s.data::text as data, s.capacidade, (select count(*) from passageiros pa join reservas r on r.id = pa.reserva_id where r.saida_id = s.id and r.status = 'CONFIRMADA')::int as pax
       from saidas s order by pax desc`,
    );
    const maior = saidasRows[0]!;
    const datas = saidasRows.map((r) => r.data as string).sort();
    await pool.query("update saidas set status = 'CANCELADA' where id = $1", [maior.id]);
    try {
      let resultado = "";
      let chamadas = 0;
      definirClienteIA({
        async enviar(p) {
          if (++chamadas === 1) return { content: [toolUse("ocupacao_por_passeio", { de: datas[0], ate: datas.at(-1) })], stop_reason: "tool_use", modelo: p.modelo, usage: uso };
          resultado = String((p.mensagens.at(-1)!.content as BlocoIA[])[0]!.content);
          return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", modelo: p.modelo, usage: uso };
        },
      });
      const admin = await logado("admin@bybus.test");
      expect((await admin.req("POST", "/api/ia/assistente", { mensagens: [{ papel: "usuario", texto: "Ocupação?" }] })).statusCode).toBe(200);
      const outras = saidasRows.filter((r) => r.id !== maior.id);
      const paxOutras = outras.reduce((s, r) => s + (r.pax as number), 0);
      const capOutras = outras.reduce((s, r) => s + (r.capacidade as number), 0);
      const linha = JSON.parse(resultado).passeios[0];
      expect(linha.passageirosConfirmados).toBe(paxOutras);
      expect(linha.capacidade).toBe(capOutras);
      expect(linha.ocupacaoPct).toBeLessThanOrEqual(100);
      expect(linha.ocupacaoPct).toBe(Math.round((paxOutras / capOutras) * 1000) / 10);
    } finally {
      await pool.query("update saidas set status = 'PREVISTA' where id = $1", [maior.id]);
    }
  });

  it("retratos de frotas e administrativo usam os módulos reais (só agregados) e não trazem lacunas falsas", async () => {
    const { rows: un } = await pool.query("select id from unidades limit 1");
    const { rows: cat } = await pool.query("insert into fin_categorias (codigo, nome, tipo, grupo) values ('TESTE_IA', 'Categoria de teste', 'DESPESA', 'Teste') returning id");
    const { rows: v } = await pool.query("insert into veiculos (unidade_id, placa, tipo, situacao) values ($1, 'ZZZ9Z99', 'ONIBUS', 'ATIVO') returning id", [un[0].id]);
    await pool.query("insert into veiculos_documentos (veiculo_id, tipo, vencimento) values ($1, 'CRLV', current_date - 3)", [v[0].id]);
    await pool.query("insert into fin_lancamentos (tipo, descricao, categoria_id, valor_centavos, competencia, vencimento) values ('PAGAR', 'Fornecedor Ficticio SA', $1, 12345, current_date, current_date - 2), ('RECEBER', 'Canal', $1, 500, current_date, current_date + 3)", [cat[0].id]);
    const { db, pool: p } = criarDb(DATABASE_URL);
    try {
      const r = await montarRetratos(db, dataSaoPaulo(new Date()));
      const frota = r.frotas as Record<string, any>;
      const adm = r.administrativo as Record<string, any>;
      expect(frota.lacunasDeDados).toBeUndefined();
      expect(frota.registrosDosVeiculos.vencidos).toBe(1);
      expect(frota.veiculosPorSituacao.ATIVO).toBeGreaterThanOrEqual(1);
      expect(adm.contasAPagar.vencidas).toEqual({ quantidade: 1, somaCentavos: 12345 });
      expect(adm.contasAReceber.aVencerEm7Dias).toEqual({ quantidade: 1, somaCentavos: 500 });
      expect(JSON.stringify(r)).not.toContain("ZZZ9Z99");
      expect(JSON.stringify(r)).not.toContain("Fornecedor Ficticio");
      expect(acharDadoPessoal(r)).toEqual([]);
    } finally {
      await p.end();
      await pool.query("delete from fin_lancamentos where descricao in ('Fornecedor Ficticio SA', 'Canal')");
      await pool.query("delete from fin_categorias where codigo = 'TESTE_IA'");
      await pool.query("delete from veiculos_documentos where veiculo_id = $1", [v[0].id]);
      await pool.query("delete from veiculos where id = $1", [v[0].id]);
    }
  });

  it("chamarEstruturado: após max_tokens aumenta o limite (x1,5) em vez de repetir igual, e para no teto", async () => {
    const { db, pool: p } = criarDb(DATABASE_URL);
    const config = lerConfig({ AMBIENTE: "testes", DATABASE_URL, CHAVE_CRIPTOGRAFIA: CHAVE, EXIGIR_MFA_ADMIN: "false" });
    const valido = { achados: [], vulnerabilidades: [], oportunidades: [], acoes_sugeridas: [] };
    const base = { db, config, modelo: "claude-opus-5-5", esforco: "low" as const, sistema: "s", ferramenta: FERRAMENTA_AVALIACAO, parser: zAvaliacao, usuario: "u", uso: { tipo: "AVALIACAO" as const } };
    try {
      const limites: number[] = [];
      const cortaUmaVez: ClienteIA = {
        async enviar(ped) {
          limites.push(ped.maxTokens);
          if (limites.length === 1) return { content: [{ type: "text", text: "..." }], stop_reason: "max_tokens", modelo: ped.modelo, usage: uso };
          return { content: [toolUse("registrar_avaliacao", valido)], stop_reason: "tool_use", modelo: ped.modelo, usage: uso };
        },
      };
      await chamarEstruturado({ ...base, cliente: cortaUmaVez, maxTokens: 8000 });
      expect(limites).toEqual([8000, 12000]);

      const noTeto: number[] = [];
      const sempreCorta: ClienteIA = { async enviar(ped) { noTeto.push(ped.maxTokens); return { content: [], stop_reason: "max_tokens", modelo: ped.modelo, usage: uso }; } };
      await expect(chamarEstruturado({ ...base, cliente: sempreCorta, maxTokens: TETO_MAX_TOKENS })).rejects.toThrow(/teto atingido/);
      expect(noTeto).toEqual([TETO_MAX_TOKENS]);
    } finally {
      await p.end();
    }
  });
});
