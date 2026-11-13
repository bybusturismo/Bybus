import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { linkAfiliado, proximoPagamento } from "@bybus/core";
import type { Contexto } from "../app.js";
import { auditar } from "../auditoria.js";
import { afiliadoPagamentos, afiliados, finLancamentos, marketingConfig, perfis, senhaTokens, usuarios, usuariosUnidades } from "../db/schema.js";
import { podeUnidade } from "../seguranca/escopo.js";
import { gerarHashSenha } from "../seguranca/senha.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { calcularComissoes } from "../servicos/afiliadosComissao.js";
import { criarEnvioEmail, emailConfigurado } from "../servicos/email.js";
import { hojeSp } from "../servicos/marketingComum.js";

const URL_LOJA_PADRAO = "https://loja.bybusturismo.com.br";
const VALIDADE_LINK_HORAS = 72;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

const dadosBancarios = z.object({
  titular: z.string().trim().min(3).max(160),
  documento: z.string().trim().min(11).max(20),
  pix: z.string().trim().max(120).nullish().transform((v) => v || null),
  banco: z.string().trim().max(80).nullish().transform((v) => v || null),
  agencia: z.string().trim().max(20).nullish().transform((v) => v || null),
  conta: z.string().trim().max(30).nullish().transform((v) => v || null),
  tipoConta: z.enum(["CORRENTE", "POUPANCA"]).nullish(),
}).refine((d) => d.pix || (d.banco && d.agencia && d.conta), { message: "Informe a chave PIX ou banco, agência e conta.", path: ["pix"] });

/**
 * Portal do afiliado (dono, 13/11/2026): o afiliado entra com e-mail e senha próprios (perfil Afiliado) e vê só a sua
 * página — comissões (previstas, a pagar, pagas), próximo pagamento, pagamentos recebidos, dados bancários (que ele mesmo
 * cadastra, cifrados) e o link/QR code de divulgação. A equipe cria o acesso; o financeiro vê os dados bancários (auditado).
 */
