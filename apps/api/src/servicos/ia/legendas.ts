import { z } from "zod";
import type { Config } from "../../config.js";
import type { Db } from "../../db/cliente.js";
import { chamarEstruturado } from "./avaliacao.js";
import { ErroIA, iaConfigurada, obterClienteIA, type FerramentaIA } from "./cliente.js";

/**
 * "Sugerir legenda": 3 opções de legenda + hashtags no tom da marca e no idioma escolhido. Usa o mesmo cliente, o mesmo limite
 * mensal e o mesmo registro de uso dos Gestores de IA. Sem chave da IA devolve `ligada: false` (a tela mostra "IA desligada").
 * LGPD: só vai para a IA o que a pessoa digitou no briefing (título/ideia, passeio, rede) — nenhum dado de cliente.
 */

export const IDIOMAS_LEGENDA = { pt: "português do Brasil", en: "inglês", es: "espanhol" } as const;
export type IdiomaLegenda = keyof typeof IDIOMAS_LEGENDA;

export const FERRAMENTA_LEGENDAS: FerramentaIA = {
  name: "registrar_legendas",
  description: "Registra exatamente 3 opções de legenda para o post, cada uma com suas hashtags.",
  input_schema: {
    type: "object",
    properties: {
      opcoes: {
        type: "array",
        description: "Três opções diferentes entre si (ex.: curta e direta, narrativa, com chamada para reservar).",
        items: {
          type: "object",
          properties: { legenda: { type: "string", description: "Texto da legenda, sem as hashtags." }, hashtags: { type: "array", items: { type: "string" }, description: "De 5 a 12 hashtags, cada uma começando com #." } },
          required: ["legenda", "hashtags"], additionalProperties: false,
        },
      },
    },
    required: ["opcoes"], additionalProperties: false,
  },
};

export const zLegendas = z.object({
  opcoes: z.array(z.object({
    legenda: z.string().trim().min(5).max(1800),
    hashtags: z.array(z.string().trim().regex(/^#?[\p{L}\p{N}_]{2,50}$/u)).max(15).transform((h) => h.map((x) => (x.startsWith("#") ? x : `#${x}`))),
  })).length(3),
});
export type OpcaoLegenda = z.infer<typeof zLegendas>["opcoes"][number];

const SISTEMA = `Você escreve legendas de Instagram para a By Bus Turismo, empresa de city tours e passeios em Florianópolis e Balneário Camboriú (SC).
Tom da marca: acolhedor, alegre e direto, de quem mostra a cidade com orgulho; o slogan é "veja a cidade de camarote" (use no máximo uma vez, só se couber).
Regras: não invente preços, descontos, horários, promoções, números nem fatos sobre os passeios que não estejam no briefing; não cite pessoas, clientes ou dados pessoais;
no máximo 2 emojis; legenda de até 600 caracteres, sem as hashtags; sugira de 5 a 12 hashtags relevantes (turismo local, destino, tipo de passeio).
Entregue sempre pela ferramenta registrar_legendas, com 3 opções diferentes entre si, todas no idioma pedido.`;

export type ResultadoLegendas = { ligada: false; mensagem: string } | { ligada: true; opcoes: OpcaoLegenda[]; custoUsd: number };

export async function sugerirLegendas(db: Db, config: Config, e: { briefing: string; idioma: IdiomaLegenda; passeio?: string | null; usuarioId?: string | null }): Promise<ResultadoLegendas> {
  if (!iaConfigurada(config)) return { ligada: false, mensagem: "IA desligada: as sugestões de legenda ficam disponíveis quando a chave da IA for configurada." };
  const usuario = [
    `Idioma das legendas: ${IDIOMAS_LEGENDA[e.idioma]}.`,
    e.passeio ? `Passeio: ${e.passeio}.` : null,
    `Ideia do post (texto do briefing): ${e.briefing}`,
  ].filter(Boolean).join("\n");
  try {
    const { resultado, custo } = await chamarEstruturado({
      db, config, cliente: obterClienteIA(config), modelo: config.IA_MODELO, esforco: "low", sistema: SISTEMA, ferramenta: FERRAMENTA_LEGENDAS,
      parser: zLegendas, usuario, uso: { tipo: "LEGENDA", usuarioId: e.usuarioId ?? null }, maxTokens: 3000,
    });
    return { ligada: true, opcoes: resultado.opcoes, custoUsd: custo / 1_000_000 };
  } catch (x) {
    if (x instanceof ErroIA && x.codigo === "IA_DESLIGADA") return { ligada: false, mensagem: "IA desligada." };
    throw x;
  }
}
