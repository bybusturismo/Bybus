import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { criarDb } from "../src/db/cliente.js";
import { bibliotecaPaginas } from "../src/db/schema.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
let admin: Cliente;
let editor: Cliente; // biblioteca:ver + editar
let leitor: Cliente; // biblioteca:ver
let colega: Cliente; // biblioteca:ver, vai receber acesso por pessoa
let ids: { editor: string; leitor: string; colega: string };
const { db, pool } = criarDb(DATABASE_URL);

async function novo(perfil: string, permissoes: string[], email: string) {
  expect((await admin.req("POST", "/api/perfis", { codigo: perfil, nome: perfil, permissoes })).statusCode).toBe(200);
  const r = (await admin.req("POST", "/api/usuarios", { nome: `Usuário ${perfil}`, email, perfil })).json();
  const c = new Cliente(app);
  await c.login(email, r.senhaTemporaria);
  await c.req("POST", "/api/auth/senha", { senhaAtual: r.senhaTemporaria, novaSenha: "BibTeste123456" });
  const eu = (await c.req("GET", "/api/auth/eu")).json();
  return { c, id: (eu.usuario?.id ?? eu.id) as string };
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
  admin = new Cliente(app);
  expect((await admin.login("admin@bybus.test")).statusCode).toBe(200);
  const e = await novo("BIB_ED", ["biblioteca:ver", "biblioteca:editar"], "bib.ed@bybus.test");
  const l = await novo("BIB_LE", ["biblioteca:ver"], "bib.le@bybus.test");
  const o = await novo("BIB_CO", ["biblioteca:ver"], "bib.co@bybus.test");
  editor = e.c; leitor = l.c; colega = o.c;
  ids = { editor: e.id, leitor: l.id, colega: o.id };
});
afterAll(async () => {
  await pool.end();
  await fechar();
});

const criar = async (c: Cliente, titulo: string, paiId: string | null = null, extra: Record<string, unknown> = {}) => {
  const r = await c.req("POST", "/api/biblioteca/paginas", { titulo, paiId, ...extra });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as string;
};
const lista = async (c: Cliente) => (await c.req("GET", "/api/biblioteca/paginas")).json().paginas as Array<{ id: string; paiId: string | null; ordem: number; titulo: string }>;
const filhasEm = async (pai: string | null) => (await lista(editor)).filter((p) => p.paiId === pai).sort((a, b) => a.ordem - b.ordem).map((p) => p.titulo);

