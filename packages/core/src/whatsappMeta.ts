import { detalhesConfirmacao, diaComData, fechoConfirmacao, type DadosConfirmacao } from "./mensagens.js";

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
    corpo: "Olá, {{1}}! Seu passeio *{{2}}* de amanhã, {{3}}, está confirmado! 🚌\n{{4}}\n{{5}} Bom passeio! — Equipe By Bus",
    exemplo: ["Ana", "City Tour Toda Ilha", "sábado (14/11/2026)", "Embarque: *08:00* — Villa Romana Shopping (ponto de táxi). Aguarde no local 10 minutos antes: o ônibus é pontual e não há tolerância para atrasos.", "No dia, acompanhe o ônibus no mapa por aqui: https://gestao.bybusturismo.com.br/rastreio/exemplo"],
  },
  {
    nome: "bybus_rastreio", categoria: "UTILITY", idioma: "pt_BR", descricao: "City Tour saiu: link para acompanhar",
    corpo: "Olá, {{1}}! O City Tour *{{2}}* já saiu.\nAcompanhe no mapa e veja quanto falta para ele chegar ao seu ponto: {{3}}\nO horário é uma estimativa e pode variar com o trânsito. — Equipe By Bus",
    exemplo: ["Ana", "Toda a Ilha", "https://gestao.bybusturismo.com.br/rastreio/exemplo"],
  },
  {
    nome: "bybus_lista_equipe", categoria: "UTILITY", idioma: "pt_BR", descricao: "Lista de passageiros pronta (guia e motorista)",
    corpo: "Olá, {{1}}! A lista de passageiros do passeio *{{2}}* de {{3}} está pronta ({{4}}).\nVeja e imprima no sistema: {{5}}\n— Equipe By Bus",
    exemplo: ["Guia", "City Tour Toda Ilha", "sábado (14/11/2026)", "versão 1", "https://gestao.bybusturismo.com.br/saidas/exemplo"],
  },
  {
    nome: "bybus_transfer_chegando", categoria: "UTILITY", idioma: "pt_BR", descricao: "Transfer chega em cerca de 5 minutos",
    corpo: "Olá, {{1}}! O transfer da By Bus chega em cerca de 5 minutos em {{2}}.\nPor favor, já aguarde na recepção ou na entrada, com seus pertences em mãos. — Equipe By Bus",
    exemplo: ["Ana", "Pousada Exemplo, Canasvieiras"],
  },
  {
    nome: "bybus_transfer_chegou", categoria: "UTILITY", idioma: "pt_BR", descricao: "Transfer chegou ao local de busca",
    corpo: "Olá, {{1}}! O transfer da By Bus chegou em {{2}} e está te esperando.\nPor favor, dirija-se à entrada agora. — Equipe By Bus",
    exemplo: ["Ana", "Pousada Exemplo, Canasvieiras"],
  },
  {
    nome: "bybus_embarque_chegando", categoria: "UTILITY", idioma: "pt_BR", descricao: "City Tour chega ao ponto de embarque em cerca de 5 minutos",
    corpo: "Olá, {{1}}! O City Tour *{{2}}* chega em cerca de 5 minutos ao ponto de embarque *{{3}}*.\nEsteja no ponto agora: não há tolerância para atrasos. {{4}} — Equipe By Bus",
    exemplo: ["Ana", "Toda a Ilha", "Villa Romana Shopping", "Se perder o embarque, dirija-se ao próximo ponto: Trevo da Seta."],
  },
  {
    nome: "bybus_embarque_chegou", categoria: "UTILITY", idioma: "pt_BR", descricao: "City Tour chegou ao ponto de embarque",
    corpo: "Olá, {{1}}! O City Tour *{{2}}* chegou ao ponto de embarque *{{3}}* e sai em instantes.\nNão há tolerância para atrasos. {{4}} — Equipe By Bus",
    exemplo: ["Ana", "Toda a Ilha", "Villa Romana Shopping", "Se não chegar a tempo, dirija-se ao próximo ponto: Trevo da Seta."],
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
  return uso("bybus_confirmacao", [nome(d.primeiroNome), d.passeio, diaComData(d.data), detalhesConfirmacao(d).join(" "), fechoConfirmacao(d.linkRastreio)]);
}

export function modeloRastreio(d: { primeiroNome: string; passeio: string; link: string }): UsoModelo {
  return uso("bybus_rastreio", [nome(d.primeiroNome), nomeCityTour(d.passeio), d.link]);
}

export function modeloListaEquipe(d: { primeiroNome: string; passeio: string; data: string; versao: number; link: string }): UsoModelo {
  return uso("bybus_lista_equipe", [nome(d.primeiroNome), d.passeio, diaComData(d.data), d.versao > 1 ? `lista atualizada, versão ${d.versao}` : "versão 1", d.link]);
}

/** Nome do passeio depois de "City Tour" (evita "City Tour City Tour Toda a Ilha"). */
export const nomeCityTour = (passeio: string) => passeio.replace(/^\s*city\s*tour\s*[-–:·]?\s*/i, "").trim() || passeio;

/**
 * Avisos de chegada (11/11/2026; textos revistos pelo dono em 12/11/2026). O veículo não importa (o transfer pode ser van,
 * carro ou o próprio ônibus): fala-se em "transfer" e "City Tour". No City Tour: sem tolerância para atrasos; quem perder
 * segue para o próximo ponto de embarque (`proximoPonto`, ou null se este for o último).
 */
export function modeloChegada(
  tipo: "CHEGANDO" | "CHEGOU",
  d: { rastreio: "TRANSFER" | "ONIBUS"; primeiroNome: string; passeio: string; local: string; proximoPonto?: string | null },
): UsoModelo {
  if (d.rastreio === "TRANSFER") return uso(tipo === "CHEGANDO" ? "bybus_transfer_chegando" : "bybus_transfer_chegou", [nome(d.primeiroNome), d.local]);
  const seguir = d.proximoPonto
    ? `${tipo === "CHEGANDO" ? "Se perder o embarque" : "Se não chegar a tempo"}, dirija-se ao próximo ponto: ${d.proximoPonto}.`
    : "Se não chegar a tempo, responda esta mensagem para falar com a equipe.";
  return uso(tipo === "CHEGANDO" ? "bybus_embarque_chegando" : "bybus_embarque_chegou", [nome(d.primeiroNome), nomeCityTour(d.passeio), d.local, seguir]);
}

/** Texto final de um modelo com os parâmetros (o que o cliente lê; vai para a conversa na tela). */
export function renderizarModeloMeta(u: UsoModelo): string {
  const m = MODELOS_META.find((x) => x.nome === u.nome);
  if (!m) return u.parametros.join(" ");
  return m.corpo.replace(/\{\{(\d+)\}\}/g, (_, n: string) => u.parametros[Number(n) - 1] ?? "");
}
