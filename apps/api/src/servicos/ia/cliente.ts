import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../../config.js";

/**
 * Fronteira com a API da Anthropic. Todo o resto do sistema fala com `ClienteIA`;
 * os testes usam um cliente falso (nunca chamam a API de verdade).
 */

export interface FerramentaIA {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
}

/** Blocos de conteúdo devolvidos pelo modelo (devem voltar intactos nas rodadas seguintes de uma conversa com ferramentas). */
export type BlocoIA = { type: string; [k: string]: unknown };

export interface MensagemIA {
  role: "user" | "assistant";
  content: string | BlocoIA[];
}

export interface PedidoIA {
  modelo: string;
  esforco: "low" | "medium" | "high";
  /** Prompt de sistema estável (vai para o cache). */
  sistema: string;
  ferramentas: FerramentaIA[];
  mensagens: MensagemIA[];
  maxTokens: number;
}

export interface RespostaIA {
  content: BlocoIA[];
  stop_reason: string | null;
  modelo: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
}

export interface ClienteIA {
  enviar(pedido: PedidoIA): Promise<RespostaIA>;
}

export class ErroIA extends Error {
  constructor(public codigo: "IA_DESLIGADA" | "IA_LIMITE" | "IA_RECUSA" | "IA_ERRO" | "IA_RESPOSTA_INVALIDA", mensagem: string) {
    super(mensagem);
    this.name = "ErroIA";
  }
}

let clienteSubstituto: ClienteIA | null = null;
let clienteReal: { chave: string; cliente: ClienteIA } | null = null;

/** Só para testes: troca o cliente por um falso (nenhum teste chama a API de verdade). `null` desfaz. */
export function definirClienteIA(c: ClienteIA | null) {
  clienteSubstituto = c;
}

/** IA ligada = há chave configurada (ou, nos testes, um cliente falso instalado). Sem isso o sistema segue normal e mostra "IA desligada". */
export const iaConfigurada = (config: Config) => !!clienteSubstituto || !!config.ANTHROPIC_API_KEY;

export function obterClienteIA(config: Config): ClienteIA {
  if (clienteSubstituto) return clienteSubstituto;
  if (!config.ANTHROPIC_API_KEY) throw new ErroIA("IA_DESLIGADA", "IA desligada: ANTHROPIC_API_KEY não configurada.");
  if (clienteReal?.chave !== config.ANTHROPIC_API_KEY) clienteReal = { chave: config.ANTHROPIC_API_KEY, cliente: criarClienteAnthropic(config) };
  return clienteReal.cliente;
}

/**
 * Cliente real (SDK oficial, versão fixa). Usa streaming + finalMessage (evita timeout em respostas longas),
 * raciocínio adaptativo, `effort` por chamada, cache do prompt de sistema/ferramentas e o fallback de recusa
 * do lado do servidor. Saída estruturada: ferramenta de registro com `strict: true` (tool_choice forçado não é aceito
 * nos modelos atuais; a instrução fica no prompt e quem chama confere o resultado).
 */
export function criarClienteAnthropic(config: Config): ClienteIA {
  if (!config.ANTHROPIC_API_KEY) throw new ErroIA("IA_DESLIGADA", "IA desligada: ANTHROPIC_API_KEY não configurada.");
  const sdk = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 3 });
  return {
    async enviar(p) {
      try {
        const ferramentas = p.ferramentas.map((f, i) => ({
          ...f,
          strict: true,
          // Um ponto de cache no fim da lista de ferramentas (a lista é estável entre chamadas do mesmo tipo).
          ...(i === p.ferramentas.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
        }));
        const msg = await sdk.beta.messages
          .stream({
            model: p.modelo,
            max_tokens: p.maxTokens,
            thinking: { type: "adaptive" },
            output_config: { effort: p.esforco },
            system: [{ type: "text", text: p.sistema, cache_control: { type: "ephemeral" } }],
            ...(ferramentas.length ? { tools: ferramentas, tool_choice: { type: "auto" as const } } : {}),
            messages: p.mensagens as Anthropic.Beta.BetaMessageParam[],
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          })
          .finalMessage();
        if (msg.stop_reason === "refusal") throw new ErroIA("IA_RECUSA", "O modelo recusou a solicitação.");
        return {
          content: msg.content as unknown as BlocoIA[],
          stop_reason: msg.stop_reason,
          modelo: msg.model,
          usage: msg.usage,
        };
      } catch (e) {
        if (e instanceof ErroIA) throw e;
        if (e instanceof Anthropic.RateLimitError) throw new ErroIA("IA_ERRO", "A IA está com muitas solicitações. Tente novamente em instantes.");
        if (e instanceof Anthropic.AuthenticationError) throw new ErroIA("IA_ERRO", "Chave da IA inválida. Verifique ANTHROPIC_API_KEY.");
        if (e instanceof Anthropic.APIError) throw new ErroIA("IA_ERRO", `Falha ao consultar a IA (${e.status ?? "rede"}).`);
        throw new ErroIA("IA_ERRO", "Falha ao consultar a IA.");
      }
    },
  };
}