describe("ordem e ciclo", () => {
  it("renumera as irmãs ao arrastar (terço de cima/baixo) e vira subpágina no meio", async () => {
    const raiz = await criar(editor, "Raiz ordem");
    const a = await criar(editor, "A1", raiz), b = await criar(editor, "B1", raiz), c = await criar(editor, "C1", raiz);
    expect(await filhasEm(raiz)).toEqual(["A1", "B1", "C1"]);
    expect((await editor.req("PATCH", `/api/biblioteca/paginas/${c}`, { antesDe: a })).statusCode).toBe(200);
    expect(await filhasEm(raiz)).toEqual(["C1", "A1", "B1"]);
    const ordens = (await lista(editor)).filter((p) => p.paiId === raiz).map((p) => p.ordem).sort();
    expect(ordens).toEqual([1, 2, 3]);
    // sem antesDe vai para o fim
    expect((await editor.req("PATCH", `/api/biblioteca/paginas/${c}`, { paiId: raiz })).statusCode).toBe(200);
    expect(await filhasEm(raiz)).toEqual(["A1", "B1", "C1"]);
    // meio: dentro de outra
    expect((await editor.req("PATCH", `/api/biblioteca/paginas/${b}`, { paiId: a })).statusCode).toBe(200);
    expect(await filhasEm(raiz)).toEqual(["A1", "C1"]);
    expect(await filhasEm(a)).toEqual(["B1"]);
    // referência que não é irmã é recusada
    expect((await editor.req("PATCH", `/api/biblioteca/paginas/${c}`, { antesDe: b })).json().codigo).toBe("IRMA_INVALIDA");
  });

  it("recusa ciclo (dentro dela mesma ou de uma subpágina)", async () => {
    const a = await criar(editor, "Ciclo A");
    const b = await criar(editor, "Ciclo B", a);
    const c = await criar(editor, "Ciclo C", b);
    for (const alvo of [a, c, b]) {
      if (alvo === b) continue;
      const r = await editor.req("PATCH", `/api/biblioteca/paginas/${a}`, { paiId: alvo });
      expect(r.statusCode).toBe(400);
      expect(r.json().codigo).toBe("CICLO");
    }
    expect((await editor.req("PATCH", `/api/biblioteca/paginas/${b}`, { paiId: b })).json().codigo).toBe("CICLO");
  });

  it("as irmãs que a pessoa não vê mantêm o lugar na renumeração", async () => {
    const raiz = await criar(editor, "Raiz oculta");
    const x = await criar(editor, "Visível 1", raiz), oculta = await criar(editor, "Oculta", raiz), y = await criar(editor, "Visível 2", raiz);
    await admin.req("PATCH", `/api/biblioteca/paginas/${oculta}`, { acesso: "RESTRITO" });
    await admin.req("PUT", `/api/biblioteca/paginas/${raiz}/pessoas`, { pessoas: [{ usuarioId: ids.colega, nivel: "EDITAR" }] });
    await admin.req("PUT", `/api/biblioteca/paginas/${oculta}/pessoas`, { pessoas: [{ usuarioId: ids.editor, nivel: "EDITAR" }] });
    // colega edita Visível 2 e o move para antes de Visível 1; a oculta fica depois deles, em seu lugar relativo
    expect((await colega.req("PATCH", `/api/biblioteca/paginas/${y}`, { antesDe: x })).statusCode).toBe(200);
    const todas = (await db.select().from(bibliotecaPaginas).where(eq(bibliotecaPaginas.paiId, raiz))).sort((a, b) => a.ordem - b.ordem).map((p) => p.titulo);
    expect(todas).toEqual(["Visível 2", "Visível 1", "Oculta"]);
  });
});

