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
  /** Credenciais do aplicativo criado na Paytour (Avançado → Aplicativos). Sem elas, a sincronização fica desligada. */
  PAYTOUR_APP_KEY: z.string().min(8).optional(),
  PAYTOUR_APP_SECRET: z.string().min(8).optional(),
  PAYTOUR_URL: z.string().url().default("https://api.paytour.com.br/v2"),
  /** Intervalo da busca automática de pedidos novos/alterados (0 = só manual). */
  PAYTOUR_SINCRONIZAR_MINUTOS: z.coerce.number().int().min(0).max(1440).default(5),
  /** Na primeira sincronização, quantos dias para trás buscar pedidos alterados. */
  PAYTOUR_DIAS_INICIAIS: z.coerce.number().int().min(1).max(365).default(30),
  /**
   * LGPD: fora da produção os dados pessoais importados são anonimizados. "true" grava dados reais —
   * permitido só em desenvolvimento, com autorização do dono registrada (ADR 0006, 04/11/2026).
   */
  DADOS_REAIS_AUTORIZADOS: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  /** WhatsApp: "simulado" (padrão, nada sai) ou "evolution" (Evolution API; ver servicos/whatsapp.ts). */
  WHATSAPP_PROVEDOR: z.enum(["simulado", "evolution"]).default("simulado"),
  EVOLUTION_URL: z.string().url().optional(),
  EVOLUTION_API_KEY: z.string().min(8).optional(),
  EVOLUTION_INSTANCIA: z.string().min(1).default("bybus"),
  /** Fora da produção, só envia de verdade com "true" (proteção contra mandar mensagem a cliente real em teste). */
  WHATSAPP_ENVIO_REAL: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  /**
   * Segredo da rota interna que recebe os avisos da Evolution (mensagens, status, conexão): /api/interno/whatsapp/<token>.
   * Sem ele a rota responde 404 e a central de conversas só mostra o que a fila enviou. Gere com: openssl rand -hex 32
   */
  WHATSAPP_WEBHOOK_TOKEN: z.string().min(32, "WHATSAPP_WEBHOOK_TOKEN deve ter pelo menos 32 caracteres").optional(),
  /** Grupo do WhatsApp que recebe a lista fechada (JID "...@g.us"); vazio = só gera o texto para copiar. */
  WHATSAPP_GRUPO_LISTA: z.string().regex(/^[\d-]+@g\.us$/, "WHATSAPP_GRUPO_LISTA deve ser o JID do grupo (…@g.us)").optional(),
  /** Fechamento automático da lista na véspera (America/Sao_Paulo). */
  FECHAMENTO_AUTOMATICO: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  FECHAMENTO_HORA: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("21:00"),
  /** Voucher pelo WhatsApp logo após a venda (desligado até o modelo de mensagem ser aprovado pelo dono). */
  MENSAGEM_VOUCHER_AUTOMATICA: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  /** Endereço público do sistema (para os links de embarque nas mensagens). */
  URL_PUBLICA: z.string().url().optional(),
  /** Chave da API da Anthropic (IA). Sem ela a IA fica desligada e o resto do sistema funciona normalmente. Só em variável de ambiente/cofre. */
  ANTHROPIC_API_KEY: z.string().optional().transform((v) => v?.trim() || undefined),
  /** Modelo dos gestores (avaliação e debate) e do assistente. Padrão: o recomendado para o dia a dia. */
  IA_MODELO: z.string().min(3).default("claude-opus-5-5"),
  /** Modelo da síntese final. Padrão = IA_MODELO; opção mais forte e mais cara: claude-fable-5-1. */
  IA_MODELO_SINTESE: z.string().optional().transform((v) => v?.trim() || undefined),
  IA_ESFORCO: z.enum(["low", "medium", "high"]).default("medium"),
  IA_ESFORCO_SINTESE: z.enum(["low", "medium", "high"]).default("high"),
  IA_ESFORCO_ASSISTENTE: z.enum(["low", "medium", "high"]).default("low"),
  /** Limite mensal de gasto com IA em US$ (0 = sem limite). Ao atingir, novas chamadas são recusadas. */
  IA_LIMITE_MES_USD: z.coerce.number().min(0).default(60),
  /** Avaliação diária automática dos gestores (só roda com ANTHROPIC_API_KEY). */
  IA_AVALIACAO_DIARIA: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  /** Horário (America/Sao_Paulo) da avaliação diária. */
  IA_AVALIACAO_HORARIO: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").default("06:30"),
  /** MFA obrigatório para ADMIN e SUPERVISOR. */
  EXIGIR_MFA_ADMIN: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
});

const esquemaValidado = esquema.refine((c) => !c.DADOS_REAIS_AUTORIZADOS || c.AMBIENTE === "desenvolvimento", {
  message: "DADOS_REAIS_AUTORIZADOS só vale em desenvolvimento (em testes os dados são sempre fictícios; em produção já são reais).",
  path: ["DADOS_REAIS_AUTORIZADOS"],
}).refine((c) => c.AMBIENTE !== "producao" || c.EXIGIR_MFA_ADMIN, {
  message: "Em produção, EXIGIR_MFA_ADMIN não pode ser false.",
  path: ["EXIGIR_MFA_ADMIN"],
});

export type Config = z.infer<typeof esquema>;

/** Anonimizar dados pessoais nas importações? Sim fora da produção, salvo autorização explícita em desenvolvimento. */
export function deveAnonimizar(c: Config): boolean {
  return c.AMBIENTE !== "producao" && !c.DADOS_REAIS_AUTORIZADOS;
}

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = esquemaValidado.safeParse(env);
  if (!r.success) {
    throw new Error("Configuração inválida:\n" + r.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n"));
  }
  return r.data;
}
