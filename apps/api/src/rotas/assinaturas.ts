import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  MINUTOS_CODIGO_ASSINATURA, PAPEIS_SIGNATARIO, TENTATIVAS_CODIGO_ASSINATURA, cpfValido, folhaDeAssinaturas, mascararEmail, mesmoNome,
  montarContratoGrupo, type BlocoContrato, type PapelSignatario,
} from "@bybus/core";
import type { Contexto } from "../app.js";
import { auditar } from "../auditoria.js";
import { assinaturaDocumentos, assinaturaSignatarios, finLancamentos, gruposAnexos, gruposFechados } from "../db/schema.js";
import { podeUnidade } from "../seguranca/escopo.js";
import { ErroHttp, exigir, type UsuarioSessao } from "../seguranca/sessao.js";
import { criarEnvioEmail, emailConfigurado } from "../servicos/email.js";
import { hashToken } from "../servicos/linkEmbarque.js";
import { hojeSp } from "../servicos/marketingComum.js";
import { gerarPdfTimbrado } from "../servicos/pdfTimbrado.js";
import { dadosEmpresaContrato } from "./grupos.js";

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const tokenPublico = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
/** Código de verificação fácil de ditar: BB-XXXX-XXXX (sem letras que se confundem). */
function novoCodigo(): string {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const parte = () => Array.from({ length: 4 }, () => a[randomInt(a.length)]).join("");
  return `BB-${parte()}-${parte()}`;
}

/**
 * Assinatura eletrônica do contrato de grupo (dono, 13/11/2026), como as ferramentas do mercado: documento congelado (PDF,
 * hash SHA-256), link individual por signatário (por e-mail e para copiar), código de 6 dígitos por e-mail (10 min, 5
 * tentativas), nome e CPF conferidos, aceite, trilha (data/hora, IP, navegador) e, ao final, o PDF com a folha de
 * assinaturas e o código de verificação público (/verificar/<código>).
 */
