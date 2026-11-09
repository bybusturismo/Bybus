import { describe, expect, it } from "vitest";
import {
  contarHashtags, diaEHora, engajamentoDoPost, erroTransitorio, esperaTentativaMinutos, janelaResposta, melhoresHorarios, rankingPosts, taxaEngajamento, validarAgendamento,
  type EntradaAgendamento,
} from "../src/index.js";

const agora = new Date("2026-11-10T12:00:00Z");

describe("janela de 24 horas do Direct", () => {
  it("aberta logo após a mensagem do cliente e fecha em 24 h exatas", () => {
    const j = janelaResposta(new Date(agora.getTime() - 3_600_000), agora);
    expect(j.aberta).toBe(true);
    expect(j.minutosRestantes).toBe(23 * 60);
    expect(janelaResposta(new Date(agora.getTime() - 24 * 3_600_000 + 60_000), agora).aberta).toBe(true);
    expect(janelaResposta(new Date(agora.getTime() - 24 * 3_600_000), agora).aberta).toBe(false);
    expect(janelaResposta(new Date(agora.getTime() - 30 * 3_600_000), agora).minutosRestantes).toBe(0);
  });
  it("fechada quando o cliente nunca escreveu ou a data é inválida", () => {
    expect(janelaResposta(null, agora)).toEqual({ aberta: false, expiraEm: null, minutosRestantes: 0 });
    expect(janelaResposta("lixo", agora).aberta).toBe(false);
  });
});

const base = (extra: Partial<EntradaAgendamento> = {}): EntradaAgendamento => ({
  rede: "INSTAGRAM", tipo: "IMAGEM", legenda: "Vista da ilha #floripa", agendarEm: new Date(agora.getTime() + 3_600_000),
  midias: [{ uso: "IMAGEM", tipo: "image/jpeg" }], agora, ...extra,
});

