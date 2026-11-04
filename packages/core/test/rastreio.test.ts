import { describe, expect, it } from "vitest";
import { atualizarVisitado, distanciaKm, preverChegada, situacaoSinal, textoRastreio, velocidadeMediaKmh } from "../src/index.js";

// Pontos fictícios em linha reta ao longo da mesma latitude (1 km ≈ 0,009384° de longitude a -27,6°).
const KM = 0.0101;
const ponto = (km: number) => ({ lat: -27.6, lng: -48.5 + km * KM });
const rota = [ponto(0), ponto(2), ponto(4), ponto(6)];

describe("distância", () => {
  it("haversine: zero para o mesmo ponto e ~111 km por grau de latitude", () => {
    expect(distanciaKm(ponto(0), ponto(0))).toBe(0);
    expect(distanciaKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.19, 1);
  });
});

describe("velocidade média", () => {
  it("padrão 25 km/h sem amostras e mínimo de 15 km/h", () => {
    expect(velocidadeMediaKmh([])).toBe(25);
    expect(velocidadeMediaKmh([null, undefined, -3, Number.NaN])).toBe(25);
    expect(velocidadeMediaKmh([0, 0, 0])).toBe(15);
    expect(velocidadeMediaKmh([5])).toBe(18); // 5 m/s = 18 km/h
    expect(velocidadeMediaKmh([10, null, 0])).toBe(18); // média de 10 e 0 = 5 m/s
  });
});

describe("pontos visitados", () => {
  it("avança ao chegar a 150 m e não volta; passar adiante conta os anteriores", () => {
    expect(atualizarVisitado(-1, rota, [ponto(-1)])).toBe(-1);
    expect(atualizarVisitado(-1, rota, [ponto(0.1)])).toBe(0); // ~100 m do primeiro
    expect(atualizarVisitado(-1, rota, [ponto(0.3)])).toBe(-1); // 300 m: ainda não
    expect(atualizarVisitado(0, rota, [ponto(0)])).toBe(0);
    expect(atualizarVisitado(-1, rota, [ponto(4)])).toBe(2);
  });
  it("ignora pontos sem coordenadas", () => {
    expect(atualizarVisitado(-1, [null, ponto(2)], [ponto(2)])).toBe(1);
    expect(atualizarVisitado(-1, [null], [ponto(0)])).toBe(-1);
  });
});

