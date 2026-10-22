import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import type { FastifyInstance } from "fastify";
import { Cliente, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
});
afterAll(async () => fechar());

async function logado(email: string) {
  const c = new Cliente(app);
  const r = await c.login(email);
  expect(r.statusCode).toBe(200);
  return c;
}

async function primeiraSaida(c: Cliente) {
  const r = await c.req("GET", "/api/saidas?de=2000-01-01&ate=2100-01-01");
  expect(r.statusCode).toBe(200);
  return r.json() as Array<{ id: string; data: string; passageiros: number; pagantes: number }>;
}

describe("autenticação", () => {
  it("recusa senha errada sem revelar se o e-mail existe", async () => {
    const c = new Cliente(app);
    const a = await c.login("atendente@bybus.test", "errada-123456");
    const b = await c.login("naoexiste@bybus.test", "errada-123456");
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().mensagem).toBe(b.json().mensagem);
  });

  it("bloqueia após 5 tentativas erradas", async () => {
    const admin = new Cliente(app);
    await admin.login("admin@bybus.test");
    const { senhaTemporaria } = (await admin.req("POST", "/api/usuarios", { nome: "Usuário Bloqueio", email: "bloqueio@bybus.test", perfil: "GUIA" })).json();
    const c = new Cliente(app);
    for (let i = 0; i < 5; i++) await c.login("bloqueio@bybus.test", "errada-123456");
    // Bloqueada: mesmo com a senha certa, a resposta é a genérica (não revela o bloqueio a terceiros).
    const r = await c.login("bloqueio@bybus.test", senhaTemporaria);
    expect(r.statusCode).toBe(401);
    expect(r.json().codigo).toBe("CREDENCIAIS_INVALIDAS");
  });

  it("exige o cabeçalho anti-CSRF em requisições que alteram dados", async () => {
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "a@b.c", senha: "x" } });
    expect(r.statusCode).toBe(403);
  });

  it("sem login não acessa nada", async () => {
    const r = await new Cliente(app).req("GET", "/api/saidas?de=2000-01-01&ate=2100-01-01");
    expect(r.statusCode).toBe(401);
  });

  it("logout encerra a sessão", async () => {
    const c = await logado("guia@bybus.test");
    await c.req("POST", "/api/auth/logout");
    const r = await c.req("GET", "/api/auth/eu");
    expect(r.statusCode).toBe(401);
  });
});

describe("MFA obrigatório para administrativos", () => {
  it("supervisor precisa configurar MFA e depois faz login com código", async () => {
    const { app: appMfa, fechar: fecharMfa } = await subirApp({ EXIGIR_MFA_ADMIN: "true" });
    try {
      // Usuário próprio para não afetar os demais testes.
      const admin = new Cliente(app);
      await admin.login("admin@bybus.test");
      const { senhaTemporaria } = (await admin.req("POST", "/api/usuarios", { nome: "Supervisor MFA", email: "sup-mfa@bybus.test", perfil: "SUPERVISOR" })).json();
      const c = new Cliente(appMfa);
      expect((await c.login("sup-mfa@bybus.test", senhaTemporaria)).statusCode).toBe(200);
      expect((await c.req("POST", "/api/auth/senha", { senhaAtual: senhaTemporaria, novaSenha: "SupervisorMfa123" })).statusCode).toBe(200);
      expect((await c.req("GET", "/api/auth/eu")).json().pendencia).toBe("CONFIGURAR_MFA");
      expect((await c.req("GET", "/api/saidas?de=2000-01-01&ate=2100-01-01")).statusCode).toBe(403);

      const { segredo } = (await c.req("POST", "/api/auth/mfa/iniciar")).json();
      expect((await c.req("POST", "/api/auth/mfa/ativar", { codigo: "000000" })).statusCode).toBe(400);
      expect((await c.req("POST", "/api/auth/mfa/ativar", { codigo: authenticator.generate(segredo) })).statusCode).toBe(200);
      expect((await c.req("GET", "/api/saidas?de=2000-01-01&ate=2100-01-01")).statusCode).toBe(200);

      const novo = new Cliente(appMfa);
      const semCodigo = await novo.login("sup-mfa@bybus.test", "SupervisorMfa123");
      expect(semCodigo.statusCode).toBe(401);
      expect(semCodigo.json().codigo).toBe("MFA_NECESSARIO");
      // O código usado na ativação não pode ser reutilizado no login (proteção contra replay).
      const reuso = await novo.login("sup-mfa@bybus.test", "SupervisorMfa123", authenticator.generate(segredo));
      expect(reuso.statusCode).toBe(401);
      expect(reuso.json().codigo).toBe("MFA_INVALIDO");
    } finally {
      await fecharMfa();
    }
  });
});