describe("validação do agendamento", () => {
  it("aceita post de imagem completo", () => expect(validarAgendamento(base())).toEqual([]));
  it("exige Instagram, data futura e antecedência mínima", () => {
    expect(validarAgendamento(base({ rede: "TIKTOK" }))).toContain("Só é possível agendar posts do Instagram.");
    expect(validarAgendamento(base({ agendarEm: null }))).toContain("Informe a data e a hora da publicação.");
    expect(validarAgendamento(base({ agendarEm: new Date(agora.getTime() + 60_000) })).join()).toMatch(/antecedência/);
    expect(validarAgendamento(base({ agendarEm: new Date(agora.getTime() - 60_000) })).join()).toMatch(/antecedência/);
    expect(validarAgendamento(base({ agendarEm: new Date(agora.getTime() + 400 * 86_400_000) })).join()).toMatch(/longe demais/);
  });
  it("confere mídia por tipo de post", () => {
    expect(validarAgendamento(base({ midias: [] })).join()).toMatch(/exatamente 1 imagem/);
    expect(validarAgendamento(base({ midias: [{ uso: "IMAGEM", tipo: "image/png" }] })).join()).toMatch(/JPEG/);
    expect(validarAgendamento(base({ tipo: "REELS", midias: [{ uso: "VIDEO", tipo: "video/mp4" }] }))).toEqual([]);
    expect(validarAgendamento(base({ tipo: "REELS", midias: [{ uso: "VIDEO", tipo: "video/webm" }] })).join()).toMatch(/MP4/);
    expect(validarAgendamento(base({ tipo: "REELS" })).join()).toMatch(/Reels/);
    const j = { uso: "IMAGEM" as const, tipo: "image/jpeg" };
    expect(validarAgendamento(base({ tipo: "CARROSSEL", midias: [j] })).join()).toMatch(/Carrossel/);
    expect(validarAgendamento(base({ tipo: "CARROSSEL", midias: [j, j, j] }))).toEqual([]);
    expect(validarAgendamento(base({ tipo: "CARROSSEL", midias: Array(11).fill(j) })).join()).toMatch(/Carrossel/);
    expect(validarAgendamento(base({ midias: [{ uso: "ARQUIVO", tipo: "application/pdf" }] })).join()).toMatch(/só imagens ou vídeos/);
  });
  it("limita legenda e hashtags", () => {
    expect(validarAgendamento(base({ legenda: "a".repeat(2201) })).join()).toMatch(/2200/);
    expect(validarAgendamento(base({ legenda: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ") })).join()).toMatch(/hashtags/);
    expect(contarHashtags("oi #a #b, #c_d texto#naoconta")).toBe(3);
  });
});

describe("tentativas", () => {
  it("backoff exponencial limitado a 30 min", () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(esperaTentativaMinutos)).toEqual([2, 4, 8, 16, 30, 30, 30]);
  });
  it("só rede, 429 e 5xx valem nova tentativa", () => {
    expect([null, 429, 500, 503].every(erroTransitorio)).toBe(true);
    expect([400, 401, 403, 404].some(erroTransitorio)).toBe(false);
  });
});

describe("análise dos posts", () => {
  const post = (id: string, quando: string, c: number, co = 0, s = 0, sh = 0, alcance: number | null = 100) => ({ id, publicadoEm: quando, curtidas: c, comentarios: co, salvamentos: s, compartilhamentos: sh, alcance });
  it("engajamento soma curtidas, comentários, salvamentos e compartilhamentos", () => {
    expect(engajamentoDoPost(post("a", "2026-11-01T12:00:00Z", 10, 2, 3, 5))).toBe(20);
    expect(engajamentoDoPost({ curtidas: null, comentarios: null, salvamentos: null, compartilhamentos: null })).toBe(0);
    expect(taxaEngajamento(post("a", "2026-11-01T12:00:00Z", 10, 0, 0, 0, 200))).toBeCloseTo(0.05);
    expect(taxaEngajamento(post("a", "2026-11-01T12:00:00Z", 10, 0, 0, 0, null))).toBeNull();
  });
  it("ranking ordena por engajamento", () => {
    const r = rankingPosts([post("a", "2026-11-01T12:00:00Z", 5), post("b", "2026-11-02T12:00:00Z", 50), post("c", "2026-11-03T12:00:00Z", 20)], 2);
    expect(r.map((p) => p.id)).toEqual(["b", "c"]);
  });
  it("dia e hora no fuso de São Paulo", () => {
    expect(diaEHora(new Date("2026-11-07T02:30:00Z"))).toEqual({ dia: 5, hora: 23 }); // sexta 23h em SP
  });
  it("melhores horários: médias por dia/hora e melhor combinação com 2+ posts", () => {
    const posts = [
      post("1", "2026-11-02T21:00:00Z", 10), // segunda 18h SP
      post("2", "2026-11-09T21:00:00Z", 30), // segunda 18h
      post("3", "2026-11-03T13:00:00Z", 100), // terça 10h (sozinho: não vira "melhor")
    ];
    const m = melhoresHorarios(posts);
    expect(m.porDiaSemana).toEqual([{ dia: 1, posts: 2, engajamentoMedio: 20 }, { dia: 2, posts: 1, engajamentoMedio: 100 }]);
    expect(m.porHora.map((h) => h.hora)).toEqual([10, 18]);
    expect(m.melhor).toEqual({ dia: 1, hora: 18, posts: 2, engajamentoMedio: 20 });
    expect(melhoresHorarios([]).melhor).toBeNull();
  });
});

import { aplicarVariaveis, ETIQUETAS_CONVERSA, normalizarAtalho, RESPOSTAS_INICIAIS, ATALHO_RESPOSTA_REGEX, IDIOMAS_RESPOSTA, STATUS_CONTEUDO } from "../src/index.js";

describe("respostas prontas e etiquetas", () => {
  it("aplica variáveis e devolve o que faltou", () => {
    const r = aplicarVariaveis("Oi, {nome}! {passeio} em {data} no {ponto} às {horario}. {outra}", { nome: "Ana", passeio: "City Tour", data: "10/11", ponto: null });
    expect(r.texto).toBe("Oi, Ana! City Tour em 10/11 no {ponto} às {horario}. {outra}");
    expect(r.faltando).toEqual(["ponto", "horario"]);
    expect(aplicarVariaveis("sem variáveis", {})).toEqual({ texto: "sem variáveis", faltando: [] });
  });
  it("normaliza o atalho", () => {
    expect(normalizarAtalho("/Preço Criança!")).toBe("preco-crianca");
    expect(ATALHO_RESPOSTA_REGEX.test(normalizarAtalho("  /Ponto  "))).toBe(true);
  });
  it("sugestões iniciais: 10 perguntas em PT, EN e ES, com atalhos válidos e sem repetir", () => {
    expect(RESPOSTAS_INICIAIS).toHaveLength(30);
    const chaves = new Set(RESPOSTAS_INICIAIS.map((r) => `${r.atalho}/${r.idioma}`));
    expect(chaves.size).toBe(30);
    for (const r of RESPOSTAS_INICIAIS) expect(ATALHO_RESPOSTA_REGEX.test(r.atalho)).toBe(true);
    for (const a of new Set(RESPOSTAS_INICIAIS.map((r) => r.atalho))) for (const i of IDIOMAS_RESPOSTA) expect(chaves.has(`${a}/${i}`)).toBe(true);
    // não afirmam política da empresa: só variáveis conhecidas
    for (const r of RESPOSTAS_INICIAIS) expect((r.texto.match(/\{(\w+)\}/g) ?? []).every((v) => ["{nome}", "{passeio}", "{data}", "{ponto}", "{horario}"].includes(v))).toBe(true);
  });
  it("etiquetas e fluxo de aprovação", () => {
    expect(ETIQUETAS_CONVERSA).toHaveLength(5);
    expect(STATUS_CONTEUDO).toEqual(["IDEIA", "PRODUCAO", "EM_APROVACAO", "APROVADO", "AGENDADO", "PUBLICADO"]);
  });
});
