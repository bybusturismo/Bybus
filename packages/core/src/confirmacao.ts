/**
 * Confirmação da saída em duas etapas (pedido do gerente, 09/11/2026).
 *
 * Na véspera, a partir da hora da prévia (manhã), o sistema conta as reservas pagas e pendentes de cada saída de amanhã:
 * - atingiu um ponto de corte → a saída é confirmada sozinha e cada titular recebe a confirmação completa;
 * - não atingiu → o titular recebe a prévia ("estamos montando a lista") e o sistema reavalia ao longo do dia;
 * - na hora limite (18h) sem atingir o corte → a equipe decide (a saída nunca é cancelada sozinha).
 * Os números são estatísticos (menor chance de no-show) e ficam editáveis na tela.
 */

export const CONTAR_POR = ["RESERVAS", "PASSAGEIROS"] as const;
export type ContarPor = (typeof CONTAR_POR)[number];

export interface RegrasConfirmacao {
  ligado: boolean;
  contarPor: ContarPor;
  /** Corte 1: com este número de pagas, confirma. */
  pagasParaConfirmar: number;
  /** Corte 2: com este total (pagas + pendentes)… */
  totalParaConfirmar: number;
  /** …e pelo menos estas pagas, confirma. */
  pagasMinimasNoTotal: number;
  /** A partir desta hora da véspera: prévia, pedido do ponto e confirmação pelos cortes. */
  horaPrevia: string;
  /** Até esta hora sai a decisão; depois, sem corte, a equipe decide. */
  horaLimite: string;
}

/** Números do gerente (09/11/2026): 10 pagas, ou 16 no total com metade paga; decisão até as 18h. A validar com o dono. */
export const REGRAS_CONFIRMACAO_PADRAO: RegrasConfirmacao = {
  ligado: true, contarPor: "RESERVAS", pagasParaConfirmar: 10, totalParaConfirmar: 16, pagasMinimasNoTotal: 8, horaPrevia: "09:00", horaLimite: "18:00",
};

export type DecisaoConfirmacao = "CONFIRMAR" | "AGUARDAR" | "DECIDIR";

export function avaliarConfirmacao(c: { pagas: number; pendentes: number }, r: RegrasConfirmacao, hora: string): { decisao: DecisaoConfirmacao; motivo: string } {
  const total = c.pagas + c.pendentes;
  const un = r.contarPor === "PASSAGEIROS" ? "passageiros" : "reservas";
  if (r.pagasParaConfirmar > 0 && c.pagas >= r.pagasParaConfirmar) return { decisao: "CONFIRMAR", motivo: `${c.pagas} ${un} pagas (corte: ${r.pagasParaConfirmar}).` };
  if (r.totalParaConfirmar > 0 && total >= r.totalParaConfirmar && c.pagas >= r.pagasMinimasNoTotal) {
    return { decisao: "CONFIRMAR", motivo: `${total} ${un} no total, ${c.pagas} pagas (corte: ${r.totalParaConfirmar} com ${r.pagasMinimasNoTotal} pagas).` };
  }
  if (hora >= r.horaLimite) return { decisao: "DECIDIR", motivo: `Não atingiu os cortes até as ${r.horaLimite}: ${c.pagas} pagas e ${c.pendentes} pendentes. A equipe decide.` };
  return { decisao: "AGUARDAR", motivo: `${c.pagas} pagas e ${c.pendentes} pendentes. Reavaliando até as ${r.horaLimite}.` };
}

/** Confere regras vindas da tela. Retorna a mensagem de erro ou null. */
export function validarRegrasConfirmacao(r: RegrasConfirmacao): string | null {
  const hora = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!hora.test(r.horaPrevia) || !hora.test(r.horaLimite)) return "Horários no formato HH:MM.";
  if (r.horaPrevia >= r.horaLimite) return "A hora da prévia precisa ser antes da hora limite.";
  if (r.pagasMinimasNoTotal > r.totalParaConfirmar) return "As pagas mínimas não podem passar do total.";
  return null;
}