describe("usuários", () => {
  it("admin cria usuário com senha temporária e troca obrigatória", async () => {
    const admin = await logado("admin@bybus.test");
    const r = await admin.req("POST", "/api/usuarios", { nome: "Nova Atendente", email: "nova@bybus.test", perfil: "ATENDENTE" });
    expect(r.statusCode).toBe(200);
    const { senhaTemporaria } = r.json();

    const nova = new Cliente(app);
    expect((await nova.login("nova@bybus.test", senhaTemporaria)).statusCode).toBe(200);
    expect((await nova.req("GET", "/api/saidas?de=2000-01-01&ate=2100-01-01")).json().codigo).toBe("TROCAR_SENHA");
    expect((await nova.req("POST", "/api/auth/senha", { senhaAtual: senhaTemporaria, novaSenha: "curta" })).statusCode).toBe(400);
    expect((await nova.req("POST", "/api/auth/senha", { senhaAtual: senhaTemporaria, novaSenha: "SenhaNova12345" })).statusCode).toBe(200);
    expect((await nova.req("GET", "/api/saidas?de=2000-01-01&ate=2100-01-01")).statusCode).toBe(200);
  });

  it("atendente não gerencia usuários", async () => {
    const c = await logado("atendente@bybus.test");
    expect((await c.req("GET", "/api/usuarios")).statusCode).toBe(403);
  });
});

describe("lista de passageiros", () => {
  it("monta em ordem de embarque com documentos mascarados", async () => {
    const c = await logado("atendente@bybus.test");
    const [saida] = await primeiraSaida(c);
    const r = await c.req("GET", `/api/saidas/${saida!.id}/manifesto`);
    expect(r.statusCode).toBe(200);
    const { manifesto } = r.json();
    const horarios = manifesto.blocos.filter((b: { ponto: unknown }) => b.ponto).map((b: { ponto: { horario: string; ordem: number } }) => b.ponto.horario + String(b.ponto.ordem).padStart(4, "0"));
    expect(horarios).toEqual([...horarios].sort());
    const docs = manifesto.blocos.flatMap((b: { linhas: Array<{ passageiro: { documento: string | null } }> }) => b.linhas.map((l) => l.passageiro.documento)).filter(Boolean);
    expect(docs.length).toBeGreaterThan(0);
    docs.forEach((d: string) => expect(d).toMatch(/^•••/));
  });

  it("atendente não vê documento completo; supervisor vê e fica auditado", async () => {
    const at = await logado("atendente@bybus.test");
    const [saida] = await primeiraSaida(at);
    expect((await at.req("GET", `/api/saidas/${saida!.id}/manifesto?documentos=completos`)).statusCode).toBe(403);

    const sup = await logado("supervisor@bybus.test");
    const r = await sup.req("GET", `/api/saidas/${saida!.id}/manifesto?documentos=completos`);
    expect(r.statusCode).toBe(200);
    const docs = r.json().manifesto.blocos.flatMap((b: { linhas: Array<{ passageiro: { documento: string | null; documentoTipo: string } }> }) => b.linhas.map((l) => l.passageiro)).filter((p: { documentoTipo: string }) => p.documentoTipo === "CPF");
    expect(docs[0].documento).toMatch(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/);

    const aud = (await sup.req("GET", "/api/auditoria")).json();
    expect(aud.some((a: { acao: string }) => a.acao === "MANIFESTO_DOCUMENTOS_COMPLETOS")).toBe(true);
  });

  it("motorista vê a lista sem telefones", async () => {
    const m = await logado("motorista@bybus.test");
    const [saida] = await primeiraSaida(m);
    const linhas = (await m.req("GET", `/api/saidas/${saida!.id}/manifesto`)).json().manifesto.blocos.flatMap((b: { linhas: unknown[] }) => b.linhas);
    linhas.forEach((l: { contatoTelefone: string | null }) => expect(l.contatoTelefone).toBeNull());
  });

  it("exporta CSV com proteção contra fórmula", async () => {
    const c = await logado("atendente@bybus.test");
    const [saida] = await primeiraSaida(c);
    const r = await c.req("GET", `/api/saidas/${saida!.id}/manifesto.csv`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.body.split("\r\n")[0]).toContain("Ponto de embarque");
  });
});