describe("acesso por pessoa herdado", () => {
  it("restrita + lista de pessoas: VER lê, EDITAR edita, vale para as subpáginas; quem não está na lista não vê", async () => {
    const pai = await criar(editor, "Pessoal pai", null, { acesso: "RESTRITO", conteudo: "<p>Confidencial pessoal</p>" });
    const filha = await criar(editor, "Pessoal filha", pai, { conteudo: "<p>Filha</p>" });
    expect((await leitor.req("GET", `/api/biblioteca/paginas/${filha}`)).statusCode).toBe(404);
    expect((await colega.req("GET", `/api/biblioteca/paginas/${filha}`)).statusCode).toBe(404);
    // só quem edita a Biblioteca mexe na lista
    expect((await colega.req("PUT", `/api/biblioteca/paginas/${pai}/pessoas`, { pessoas: [] })).statusCode).toBe(403);
    expect((await admin.req("PUT", `/api/biblioteca/paginas/${pai}/pessoas`, { pessoas: [{ usuarioId: ids.colega, nivel: "VER" }, { usuarioId: ids.leitor, nivel: "EDITAR" }] })).statusCode).toBe(200);
    // VER: lê a filha herdada, não edita
    const g = (await colega.req("GET", `/api/biblioteca/paginas/${filha}`)).json();
    expect(g.podeEditar).toBe(false);
    expect((await colega.req("PATCH", `/api/biblioteca/paginas/${filha}`, { titulo: "Invasão" })).statusCode).toBe(403);
    expect((await colega.req("POST", "/api/biblioteca/paginas", { titulo: "Nova filha", paiId: pai })).statusCode).toBe(403);
    // EDITAR: edita a herdada e cria subpágina, mas não muda o acesso nem cria na raiz
    expect((await leitor.req("PATCH", `/api/biblioteca/paginas/${filha}`, { titulo: "Filha editada", conteudo: "<p>novo</p>" })).statusCode).toBe(200);
    expect((await leitor.req("POST", "/api/biblioteca/paginas", { titulo: "Neta", paiId: filha })).statusCode).toBe(200);
    expect((await leitor.req("PATCH", `/api/biblioteca/paginas/${filha}`, { acesso: "RESTRITO" })).statusCode).toBe(403);
    expect((await leitor.req("POST", "/api/biblioteca/paginas", { titulo: "Na raiz", paiId: null })).statusCode).toBe(403);
    // colaboradores e proprietário aparecem
    const pai2 = (await editor.req("GET", `/api/biblioteca/paginas/${pai}`)).json();
    expect(pai2.subpaginas[0].colaboradores).toContain("Usuário BIB_LE");
    expect(pai2.subpaginas[0].proprietario).toBe("Usuário BIB_ED");
    // a busca respeita a lista
    expect((await colega.req("GET", "/api/biblioteca/busca?q=Confidencial")).json().map((x: { id: string }) => x.id)).toEqual([pai]);
    expect((await new Cliente(app).req("GET", "/api/biblioteca/busca?q=Confidencial")).statusCode).toBe(401);
  });

  it("lista de pessoa inválida é recusada; exige login e permissão de ver", async () => {
    const p = await criar(editor, "Lista inválida");
    expect((await admin.req("PUT", `/api/biblioteca/paginas/${p}/pessoas`, { pessoas: [{ usuarioId: "00000000-0000-4000-8000-000000000000", nivel: "VER" }] })).json().codigo).toBe("PESSOA_INVALIDA");
    expect((await admin.req("PUT", `/api/biblioteca/paginas/${p}/pessoas`, { pessoas: [{ usuarioId: ids.colega, nivel: "DONO" }] })).statusCode).toBe(400);
    expect((await new Cliente(app).req("GET", `/api/biblioteca/paginas/${p}/pessoas`)).statusCode).toBe(401);
  });
});

describe("HTML perigoso é limpo no servidor", () => {
  it("remove script, onerror, javascript:, style com url() e imagens de fora", async () => {
    const sujo = [
      "<p onclick=\"alert(1)\" style=\"color: red; background: url(http://x.test/a.png); position: fixed\">Olá<script>alert(1)</script></p>",
      "<img src=\"x\" onerror=\"alert(1)\">",
      "<img src=\"https://rastreio.test/pixel.png\">",
      "<a href=\"javascript:alert(1)\">ruim</a>",
      "<a href=\"https://exemplo.test/ok\" onmouseover=\"x()\">bom</a>",
      "<iframe src=\"https://x.test\"></iframe>",
      "<svg onload=\"alert(1)\"><circle/></svg>",
      "<style>body{display:none}</style>",
      "<video src=\"https://x.test/v.mp4\" onerror=\"x()\"></video>",
    ].join("");
    const id = await criar(editor, "Página suja", null, { conteudo: sujo });
    const g = (await editor.req("GET", `/api/biblioteca/paginas/${id}`)).json();
    expect(g.formato).toBe("html");
    const c = g.conteudo as string;
    expect(c.startsWith("<!--html-->")).toBe(true);
    for (const proibido of ["<script", "alert(", "onerror", "onclick", "onmouseover", "onload", "url(", "position", "javascript:", "<iframe", "<svg", "<style", "rastreio.test", "x.test"]) {
      expect(c, `contém ${proibido}`).not.toContain(proibido);
    }
    expect(c).toContain("color: red");
    expect(c).toContain('href="https://exemplo.test/ok"');
    expect(c).toContain('rel="noopener noreferrer"');
    // edição também limpa
    await editor.req("PATCH", `/api/biblioteca/paginas/${id}`, { conteudo: "<p><img src=\"/api/biblioteca/anexos/00000000-0000-4000-8000-000000000000\" onerror=\"x()\"><b onclick=\"y()\">forte</b></p>" });
    const c2 = (await editor.req("GET", `/api/biblioteca/paginas/${id}`)).json().conteudo as string;
    expect(c2).toContain("/api/biblioteca/anexos/00000000-0000-4000-8000-000000000000");
    expect(c2).not.toContain("onerror");
    expect(c2).not.toContain("onclick");
  });

  it("markdown enviado vira HTML limpo; ícone com marcação é recusado", async () => {
    const id = await criar(editor, "Veio do markdown", null, { conteudo: "# Título\n\n<script>x</script> **forte**", formato: "markdown", icone: "📘" });
    const g = (await editor.req("GET", `/api/biblioteca/paginas/${id}`)).json();
    expect(g.conteudo).toContain("<h1>Título</h1>");
    expect(g.conteudo).not.toContain("<script");
    expect(g.icone).toBe("📘");
    expect((await editor.req("PATCH", `/api/biblioteca/paginas/${id}`, { icone: "<b>x</b>" })).statusCode).toBe(400);
  });
});

