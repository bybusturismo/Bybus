import { describe, expect, it } from "vitest";
import { PONTOS_TODA_ILHA, compararPontos, montarManifesto, validarSequenciaTransfer, type PontoEmbarque, type ReservaManifesto } from "../src/index.js";

const pontos: PontoEmbarque[] = PONTOS_TODA_ILHA.map((p, i) => ({ ...p, id: `p${i}` }));
const id = (nome: string) => pontos.find((p) => p.nome.includes(nome))!.id;

function reserva(rid: string, contato: string, ponto: string | null, n = 1, extra: Partial<ReservaManifesto> = {}): ReservaManifesto {
  return {
    id: rid,
    canal: "PAYTOUR",
    contatoNome: contato,
    pontoEmbarqueId: ponto,
    status: "CONFIRMADA",
    passageiros: Array.from({ length: n }, (_, i) => ({ id: `${rid}-${i}`, nome: `${contato} ${i}`, categoria: "ADULTO", embarque: "PENDENTE" })),
    ...extra,
  };
}

describe("ordem de embarque", () => {
  it("pontos oficiais já estão em ordem e transfer não está invertido", () => {
    const ordenados = [...pontos].sort(compararPontos);
    expect(ordenados.map((p) => p.ordem)).toEqual(pontos.map((p) => p.ordem));
    expect(validarSequenciaTransfer(pontos)).toEqual([]);
  });

  it("detecta transfer invertido", () => {
    const invertido = pontos.map((p) => (p.nome.includes("Jurerê") ? { ...p, horario: "06:30" } : p));
    expect(validarSequenciaTransfer(invertido)).toHaveLength(1);
  });

  it("ordena por horário, desempata pela sequência oficial, deixa 'A DEFINIR' no fim", () => {
    const m = montarManifesto(pontos, [
      reserva("r1", "Zélia Fictícia", id("Joaquina")),
      reserva("r2", "Ana Fictícia", id("Novotel")),
      reserva("r3", "Bruno Fictício", id("Majestic")),
      reserva("r4", "Caio Fictício", null),
      reserva("r5", "Davi Fictício", id("Ingleses")),
      reserva("r6", "Eva Fictícia", id("Jurerê")),
    ]);
    expect(m.blocos.map((b) => b.ponto?.nome ?? "A DEFINIR")).toEqual([
      "Transfer — Ingleses e Santinho",
      "Transfer — Jurerê",
      "Hotel Majestic (fundos)",
      "Hotel Novotel (fundos)",
      "Praia da Joaquina",
      "A DEFINIR",
    ]);
    expect(m.blocos.flatMap((b) => b.linhas.map((l) => l.numero))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("mantém a família junta e ordena titulares por nome dentro do ponto", () => {
    const m = montarManifesto(pontos, [reserva("r1", "Marta", id("Villa")), reserva("r2", "Beto", id("Villa"), 3)]);
    expect(m.blocos[0]!.linhas.map((l) => l.reservaId)).toEqual(["r2", "r2", "r2", "r1"]);
  });

  it("passageiro com ponto próprio sai do bloco da reserva", () => {
    const r = reserva("r1", "Família", id("Villa"), 2);
    r.passageiros[1]!.pontoEmbarqueId = id("Catedral");
    const m = montarManifesto(pontos, [r]);
    expect(m.blocos.map((b) => b.ponto?.nome)).toEqual(["Villa Romana Shopping", "Catedral Metropolitana — Praça XV de Novembro"]);
  });

  it("ignora reservas canceladas", () => {
    const m = montarManifesto(pontos, [reserva("r1", "A", id("Villa"), 12), reserva("r2", "B", id("Villa"), 5, { status: "CANCELADA" })]);
    expect(m.totais.passageiros).toBe(12);
  });
});

describe("totais e alertas", () => {
  it("colo não ocupa assento; cortesia não é pagante", () => {
    const r = reserva("r1", "A", id("Villa"), 3);
    r.passageiros[1]!.categoria = "COLO";
    r.passageiros[2]!.categoria = "CORTESIA";
    const m = montarManifesto(pontos, [r]);
    expect(m.totais).toMatchObject({ passageiros: 3, assentos: 2, pagantes: 1 });
  });

  it("abaixo de 10 pagantes exige supervisor; 10–11 aguarda", () => {
    expect(montarManifesto(pontos, [reserva("r", "A", id("Villa"), 9)]).alertas.map((a) => a.codigo)).toContain("DECISAO_SUPERVISOR");
    const onze = montarManifesto(pontos, [reserva("r", "A", id("Villa"), 11)]).alertas.map((a) => a.codigo);
    expect(onze).toContain("MINIMO_NAO_ATINGIDO");
    expect(onze).not.toContain("DECISAO_SUPERVISOR");
    expect(montarManifesto(pontos, [reserva("r", "A", id("Villa"), 12)]).alertas.map((a) => a.codigo)).not.toContain("MINIMO_NAO_ATINGIDO");
  });

  it("alerta de lotação próxima e excedida", () => {
    expect(montarManifesto(pontos, [reserva("r", "A", id("Villa"), 66)]).alertas.map((a) => a.codigo)).toContain("LOTACAO_PROXIMA");
    expect(montarManifesto(pontos, [reserva("r", "A", id("Villa"), 74)]).alertas.map((a) => a.codigo)).toContain("LOTACAO_EXCEDIDA");
  });

  it("alerta reserva sem ponto, passageiro sem nome e sem documento", () => {
    const r = reserva("r", "A", null, 2);
    r.passageiros[1]!.nome = "";
    const codigos = montarManifesto(pontos, [r]).alertas.map((a) => a.codigo);
    expect(codigos).toEqual(expect.arrayContaining(["SEM_PONTO_EMBARQUE", "PASSAGEIRO_SEM_NOME", "SEM_DOCUMENTO"]));
  });
});
