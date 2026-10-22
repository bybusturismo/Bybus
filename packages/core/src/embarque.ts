import type { PontoEmbarque } from "./tipos.js";

/**
 * Pontos oficiais do City Tour Toda Ilha (Florianópolis), na ordem de embarque do
 * Novo Manual do Atendente (2025/26). Pontos de mesmo horário seguem a sequência listada.
 * A ordem do transfer (Ingleses/Santinho → Cachoeira → Canasvieiras → Jurerê) nunca pode ser invertida.
 */
export const PONTOS_TODA_ILHA: ReadonlyArray<Omit<PontoEmbarque, "id">> = [
  { ordem: 10, horario: "06:50", nome: "Transfer — Ingleses e Santinho", endereco: "Santinho ~6h40; Centrinho dos Ingleses e Ingleses Norte 6h40–6h50", ehTransfer: true },
  { ordem: 20, horario: "07:00", nome: "Transfer — Cachoeira do Bom Jesus", endereco: "Até o hotel Parador da Cachoeira (6h55–7h05)", ehTransfer: true },
  { ordem: 30, horario: "07:10", nome: "Transfer — Canasvieiras", endereco: "7h00–7h10", ehTransfer: true },
  { ordem: 40, horario: "07:15", nome: "Transfer — Jurerê", endereco: "7h00–7h15", ehTransfer: true },
  { ordem: 50, horario: "08:00", nome: "Villa Romana Shopping", endereco: "Rua Santa Mônica — próximo aos hotéis Interclass Trindade, Mercure Convention e Quinta da Bica D'água", ehTransfer: false },
  { ordem: 60, horario: "08:15", nome: "Hotel Majestic (fundos)", endereco: "Rua Heitor Luz — Praça Lauro Müller", ehTransfer: false },
  { ordem: 70, horario: "08:15", nome: "Hotel Blue Tree Towers", endereco: "Rua Bocaiúva, 2304", ehTransfer: false },
  { ordem: 80, horario: "08:15", nome: "Hotel Novotel (fundos)", endereco: "Rua Bocaiúva, esquina com a Travessa Harmonia — em frente à escola Teddy Bear", ehTransfer: false },
  { ordem: 90, horario: "08:25", nome: "Apart Hotel Rio Branco", endereco: "Próximo ao hotel Porto da Ilha", ehTransfer: false },
  { ordem: 100, horario: "08:25", nome: "Hotel Ibis", endereco: "Próximo aos hotéis Lumar, Ecobox Hostel, Farol da Ilha, Valerim e Faial", ehTransfer: false },
  { ordem: 110, horario: "08:25", nome: "Hotel Castelmar", endereco: "R. Felipe Schmidt, 1260 — Centro (próx. Intercity, Slaviero Baía Norte; parte continental)", ehTransfer: false },
  { ordem: 120, horario: "08:45", nome: "Catedral Metropolitana — Praça XV de Novembro", endereco: "Próximo aos hotéis Cecomtur, Florianópolis Palace, Oscar, Sumaré e Centrosul", ehTransfer: false },
  { ordem: 130, horario: "10:00", nome: "Praia da Joaquina", endereco: "Em frente ao Cris Hotel — Av. Prefeito Acácio Garibaldi São Tiago", ehTransfer: false },
];

/** Converte "HH:MM" em minutos. */
export function minutos(horario: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(horario);
  if (!m) throw new Error(`Horário inválido: ${horario}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Ordena por horário e, no empate, pela sequência oficial. */
export function compararPontos(a: Pick<PontoEmbarque, "horario" | "ordem">, b: Pick<PontoEmbarque, "horario" | "ordem">): number {
  return minutos(a.horario) - minutos(b.horario) || a.ordem - b.ordem;
}

/**
 * Verifica se a sequência de pontos de transfer respeita horários crescentes
 * (regra: não se marca Jurerê antes de Canasvieiras etc.).
 */
export function validarSequenciaTransfer(pontos: ReadonlyArray<Pick<PontoEmbarque, "horario" | "ordem" | "ehTransfer" | "nome">>): string[] {
  const transfers = pontos.filter((p) => p.ehTransfer).sort((a, b) => a.ordem - b.ordem);
  const erros: string[] = [];
  for (let i = 1; i < transfers.length; i++) {
    if (minutos(transfers[i]!.horario) < minutos(transfers[i - 1]!.horario)) {
      erros.push(`"${transfers[i]!.nome}" não pode ter horário anterior a "${transfers[i - 1]!.nome}".`);
    }
  }
  return erros;
}
