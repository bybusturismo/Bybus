import { describe, expect, it } from "vitest";
import { comprimentoKm, indicesNoTracado, kmPeloTracado, lerKml, preverChegada, tracadoDaRota } from "../src/index.js";

// KML fictício no formato que o Google My Maps exporta (pastas, pontos e uma linha).
const KML = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Rota fictícia</name>
<Folder><name>Rotas</name><Placemark><name>Trajeto</name><LineString><tessellate>1</tessellate><coordinates>
-48.50,-27.60,0 -48.49,-27.60,0 -48.48,-27.60,0 -48.48,-27.59,0 -48.48,-27.58,0 -48.49,-27.58,0 -48.50,-27.58,0
</coordinates></LineString></Placemark></Folder>
<Folder><name>Pontos de embarque</name>
<Placemark><name><![CDATA[1 - Início às 8h no Shopping Fictício]]></name><Point><coordinates>-48.50,-27.60,0</coordinates></Point></Placemark>
<Placemark><name>2 - Embarque às 8h15 no Hotel Fictício &amp; Cia</name><Point><coordinates>-48.48,-27.59,0</coordinates></Point></Placemark>
</Folder></Document></kml>`;

describe("rota importada do mapa (.kml)", () => {
  it("lê pontos com a pasta e a linha do traçado", () => {
    const k = lerKml(KML);
    expect(k.pontos).toEqual([
      { nome: "1 - Início às 8h no Shopping Fictício", pasta: "Pontos de embarque", lat: -27.60, lng: -48.50 },
      { nome: "2 - Embarque às 8h15 no Hotel Fictício & Cia", pasta: "Pontos de embarque", lat: -27.59, lng: -48.48 },
    ]);
    expect(k.linhas[0]!.coordenadas).toHaveLength(7);
    const t = tracadoDaRota(k.linhas);
    expect(comprimentoKm(t)).toBeGreaterThan(5);
  });

  it("distância pelo caminho (em U) é maior que a linha reta e entra na previsão", () => {
    const t = tracadoDaRota(lerKml(KML).linhas);
    const paradas = [{ lat: -27.60, lng: -48.50 }, { lat: -27.58, lng: -48.50 }]; // início e fim do U: perto em linha reta
    const indices = indicesNoTracado(t, paradas);
    expect(indices).toEqual([0, 6]);
    const km = kmPeloTracado(t, { lat: -27.60, lng: -48.50 }, 0, 6)!;
    expect(km).toBeGreaterThan(5); // dá a volta: ~6 km, contra ~2,2 km em linha reta
    const reta = preverChegada({ posicao: paradas[0]!, pontos: paradas, visitado: 0, alvo: 1 });
    const pelaRota = preverChegada({ posicao: paradas[0]!, pontos: paradas, visitado: 0, alvo: 1, rota: { tracado: t, indices } });
    expect(pelaRota.distanciaKm!).toBeGreaterThan(reta.distanciaKm!);
    // Fora do traçado (> 300 m): volta para a linha reta.
    expect(kmPeloTracado(t, { lat: -27.70, lng: -48.70 }, 0, 6)).toBeNull();
  });
});

describe("análise do trajeto (gestão)", () => {
  it("horário em cada parada, parada pulada, km e velocidade", async () => {
    const { analisarTrajeto } = await import("../src/index.js");
    const t0 = Date.parse("2026-11-11T11:00:00Z");
    const paradas = [{ lat: -27.60, lng: -48.50 }, { lat: -27.60, lng: -48.48 }, { lat: -27.60, lng: -48.46 }];
    const pos = [
      { lat: -27.60, lng: -48.50, em: new Date(t0), velocidade: 0 },
      { lat: -27.605, lng: -48.48, em: new Date(t0 + 5 * 60_000), velocidade: 8 }, // ~550 m ao lado: não passou na 2ª
      { lat: -27.60, lng: -48.46, em: new Date(t0 + 10 * 60_000), velocidade: 10 },
    ];
    const a = analisarTrajeto(paradas, pos);
    expect(a.passagens.map((x) => x?.toISOString() ?? null)).toEqual(["2026-11-11T11:00:00.000Z", null, "2026-11-11T11:10:00.000Z"]);
    expect(a.pulados).toEqual([false, true, false]);
    expect(a.resumo).toMatchObject({ duracaoMin: 10, velocidadeMaximaKmh: 36 });
    expect(a.resumo.km).toBeGreaterThan(4);
  });
});
