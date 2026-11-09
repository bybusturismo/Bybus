import { detalhesConfirmacao, diaComData, type DadosConfirmacao } from "./mensagens.js";

/**
 * WhatsApp oficial da Meta (decisão do dono, 09/11/2026; ADR 0010). Fora da janela de 24 h desde a última mensagem do cliente,
 * a empresa só pode iniciar conversa com um MODELO aprovado pela Meta. Os modelos abaixo repetem os textos aprovados pelo dono
 * (mensagens.ts); o miolo variável vai num parâmetro. Regras da Meta: o corpo não começa nem termina com variável; parâmetro sem
 * quebra de linha, tabulação nem mais de 4 espaços seguidos. [A CONFIRMAR] aprovação de cada modelo pela Meta.
 */
export interface ModeloMeta {
  nome: string;
  categoria: "UTILITY" | "MARKETING";
  idioma: "pt_BR";
  corpo: string;
  /** Valores de exemplo (exigidos no envio para aprovação). */
  exemplo: string[];
  descricao: string;
}

export const MODELOS_META: readonly ModeloMeta[] = [
  {
    nome: "bybus_previa", categoria: "UTILITY", idioma: "pt_BR", descricao: "Prévia da véspera (estamos montando a lista)",
    corpo: "Olá, {{1}}! Recebemos sua reserva do passeio *{{2}}* para amanhã, {{3}}.\nEstamos montando a lista de passageiros e, ao longo do dia, enviaremos a confirmação com o horário e o local de embarque.\n{{4}}\n— Equipe By Bus",
    exemplo: ["Ana", "City Tour Toda Ilha", "sábado (14/11/2026)", "Para adiantar, informe onde está hospedado(a): https://gestao.bybusturismo.com.br/embarque/exemplo"],
  },
  {
    nome: "bybus_confirmacao", categoria: "UTILITY", idioma: "pt_BR", descricao: "Confirmação da saída com horário e ponto",
    corpo: "Olá, {{1}}! Seu passeio *{{2}}* de amanhã, {{3}}, está confirmado! 🚌\n{{4}}\nNo dia, enviaremos o link para acompanhar o ônibus. Bom passeio! — Equipe By Bus",
    exemplo: ["Ana", "City Tour Toda Ilha", "sábado (14/11/2026)", "Embarque: *08:00* — Villa Romana Shopping (ponto de táxi). Aguarde no local 10 minutos antes: o ônibus é pontual e não há tolerância para atrasos."],
  },
  {
    nome: "bybus_rastreio", categoria: "UTILITY", idioma: "pt_BR", descricao: "Ônibus saiu: link para acompanhar",
    corpo: "Olá, {{1}}! O ônibus do passeio *{{2}}* já saiu.\nAcompanhe no mapa e veja quanto falta para ele chegar ao seu ponto: {{3}}\nO horário é uma estimativa e pode variar com o trânsito. — Equipe By Bus",
    exemplo: ["Ana", "City Tour Toda Ilha", "https://gestao.bybusturismo.com.br/rastreio/exemplo"],
  },
  {
    nome: "bybus_lista_equipe", categoria: "UTILITY", idioma: "pt_BR", descricao: "Lista de passageiros pronta (guia e motorista)",
    corpo: "Olá, {{1}}! A lista de passageiros do passeio *{{2}}* de {{3}} está pronta ({{4}}).\nVeja e imprima no sistema: {{5}}\n— Equipe By Bus",
    exemplo: ["Guia", "City Tour Toda Ilha", "sábado (14/11/2026)", "versão 1", "https://gestao.bybusturismo.com.br/saidas/exemplo"],
  },
];

export interface UsoModelo { nome: string; idioma: string; parametros: string[] }

/** Parâmetro aceito pela Meta: sem quebras de linha/tabulação, sem 5+ espaços seguidos, não vazio, até 1024 caracteres. */
export function limparParametro(t: string): string {
  const limpo = t.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 1024);
  return limpo || "-";
}
const uso = (nome: string, parametros: string[]): UsoModelo => ({ nome, idioma: "pt_BR", parametros: parametros.map(limparParametro) });
const nome = (n: string) => n || "tudo bem";

export function modeloPrevia(d: { primeiroNome: string; passeio: string; data: string; linkEmbarque: string | null; semPonto: boolean }): UsoModelo {
  const extra = d.semPonto
    ? d.linkEmbarque ? `Para adiantar, informe onde está hospedado(a): ${d.linkEmbarque}` : "Para adiantar, responda esta mensagem com o hotel ou endereço onde está hospedado(a)."
    : "Qualquer dúvida, é só responder esta mensagem.";
  return uso("bybus_previa", [nome(d.primeiroNome), d.passeio, diaComData(d.data), extra]);
}

export function modeloConfirmacao(d: DadosConfirmacao): UsoModelo {
  return uso("bybus_confirmacao", [nome(d.primeiroNome), d.passeio, diaComData(d.data), detalhesConfirmacao(d).join(" ")]);
}

export function modeloRastreio(d: { primeiroNome: string; passeio: string; link: string }): UsoModelo {
  return uso("bybus_rastreio", [nome(d.primeiroNome), d.passeio, d.link]);
}

export function modeloListaEquipe(d: { primeiroNome: string; passeio: string; data: string; versao: number; link: string }): UsoModelo {
  return uso("bybus_lista_equipe", [nome(d.primeiroNome), d.passeio, diaComData(d.data), d.versao > 1 ? `lista atualizada, versão ${d.versao}` : "versão 1", d.link]);
}

/** Texto final de um modelo com os parâmetros (o que o cliente lê; vai para a conversa na tela). */
export function renderizarModeloMeta(u: UsoModelo): string {
  const m = MODELOS_META.find((x) => x.nome === u.nome);
  if (!m) return u.parametros.join(" ");
  return m.corpo.replace(/\{\{(\d+)\}\}/g, (_, n: string) => u.parametros[Number(n) - 1] ?? "");
}