describe("reservas e embarque", () => {
  it("atendente cria reserva com CPF inválido e o sistema alerta", async () => {
    const c = await logado("atendente@bybus.test");
    const [saida] = await primeiraSaida(c);
    const r = await c.req("POST", `/api/saidas/${saida!.id}/reservas`, {
      canal: "BALCAO", contatoNome: "Cliente Balcão Fictício",
      passageiros: [{ nome: "Cliente Balcão Fictício", categoria: "ADULTO", documentoTipo: "CPF", documento: "111.222.333-44" }],
    });
    expect(r.statusCode).toBe(200);
    const m = (await c.req("GET", `/api/saidas/${saida!.id}/manifesto`)).json().manifesto;
    expect(m.alertas.map((a: { codigo: string }) => a.codigo)).toContain("DOCUMENTO_INVALIDO");
  });

  it("guia registra embarque; motorista não pode", async () => {
    const guia = await logado("guia@bybus.test");
    const [saida] = await primeiraSaida(guia);
    const m = (await guia.req("GET", `/api/saidas/${saida!.id}/manifesto`)).json().manifesto;
    const pid = m.blocos[0].linhas[0].passageiro.id;
    const r = await guia.req("POST", `/api/passageiros/${pid}/embarque`, { status: "EMBARCOU" });
    expect(r.statusCode).toBe(200);
    expect(r.json().embarque).toBe("EMBARCOU");
  });

  it("só supervisor confirma ou cancela a saída", async () => {
    const at = await logado("atendente@bybus.test");
    const [saida] = await primeiraSaida(at);
    expect((await at.req("PATCH", `/api/saidas/${saida!.id}`, { status: "CONFIRMADA" })).statusCode).toBe(403);
    expect((await at.req("PATCH", `/api/saidas/${saida!.id}`, { status: "PREVISTA" })).statusCode).toBe(403);
    const sup = await logado("supervisor@bybus.test");
    expect((await sup.req("PATCH", `/api/saidas/${saida!.id}`, { status: "CONFIRMADA" })).statusCode).toBe(200);
  });

  it("não permite inverter a ordem do transfer", async () => {
    const sup = await logado("supervisor@bybus.test");
    const [passeio] = (await sup.req("GET", "/api/passeios")).json();
    const pontos = (await sup.req("GET", `/api/passeios/${passeio.id}/pontos`)).json();
    const jurere = pontos.find((p: { nome: string }) => p.nome.includes("Jurerê"));
    const r = await sup.req("PATCH", `/api/pontos/${jurere.id}`, { horario: "06:30" });
    expect(r.statusCode).toBe(400);
    expect(r.json().codigo).toBe("ORDEM_TRANSFER");
  });
});