async function enviar(c: Cliente, paginaId: string, nome: string, tipo: string, corpo: Buffer) {
  const r = await app.inject({ method: "POST", url: `/api/biblioteca/paginas/${paginaId}/anexos?nome=${encodeURIComponent(nome)}`, payload: corpo, headers: { cookie: c.cookie, "x-bybus": "1", "content-type": tipo } });
  return r;
}

describe("anexos", () => {
  it("aceita imagem válida, entrega com os cabeçalhos certos e limpa o texto ao excluir", async () => {
    const p = await criar(editor, "Com imagem");
    const r = await enviar(editor, p, "foto.png", "image/png", PNG);
    expect(r.statusCode).toBe(200);
    const { id, url } = r.json();
    await editor.req("PATCH", `/api/biblioteca/paginas/${p}`, { conteudo: `<p>Veja:</p><img src="${url}" alt="foto">` });
    const baixar = await app.inject({ method: "GET", url, headers: { cookie: editor.cookie } });
    expect(baixar.statusCode).toBe(200);
    expect(baixar.headers["content-type"]).toBe("image/png");
    expect(baixar.headers["x-content-type-options"]).toBe("nosniff");
    expect(baixar.rawPayload.equals(PNG)).toBe(true);
    const faixa = await app.inject({ method: "GET", url, headers: { cookie: editor.cookie, range: "bytes=0-3" } });
    expect(faixa.statusCode).toBe(206);
    expect(faixa.rawPayload.length).toBe(4);
    // quem não pode ler a página não baixa
    const restrita = await criar(editor, "Imagem restrita", null, { acesso: "RESTRITO" });
    const rr = await enviar(editor, restrita, "a.png", "image/png", PNG);
    expect((await app.inject({ method: "GET", url: rr.json().url, headers: { cookie: leitor.cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    // excluir o anexo tira a imagem do texto
    expect((await editor.req("DELETE", `/api/biblioteca/anexos/${id}`)).statusCode).toBe(200);
    expect((await editor.req("GET", `/api/biblioteca/paginas/${p}`)).json().conteudo).not.toContain("<img");
    expect((await leitor.req("DELETE", `/api/biblioteca/anexos/${rr.json().id}`)).statusCode).toBe(404);
  });

  it("recusa tipo inválido, conteúdo que não confere, SVG/HTML e arquivo grande", async () => {
    const p = await criar(editor, "Anexos inválidos");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect((await enviar(editor, p, "a.svg", "image/svg+xml", svg)).statusCode).toBe(400);
    expect((await enviar(editor, p, "a.html", "text/html", Buffer.from("<script>1</script>"))).statusCode).toBe(400);
    expect((await enviar(editor, p, "a.exe", "application/octet-stream", Buffer.from("MZ...."))).statusCode).toBe(400);
    // declarado PNG, mas o conteúdo é HTML
    expect((await enviar(editor, p, "falso.png", "image/png", Buffer.from("<html><script>alert(1)</script></html>"))).json().codigo).toBe("TIPO_INVALIDO");
    // declarado PDF, conteúdo PNG
    expect((await enviar(editor, p, "x.pdf", "application/pdf", PNG)).json().codigo).toBe("TIPO_INVALIDO");
    // vazio
    expect((await enviar(editor, p, "vazio.png", "image/png", Buffer.alloc(0))).statusCode).toBe(400);
    // imagem maior que 8 MB
    const grande = Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]);
    const rg = await enviar(editor, p, "grande.png", "image/png", grande);
    expect(rg.statusCode).toBe(413);
    // zip disfarçado (sem extensão docx/xlsx)
    expect((await enviar(editor, p, "a.zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from([0x50, 0x4b, 3, 4, 0, 0]))).statusCode).toBe(400);
    // arquivos permitidos: pdf e txt
    expect((await enviar(editor, p, "manual.pdf", "application/pdf", Buffer.from("%PDF-1.4\n%%EOF"))).statusCode).toBe(200);
    expect((await enviar(editor, p, "notas.txt", "text/plain", Buffer.from("olá mundo"))).statusCode).toBe(200);
    const det = (await editor.req("GET", `/api/biblioteca/paginas/${p}`)).json();
    expect(det.anexos.map((a: { nome: string; uso: string }) => `${a.nome}:${a.uso}`).sort()).toEqual(["manual.pdf:ARQUIVO", "notas.txt:ARQUIVO"]);
  });

  it("exige login e permissão para editar a página; nome com caminho é limpo; vídeo webm aceito", async () => {
    const p = await criar(editor, "Anexos permissão");
    expect((await app.inject({ method: "POST", url: `/api/biblioteca/paginas/${p}/anexos?nome=a.png`, payload: PNG, headers: { "x-bybus": "1", "content-type": "image/png" } })).statusCode).toBe(401);
    expect((await enviar(leitor, p, "a.png", "image/png", PNG)).statusCode).toBe(403);
    const r = await enviar(editor, p, "../../etc/passwd.png", "image/png", PNG);
    expect(r.json().nome).toBe("passwd.png");
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);
    const v = await enviar(editor, p, "tela.webm", "video/webm", webm);
    expect(v.statusCode).toBe(200);
    expect(v.json().uso).toBe("VIDEO");
    // vídeo no texto sobrevive à limpeza (só com anexo da biblioteca)
    await editor.req("PATCH", `/api/biblioteca/paginas/${p}`, { conteudo: `<video src="${v.json().url}"></video><video src="https://x.test/v.mp4"></video>` });
    const c = (await editor.req("GET", `/api/biblioteca/paginas/${p}`)).json().conteudo as string;
    expect(c.match(/<video/g)?.length).toBe(1);
    expect(c).toContain("controls");
  });
});

describe("lixeira, duplicar e PDF", () => {
  it("excluir vai para a lixeira, restaurar devolve com as subpáginas", async () => {
    const pai = await criar(editor, "Lixo pai");
    const filha = await criar(editor, "Lixo filha", pai);
    expect((await editor.req("DELETE", `/api/biblioteca/paginas/${pai}`)).json().paginas).toBe(2);
    expect((await lista(editor)).some((p) => p.id === pai || p.id === filha)).toBe(false);
    expect((await editor.req("GET", `/api/biblioteca/paginas/${filha}`)).statusCode).toBe(404);
    const lixeira = (await admin.req("GET", "/api/biblioteca/lixeira")).json() as Array<{ id: string; paginas: number }>;
    expect(lixeira.find((l) => l.id === pai)?.paginas).toBe(2);
    expect((await leitor.req("GET", "/api/biblioteca/lixeira")).statusCode).toBe(403);
    expect((await admin.req("POST", `/api/biblioteca/lixeira/${pai}/restaurar`)).statusCode).toBe(200);
    expect((await lista(editor)).filter((p) => [pai, filha].includes(p.id))).toHaveLength(2);
    // apagar de vez
    await editor.req("DELETE", `/api/biblioteca/paginas/${pai}`);
    expect((await admin.req("DELETE", `/api/biblioteca/lixeira/${pai}`)).statusCode).toBe(200);
    expect((await db.select().from(bibliotecaPaginas).where(eq(bibliotecaPaginas.id, filha))).length).toBe(0);
  });

  it("duplicar copia subpáginas e anexos e aponta o texto para os anexos novos", async () => {
    const pai = await criar(editor, "Dup pai");
    const filha = await criar(editor, "Dup filha", pai);
    const img = (await enviar(editor, filha, "i.png", "image/png", PNG)).json();
    await editor.req("PATCH", `/api/biblioteca/paginas/${filha}`, { conteudo: `<p>Foto</p><img src="${img.url}">` });
    const r = (await editor.req("POST", `/api/biblioteca/paginas/${pai}/duplicar`)).json();
    expect(r.paginas).toBe(2);
    const copia = (await editor.req("GET", `/api/biblioteca/paginas/${r.id}`)).json();
    expect(copia.titulo).toBe("Cópia de Dup pai");
    expect(copia.subpaginas).toHaveLength(1);
    const filhaCopia = (await editor.req("GET", `/api/biblioteca/paginas/${copia.subpaginas[0].id}`)).json();
    expect(filhaCopia.anexos).toHaveLength(1);
    expect(filhaCopia.anexos[0].id).not.toBe(img.id);
    expect(filhaCopia.conteudo).toContain(filhaCopia.anexos[0].id);
    expect(filhaCopia.conteudo).not.toContain(img.id);
    // a cópia fica logo depois da original
    const irmas = (await lista(editor)).filter((p) => p.paiId === null).sort((a, b) => a.ordem - b.ordem).map((p) => p.id);
    expect(irmas.indexOf(r.id)).toBe(irmas.indexOf(pai) + 1);
    expect((await leitor.req("POST", `/api/biblioteca/paginas/${pai}/duplicar`)).statusCode).toBe(403);
  });

  it("gera o PDF da página (título, listas, tabela, quebra) só para quem pode ler", async () => {
    const img = await criar(editor, "Para PDF", null, {
      conteudo: "<h1>Regras</h1><p>Texto <strong>forte</strong> e <em>itálico</em> com acentuação: ação, é.</p><ul><li>um</li><li>dois</li></ul><ol><li>a</li></ol><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><hr class=\"quebra-pagina\"><p>Segunda página</p>",
    });
    const r = await app.inject({ method: "GET", url: `/api/biblioteca/paginas/${img}/pdf`, headers: { cookie: editor.cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect((r.rawPayload.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const restrita = await criar(editor, "PDF restrito", null, { acesso: "RESTRITO" });
    expect((await app.inject({ method: "GET", url: `/api/biblioteca/paginas/${restrita}/pdf`, headers: { cookie: leitor.cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/biblioteca/paginas/${img}/pdf` })).statusCode).toBe(401);
  });

  it("página antiga em markdown continua abrindo como markdown", async () => {
    const [seed] = await db.insert(bibliotecaPaginas).values({ titulo: "Antiga", conteudo: "# Velha\n\n- item" }).returning();
    const g = (await editor.req("GET", `/api/biblioteca/paginas/${seed!.id}`)).json();
    expect(g.formato).toBe("markdown");
    expect(g.conteudo).toBe("# Velha\n\n- item");
    expect((await editor.req("GET", `/api/biblioteca/paginas/${seed!.id}/pdf`)).statusCode).toBe(200);
  });
});
