import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { assinaturaDocumentos, gruposAnexos } from "../src/db/schema.js";
import { emailsDeTeste } from "../src/servicos/email.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
const comDb = async <T>(f: (db: ReturnType<typeof criarDb>["db"]) => Promise<T>) => {
  const { db, pool } = criarDb(DATABASE_URL);
  try { return await f(db); } finally { await pool.end(); }
};
beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp({ URL_PUBLICA: "https://gestao.exemplo.test", EMAIL_USUARIO: "envio@exemplo.test", EMAIL_SENHA: "senha-ficticia" }));
});
afterAll(async () => fechar());

// CPFs fictícios válidos (gerados só para teste).
const CPF_REP = "52998224725";
const CPF_DIR = "11144477735";

describe("assinatura eletrônica do contrato (13/11/2026)", () => {
  it("envia, cada um assina com código por e-mail, nome e CPF; no fim gera o PDF com a folha de assinaturas", async () => {
    const c = new Cliente(app);
    await c.login("supervisor@bybus.test");
    const id = (await c.req("POST", "/api/grupos", { nome: "Escola Fictícia Assinatura", estilo: "ESCOLA", dataPasseio: "2099-05-10", pessoas: 30, valorPorPessoaCentavos: 13000, representanteNome: "Representante Fictícia" })).json().id as string;
    expect((await c.req("POST", `/api/grupos/${id}/assinatura`, { signatarios: [{ papel: "CONTRATANTE", nome: "Representante Fictícia", email: "rep@exemplo.test" }] })).statusCode).toBe(400);
    emailsDeTeste.length = 0;
    const env = await c.req("POST", `/api/grupos/${id}/assinatura`, { signatarios: [
      { papel: "CONTRATANTE", nome: "Representante Fictícia", email: "rep@exemplo.test", cpf: CPF_REP },
      { papel: "CONTRATADA", nome: "Diretora Fictícia", email: "dir@exemplo.test" },
    ] });
    expect(env.statusCode, env.body).toBe(200);
    const { links, codigoVerificacao, documentoId } = env.json();
    expect(codigoVerificacao).toMatch(/^BB-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(links.every((l: { emailEnviado: boolean; link: string }) => l.emailEnviado && l.link.startsWith("https://gestao.exemplo.test/assinar/"))).toBe(true);
    expect(emailsDeTeste.map((e) => e.para).sort()).toEqual(["dir@exemplo.test", "rep@exemplo.test"]);
    expect((await c.req("POST", `/api/grupos/${id}/assinatura`, { signatarios: [{ papel: "CONTRATANTE", nome: "X Y Z", email: "a@b.test" }, { papel: "CONTRATADA", nome: "X Y Z", email: "a@b.test" }] })).statusCode).toBe(409);

    const pub = new Cliente(app);
    const tokRep = links[0].link.split("/").pop();
    const ver = (await pub.req("GET", `/api/publico/assinar/${tokRep}`)).json();
    expect(ver).toMatchObject({ documento: { status: "PENDENTE", codigoVerificacao }, signatario: { nome: "Representante Fictícia", email: "re*@exemplo.test" } });
    const pdf = await pub.req("GET", `/api/publico/assinar/${tokRep}/pdf`);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");

    const assinar = async (tok: string, email: string, nome: string, cpf: string, erroCodigo = false) => {
      emailsDeTeste.length = 0;
      expect((await pub.req("POST", `/api/publico/assinar/${tok}/codigo`)).statusCode).toBe(200);
      const msg = emailsDeTeste.find((e) => e.para === email)!;
      const codigo = /(\d{6})/.exec(msg.assunto)![1]!;
      if (erroCodigo) {
        const errado = codigo === "000000" ? "111111" : "000000";
        const r = await pub.req("POST", `/api/publico/assinar/${tok}/assinar`, { codigo: errado, nome, cpf, aceite: true });
        expect(r.json().codigo).toBe("CODIGO_ERRADO");
        expect((await pub.req("POST", `/api/publico/assinar/${tok}/assinar`, { codigo, nome: "Outra Pessoa Fictícia", cpf, aceite: true })).json().codigo).toBe("NOME_DIFERENTE");
        expect((await pub.req("POST", `/api/publico/assinar/${tok}/assinar`, { codigo, nome, cpf: CPF_DIR, aceite: true })).json().codigo).toBe("CPF_DIFERENTE");
      }
      return pub.req("POST", `/api/publico/assinar/${tok}/assinar`, { codigo, nome, cpf, aceite: true }, { "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile" });
    };
    const r1 = await assinar(tokRep, "rep@exemplo.test", "  representante ficticia ", CPF_REP, true);
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r1.json().concluido).toBe(false);
    expect((await pub.req("POST", `/api/publico/assinar/${tokRep}/codigo`)).statusCode).toBe(409); // já assinou

    const tokDir = links[1].link.split("/").pop();
    emailsDeTeste.length = 0;
    const r2 = await assinar(tokDir, "dir@exemplo.test", "Diretora Fictícia", CPF_DIR);
    expect(r2.json().concluido).toBe(true);
    expect(emailsDeTeste.filter((e) => e.assunto.startsWith("Documento assinado")).length).toBe(2);

    const [d] = await comDb((db) => db.select().from(assinaturaDocumentos).where(eq(assinaturaDocumentos.id, documentoId)));
    expect(d).toMatchObject({ status: "CONCLUIDO" });
    expect(d!.hashFinal).toMatch(/^[0-9a-f]{64}$/);
    expect(await comDb((db) => db.select().from(gruposAnexos).where(eq(gruposAnexos.grupoId, id)))).toHaveLength(1);
    const lista = (await c.req("GET", `/api/grupos/${id}/assinaturas`)).json();
    expect(lista[0].signatarios.every((s: { assinadoEm: string | null }) => s.assinadoEm)).toBe(true);

    // Verificação pública: só metadados (sem e-mail, CPF ou conteúdo).
    const v = (await pub.req("GET", `/api/publico/verificar/${codigoVerificacao}`)).json();
    expect(v).toMatchObject({ status: "CONCLUIDO", hashOriginal: d!.hashOriginal, hashFinal: d!.hashFinal });
    expect(JSON.stringify(v)).not.toMatch(/exemplo\.test|52998224725|11144477735/);
    expect((await pub.req("GET", "/api/publico/verificar/BB-AAAA-AAAA")).statusCode).toBe(404);
  });

  it("cancelar derruba os links; quem não lança reservas não envia", async () => {
    const c = new Cliente(app);
    await c.login("supervisor@bybus.test");
    const id = (await c.req("POST", "/api/grupos", { nome: "Escola Fictícia Cancela", estilo: "ESCOLA" })).json().id as string;
    const env = (await c.req("POST", `/api/grupos/${id}/assinatura`, { signatarios: [{ papel: "CONTRATANTE", nome: "Rep Fictício", email: "r@exemplo.test" }, { papel: "CONTRATADA", nome: "Dir Fictícia", email: "d@exemplo.test" }] })).json();
    expect((await c.req("POST", `/api/assinaturas/${env.documentoId}/cancelar`)).statusCode).toBe(200);
    expect((await new Cliente(app).req("GET", `/api/publico/assinar/${env.links[0].link.split("/").pop()}`)).statusCode).toBe(404);
    const guia = new Cliente(app);
    await guia.login("guia@bybus.test");
    expect((await guia.req("POST", `/api/grupos/${id}/assinatura`, { signatarios: [] })).statusCode).toBe(403);
  });
});