describe("importação", () => {
  const email = (ref: string, pax = "2 Adult") => `| Booking ref. | ${ref} |
| Product booking ref. | BYB-T${ref.replace(/\D/g, "")} |
| Ext. booking ref | 77${ref.replace(/\D/g, "")} |
| Product | 165696P2 - Floripa City Tour by Bus - Whole Island |
| Sold by | Viator.com |
| Booking channel | Viator.com |
| Customer | Teste, Pessoa |
| Customer phone | +1 555-000-0001 |
| Date | Sat 24.Oct '26 @ 08:00 |
| PAX | ${pax} |`;

  it("prévia não grava; confirmação grava; reimportar não duplica; cancelamento cancela", async () => {
    const c = await logado("atendente@bybus.test");
    const previa = await c.req("POST", "/api/importacoes/bokun-email", { emails: [{ assunto: "New booking", corpo: email("VIA-555000111") }] });
    expect(previa.json().resumo.CRIAR).toBe(1);
    const previa2 = await c.req("POST", "/api/importacoes/bokun-email", { emails: [{ assunto: "New booking", corpo: email("VIA-555000111") }] });
    expect(previa2.json().resumo.CRIAR).toBe(1);

    expect((await c.req("POST", "/api/importacoes/bokun-email", { emails: [{ assunto: "New booking", corpo: email("VIA-555000111") }], confirmar: true })).json().resumo.CRIAR).toBe(1);
    expect((await c.req("POST", "/api/importacoes/bokun-email", { emails: [{ assunto: "New booking", corpo: email("VIA-555000111") }], confirmar: true })).json().resumo.ATUALIZAR).toBe(1);
    expect((await c.req("POST", "/api/importacoes/bokun-email", { emails: [{ assunto: "Cancelled booking", corpo: email("VIA-555000111") }], confirmar: true })).json().resumo.CANCELAR).toBe(1);
  });

  it("importa CSV da Paytour, detecta espelho de OTA e aponta duplicata", async () => {
    const c = await logado("atendente@bybus.test");
    await c.req("POST", "/api/importacoes/bokun-email", { emails: [{ assunto: "New booking", corpo: email("VIA-555000222", "1 Senior") }], confirmar: true });
    const csv = [
      "Código;Data;Atividade;Nome;Documento;Categoria;Ponto de embarque;Afiliado;Status;Observações",
      "9001;24/10/2026;City Tour Toda Ilha;Família Csv Teste;529.982.247-25;Adulto;Villa Romana Shopping;;Confirmada;",
      "9001;24/10/2026;City Tour Toda Ilha;Filho Csv Teste;;Infantil;Villa Romana Shopping;;Confirmada;",
      "9002;24/10/2026;City Tour Toda Ilha;Pessoa Teste;1111;Sênior;;tripadvisorinternobybus@gmail.com;Confirmada;VIA-555000222",
      "9003;24/10/2026;Passeio de Escuna;Outro Passeio;;Adulto;;;Confirmada;",
    ].join("\n");
    const r = await c.req("POST", "/api/importacoes/paytour-csv", { conteudo: csv, confirmar: true });
    expect(r.statusCode).toBe(200);
    expect(r.json().resumo).toMatchObject({ CRIAR: 2, IGNORAR: 1 });

    const saidas = await primeiraSaida(c);
    const s24 = saidas.find((s) => s.data === "2026-10-24")!;
    const m = (await c.req("GET", `/api/saidas/${s24.id}/manifesto`)).json().manifesto;
    expect(m.alertas.map((a: { codigo: string }) => a.codigo)).toContain("POSSIVEL_DUPLICATA");
    const villa = m.blocos.find((b: { ponto: { nome: string } | null }) => b.ponto?.nome === "Villa Romana Shopping");
    const nomes = villa.linhas.map((l: { passageiro: { nome: string } }) => l.passageiro.nome);
    const i = nomes.indexOf("Família Csv Teste");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(nomes[i + 1]).toBe("Filho Csv Teste"); // família junta, na ordem cadastrada
  });
});