/**
 * Regiões de onde o trânsito até o ponto costuma ser intenso (gerente, 09/11/2026): continente, norte da ilha e Lagoa da Conceição.
 * Lista de bairros a confirmar com a operação.
 */
const REGIOES: Array<{ regiao: "CONTINENTE" | "NORTE" | "LAGOA"; termos: string[] }> = [
  { regiao: "LAGOA", termos: ["lagoa da conceicao", "barra da lagoa", "canto da lagoa", "costa da lagoa"] },
  { regiao: "NORTE", termos: ["ingleses", "santinho", "canasvieiras", "jurere", "cachoeira do bom jesus", "ponta das canas", "praia brava", "lagoinha", "daniela", "sambaqui", "santo antonio de lisboa", "ratones", "vargem grande", "vargem pequena", "rio vermelho", "moçambique", "mocambique"] },
  { regiao: "CONTINENTE", termos: ["estreito", "coqueiros", "capoeiras", "abraao", "balneario do estreito", "kobrasol", "campinas", "barreiros", "sao jose", "palhoca", "biguacu", "jardim atlantico", "itaguacu", "bom abrigo"] },
];
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Região de trânsito intenso a partir de bairro, endereço ou hotel informados (null = nenhuma reconhecida). */
export function regiaoComTransito(...textos: Array<string | null | undefined>): "CONTINENTE" | "NORTE" | "LAGOA" | null {
  const t = ` ${normalizar(textos.filter(Boolean).join(" "))} `.replace(/[^a-z0-9]+/g, " ");
  for (const r of REGIOES) if (r.termos.some((x) => t.includes(` ${normalizar(x)} `))) return r.regiao;
  return null;
}

/** Horas sem resposta (sem ponto informado) depois da prévia/confirmação para avisar a equipe de mandar pela Viator (gerente, 09/11/2026). */
export const HORAS_SEM_RESPOSTA_VIATOR = 4;

/**
 * Mensagem para a equipe colar no chat da Viator/Tripadvisor quando o cliente não responde no WhatsApp.
 * Sem link (um link novo invalidaria o do WhatsApp): o cliente responde com o hotel e a equipe cadastra. [A CONFIRMAR] texto oficial.
 */
export function textoViatorSemResposta(idioma: "pt" | "en" | "es", d: { primeiroNome: string; passeio: string; data: string }): string {
  const data = d.data.split("-").reverse().join("/");
  const nome = d.primeiroNome || "";
  if (idioma === "en") {
    return `Hi${nome ? ` ${nome}` : ""}! This is By Bus Turismo, the operator of your ${d.passeio} tour on ${data}. We sent you a WhatsApp message but have not heard back. `
      + "Please reply here with the name and address of your hotel, so we can tell you your pickup point and time. The bus leaves on time and we need this information today. Thank you! — By Bus Team";
  }
  if (idioma === "es") {
    return `¡Hola${nome ? `, ${nome}` : ""}! Somos By Bus Turismo, la empresa de tu paseo ${d.passeio} del ${data}. Te enviamos un mensaje por WhatsApp, pero no recibimos respuesta. `
      + "Por favor, respóndenos aquí con el nombre y la dirección de tu hotel para indicarte el punto y el horario de embarque. El bus sale puntualmente y necesitamos esta información hoy. ¡Gracias! — Equipo By Bus";
  }
  return `Olá${nome ? `, ${nome}` : ""}! Aqui é a By Bus Turismo, do seu passeio ${d.passeio} em ${data}. Enviamos uma mensagem pelo WhatsApp, mas ainda não tivemos retorno. `
    + "Por favor, responda aqui com o nome e o endereço do seu hotel para informarmos o ponto e o horário de embarque. O ônibus sai pontualmente e precisamos dessa informação hoje. Obrigado! — Equipe By Bus";
}