export async function rotasPortalAfiliado(app: FastifyInstance, { db, config, cofre }: Contexto) {
  const gerenciar = { preHandler: exigir(config, "marketing:gerenciar") };
  const portal = { preHandler: exigir(config, "afiliado:portal") };
  const enviar = criarEnvioEmail(config);

  async function afiliadoDaEquipe(u: { todasUnidades: boolean; unidadeIds: string[] }, id: string) {
    const [a] = await db.select().from(afiliados).where(eq(afiliados.id, id));
    if (!a || !(u.todasUnidades || !a.unidadeId || podeUnidade(u as never, a.unidadeId))) throw new ErroHttp(404, "NAO_ENCONTRADO", "Afiliado não encontrado.");
    return a;
  }

  /** Cria o acesso do afiliado ao portal e manda o link para ele criar a senha (vale 72 h). */
  app.post("/api/marketing/afiliados/:id/acesso", gerenciar, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { email } = z.object({ email: z.string().trim().toLowerCase().email("E-mail inválido.").max(200) }).parse(req.body);
    const a = await afiliadoDaEquipe(req.usuario!, id);
    if (a.usuarioId) {
      const [u] = await db.select({ ativo: usuarios.ativo }).from(usuarios).where(eq(usuarios.id, a.usuarioId));
      if (u?.ativo) throw new ErroHttp(409, "JA_TEM_ACESSO", "Este afiliado já tem acesso ao portal. Para trocar o e-mail, remova o acesso e crie de novo.");
    }
    const [existe] = await db.select({ id: usuarios.id }).from(usuarios).where(sql`lower(${usuarios.email}) = ${email}`);
    if (existe) throw new ErroHttp(409, "EMAIL_EM_USO", "Já existe um usuário com este e-mail.");
    const [perfil] = await db.select({ id: perfis.id }).from(perfis).where(eq(perfis.codigo, "AFILIADO"));
    if (!perfil) throw new ErroHttp(500, "SEM_PERFIL", "Perfil Afiliado não encontrado.");
    const codigo = randomBytes(32).toString("base64url");
    const novo = await db.transaction(async (tx) => {
      const [u] = await tx.insert(usuarios).values({ nome: a.nome, email, perfilId: perfil.id, senhaHash: await gerarHashSenha(randomBytes(24).toString("base64url")), trocarSenha: false }).returning({ id: usuarios.id });
      if (a.unidadeId) await tx.insert(usuariosUnidades).values({ usuarioId: u!.id, unidadeId: a.unidadeId });
      await tx.update(afiliados).set({ usuarioId: u!.id, atualizadoEm: new Date() }).where(eq(afiliados.id, a.id));
      await tx.insert(senhaTokens).values({ usuarioId: u!.id, hash: sha(codigo), expiraEm: new Date(Date.now() + VALIDADE_LINK_HORAS * 3_600_000) });
      return u!;
    });
    const link = `${(config.URL_PUBLICA ?? "").replace(/\/$/, "")}/redefinir-senha?c=${codigo}`;
    let emailEnviado = false;
    if (emailConfigurado(config)) {
      try {
        await enviar({ para: email, assunto: "By Bus: seu acesso ao portal do afiliado", texto: `Olá, ${a.nome}!\n\nA By Bus criou o seu acesso ao portal do afiliado: ali você acompanha as suas comissões, cadastra os dados bancários para receber e pega o seu link e QR code de divulgação.\n\nCrie a sua senha (o link vale ${VALIDADE_LINK_HORAS} horas):\n${link}\n\nDepois, entre com este e-mail em ${(config.URL_PUBLICA ?? "").replace(/\/$/, "")}\n\n— By Bus Turismo` });
        emailEnviado = true;
      } catch { /* a tela mostra o link para mandar de outro jeito */ }
    }
    await auditar(db, req, "AFILIADO_ACESSO_CRIADO", { tipo: "afiliado", id: a.id }, { usuarioId: novo.id, emailEnviado });
    return { link, emailEnviado, validadeHoras: VALIDADE_LINK_HORAS };
  });

  app.delete("/api/marketing/afiliados/:id/acesso", gerenciar, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const a = await afiliadoDaEquipe(req.usuario!, id);
    if (!a.usuarioId) return { ok: true };
    await db.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, a.usuarioId));
    await db.update(afiliados).set({ usuarioId: null, atualizadoEm: new Date() }).where(eq(afiliados.id, a.id));
    await auditar(db, req, "AFILIADO_ACESSO_REMOVIDO", { tipo: "afiliado", id: a.id }, { usuarioId: a.usuarioId });
    return { ok: true };
  });

  /** Dados bancários do afiliado para o pagamento (financeiro), sempre auditado. */
  app.get("/api/marketing/afiliados/:id/dados-bancarios", { preHandler: exigir(config, "financeiro:gerenciar") }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const a = await afiliadoDaEquipe(req.usuario!, id);
    await auditar(db, req, "AFILIADO_DADOS_BANCARIOS_VISTOS", { tipo: "afiliado", id: a.id }, {});
    return { nome: a.nome, dados: a.dadosBancariosCifrado ? JSON.parse(cofre.decifrar(a.dadosBancariosCifrado)) : null, atualizadoEm: a.dadosBancariosEm };
  });

  // ---------- Portal (o próprio afiliado) ----------
  async function meuCadastro(usuarioId: string) {
    const [a] = await db.select().from(afiliados).where(and(eq(afiliados.usuarioId, usuarioId), eq(afiliados.ativo, true)));
    if (!a) throw new ErroHttp(404, "SEM_AFILIADO", "Seu usuário não está ligado a um cadastro de afiliado. Fale com a By Bus.");
    return a;
  }

  app.get("/api/portal-afiliado", portal, async (req) => {
    const a = await meuCadastro(req.usuario!.id);
    const hoje = hojeSp();
    const [cfg] = await db.select({ valor: marketingConfig.valor }).from(marketingConfig).where(eq(marketingConfig.chave, "url_loja"));
    const comissoes = (await calcularComissoes(db, null, hoje)).filter((c) => c.afiliadoId === a.id)
      .sort((x, y) => y.dataPasseio.localeCompare(x.dataPasseio))
      .map(({ afiliadoId: _a, paytourAfiliadoId: _p, unidadeId: _u, afiliadoNome: _n, ...c }) => c);
    const soma = (s: string) => comissoes.filter((c) => c.situacao === s).reduce((t, c) => t + c.comissaoCentavos, 0);
    const proximo = proximoPagamento(hoje);
    const pagamentos = await db.select({ dataPagamento: afiliadoPagamentos.dataPagamento, periodoDe: afiliadoPagamentos.periodoDe, periodoAte: afiliadoPagamentos.periodoAte, totalCentavos: afiliadoPagamentos.totalCentavos, situacao: finLancamentos.situacao, pagoEm: finLancamentos.pagoEm })
      .from(afiliadoPagamentos).innerJoin(finLancamentos, eq(finLancamentos.id, afiliadoPagamentos.lancamentoId))
      .where(eq(afiliadoPagamentos.afiliadoId, a.id)).orderBy(desc(afiliadoPagamentos.dataPagamento)).limit(48);
    return {
      afiliado: { nome: a.nome, codigo: a.codigo, link: linkAfiliado(cfg?.valor || URL_LOJA_PADRAO, a.codigo) },
      totais: { previstaCentavos: soma("PREVISTA"), aPagarCentavos: soma("A_PAGAR"), pagaCentavos: soma("PAGA") },
      proximoPagamento: { data: proximo, totalCentavos: comissoes.filter((c) => c.situacao === "A_PAGAR" && c.dataPagamento <= proximo).reduce((t, c) => t + c.comissaoCentavos, 0) },
      comissoes, pagamentos,
      dadosBancarios: a.dadosBancariosCifrado ? JSON.parse(cofre.decifrar(a.dadosBancariosCifrado)) : null,
    };
  });

  app.put("/api/portal-afiliado/dados-bancarios", portal, async (req) => {
    const d = dadosBancarios.parse(req.body);
    const a = await meuCadastro(req.usuario!.id);
    await db.update(afiliados).set({ dadosBancariosCifrado: cofre.cifrar(JSON.stringify(d)), dadosBancariosEm: new Date(), atualizadoEm: new Date() }).where(eq(afiliados.id, a.id));
    await auditar(db, req, "AFILIADO_DADOS_BANCARIOS_ALTERADOS", { tipo: "afiliado", id: a.id }, {});
    return { ok: true };
  });
}