export async function rotasAssinaturas(app: FastifyInstance, { db, config, cofre }: Contexto) {
  const acesso = { preHandler: exigir(config, "reservas:editar") };
  const enviarEmail = criarEnvioEmail(config);
  const base = () => (config.URL_PUBLICA ?? "").replace(/\/$/, "");

  async function grupoDoUsuario(u: UsuarioSessao, id: string) {
    const [g] = await db.select().from(gruposFechados).where(eq(gruposFechados.id, id));
    if (!g || !(u.todasUnidades || !g.unidadeId || podeUnidade(u, g.unidadeId))) throw new ErroHttp(404, "NAO_ENCONTRADO", "Grupo não encontrado.");
    return g;
  }
  async function documentoDoUsuario(u: UsuarioSessao, id: string) {
    const [d] = await db.select().from(assinaturaDocumentos).where(eq(assinaturaDocumentos.id, id));
    if (!d || !d.grupoId) throw new ErroHttp(404, "NAO_ENCONTRADO", "Documento não encontrado.");
    await grupoDoUsuario(u, d.grupoId);
    return d;
  }

  async function mandarLink(s: { nome: string; email: string; papel: string }, titulo: string, token: string) {
    const link = `${base()}/assinar/${token}`;
    if (!emailConfigurado(config)) return { link, enviado: false };
    try {
      await enviarEmail({
        para: s.email, assunto: `Assinatura: ${titulo}`,
        texto: `Olá, ${s.nome.split(" ")[0]}!\n\nA By Bus Turismo enviou o documento "${titulo}" para a sua assinatura eletrônica (${s.papel.toLowerCase()}).\n\nPara ler e assinar, abra:\n${link}\n\nNa assinatura, enviaremos um código de confirmação para este e-mail.\n\n— By Bus Turismo`,
      });
      return { link, enviado: true };
    } catch {
      return { link, enviado: false };
    }
  }

  // ---------- Equipe ----------
  const signatarioCorpo = z.object({
    papel: z.enum(PAPEIS_SIGNATARIO), nome: z.string().trim().min(3).max(160), email: z.string().trim().email("E-mail de signatário inválido.").max(160),
    cpf: z.string().trim().max(20).nullish().transform((v) => (v ? v.replace(/\D/g, "") : null)),
  });

  app.post("/api/grupos/:id/assinatura", acesso, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { signatarios } = z.object({ signatarios: z.array(signatarioCorpo).min(1).max(6) }).parse(req.body);
    if (!signatarios.some((s) => s.papel === "CONTRATANTE") || !signatarios.some((s) => s.papel === "CONTRATADA")) throw new ErroHttp(400, "SIGNATARIOS", "Inclua quem assina pelo contratante e pela By Bus.");
    for (const s of signatarios) if (s.cpf && !cpfValido(s.cpf)) throw new ErroHttp(400, "CPF_INVALIDO", `CPF inválido de ${s.nome}.`);
    const g = await grupoDoUsuario(req.usuario!, id);
    const [pendente] = await db.select({ id: assinaturaDocumentos.id }).from(assinaturaDocumentos).where(and(eq(assinaturaDocumentos.grupoId, id), eq(assinaturaDocumentos.status, "PENDENTE")));
    if (pendente) throw new ErroHttp(409, "ASSINATURA_PENDENTE", "Já há um contrato deste grupo aguardando assinaturas. Cancele-o antes de enviar outro.");
    const [sinal] = await db.select({ vencimento: finLancamentos.vencimento }).from(finLancamentos).where(eq(finLancamentos.grupoFechadoId, id)).orderBy(asc(finLancamentos.vencimento)).limit(1);
    const prazoLista = g.dataPasseio ? new Date(Date.parse(`${g.dataPasseio}T12:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10) : null;
    const blocos = montarContratoGrupo({ ...g, estilo: g.estilo as never, vencimentoSinal: sinal?.vencimento ?? null, prazoLista }, await dadosEmpresaContrato(db), hojeSp());
    const titulo = `Contrato — ${g.nome}`;
    const pdf = await gerarPdfTimbrado(titulo, blocos, titulo);
    const tokens = signatarios.map(() => randomBytes(24).toString("base64url"));
    const doc = await db.transaction(async (tx) => {
      const [d] = await tx.insert(assinaturaDocumentos).values({
        grupoId: id, titulo, codigoVerificacao: novoCodigo(), blocosJson: JSON.stringify(blocos), pdfCifrado: cofre.cifrar(pdf.toString("base64")),
        hashOriginal: sha256(pdf), criadoPor: req.usuario!.id,
      }).returning();
      await tx.insert(assinaturaSignatarios).values(signatarios.map((s, i) => ({
        documentoId: d!.id, ordem: i, papel: s.papel, nome: s.nome, email: s.email.toLowerCase(), cpfCifrado: s.cpf ? cofre.cifrar(s.cpf) : null, tokenHash: hashToken(tokens[i]!),
      })));
      return d!;
    });
    const links = [];
    for (const [i, s] of signatarios.entries()) {
      const r = await mandarLink(s, titulo, tokens[i]!);
      links.push({ nome: s.nome, papel: s.papel, link: r.link, emailEnviado: r.enviado });
    }
    await auditar(db, req, "ASSINATURA_ENVIADA", { tipo: "assinatura_documento", id: doc.id }, { grupoId: id, signatarios: signatarios.length, hash: doc.hashOriginal });
    // Os links só aparecem agora (o banco guarda o hash): a tela mostra para copiar e mandar pelo WhatsApp, se preciso.
    return { documentoId: doc.id, codigoVerificacao: doc.codigoVerificacao, links };
  });

  app.get("/api/grupos/:id/assinaturas", acesso, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await grupoDoUsuario(req.usuario!, id);
    const docs = await db.select({
      id: assinaturaDocumentos.id, titulo: assinaturaDocumentos.titulo, status: assinaturaDocumentos.status, codigoVerificacao: assinaturaDocumentos.codigoVerificacao,
      criadoEm: assinaturaDocumentos.criadoEm, concluidoEm: assinaturaDocumentos.concluidoEm, hashOriginal: assinaturaDocumentos.hashOriginal,
    }).from(assinaturaDocumentos).where(eq(assinaturaDocumentos.grupoId, id)).orderBy(desc(assinaturaDocumentos.criadoEm));
    const sig = docs.length ? await db.select({
      id: assinaturaSignatarios.id, documentoId: assinaturaSignatarios.documentoId, papel: assinaturaSignatarios.papel, nome: assinaturaSignatarios.nome,
      email: assinaturaSignatarios.email, visualizadoEm: assinaturaSignatarios.visualizadoEm, assinadoEm: assinaturaSignatarios.assinadoEm,
    }).from(assinaturaSignatarios).where(sql`${assinaturaSignatarios.documentoId} in (${sql.join(docs.map((d) => sql`${d.id}`), sql`, `)})`).orderBy(asc(assinaturaSignatarios.ordem)) : [];
    return docs.map((d) => ({ ...d, signatarios: sig.filter((s) => s.documentoId === d.id) }));
  });

  app.post("/api/assinaturas/:id/cancelar", acesso, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const d = await documentoDoUsuario(req.usuario!, id);
    if (d.status !== "PENDENTE") throw new ErroHttp(409, "NAO_PENDENTE", "Só dá para cancelar um documento que ainda aguarda assinaturas.");
    await db.update(assinaturaDocumentos).set({ status: "CANCELADO", canceladoEm: new Date() }).where(eq(assinaturaDocumentos.id, id));
    await auditar(db, req, "ASSINATURA_CANCELADA", { tipo: "assinatura_documento", id }, {});
    return { ok: true };
  });

  /** Novo link para um signatário (o anterior deixa de valer): para reenviar ou mandar pelo WhatsApp. */
  app.post("/api/assinaturas/:id/signatarios/:sid/link", acesso, async (req) => {
    const { id, sid } = z.object({ id: z.string().uuid(), sid: z.string().uuid() }).parse(req.params);
    const d = await documentoDoUsuario(req.usuario!, id);
    if (d.status !== "PENDENTE") throw new ErroHttp(409, "NAO_PENDENTE", "Este documento não aguarda mais assinaturas.");
    const [s] = await db.select().from(assinaturaSignatarios).where(and(eq(assinaturaSignatarios.id, sid), eq(assinaturaSignatarios.documentoId, id)));
    if (!s) throw new ErroHttp(404, "NAO_ENCONTRADO", "Signatário não encontrado.");
    if (s.assinadoEm) throw new ErroHttp(409, "JA_ASSINOU", "Esta pessoa já assinou.");
    const t = randomBytes(24).toString("base64url");
    await db.update(assinaturaSignatarios).set({ tokenHash: hashToken(t), codigoHash: null, codigoExpiraEm: null, codigoTentativas: 0 }).where(eq(assinaturaSignatarios.id, sid));
    const r = await mandarLink(s, d.titulo, t);
    await auditar(db, req, "ASSINATURA_LINK_REENVIADO", { tipo: "assinatura_documento", id }, { signatarioId: sid, emailEnviado: r.enviado });
    return { link: r.link, emailEnviado: r.enviado };
  });

  app.get("/api/assinaturas/:id/pdf", acesso, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const d = await documentoDoUsuario(req.usuario!, id);
    const final = d.pdfFinalCifrado ?? d.pdfCifrado;
    return reply.header("Content-Type", "application/pdf").header("Cache-Control", "no-store")
      .header("Content-Disposition", `inline; filename="${d.status === "CONCLUIDO" ? "contrato-assinado" : "contrato"}.pdf"`).send(Buffer.from(cofre.decifrar(final), "base64"));
  });

  // ---------- Página de quem assina (sem login) ----------
  const limite = (max: number) => ({ config: { rateLimit: { max, timeWindow: "1 minute" } } });
  async function signatarioDoLink(t: string) {
    const [r] = await db.select({ s: assinaturaSignatarios, d: assinaturaDocumentos }).from(assinaturaSignatarios)
      .innerJoin(assinaturaDocumentos, eq(assinaturaDocumentos.id, assinaturaSignatarios.documentoId)).where(eq(assinaturaSignatarios.tokenHash, hashToken(t)));
    if (!r || r.d.status === "CANCELADO") throw new ErroHttp(404, "LINK_INVALIDO", "Link inválido ou documento cancelado. Fale com a By Bus.");
    return r;
  }
  const ipDe = (req: FastifyRequest) => req.ip ?? null;

  app.get("/api/publico/assinar/:token", limite(30), async (req) => {
    const { token: t } = z.object({ token: tokenPublico }).parse(req.params);
    const { s, d } = await signatarioDoLink(t);
    if (!s.visualizadoEm) await db.update(assinaturaSignatarios).set({ visualizadoEm: new Date() }).where(eq(assinaturaSignatarios.id, s.id));
    const todos = await db.select({ papel: assinaturaSignatarios.papel, nome: assinaturaSignatarios.nome, assinadoEm: assinaturaSignatarios.assinadoEm }).from(assinaturaSignatarios)
      .where(eq(assinaturaSignatarios.documentoId, d.id)).orderBy(asc(assinaturaSignatarios.ordem));
    return {
      documento: { titulo: d.titulo, status: d.status, hash: d.hashOriginal, codigoVerificacao: d.codigoVerificacao, criadoEm: d.criadoEm },
      signatario: { nome: s.nome, papel: s.papel, email: mascararEmail(s.email), assinadoEm: s.assinadoEm, pedeCpf: true },
      signatarios: todos.map((x) => ({ papel: x.papel, nome: x.nome, assinado: !!x.assinadoEm })),
    };
  });

  app.get("/api/publico/assinar/:token/pdf", limite(30), async (req, reply) => {
    const { token: t } = z.object({ token: tokenPublico }).parse(req.params);
    const { d } = await signatarioDoLink(t);
    return reply.header("Content-Type", "application/pdf").header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `inline; filename="${d.status === "CONCLUIDO" ? "contrato-assinado" : "contrato"}.pdf"`).send(Buffer.from(cofre.decifrar(d.pdfFinalCifrado ?? d.pdfCifrado), "base64"));
  });

  app.post("/api/publico/assinar/:token/codigo", limite(5), async (req) => {
    const { token: t } = z.object({ token: tokenPublico }).parse(req.params);
    const { s, d } = await signatarioDoLink(t);
    if (d.status !== "PENDENTE" || s.assinadoEm) throw new ErroHttp(409, "JA_ASSINADO", "Este documento já foi assinado por você.");
    if (s.codigosEnviados >= 8) throw new ErroHttp(429, "MUITOS_CODIGOS", "Muitos códigos enviados. Peça um novo link à By Bus.");
    if (!emailConfigurado(config)) throw new ErroHttp(503, "EMAIL_INDISPONIVEL", "O envio de e-mail não está configurado. Fale com a By Bus.");
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await db.update(assinaturaSignatarios).set({
      codigoHash: sha256(`${s.id}:${codigo}`), codigoExpiraEm: new Date(Date.now() + MINUTOS_CODIGO_ASSINATURA * 60_000), codigoTentativas: 0, codigosEnviados: s.codigosEnviados + 1,
    }).where(eq(assinaturaSignatarios.id, s.id));
    await enviarEmail({ para: s.email, assunto: `Código de assinatura: ${codigo}`, texto: `Seu código para assinar "${d.titulo}" é: ${codigo}\n\nEle vale por ${MINUTOS_CODIGO_ASSINATURA} minutos. Se você não pediu, ignore este e-mail.\n\n— By Bus Turismo` });
    return { enviadoPara: mascararEmail(s.email), validoMinutos: MINUTOS_CODIGO_ASSINATURA };
  });

  app.post("/api/publico/assinar/:token/assinar", limite(10), async (req) => {
    const { token: t } = z.object({ token: tokenPublico }).parse(req.params);
    const b = z.object({
      codigo: z.string().regex(/^\d{6}$/, "Digite o código de 6 números."), nome: z.string().trim().min(3).max(160), cpf: z.string().trim().max(20),
      aceite: z.literal(true, { errorMap: () => ({ message: "Marque que leu e concorda com o documento." }) }),
    }).parse(req.body);
    const { s, d } = await signatarioDoLink(t);
    if (d.status !== "PENDENTE" || s.assinadoEm) throw new ErroHttp(409, "JA_ASSINADO", "Este documento já foi assinado por você.");
    if (!s.codigoHash || !s.codigoExpiraEm || s.codigoExpiraEm < new Date()) throw new ErroHttp(400, "CODIGO_VENCIDO", "Código vencido ou não enviado. Peça um novo código.");
    if (s.codigoTentativas >= TENTATIVAS_CODIGO_ASSINATURA) throw new ErroHttp(429, "MUITAS_TENTATIVAS", "Muitas tentativas. Peça um novo código.");
    const esperado = Buffer.from(s.codigoHash, "hex");
    const recebido = Buffer.from(sha256(`${s.id}:${b.codigo}`), "hex");
    if (!timingSafeEqual(esperado, recebido)) {
      await db.update(assinaturaSignatarios).set({ codigoTentativas: s.codigoTentativas + 1 }).where(eq(assinaturaSignatarios.id, s.id));
      throw new ErroHttp(400, "CODIGO_ERRADO", `Código incorreto. Restam ${TENTATIVAS_CODIGO_ASSINATURA - s.codigoTentativas - 1} tentativa(s).`);
    }
    if (!mesmoNome(b.nome, s.nome)) throw new ErroHttp(400, "NOME_DIFERENTE", "O nome digitado não confere com o do signatário cadastrado. Digite o nome completo, como no convite.");
    const cpf = b.cpf.replace(/\D/g, "");
    if (!cpfValido(cpf)) throw new ErroHttp(400, "CPF_INVALIDO", "CPF inválido.");
    if (s.cpfCifrado && cofre.decifrar(s.cpfCifrado) !== cpf) throw new ErroHttp(400, "CPF_DIFERENTE", "O CPF não confere com o cadastrado para este signatário.");
    const agora = new Date();
    const r = await db.update(assinaturaSignatarios).set({
      assinadoEm: agora, nomeDigitado: b.nome, cpfDigitadoCifrado: cofre.cifrar(cpf), ip: ipDe(req), navegador: String(req.headers["user-agent"] ?? "").slice(0, 300),
      codigoHash: null, codigoExpiraEm: null,
    }).where(and(eq(assinaturaSignatarios.id, s.id), sql`${assinaturaSignatarios.assinadoEm} is null`)).returning({ id: assinaturaSignatarios.id });
    if (!r.length) throw new ErroHttp(409, "JA_ASSINADO", "Este documento já foi assinado por você.");
    await auditar(db, null, "ASSINATURA_REALIZADA", { tipo: "assinatura_documento", id: d.id }, { signatarioId: s.id, papel: s.papel });
    const concluido = await concluirSeCompleto(d.id);
    return { assinadoEm: agora, concluido };
  });

  /** Quando todos assinaram: PDF final = contrato + folha de assinaturas; vira anexo do grupo e todos recebem aviso. */
  async function concluirSeCompleto(documentoId: string): Promise<boolean> {
    const [d] = await db.select().from(assinaturaDocumentos).where(eq(assinaturaDocumentos.id, documentoId));
    if (!d || d.status !== "PENDENTE") return false;
    const todos = await db.select().from(assinaturaSignatarios).where(eq(assinaturaSignatarios.documentoId, documentoId)).orderBy(asc(assinaturaSignatarios.ordem));
    if (todos.some((s) => !s.assinadoEm)) return false;
    const blocos = JSON.parse(d.blocosJson) as BlocoContrato[];
    const folha = folhaDeAssinaturas({
      titulo: d.titulo, hashOriginal: d.hashOriginal, codigo: d.codigoVerificacao, urlVerificacao: `${base()}/verificar/${d.codigoVerificacao}`, enviadoEm: d.criadoEm.toISOString(),
      signatarios: todos.map((s) => ({ papel: s.papel as PapelSignatario, nome: s.nome, email: s.email, cpf: s.cpfDigitadoCifrado ? cofre.decifrar(s.cpfDigitadoCifrado) : null, assinadoEm: s.assinadoEm!.toISOString(), ip: s.ip, navegador: s.navegador })),
    });
    const pdf = await gerarPdfTimbrado(`${d.titulo} (assinado)`, [...blocos, ...folha], `${d.titulo} · verificação ${d.codigoVerificacao}`);
    const ok = await db.update(assinaturaDocumentos).set({ status: "CONCLUIDO", concluidoEm: new Date(), pdfFinalCifrado: cofre.cifrar(pdf.toString("base64")), hashFinal: sha256(pdf) })
      .where(and(eq(assinaturaDocumentos.id, documentoId), eq(assinaturaDocumentos.status, "PENDENTE"))).returning({ id: assinaturaDocumentos.id });
    if (!ok.length) return false;
    if (d.grupoId) {
      await db.insert(gruposAnexos).values({ grupoId: d.grupoId, tipo: "CONTRATO", nomeArquivo: `contrato-assinado-${d.codigoVerificacao}.pdf`, mime: "application/pdf", tamanho: pdf.length, dadosCifrados: cofre.cifrar(pdf.toString("base64")) });
    }
    await auditar(db, null, "ASSINATURA_CONCLUIDA", { tipo: "assinatura_documento", id: documentoId }, { hashFinal: sha256(pdf) });
    if (emailConfigurado(config)) {
      for (const s of todos) {
        await enviarEmail({ para: s.email, assunto: `Documento assinado: ${d.titulo}`, texto: `Olá, ${s.nome.split(" ")[0]}!\n\nTodas as partes assinaram "${d.titulo}".\nCódigo de verificação: ${d.codigoVerificacao}\nConfira a autenticidade em: ${base()}/verificar/${d.codigoVerificacao}\n\nO documento assinado pode ser baixado pelo mesmo link que você usou para assinar.\n\n— By Bus Turismo` }).catch(() => undefined);
      }
    }
    return true;
  }

  // ---------- Verificação pública ----------
  app.get("/api/publico/verificar/:codigo", limite(30), async (req) => {
    const { codigo } = z.object({ codigo: z.string().trim().toUpperCase().regex(/^BB-[A-Z0-9]{4}-[A-Z0-9]{4}$/) }).parse(req.params);
    const [d] = await db.select().from(assinaturaDocumentos).where(eq(assinaturaDocumentos.codigoVerificacao, codigo));
    if (!d) throw new ErroHttp(404, "NAO_ENCONTRADO", "Nenhum documento com este código.");
    const sig = await db.select({ papel: assinaturaSignatarios.papel, nome: assinaturaSignatarios.nome, assinadoEm: assinaturaSignatarios.assinadoEm }).from(assinaturaSignatarios)
      .where(eq(assinaturaSignatarios.documentoId, d.id)).orderBy(asc(assinaturaSignatarios.ordem));
    return { titulo: d.titulo, status: d.status, enviadoEm: d.criadoEm, concluidoEm: d.concluidoEm, hashOriginal: d.hashOriginal, hashFinal: d.hashFinal, signatarios: sig };
  });
}
