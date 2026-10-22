import { z } from "zod";

const esquema = z.object({
  AMBIENTE: z.enum(["desenvolvimento", "testes", "producao"]).default("desenvolvimento"),
  PORTA: z.coerce.number().default(3333),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().url(),
  /** Chave AES-256 em base64 (32 bytes) para criptografar documentos. Gere com: openssl rand -base64 32 */
  CHAVE_CRIPTOGRAFIA: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "CHAVE_CRIPTOGRAFIA deve ter 32 bytes em base64"),
  /** Origem do front-end (CORS/cookies). */
  ORIGEM_WEB: z.string().default("http://localhost:5173"),
  SESSAO_HORAS: z.coerce.number().default(12),
  /** Tentativas de login/troca de senha por minuto por IP. */
  LIMITE_LOGIN_POR_MINUTO: z.coerce.number().default(10),
  /** MFA obrigatório para ADMIN e SUPERVISOR. */
  EXIGIR_MFA_ADMIN: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
});

export type Config = z.infer<typeof esquema>;

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = esquema.safeParse(env);
  if (!r.success) {
    throw new Error("Configuração inválida:\n" + r.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n"));
  }
  return r.data;
}
