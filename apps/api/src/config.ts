import { z } from "zod";

const esquema = z.object({
  /** Obrigatório (sem padrão) para que produção nunca rode por engano com configurações de desenvolvimento. */
  AMBIENTE: z.enum(["desenvolvimento", "testes", "producao"]),
  PORTA: z.coerce.number().default(3333),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().url(),
  /** Chave AES-256 em base64 (32 bytes) para criptografar documentos. Gere com: openssl rand -base64 32 */
  CHAVE_CRIPTOGRAFIA: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "CHAVE_CRIPTOGRAFIA deve ter 32 bytes em base64"),
  /** Origem do front-end (CORS/cookies). */
  ORIGEM_WEB: z.string().default("http://localhost:5173"),
  SESSAO_HORAS: z.coerce.number().default(12),
  /** Sessão expira após este tempo sem uso. */
  SESSAO_INATIVIDADE_MINUTOS: z.coerce.number().default(120),
  /** Quantidade de proxies reversos confiáveis à frente da API (0 = nenhum; não confiar em X-Forwarded-For). */
  PROXIES_CONFIAVEIS: z.coerce.number().int().min(0).max(5).default(0),
  /** Tentativas de login/troca de senha por minuto por IP. */
  LIMITE_LOGIN_POR_MINUTO: z.coerce.number().default(10),
  /**
   * Segredo do robô do Gmail (Apps Script) que envia os e-mails de reserva para /api/integracoes/emails.
   * Sem ele, a entrada automática fica desligada. Gere com: openssl rand -base64 36
   */
  INTEGRACAO_EMAIL_TOKEN: z.string().min(32, "INTEGRACAO_EMAIL_TOKEN deve ter pelo menos 32 caracteres").optional(),
  /** MFA obrigatório para ADMIN e SUPERVISOR. */
  EXIGIR_MFA_ADMIN: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
});

const esquemaValidado = esquema.refine((c) => c.AMBIENTE !== "producao" || c.EXIGIR_MFA_ADMIN, {
  message: "Em produção, EXIGIR_MFA_ADMIN não pode ser false.",
  path: ["EXIGIR_MFA_ADMIN"],
});

export type Config = z.infer<typeof esquema>;

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = esquemaValidado.safeParse(env);
  if (!r.success) {
    throw new Error("Configuração inválida:\n" + r.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n"));
  }
  return r.data;
}
