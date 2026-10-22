import { and, eq, gt } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { sessoes, usuarios, type Perfil } from "../db/schema.js";
import { gerarToken, sha256 } from "./cripto.js";
import { pode, PERFIS_COM_MFA_OBRIGATORIO, type Permissao } from "./permissoes.js";

export const COOKIE_SESSAO = "bybus_sessao";

export interface UsuarioSessao {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  trocarSenha: boolean;
  totpAtivo: boolean;
  sessaoId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    usuario?: UsuarioSessao;
  }
}

export async function criarSessao(db: Db, config: Config, req: FastifyRequest, reply: FastifyReply, usuarioId: string) {
  const token = gerarToken();
  const expiraEm = new Date(Date.now() + config.SESSAO_HORAS * 3600_000);
  await db.insert(sessoes).values({
    id: sha256(token),
    usuarioId,
    expiraEm,
    ip: req.ip,
    userAgent: req.headers["user-agent"]?.slice(0, 300) ?? null,
  });
  reply.setCookie(COOKIE_SESSAO, token, {
    httpOnly: true,
    secure: config.AMBIENTE === "producao",
    sameSite: "strict",
    path: "/",
    expires: expiraEm,
  });
}

export async function carregarUsuario(db: Db, token: string | undefined): Promise<UsuarioSessao | null> {
  if (!token) return null;
  const id = sha256(token);
  const [linha] = await db
    .select({ sessao: sessoes, usuario: usuarios })
    .from(sessoes)
    .innerJoin(usuarios, eq(usuarios.id, sessoes.usuarioId))
    .where(and(eq(sessoes.id, id), eq(sessoes.revogada, false), gt(sessoes.expiraEm, new Date()), eq(usuarios.ativo, true)))
    .limit(1);
  if (!linha) return null;
  await db.update(sessoes).set({ ultimoUso: new Date() }).where(eq(sessoes.id, id));
  const u = linha.usuario;
  return { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, trocarSenha: u.trocarSenha, totpAtivo: u.totpAtivo, sessaoId: id };
}

export class ErroHttp extends Error {
  constructor(public status: number, public codigo: string, mensagem: string) {
    super(mensagem);
  }
}

/** Pendências que bloqueiam o uso do sistema até serem resolvidas (troca de senha, configuração de MFA). */
export function pendencia(u: UsuarioSessao, config: Config): "TROCAR_SENHA" | "CONFIGURAR_MFA" | null {
  if (u.trocarSenha) return "TROCAR_SENHA";
  if (config.EXIGIR_MFA_ADMIN && PERFIS_COM_MFA_OBRIGATORIO.includes(u.perfil) && !u.totpAtivo) return "CONFIGURAR_MFA";
  return null;
}

export function exigir(config: Config, permissao?: Permissao) {
  return async (req: FastifyRequest) => {
    const u = req.usuario;
    if (!u) throw new ErroHttp(401, "NAO_AUTENTICADO", "Faça login para continuar.");
    const p = pendencia(u, config);
    if (p) throw new ErroHttp(403, p, p === "TROCAR_SENHA" ? "Troque sua senha antes de continuar." : "Configure a verificação em duas etapas antes de continuar.");
    if (permissao && !pode(u.perfil, permissao)) throw new ErroHttp(403, "SEM_PERMISSAO", "Seu perfil não tem acesso a esta função.");
  };
}
