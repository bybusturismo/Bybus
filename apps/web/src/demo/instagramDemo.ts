/**
 * Instagram da demonstração: números e posts fictícios (aba Instagram do Marketing), comentários, banco de mídias e o fluxo de
 * aprovação/agendamento do calendário de conteúdo. Nada sai de verdade; as imagens são desenhos gerados no navegador.
 */
import { engajamentoDoPost, melhoresHorarios, rankingPosts, ROTULO_TIPO_POST, validarAgendamento, type TipoPostInstagram } from "@bybus/core";
import { NAO, UN_FLN, diasEntre, somarDias, type Ctx, type Rotear } from "./comum";
import { conteudos, semearConteudosInstagram, type Conteudo } from "./marketingDemo";

const ESTADO = { conectado: true, real: false, simulado: true, avisosLigados: true };

const placeholder = (cor: string, texto: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="${cor}"/><text x="120" y="96" font-family="sans-serif" font-size="18" fill="#fff" text-anchor="middle">${texto}</text></svg>`)}`;

interface Post { id: string; tipo: string; legenda: string; link: string; publicadoEm: string; curtidas: number; comentarios: number; salvamentos: number; compartilhamentos: number; alcance: number }
interface Comentario { id: string; autor: string; texto: string; escritoEm: string; ehResposta: boolean; oculto: boolean; lido: boolean; respostaTexto: string | null; respostaStatus: "SIMULADA" | null; respostaEm: string | null; post: { legenda: string; link: string | null } | null }
interface ItemBanco { id: string; nome: string; tipo: string; uso: "IMAGEM" | "VIDEO"; tamanho: number; passeio: string | null; pontoTuristico: string | null; temporada: string | null; criadoEm: string; previa: string }
interface Midia { id: string; nome: string; tipo: string; uso: "IMAGEM" | "VIDEO"; tamanho: number; ordem: number; previa: string }

let semeado = false;
let hoje = "";
let agoraMs = 0;
const posts: Post[] = [];
const comentarios: Comentario[] = [];
const banco: ItemBanco[] = [];
const midias = new Map<string, Midia[]>();

/** Número "aleatório" estável (para a demonstração sempre mostrar a mesma conta). */
const pseudo = (i: number, base: number, amplitude: number) => Math.round(base + Math.sin(i * 1.7) * amplitude + Math.cos(i * 0.6) * amplitude * 0.6);

function semear(ctx: Ctx) {
  if (semeado) return;
  semeado = true;
  hoje = ctx.dataMais(0);
  agoraMs = Date.now();
  const legendas = [
    ["REELS", "Pôr do sol na Lagoa da Conceição"], ["IMAGEM", "Vista do mirante no City Tour Toda Ilha"], ["CARROSSEL", "Cinco paradas imperdíveis em Florianópolis"], ["REELS", "Trenzinho de Balneário Camboriú ao entardecer"],
    ["IMAGEM", "Bom dia da ilha da magia"], ["VIDEO", "Bastidores da saída das 8h"], ["IMAGEM", "Praia dos Ingleses vista de cima"], ["CARROSSEL", "Dicas de roupa e protetor para o passeio"],
    ["REELS", "Veja a cidade de camarote"], ["IMAGEM", "Cristo Luz em Balneário Camboriú"], ["IMAGEM", "Pausa para o café colonial"], ["REELS", "Guia conta a história do Ribeirão da Ilha"],
  ] as const;
  legendas.forEach(([tipo, legenda], i) => {
    const dia = somarDias(hoje, -3 - i * 4);
    const hora = [18, 12, 19, 9, 18, 20][i % 6]!;
    const bonus = tipo === "REELS" ? 2.4 : tipo === "CARROSSEL" ? 1.5 : 1;
    const alcance = Math.round(pseudo(i, 2400, 700) * bonus);
    posts.push({
      id: `ig-post-${i + 1}`, tipo, legenda, link: `https://instagram.exemplo.test/p/demo${i + 1}`,
      publicadoEm: new Date(`${dia}T${String(hora + 3).padStart(2, "0")}:00:00Z`).toISOString(), // hora de Brasília + 3 = UTC
      curtidas: Math.round(alcance * 0.06), comentarios: Math.round(alcance * 0.004), salvamentos: Math.round(alcance * 0.01), compartilhamentos: Math.round(alcance * 0.008), alcance,
    });
  });
  const c = (id: string, autor: string, texto: string, minAtras: number, extra: Partial<Comentario> = {}) => comentarios.push({
    id, autor, texto, escritoEm: new Date(agoraMs - minAtras * 60_000).toISOString(), ehResposta: false, oculto: false, lido: false, respostaTexto: null, respostaStatus: null, respostaEm: null,
    post: { legenda: posts[Number(id.slice(-1)) % posts.length]!.legenda, link: posts[Number(id.slice(-1)) % posts.length]!.link }, ...extra,
  });
  c("ig-com-1", "viajante_ficticio", "Lindo demais! Qual o horário dessa saída?", 40);
  c("ig-com-2", "familia.demo", "Fizemos esse passeio mês passado, recomendo!", 190, { lido: true });
  c("ig-com-3", "perfil_promocional_demo", "Ganhe seguidores comprando em nosso site!!! 🔥🔥", 260);
  c("ig-com-4", "english_visitor_demo", "Is this tour available in English?", 640);
  c("ig-com-5", "turista.mineira.demo", "Adoramos o trenzinho!", 1500, { lido: true, respostaTexto: "Obrigado pela visita, esperamos você de novo!", respostaStatus: "SIMULADA", respostaEm: new Date(agoraMs - 1400 * 60_000).toISOString() });

  const item = (id: string, nome: string, passeio: string | null, ponto: string | null, temp: string | null, cor: string, tipo = "image/jpeg") => banco.push({
    id, nome, tipo, uso: tipo.startsWith("video") ? "VIDEO" : "IMAGEM", tamanho: tipo.startsWith("video") ? 38_000_000 : 1_800_000, passeio, pontoTuristico: ponto, temporada: temp, criadoEm: new Date(agoraMs - 20 * 86_400_000).toISOString(), previa: placeholder(cor, ponto ?? nome),
  });
  item("bm-1", "lagoa-por-do-sol.jpg", "City Tour Toda Ilha", "Lagoa da Conceição", "Verão 2027", "#c2410c");
  item("bm-2", "mirante-ilha.jpg", "City Tour Toda Ilha", "Mirante do Morro da Cruz", "Todas", "#0069ad");
  item("bm-3", "ingleses-drone.jpg", "City Tour Toda Ilha", "Praia dos Ingleses", "Verão 2027", "#0e7c86");
  item("bm-4", "trenzinho-bc.mp4", "City Tour Balneário Camboriú", "Cristo Luz", "Todas", "#4a4395", "video/mp4");
  item("bm-5", "cristo-luz-noite.jpg", "City Tour Balneário Camboriú", "Cristo Luz", "Inverno 2026", "#4a4395");
  item("bm-6", "ribeirao-casario.jpg", "City Tour Toda Ilha", "Ribeirão da Ilha", "Todas", "#61b339");
  item("bm-7", "logo-bybus.png", null, null, null, "#231f20", "image/png");
  item("bm-8", "equipe-saida-8h.jpg", null, null, "Todas", "#db2e53");
}

/** Posts do Instagram no calendário de conteúdo: um em cada etapa do fluxo (aprovação → agendamento → publicação). */
semearConteudosInstagram.fn = (lista: Conteudo[], dataMais) => {
  const quando = (dias: number, hora: number) => new Date(`${dataMais(dias)}T${String(hora + 3).padStart(2, "0")}:00:00Z`).toISOString();
  const base = (extra: Conteudo): Conteudo => ({ tipoPost: null, agendarEm: null, pubStatus: null, pubSimulado: false, pubErro: null, qtdMidias: 0, aprovadoEm: null, ...extra });
  const ct1 = lista.find((x) => x.id === "ct-1");
  if (ct1) Object.assign(ct1, { tipoPost: "REELS", agendarEm: quando(2, 10), pubStatus: "AGENDADO", qtdMidias: 1, aprovadoEm: new Date().toISOString() });
  lista.push(
    base({ id: "ct-5", unidadeId: UN_FLN, titulo: "Carrossel: cinco paradas do City Tour", rede: "INSTAGRAM", status: "EM_APROVACAO", dataPrevista: dataMais(4), legenda: "Cinco paradas para ver Florianópolis de camarote. Arraste e escolha a sua!", link: null, responsavelId: "rs-1", qtdMidias: 3 }),
    base({ id: "ct-6", unidadeId: UN_FLN, titulo: "Foto: Lagoa ao entardecer", rede: "INSTAGRAM", status: "APROVADO", dataPrevista: dataMais(3), legenda: "Entardecer na Lagoa da Conceição #floripa #citytour", link: null, responsavelId: "rs-2", qtdMidias: 1, aprovadoEm: new Date().toISOString() }),
    base({ id: "ct-7", unidadeId: UN_FLN, titulo: "Reels: trenzinho (publicado)", rede: "INSTAGRAM", status: "PUBLICADO", dataPrevista: dataMais(-2), legenda: "Trenzinho ao pôr do sol.", link: null, responsavelId: "rs-1", tipoPost: "REELS", agendarEm: quando(-2, 18), pubStatus: "PUBLICADO", pubSimulado: true, qtdMidias: 1, aprovadoEm: new Date().toISOString() }),
    base({ id: "ct-8", unidadeId: UN_FLN, titulo: "Imagem: promoção de baixa temporada", rede: "INSTAGRAM", status: "AGENDADO", dataPrevista: dataMais(-1), legenda: "Baixa temporada com o melhor preço.", link: null, responsavelId: "rs-2", tipoPost: "IMAGEM", agendarEm: quando(-1, 9), pubStatus: "FALHOU", pubErro: "URL_PUBLICA_AUSENTE", qtdMidias: 1, aprovadoEm: new Date().toISOString() }),
    base({ id: "ct-9", unidadeId: UN_FLN, titulo: "Stories: contagem para a temporada", rede: "INSTAGRAM", status: "PRODUCAO", dataPrevista: dataMais(9), legenda: null, link: null, responsavelId: null }),
  );
  for (const [id, qtd] of [["ct-1", 1], ["ct-5", 3], ["ct-6", 1], ["ct-7", 1], ["ct-8", 1]] as const) {
    midias.set(id, Array.from({ length: qtd }, (_, i) => ({ id: `mid-${id}-${i}`, nome: `${id}-${i + 1}.${id === "ct-1" || id === "ct-7" ? "mp4" : "jpg"}`, tipo: id === "ct-1" || id === "ct-7" ? "video/mp4" : "image/jpeg", uso: id === "ct-1" || id === "ct-7" ? "VIDEO" as const : "IMAGEM" as const, tamanho: 1_500_000, ordem: i, previa: placeholder(["#0069ad", "#0e7c86", "#c2410c"][i % 3]!, `Mídia ${i + 1}`) })));
  }
};

const LEGENDAS_IA: Record<string, Array<{ legenda: string; hashtags: string[] }>> = {
  pt: [
    { legenda: "Veja a cidade de camarote: a Lagoa da Conceição ao entardecer é o programa perfeito.", hashtags: ["#floripa", "#lagoadaconceicao", "#citytour", "#turismo", "#santacatarina", "#bybus"] },
    { legenda: "Um dia, seis paradas e muita vista bonita. Já escolheu a sua favorita?", hashtags: ["#florianopolis", "#passeio", "#ferias", "#viajarbrasil", "#bybus"] },
    { legenda: "Do mirante à praia: venha conhecer a ilha com quem conhece cada curva do caminho.", hashtags: ["#ilhadamagia", "#turismoembarcado", "#floripa", "#bybus", "#viagem"] },
  ],
  en: [
    { legenda: "See the city from the best seat in the house: sunset at Lagoa da Conceição.", hashtags: ["#florianopolis", "#brazil", "#citytour", "#travel", "#bybus"] },
    { legenda: "One day, six stops and plenty of beautiful views. Which one is your favorite?", hashtags: ["#floripa", "#tour", "#vacation", "#traveltheworld", "#bybus"] },
    { legenda: "From the lookout to the beach: discover the island with local guides.", hashtags: ["#islandlife", "#southbrazil", "#bybus", "#travelgram", "#trip"] },
  ],
  es: [
    { legenda: "Mira la ciudad desde el mejor asiento: atardecer en la Lagoa da Conceição.", hashtags: ["#florianopolis", "#brasil", "#citytour", "#viajar", "#bybus"] },
    { legenda: "Un día, seis paradas y muchas vistas lindas. ¿Cuál es tu favorita?", hashtags: ["#floripa", "#paseo", "#vacaciones", "#viajeros", "#bybus"] },
    { legenda: "Del mirador a la playa: conoce la isla con guías locales.", hashtags: ["#islademagia", "#sudbrasil", "#bybus", "#turismo", "#viaje"] },
  ],
};

export const rotearInstagram: Rotear = (ctx, metodo, caminho, q, c) => {
  const ehMkt = caminho.startsWith("/api/marketing/instagram") || caminho.startsWith("/api/marketing/banco-midias") || caminho.startsWith("/api/marketing/legendas") || /^\/api\/marketing\/conteudos\/[^/]+\/(midias|solicitar-aprovacao|aprovar|devolver|agendar|cancelar-agendamento)/.test(caminho);
  if (!ehMkt && !caminho.startsWith("/api/instagram/")) return NAO;
  semear(ctx);
  let m: RegExpMatchArray | null;
  const r = (re: RegExp) => (m = caminho.match(re));
  const ver = () => ctx.exigir("marketing:ver");
  const gerir = () => ctx.exigir("marketing:gerenciar");

  // ---------- Aba Instagram ----------
  if (metodo === "GET" && caminho === "/api/marketing/instagram") {
    ver();
    const ate = q.get("ate") ?? hoje;
    const de = q.get("de") ?? somarDias(ate, -29);
    const dias = Math.max(0, Math.min(400, diasEntre(de, ate)));
    const serie = Array.from({ length: dias + 1 }, (_, i) => {
      const data = somarDias(de, i);
      const k = diasEntre(data, hoje); // dias atrás
      return { data, seguidores: 1530 - Math.round(k * 2.4), alcance: Math.max(120, pseudo(k, 520, 160)), visualizacoes: Math.max(200, pseudo(k + 5, 1100, 300)), visitasPerfil: Math.max(5, pseudo(k + 9, 38, 12)), cliquesSite: Math.max(0, pseudo(k + 2, 4, 3)) };
    });
    const soma = (f: (d: (typeof serie)[number]) => number) => serie.reduce((s, d) => s + f(d), 0);
    const doPeriodo = posts.filter((p) => p.publicadoEm.slice(0, 10) >= de && p.publicadoEm.slice(0, 10) <= ate).map((p) => ({ ...p, id: p.id }));
    return {
      modo: ESTADO, periodo: { de, ate }, atualizadoEm: new Date(agoraMs - 3 * 3_600_000).toISOString(),
      resumo: { seguidores: serie[serie.length - 1]!.seguidores, variacaoSeguidores: serie[serie.length - 1]!.seguidores - serie[0]!.seguidores, alcance: soma((d) => d.alcance), visualizacoes: soma((d) => d.visualizacoes), visitasPerfil: soma((d) => d.visitasPerfil), cliquesSite: soma((d) => d.cliquesSite), posts: doPeriodo.length, engajamento: doPeriodo.reduce((s, p) => s + engajamentoDoPost(p), 0) },
      serie: serie.map((d) => ({ data: d.data, seguidores: d.seguidores, alcance: d.alcance })),
      ranking: rankingPosts(doPeriodo, 10),
      melhores: melhoresHorarios(doPeriodo),
    };
  }
  if (metodo === "POST" && caminho === "/api/marketing/instagram/atualizar") { gerir(); return { executou: false, motivo: "SIMULADO", dias: 0, posts: 0, falhas: [] }; }

  // ---------- Comentários ----------
  if (metodo === "GET" && caminho === "/api/instagram/comentarios") {
    ctx.exigir("whatsapp:ver");
    const lista = comentarios.filter((x) => q.get("situacao") === "todos" || (x.respostaStatus === null && !x.oculto)).sort((a, b) => b.escritoEm.localeCompare(a.escritoEm));
    return { modo: ESTADO, naoLidos: comentarios.filter((x) => !x.lido).length, comentarios: lista };
  }
  if (r(/^\/api\/instagram\/comentarios\/([^/]+)\/(lido|responder|ocultar)$/) && metodo === "POST") {
    ctx.exigir("whatsapp:ver");
    const x = comentarios.find((y) => y.id === m![1]);
    if (!x) throw ctx.erro(404, "NAO_ENCONTRADO", "Comentário não encontrado.");
    if (m![2] === "lido") { x.lido = true; return { ok: true }; }
    ctx.exigir("whatsapp:responder");
    if (m![2] === "ocultar") { x.oculto = c.oculto !== false; x.lido = true; return { ok: true, oculto: x.oculto }; }
    const texto = String(c.texto ?? "").trim();
    if (!texto) throw ctx.erro(400, "DADOS_INVALIDOS", "Escreva a resposta.");
    if (x.respostaStatus) throw ctx.erro(409, "JA_RESPONDIDO", "Este comentário já foi respondido.");
    Object.assign(x, { respostaTexto: texto, respostaStatus: "SIMULADA", respostaEm: new Date().toISOString(), lido: true });
    ctx.auditar("instagram.comentario_responder", "ig_comentario", x.id, { comentarioId: x.id });
    return { status: "SIMULADA", erro: null };
  }

  // ---------- Banco de mídias ----------
  if (metodo === "GET" && caminho === "/api/marketing/banco-midias") {
    ver();
    const f = (k: "passeio" | "pontoTuristico" | "temporada") => q.get(k) || null;
    const busca = (q.get("busca") ?? "").toLowerCase();
    const uniq = (v: Array<string | null>) => [...new Set(v.filter((x): x is string => !!x))].sort();
    return {
      itens: banco.filter((i) => (!f("passeio") || i.passeio === f("passeio")) && (!f("pontoTuristico") || i.pontoTuristico === f("pontoTuristico")) && (!f("temporada") || i.temporada === f("temporada")) && (!busca || i.nome.toLowerCase().includes(busca))),
      etiquetas: { passeios: uniq(["City Tour Toda Ilha", "City Tour Balneário Camboriú", ...banco.map((i) => i.passeio)]), pontosTuristicos: uniq(banco.map((i) => i.pontoTuristico)), temporadas: uniq(banco.map((i) => i.temporada)) },
    };
  }
  if (metodo === "POST" && caminho === "/api/marketing/banco-midias") {
    gerir();
    const nome = q.get("nome") ?? "arquivo.jpg";
    const video = /\.(mp4|webm)$/i.test(nome);
    const novo: ItemBanco = { id: ctx.id("bm"), nome, tipo: video ? "video/mp4" : /\.png$/i.test(nome) ? "image/png" : "image/jpeg", uso: video ? "VIDEO" : "IMAGEM", tamanho: 1_200_000, passeio: q.get("passeio") || null, pontoTuristico: q.get("pontoTuristico") || null, temporada: q.get("temporada") || null, criadoEm: ctx.agoraIso(), previa: placeholder("#4a4395", nome) };
    banco.unshift(novo);
    return novo;
  }
  if (r(/^\/api\/marketing\/banco-midias\/([^/]+)$/)) {
    gerir();
    const i = banco.find((y) => y.id === m![1]);
    if (!i) throw ctx.erro(404, "NAO_ENCONTRADO", "Mídia não encontrada.");
    if (metodo === "DELETE") { banco.splice(banco.indexOf(i), 1); return { ok: true }; }
    if (metodo === "PATCH") { for (const k of ["passeio", "pontoTuristico", "temporada"] as const) if (k in c) i[k] = c[k] || null; return i; }
  }

  // ---------- Mídia, aprovação e agendamento do conteúdo ----------
  if (r(/^\/api\/marketing\/conteudos\/([^/]+)\/midias(?:\/([^/]+))?$/)) {
    const cont = conteudos.find((y) => y.id === m![1]);
    if (!cont) throw ctx.erro(404, "NAO_ENCONTRADO", "Conteúdo não encontrado.");
    const lista = midias.get(cont.id) ?? [];
    midias.set(cont.id, lista);
    const sincronizar = () => {
      lista.forEach((x, k) => { x.ordem = k; });
      cont.qtdMidias = lista.length;
      if (cont.status === "APROVADO" || cont.status === "AGENDADO") Object.assign(cont, { status: "EM_APROVACAO", aprovadoEm: null, pubStatus: null, pubErro: null }); // mexer na mídia desfaz a aprovação
    };
    if (metodo === "GET" && !m![2]) { ver(); return lista; }
    gerir();
    if (cont.pubStatus === "PUBLICANDO" || cont.status === "PUBLICADO") throw ctx.erro(409, "JA_PUBLICADO", "Este post já foi publicado.");
    if (metodo === "POST" && m![2] === "do-banco") {
      const b = banco.find((y) => y.id === c.bancoId);
      if (!b) throw ctx.erro(404, "NAO_ENCONTRADO", "Mídia não encontrada.");
      if (b.tipo !== "image/jpeg" && b.tipo !== "video/mp4") throw ctx.erro(400, "TIPO_INVALIDO", "O Instagram só aceita imagem JPEG e vídeo MP4. Escolha outra mídia.");
      if (lista.length >= 10) throw ctx.erro(400, "MUITAS_MIDIAS", "Um post aceita no máximo 10 mídias.");
      const nova: Midia = { id: ctx.id("mid"), nome: b.nome, tipo: b.tipo, uso: b.uso, tamanho: b.tamanho, ordem: lista.length, previa: b.previa };
      lista.push(nova);
      sincronizar();
      return nova;
    }
    if (metodo === "POST" && !m![2]) {
      const nome = q.get("nome") ?? "arquivo.jpg";
      if (!/\.(jpe?g|mp4)$/i.test(nome)) throw ctx.erro(400, "TIPO_INVALIDO", "Tipo de arquivo não permitido.");
      const video = /\.mp4$/i.test(nome);
      if (lista.length >= 10) throw ctx.erro(400, "MUITAS_MIDIAS", "Um post aceita no máximo 10 mídias.");
      const nova: Midia = { id: ctx.id("mid"), nome, tipo: video ? "video/mp4" : "image/jpeg", uso: video ? "VIDEO" : "IMAGEM", tamanho: 1_000_000, ordem: lista.length, previa: placeholder("#0069ad", nome) };
      lista.push(nova);
      sincronizar();
      return nova;
    }
    if (metodo === "DELETE" && m![2]) {
      const k = lista.findIndex((y) => y.id === m![2]);
      if (k < 0) throw ctx.erro(404, "NAO_ENCONTRADO", "Mídia não encontrada.");
      lista.splice(k, 1);
      sincronizar();
      return { ok: true };
    }
  }
  if (metodo === "POST" && r(/^\/api\/marketing\/conteudos\/([^/]+)\/(solicitar-aprovacao|aprovar|devolver|agendar|cancelar-agendamento)$/)) {
    gerir();
    const cont = conteudos.find((y) => y.id === m![1]);
    if (!cont) throw ctx.erro(404, "NAO_ENCONTRADO", "Conteúdo não encontrado.");
    const invalido = (msg: string) => ctx.erro(409, "SITUACAO_INVALIDA", msg);
    switch (m![2]) {
      case "solicitar-aprovacao":
        if (!["IDEIA", "PRODUCAO"].includes(cont.status)) throw invalido("Só ideias e rascunhos vão para aprovação.");
        cont.status = "EM_APROVACAO";
        break;
      case "aprovar":
        if (cont.status !== "EM_APROVACAO") throw invalido("Só posts “em aprovação” podem ser aprovados.");
        Object.assign(cont, { status: "APROVADO", aprovadoEm: ctx.agoraIso() });
        ctx.auditar("CONTEUDO_APROVADO", "conteudo", cont.id, {});
        break;
      case "devolver":
        if (!["EM_APROVACAO", "APROVADO", "AGENDADO"].includes(cont.status)) throw invalido("Este post não está em aprovação, aprovado nem agendado.");
        Object.assign(cont, { status: "PRODUCAO", aprovadoEm: null, pubStatus: null, pubErro: null, agendarEm: null });
        break;
      case "cancelar-agendamento":
        if (cont.status !== "AGENDADO") throw invalido("Este post não está agendado.");
        Object.assign(cont, { status: "APROVADO", pubStatus: null, pubErro: null, agendarEm: null });
        break;
      case "agendar": {
        if (cont.status !== "APROVADO" && !(cont.status === "AGENDADO" && cont.pubStatus === "FALHOU")) throw ctx.erro(409, "NAO_APROVADO", "Só é possível agendar um post aprovado. Envie para aprovação e aprove antes.");
        const lista = midias.get(cont.id) ?? [];
        const quando = new Date(String(c.agendarEm));
        const erros = validarAgendamento({ rede: cont.rede, tipo: c.tipoPost as TipoPostInstagram, legenda: cont.legenda, agendarEm: Number.isNaN(quando.getTime()) ? null : quando, midias: lista.map((x) => ({ uso: x.uso, tipo: x.tipo })) });
        if (erros.length) throw ctx.erro(400, "AGENDAMENTO_INVALIDO", erros.join(" "));
        Object.assign(cont, { status: "AGENDADO", tipoPost: c.tipoPost, agendarEm: quando.toISOString(), dataPrevista: quando.toISOString().slice(0, 10), pubStatus: "AGENDADO", pubErro: null });
        ctx.auditar("CONTEUDO_AGENDADO", "conteudo", cont.id, { tipoPost: ROTULO_TIPO_POST[c.tipoPost as TipoPostInstagram] });
        break;
      }
    }
    return { status: cont.status };
  }

  // ---------- Sugerir legenda ----------
  if (metodo === "POST" && caminho === "/api/marketing/legendas/sugerir") {
    gerir();
    if (String(c.briefing ?? "").trim().length < 3) throw ctx.erro(400, "DADOS_INVALIDOS", "Conte a ideia do post.");
    return { ligada: true, custoUsd: 0, opcoes: LEGENDAS_IA[String(c.idioma ?? "pt")] ?? LEGENDAS_IA.pt };
  }
  return NAO;
};
