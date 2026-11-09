import { describe, expect, it } from "vitest";
import { avaliarConfirmacao, REGRAS_CONFIRMACAO_PADRAO as R, regiaoComTransito, textoConfirmacao, textoListaGrupo, textoPrevia, validarRegrasConfirmacao } from "../src/index.js";

describe("pontos de corte da confirmação (números do gerente, 09/11/2026)", () => {
  it("10 pagas confirmam de manhã", () => {
    expect(avaliarConfirmacao({ pagas: 10, pendentes: 0 }, R, "09:00").decisao).toBe("CONFIRMAR");
  });
  it("10 pendentes aguardam até as 18h e depois a equipe decide", () => {
    expect(avaliarConfirmacao({ pagas: 0, pendentes: 10 }, R, "12:00").decisao).toBe("AGUARDAR");
    expect(avaliarConfirmacao({ pagas: 0, pendentes: 10 }, R, "18:00").decisao).toBe("DECIDIR");
  });
  it("16 no total com metade paga confirmam; com menos de metade paga, não", () => {
    expect(avaliarConfirmacao({ pagas: 8, pendentes: 8 }, R, "09:30").decisao).toBe("CONFIRMAR");
    expect(avaliarConfirmacao({ pagas: 7, pendentes: 9 }, R, "09:30").decisao).toBe("AGUARDAR");
  });
  it("corte zerado fica desligado", () => {
    expect(avaliarConfirmacao({ pagas: 0, pendentes: 0 }, { ...R, pagasParaConfirmar: 0, totalParaConfirmar: 0, pagasMinimasNoTotal: 0 }, "10:00").decisao).toBe("AGUARDAR");
  });
  it("valida horários e coerência das regras", () => {
    expect(validarRegrasConfirmacao(R)).toBeNull();
    expect(validarRegrasConfirmacao({ ...R, horaPrevia: "19:00" })).toMatch(/antes da hora limite/);
    expect(validarRegrasConfirmacao({ ...R, horaLimite: "25:00" })).toMatch(/HH:MM/);
    expect(validarRegrasConfirmacao({ ...R, pagasMinimasNoTotal: 20 })).toMatch(/total/);
  });
});

describe("região de trânsito intenso", () => {
  it("reconhece continente, norte da ilha e Lagoa (com ou sem acento)", () => {
    expect(regiaoComTransito("Hotel Fictício, Rua X, Canasvieiras")).toBe("NORTE");
    expect(regiaoComTransito(null, "Jurerê Internacional")).toBe("NORTE");
    expect(regiaoComTransito("Pousada Exemplo - Lagoa da Conceição")).toBe("LAGOA");
    expect(regiaoComTransito("Av. Exemplo, Estreito")).toBe("CONTINENTE");
    expect(regiaoComTransito("Kobrasol, São José")).toBe("CONTINENTE");
    expect(regiaoComTransito("Centro, Florianópolis")).toBeNull();
    expect(regiaoComTransito("Rua da Lagoa Fictícia")).toBeNull();
  });
});

describe("textos da véspera", () => {
  const base = { primeiroNome: "Ana", passeio: "City Tour", data: "2026-11-14", linkEmbarque: null };
  it("confirmação com ponto pede 10 minutos de antecedência e avisa trânsito só quando precisa", () => {
    const t = textoConfirmacao({ ...base, ponto: { horario: "08:00", nome: "Villa Romana Shopping", endereco: "Ponto de táxi" } });
    expect(t).toContain("está confirmado");
    expect(t).toContain("*08:00* — Villa Romana Shopping");
    expect(t).toContain("10 minutos antes");
    expect(t).toContain("não há tolerância para atrasos");
    expect(t).not.toContain("trânsito intenso");
    expect(t).toContain("— Equipe By Bus");
    expect(textoConfirmacao({ ...base, ponto: { horario: "07:10", nome: "Jurerê", endereco: null }, transitoIntenso: true })).toContain("trânsito intenso");
  });
  it("sem ponto: pede a hospedagem e explica o ponto mais próximo", () => {
    const t = textoConfirmacao({ ...base, ponto: null, linkEmbarque: "https://exemplo.test/e/abc" });
    expect(t).toContain("https://exemplo.test/e/abc");
    expect(t).toContain("ponto mais próximo");
  });
  it("prévia acalma o cliente e pede a hospedagem só de quem não tem ponto", () => {
    const sem = textoPrevia({ ...base, linkEmbarque: "https://exemplo.test/e/x", semPonto: true });
    expect(sem).toContain("Estamos montando a lista");
    expect(sem).toContain("https://exemplo.test/e/x");
    expect(textoPrevia({ ...base, linkEmbarque: null, semPonto: false })).not.toContain("hospedado");
  });
  it("lista reenviada inteira chega como LISTA ATUALIZADA, não adendo", () => {
    const m = { blocos: [], totais: { passageiros: 0, assentos: 0, porCategoria: { ADULTO: 0, SENIOR: 0, INFANTIL: 0, COLO: 0 } } } as unknown as Parameters<typeof textoListaGrupo>[0];
    const t = textoListaGrupo(m, { passeio: "City Tour", data: "2026-11-14", guia: null, motorista: null, veiculo: null, versao: 2 }, new Map());
    expect(t).toContain("LISTA ATUALIZADA (versão 2)");
    expect(t).not.toContain("ADENDO");
  });
});