describe("previsão de chegada", () => {
  it("soma a rota pelos pontos restantes, aplica o fator 1,3 e 1 min por parada intermediária", () => {
    // Ônibus no ponto 0 (visitado), cliente no ponto 3: o trecho restante soma 6 km retos → 7,8 km; a 25 km/h = 18,72 min + 2 paradas.
    const p = preverChegada({ posicao: ponto(0), pontos: rota, visitado: 0, alvo: 3 });
    expect(p.situacao).toBe("A_CAMINHO");
    expect(p.paradasIntermediarias).toBe(2); // pontos 1 e 2 ficam entre o ônibus e o cliente
    expect(p.distanciaKm).toBeGreaterThan(7.5);
    expect(p.distanciaKm).toBeLessThan(8.1);
    expect(p.minutos).toBe(Math.ceil((p.distanciaKm! / 25) * 60 + p.paradasIntermediarias));
  });
  it("usa a velocidade informada, com piso de 15 km/h", () => {
    const rapido = preverChegada({ posicao: ponto(0), pontos: rota, visitado: 0, alvo: 1, velocidadeKmh: 50 });
    const lento = preverChegada({ posicao: ponto(0), pontos: rota, visitado: 0, alvo: 1, velocidadeKmh: 2 });
    const piso = preverChegada({ posicao: ponto(0), pontos: rota, visitado: 0, alvo: 1, velocidadeKmh: 15 });
    expect(rapido.minutos!).toBeLessThan(lento.minutos!);
    expect(lento.minutos).toBe(piso.minutos);
  });
  it("borda: dentro do raio do ponto = NO_PONTO; ponto já visitado = JA_PASSOU", () => {
    expect(preverChegada({ posicao: ponto(2.05), pontos: rota, visitado: 0, alvo: 1 }).situacao).toBe("NO_PONTO");
    expect(preverChegada({ posicao: ponto(5), pontos: rota, visitado: 2, alvo: 2 }).situacao).toBe("JA_PASSOU");
    expect(preverChegada({ posicao: ponto(5), pontos: rota, visitado: 2, alvo: 0 }).situacao).toBe("JA_PASSOU");
  });
  it("mínimo de 1 minuto quando está perto mas fora do raio", () => {
    const p = preverChegada({ posicao: ponto(1.7), pontos: rota, visitado: 0, alvo: 1 });
    expect(p.situacao).toBe("A_CAMINHO");
    expect(p.minutos).toBeGreaterThanOrEqual(1);
  });
  it("sem coordenadas no trecho ou sem ponto do cliente: sem previsão", () => {
    const comBuraco = [ponto(0), null, ponto(4)];
    expect(preverChegada({ posicao: ponto(0), pontos: comBuraco, visitado: 0, alvo: 2 })).toMatchObject({ situacao: "SEM_PREVISAO", motivo: "SEM_COORDENADAS", minutos: null });
    expect(preverChegada({ posicao: ponto(0), pontos: [ponto(0), ponto(2), null], visitado: 0, alvo: 2 }).motivo).toBe("SEM_COORDENADAS");
    expect(preverChegada({ posicao: ponto(0), pontos: rota, visitado: 0, alvo: null })).toMatchObject({ situacao: "SEM_PREVISAO", motivo: "SEM_PONTO" });
    expect(preverChegada({ posicao: ponto(0), pontos: rota, visitado: 0, alvo: 9 }).motivo).toBe("SEM_PONTO");
  });
  it("ponto sem coordenadas antes do que já foi visitado não atrapalha", () => {
    expect(preverChegada({ posicao: ponto(2), pontos: [null, ponto(2), ponto(4)], visitado: 1, alvo: 2 }).situacao).toBe("A_CAMINHO");
  });
});

describe("situação do sinal", () => {
  const t0 = new Date("2026-11-05T11:00:00Z");
  const apos = (min: number) => new Date(t0.getTime() + min * 60_000);
  it("sem sessão, transmitindo, sem sinal e encerrado", () => {
    expect(situacaoSinal(null, t0).situacao).toBe("NAO_INICIADO");
    expect(situacaoSinal({ iniciadaEm: t0, encerradaEm: null, ultimaPosicaoEm: null }, apos(1)).situacao).toBe("AGUARDANDO_SINAL");
    expect(situacaoSinal({ iniciadaEm: t0, encerradaEm: null, ultimaPosicaoEm: null }, apos(5)).situacao).toBe("SEM_SINAL");
    expect(situacaoSinal({ iniciadaEm: t0, encerradaEm: null, ultimaPosicaoEm: apos(10) }, apos(11))).toEqual({ situacao: "TRANSMITINDO", minutosSemSinal: 1 });
    expect(situacaoSinal({ iniciadaEm: t0, encerradaEm: null, ultimaPosicaoEm: apos(10) }, apos(13))).toEqual({ situacao: "SEM_SINAL", minutosSemSinal: 3 });
    expect(situacaoSinal({ iniciadaEm: t0, encerradaEm: apos(30), ultimaPosicaoEm: apos(29) }, apos(40)).situacao).toBe("ENCERRADO");
  });
});

describe("mensagem RASTREIO", () => {
  it("leva o link e o nome do passeio, sem dados do motorista", () => {
    const t = textoRastreio({ primeiroNome: "Ana", passeio: "Toda a Ilha", link: "https://exemplo.test/rastreio/abc" });
    expect(t).toContain("Olá, Ana!");
    expect(t).toContain("*Toda a Ilha*");
    expect(t).toContain("https://exemplo.test/rastreio/abc");
    expect(textoRastreio({ primeiroNome: "", passeio: "X", link: "l" }).startsWith("Olá! ")).toBe(true);
  });
});