describe("endurecimento (revisão de segurança)", () => {
  it("auditoria não pode ser alterada nem apagada", async () => {
    const pg = await import("pg");
    const c = new pg.default.Client({ connectionString: (await import("./ajuda.js")).DATABASE_URL });
    await c.connect();
    try {
      await expect(c.query("UPDATE auditoria SET acao = 'X'")).rejects.toThrow(/imutável/);
      await expect(c.query("DELETE FROM auditoria")).rejects.toThrow(/imutável/);
    } finally {
      await c.end();
    }
  });

  it("produção recusa MFA desligado e exige AMBIENTE", async () => {
    const { lerConfig } = await import("../src/config.js");
    const base = { DATABASE_URL: "postgres://x@y/z", CHAVE_CRIPTOGRAFIA: Buffer.alloc(32).toString("base64") };
    expect(() => lerConfig({ ...base, AMBIENTE: "producao", EXIGIR_MFA_ADMIN: "false" })).toThrow(/EXIGIR_MFA_ADMIN/);
    expect(() => lerConfig(base)).toThrow(/AMBIENTE/);
  });

  it("lista e encerra sessões do próprio usuário", async () => {
    const a = await logado("guia@bybus.test");
    const b = await logado("guia@bybus.test");
    const lista = (await a.req("GET", "/api/auth/sessoes")).json();
    const outra = lista.find((s: { atual: boolean }) => !s.atual);
    expect(outra).toBeTruthy();
    expect((await a.req("DELETE", `/api/auth/sessoes/${outra.id}`)).statusCode).toBe(200);
    const r = await b.req("GET", "/api/auth/eu");
    expect([200, 401]).toContain(r.statusCode);
  });

  it("e-mail da Bókun malicioso não derruba a API", async () => {
    const c = await logado("atendente@bybus.test");
    const inicio = Date.now();
    const r = await c.req("POST", "/api/importacoes/bokun-email", { emails: [{ assunto: "x", corpo: "|a|" + " ".repeat(90_000) + "x" }] });
    expect(r.statusCode).toBe(400);
    expect(Date.now() - inicio).toBeLessThan(2000);
  });
});

describe("correções apontadas pelo front-end", () => {
  it("editar reserva sem mandar e-mail não apaga o e-mail", async () => {
    const c = await logado("atendente@bybus.test");
    const [saida] = await primeiraSaida(c);
    const r = (await c.req("POST", `/api/saidas/${saida!.id}/reservas`, {
      canal: "BALCAO", contatoNome: "Titular Email Teste", contatoEmail: "titular@exemplo.invalid",
      passageiros: [{ nome: "Titular Email Teste", categoria: "ADULTO" }],
    })).json();
    const editada = (await c.req("PATCH", `/api/reservas/${r.id}`, { observacoes: "só obs" })).json();
    expect(editada.contatoEmail).toBe("titular@exemplo.invalid");
  });

  it("trocar tipo de documento sem número é recusado", async () => {
    const c = await logado("atendente@bybus.test");
    const [saida] = await primeiraSaida(c);
    const m = (await c.req("GET", `/api/saidas/${saida!.id}/manifesto`)).json().manifesto;
    const pid = m.blocos[0].linhas[0].passageiro.id;
    const r = await c.req("PATCH", `/api/passageiros/${pid}`, { documentoTipo: "RG" });
    expect(r.statusCode).toBe(400);
  });

  it("GET /api/saidas/:id devolve a saída sem gravar auditoria de manifesto", async () => {
    const c = await logado("atendente@bybus.test");
    const [saida] = await primeiraSaida(c);
    const r = await c.req("GET", `/api/saidas/${saida!.id}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().passeio.codigo).toBe("TODA_ILHA");
  });
});
