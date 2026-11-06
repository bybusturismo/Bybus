/** WhatsApp da demonstração: 6 conversas fictícias (trocas nos dois sentidos, automáticas da fila e resposta em memória). Nada sai de verdade. */
import { aplicarVariaveis, ETIQUETAS_CONVERSA, IDIOMAS_RESPOSTA, normalizarAtalho, RESPOSTAS_INICIAIS, textoConfirmacao } from "@bybus/core";
import { NAO, semAcento, type Rotear } from "./comum";

export interface ReservaDemoWa { id: string; saidaId: string; canal: string; contatoNome: string; contatoTelefone: string | null; status: string }
export interface SaidaDemoWa { data: string; passeio: string; unidadeId: string }
export interface DepsWhatsapp {
  podeUnidade(unidadeId: string | null): boolean;
  usuarioNome(): string;
  /** Reservas vivas da demonstração (os telefones de algumas são trocados para casar com as conversas). */
  reservas(): ReservaDemoWa[];
  saida(saidaId: string): SaidaDemoWa | undefined;
  passageiros(reservaId: string): number;
  /** Quem está logado (para "minhas conversas") e os colegas que podem atender. */
  usuarioId(): string;
  /** Ponto de embarque da reserva (para as variáveis das respostas prontas). */
  ponto(reservaId: string): { nome: string; horario: string } | null;
}

interface Msg { id: string; direcao: "ENTRADA" | "SAIDA"; texto: string | null; tipo: "TEXTO" | "IMAGEM" | "AUDIO" | "DOCUMENTO" | "OUTRO"; status: string; criadoEm: string; automatica: boolean; tipoFila: string | null; enviadaPor: string | null }
interface Conv { id: string; canal: "WHATSAPP" | "INSTAGRAM"; telefone: string; chave: string; nome: string | null; unidadeId: string | null; naoLidas: number; mensagens: Msg[]; etiquetas: string[]; atendenteId: string | null }
interface Resp { id: string; atalho: string; titulo: string; idioma: string; texto: string; revisada: boolean }

const UN_FLN = "un-fln";
const LIMITE = 4096;
const MODO = { provedor: "simulado", envioReal: false, simulado: true, avisosLigados: true, conexao: null, instagram: { conectado: true, real: false, simulado: true, avisosLigados: true } };
/** Marca "quem está logado" nos dados iniciais (o login acontece depois do carregamento da demonstração). */
const EU = "@eu";
const ATENDENTES_DEMO = [{ id: "at-1", nome: "Atendente Demo" }, { id: "at-2", nome: "Supervisora Demo" }];

const digitos = (t: string) => t.replace(/\D/g, "");
function normalizar(t: string): string | null {
  let d = digitos(t);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
}
const chaveDe = (tel: string) => (/^55\d{10,11}$/.test(tel) ? `55${tel.slice(2, 4)}${tel.slice(-8)}` : tel);
const ultima = (c: Conv) => c.mensagens[c.mensagens.length - 1];

export function criarWhatsappDemo(dep: DepsWhatsapp): { rotear: Rotear; registrarFila: (m: { telefone: string; texto: string; tipo: string }) => void; preparar: () => void } {
  const conversas: Conv[] = [];
  let semeado = false;
  let seq = 1;
  const idMsg = () => `wam-${seq++}`;
  const idConv = () => `wac-${seq++}`;

  function achar(chave: string): Conv | undefined {
    return conversas.find((c) => c.chave === chave);
  }
  function criar(telefone: string, nome: string | null, unidadeId: string | null): Conv {
    const c: Conv = { id: idConv(), canal: "WHATSAPP", telefone, chave: chaveDe(telefone), nome, unidadeId, naoLidas: 0, mensagens: [], etiquetas: [], atendenteId: null };
    conversas.push(c);
    return c;
  }
  function msg(c: Conv, minutosAtras: number, direcao: Msg["direcao"], texto: string | null, extra: Partial<Msg> = {}) {
    c.mensagens.push({
      id: idMsg(), direcao, texto, tipo: "TEXTO", status: direcao === "ENTRADA" ? "RECEBIDA" : "LIDA",
      criadoEm: new Date(Date.now() - minutosAtras * 60_000).toISOString(), automatica: false, tipoFila: null, enviadaPor: null, ...extra,
    });
  }
  const criarIg = (usuario: string, id: string): Conv => {
    const c: Conv = { id: idConv(), canal: "INSTAGRAM", telefone: `ig:${id}`, chave: `ig:${id}`, nome: usuario, unidadeId: null, naoLidas: 0, mensagens: [], etiquetas: [], atendenteId: null };
    conversas.push(c);
    return c;
  };
  const respostas: Resp[] = [];
  const dono = (c: Conv) => (c.atendenteId === EU ? dep.usuarioId() : c.atendenteId);
  /** Janela de 24 h do Direct, contada da última mensagem do cliente (mesma regra da API). */
  const janelaDe = (c: Conv) => {
    if (c.canal !== "INSTAGRAM") return null;
    const ultimaEntrada = [...c.mensagens].reverse().find((m) => m.direcao === "ENTRADA");
    const expira = ultimaEntrada ? Date.parse(ultimaEntrada.criadoEm) + 24 * 3_600_000 : 0;
    return { aberta: expira > Date.now(), expiraEm: expira ? new Date(expira).toISOString() : null, minutosRestantes: Math.max(0, Math.floor((expira - Date.now()) / 60_000)) };
  };
  const reservasDe = (c: Conv) => dep.reservas().filter((r) => r.status === "CONFIRMADA" && r.contatoTelefone && chaveDe(normalizar(r.contatoTelefone) ?? "") === c.chave);

  function semear() {
    if (semeado) return;
    semeado = true;
    const atendente = "Atendente Demo";
    const supervisora = "Supervisora Demo";
    const todas = dep.reservas();
    // Reserva (não estrangeira) de uma saída da demonstração, para ligar a conversa; o telefone dela passa a ser o da conversa.
    const reservaDa = (saidaId: string, tel: string) => {
      const r = todas.find((x) => x.saidaId === saidaId && x.canal !== "VIATOR" && x.status === "CONFIRMADA" && !conversas.some((c) => c.chave === chaveDe(tel)));
      if (!r) return null;
      r.contatoTelefone = `+${tel.slice(0, 2)} ${tel.slice(2, 4)} ${tel.slice(4, 9)}-${tel.slice(9)}`;
      return r;
    };
    const primeiro = (r: ReservaDemoWa | null) => r?.contatoNome.split(" ")[0] ?? "";
    const confirmacao = (r: ReservaDemoWa | null) => {
      const s = r ? dep.saida(r.saidaId) : undefined;
      return textoConfirmacao({ primeiroNome: primeiro(r), passeio: s?.passeio ?? "City Tour Toda Ilha", data: s?.data ?? "2026-11-05", ponto: null, linkEmbarque: null });
    };

    // 1. Minas Gerais — ponto de embarque e chuva (reserva de amanhã)
    const t1 = "5531900004101";
    const r1 = reservaDa("saida-1", t1);
    const c1 = criar(t1, primeiro(r1) || "Turista MG", r1 ? UN_FLN : null);
    msg(c1, 1180, "SAIDA", confirmacao(r1), { automatica: true, tipoFila: "CONFIRMACAO", status: "SIMULADA" });
    msg(c1, 1150, "ENTRADA", "Boa noite! Estamos no Hotel Fictício Praia, em Canasvieiras. Qual é o ponto de embarque mais perto?");
    msg(c1, 1140, "SAIDA", "Boa noite! O ponto mais próximo fica na avenida principal de Canasvieiras. Vou conferir o horário exato e já confirmo por aqui.", { enviadaPor: atendente });
    msg(c1, 45, "ENTRADA", "Pode confirmar sim, obrigada! E se chover amanhã, o passeio acontece mesmo assim?");
    c1.naoLidas = 1;

    // 2. São Paulo — criança paga? (reserva de depois de amanhã)
    const t2 = "5511900004102";
    const r2 = reservaDa("saida-2", t2);
    const c2 = criar(t2, primeiro(r2) || "Turista SP", r2 ? UN_FLN : null);
    msg(c2, 130, "ENTRADA", "Oi, tudo bem? Fiz a reserva pelo site. Criança de 5 anos paga?");
    msg(c2, 128, "ENTRADA", "Somos 2 adultos e 1 criança.");
    c2.naoLidas = 2;

    // 3. Rio Grande do Sul — pergunta de venda (sem reserva)
    const c3 = criar("5551900004103", "Família Demonstração", null);
    msg(c3, 1500, "ENTRADA", "Boa tarde! Vocês têm saída no sábado para 4 pessoas? Qual o valor?");
    msg(c3, 1490, "SAIDA", "Boa tarde! Temos saída no sábado, às 8h. Os valores desta demonstração são fictícios; no sistema real a atendente informa a tarifa vigente.", { enviadaPor: atendente });
    msg(c3, 1470, "ENTRADA", "Perfeito, vou falar com a família e já aviso!");

    // 4. Argentina — pergunta em espanhol e áudio (sem reserva)
    const c4 = criar("5491155550004", "Lucía Prueba", null);
    msg(c4, 25, "ENTRADA", "Hola! ¿A qué hora sale el city tour? ¿Se puede pagar con pesos argentinos?");
    msg(c4, 24, "ENTRADA", null, { tipo: "AUDIO" });
    c4.naoLidas = 2;

    // 5. São Paulo — voucher (reserva daqui a 3 dias)
    const t5 = "5511900004105";
    const r5 = reservaDa("saida-3", t5);
    const c5 = criar(t5, primeiro(r5) || "Turista SP", r5 ? UN_FLN : null);
    msg(c5, 2900, "SAIDA", "Seu voucher do City Tour Toda Ilha: https://gestao.exemplo.test/voucher/DEMO (endereço de demonstração).", { automatica: true, tipoFila: "VOUCHER", status: "LIDA" });
    msg(c5, 2880, "ENTRADA", "Recebi, obrigada! Posso levar o voucher só no celular?");
    msg(c5, 2860, "SAIDA", "Pode sim, basta mostrar ao guia no embarque.", { enviadaPor: supervisora });

    // 6. Minas Gerais — dia do passeio: foto, rastreio e resposta que falhou (reserva de hoje)
    const t6 = "5531900004106";
    const r6 = reservaDa("saida-0", t6);
    const c6 = criar(t6, primeiro(r6) || "Turista MG", r6 ? UN_FLN : null);
    msg(c6, 50, "SAIDA", "O ônibus saiu do primeiro ponto. Acompanhe em: https://gestao.exemplo.test/rastreio/DEMO (endereço de demonstração).", { automatica: true, tipoFila: "RASTREIO", status: "SIMULADA" });
    msg(c6, 20, "ENTRADA", "Estamos aqui na frente do hotel, é neste ponto?", { tipo: "IMAGEM" });
    msg(c6, 19, "ENTRADA", "O ônibus já passou?");
    msg(c6, 15, "SAIDA", "Fiquem no ponto, o ônibus chega em 5 minutos.", { enviadaPor: atendente, status: "FALHA" });
    c6.naoLidas = 2;

    // Etiquetas e atendentes (c1 e c6 ficam com quem está logado: contador "Minhas conversas")
    const eu = EU;
    c1.etiquetas = ["DUVIDA"]; c1.atendenteId = eu;
    c2.etiquetas = ["DUVIDA"];
    c3.etiquetas = ["ORCAMENTO"]; c3.atendenteId = "at-1";
    c5.etiquetas = ["POS_VENDA"]; c5.atendenteId = "at-2";
    c6.etiquetas = ["DUVIDA"]; c6.atendenteId = eu;

    // Instagram (Direct): dentro da janela de 24 h, já respondida e com a janela encerrada
    const i1 = criarIg("viajante_ficticio", "9000000000101");
    msg(i1, 35, "ENTRADA", "Oi! Vocês têm saída amanhã de Balneário Camboriú? Somos em 4.");
    i1.naoLidas = 1; i1.etiquetas = ["ORCAMENTO"]; i1.atendenteId = eu;
    const i2 = criarIg("familia.demo", "9000000000102");
    msg(i2, 300, "ENTRADA", "Adoramos o passeio de ontem! Dá para pedir a foto do grupo?");
    msg(i2, 280, "SAIDA", "Que bom saber! Vamos procurar e enviamos por aqui.", { enviadaPor: supervisora });
    msg(i2, 150, "ENTRADA", "Obrigada! Aguardamos.");
    i2.etiquetas = ["POS_VENDA"]; i2.atendenteId = "at-2";
    const i3 = criarIg("english_visitor_demo", "9000000000103");
    msg(i3, 26 * 60, "ENTRADA", "Hi! What time does the pickup start at the hotel? Thanks");
    msg(i3, 25 * 60 + 30, "SAIDA", "Hello! Pickups start at 8:00. Let us know your hotel.", { enviadaPor: atendente });
    i3.etiquetas = ["DUVIDA"];

    // Respostas prontas: as sugestões iniciais, ainda "a revisar"
    for (const r of RESPOSTAS_INICIAIS) respostas.push({ id: `rp-${seq++}`, ...r, revisada: false });
  }

  /** Mensagem automática da fila (ex.: confirmação ao fechar a lista) → conversa do destinatário. */
  function registrarFila(m: { telefone: string; texto: string; tipo: string }) {
    semear();
    const tel = normalizar(m.telefone);
    if (!tel) return;
    const r = dep.reservas().find((x) => x.contatoTelefone && normalizar(x.contatoTelefone) === tel);
    const c = achar(chaveDe(tel)) ?? criar(tel, r?.contatoNome ?? null, r ? dep.saida(r.saidaId)?.unidadeId ?? null : null);
    msg(c, 0, "SAIDA", m.texto, { automatica: true, tipoFila: m.tipo, status: "SIMULADA" });
  }

  const visivel = (c: Conv) => c.unidadeId === null || dep.podeUnidade(c.unidadeId);
  const conversaDoUsuario = (ctx: Parameters<Rotear>[0], id: string) => {
    const c = conversas.find((x) => x.id === id);
    if (!c || !visivel(c)) throw ctx.erro(404, "NAO_ENCONTRADO", "Conversa não encontrada.");
    return c;
  };
  const texto = (ctx: Parameters<Rotear>[0], t: unknown) => {
    const v = typeof t === "string" ? t.trim() : "";
    if (!v) throw ctx.erro(400, "DADOS_INVALIDOS", "Escreva a mensagem.");
    if (v.length > LIMITE) throw ctx.erro(400, "DADOS_INVALIDOS", "A mensagem pode ter até 4.096 caracteres.");
    return v;
  };
  function responder(ctx: Parameters<Rotear>[0], c: Conv, t: string) {
    const j = janelaDe(c);
    if (j && !j.aberta) throw ctx.erro(409, "JANELA_24H_FECHADA", "Já se passaram mais de 24 horas desde a última mensagem do cliente: o Instagram não permite responder por aqui.");
    const m: Msg = { id: idMsg(), direcao: "SAIDA", texto: t, tipo: "TEXTO", status: "SIMULADA", criadoEm: new Date().toISOString(), automatica: false, tipoFila: null, enviadaPor: dep.usuarioNome() };
    c.mensagens.push(m);
    c.naoLidas = 0;
    ctx.auditar("whatsapp.responder", "wa_conversa", c.id, { conversaId: c.id });
    return { id: m.id, status: "SIMULADA", erro: null };
  }

  const rotear: Rotear = (ctx, metodo, caminho, q, c) => {
    if (!caminho.startsWith("/api/whatsapp/")) return NAO;
    semear();
    let m: RegExpMatchArray | null;
    const r = (re: RegExp) => (m = caminho.match(re));

    if (metodo === "GET" && caminho === "/api/whatsapp/conversas") {
      ctx.exigir("whatsapp:ver");
      const busca = semAcento((q.get("busca") ?? "").trim());
      const dig = digitos(busca);
      const visiveis = conversas.filter(visivel);
      const lista = visiveis
        .filter((x) => !q.get("naoLidas") || x.naoLidas > 0)
        .filter((x) => !q.get("canal") || x.canal === q.get("canal"))
        .filter((x) => !q.get("etiqueta") || x.etiquetas.includes(q.get("etiqueta")!))
        .filter((x) => q.get("atendente") !== "eu" || dono(x) === dep.usuarioId())
        .filter((x) => q.get("atendente") !== "sem" || x.atendenteId === null)
        .filter((x) => !busca || semAcento(x.nome ?? "").includes(busca) || (dig.length >= 3 && x.telefone.includes(dig)))
        .sort((a, b) => Date.parse(ultima(b)?.criadoEm ?? "0") - Date.parse(ultima(a)?.criadoEm ?? "0"))
        .slice(0, Number(q.get("limite") ?? 100))
        .map((x) => {
          const u = ultima(x);
          const at = [...ATENDENTES_DEMO, { id: dep.usuarioId(), nome: dep.usuarioNome() }].find((a) => a.id === dono(x));
          return { id: x.id, canal: x.canal, etiquetas: x.etiquetas, atendenteId: dono(x), atendenteNome: at?.nome ?? null, telefone: x.telefone, nome: x.nome, naoLidas: x.naoLidas, ultimaMensagemEm: u?.criadoEm ?? null, unidadeId: x.unidadeId, unidadeCodigo: x.unidadeId ? "FLN" : null,
            previa: u?.texto?.slice(0, 140) ?? null, previaTipo: u?.tipo ?? null, previaDirecao: u?.direcao ?? null };
        });
      const porCanal: Record<string, number> = {};
      for (const x of visiveis) porCanal[x.canal] = (porCanal[x.canal] ?? 0) + x.naoLidas;
      return { modo: MODO, naoLidasTotal: visiveis.reduce((s, x) => s + x.naoLidas, 0), naoLidasPorCanal: porCanal, minhasConversas: visiveis.filter((x) => dono(x) === dep.usuarioId()).length, conversas: lista };
    }
    if (metodo === "POST" && caminho === "/api/whatsapp/conversas") {
      ctx.exigir("whatsapp:responder");
      ctx.exigir("whatsapp:ver");
      const tel = normalizar(String(c.telefone ?? ""));
      if (!tel) throw ctx.erro(400, "TELEFONE_INVALIDO", "Telefone inválido. Use DDD + número (ex.: 48 99999-0000) ou com o código do país.");
      const t = c.texto ? texto(ctx, c.texto) : null;
      const reserva = dep.reservas().find((x) => x.contatoTelefone && chaveDe(normalizar(x.contatoTelefone) ?? "") === chaveDe(tel));
      const conv = achar(chaveDe(tel)) ?? criar(tel, reserva?.contatoNome ?? null, reserva ? dep.saida(reserva.saidaId)?.unidadeId ?? null : null);
      if (!visivel(conv)) throw ctx.erro(404, "NAO_ENCONTRADO", "Conversa não encontrada.");
      ctx.auditar("whatsapp.nova_conversa", "wa_conversa", conv.id, { conversaId: conv.id });
      return { id: conv.id, envio: t ? responder(ctx, conv, t) : null };
    }
    if (metodo === "GET" && r(/^\/api\/whatsapp\/conversas\/([^/]+)$/)) {
      ctx.exigir("whatsapp:ver");
      const conv = conversaDoUsuario(ctx, m![1]!);
      const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
      const reservas = reservasDe(conv).flatMap((x) => {
        const s = dep.saida(x.saidaId);
        return s && dep.podeUnidade(s.unidadeId) ? [{ reservaId: x.id, saidaId: x.saidaId, data: s.data, passeio: s.passeio, titular: x.contatoNome, canal: x.canal, passageiros: dep.passageiros(x.id), proxima: s.data >= hoje }] : [];
      });
      const alvo = reservasDe(conv).map((x) => ({ x, s: dep.saida(x.saidaId) })).filter((y): y is { x: ReservaDemoWa; s: SaidaDemoWa } => !!y.s).sort((a, b) => (a.s.data >= hoje ? 0 : 1) - (b.s.data >= hoje ? 0 : 1) || a.s.data.localeCompare(b.s.data))[0];
      const ponto = alvo ? dep.ponto(alvo.x.id) : null;
      const variaveis = { nome: (conv.nome ?? alvo?.x.contatoNome ?? "").split(" ")[0] || null, passeio: alvo?.s.passeio ?? null, data: alvo ? alvo.s.data.split("-").reverse().join("/") : null, ponto: ponto?.nome ?? null, horario: ponto?.horario ?? null };
      return { id: conv.id, canal: conv.canal, telefone: conv.telefone, nome: conv.nome, naoLidas: conv.naoLidas, unidadeId: conv.unidadeId, modo: MODO, reservas, etiquetas: conv.etiquetas, atendenteId: dono(conv), janela: janelaDe(conv), variaveis };
    }
    if (metodo === "GET" && r(/^\/api\/whatsapp\/conversas\/([^/]+)\/mensagens$/)) {
      ctx.exigir("whatsapp:ver");
      const conv = conversaDoUsuario(ctx, m![1]!);
      const limite = Math.min(100, Number(q.get("limite") ?? 50));
      const antes = q.get("antes");
      const todas = [...conv.mensagens].reverse().filter((x) => !antes || x.criadoEm < antes);
      return { itens: todas.slice(0, limite), temMais: todas.length > limite };
    }
    if (metodo === "POST" && r(/^\/api\/whatsapp\/conversas\/([^/]+)\/lida$/)) {
      ctx.exigir("whatsapp:ver");
      conversaDoUsuario(ctx, m![1]!).naoLidas = 0;
      return { ok: true };
    }
    if (metodo === "POST" && r(/^\/api\/whatsapp\/conversas\/([^/]+)\/responder$/)) {
      ctx.exigir("whatsapp:responder");
      ctx.exigir("whatsapp:ver");
      const conv = conversaDoUsuario(ctx, m![1]!);
      return responder(ctx, conv, texto(ctx, c.texto));
    }
    if (metodo === "PUT" && r(/^\/api\/whatsapp\/conversas\/([^/]+)\/etiquetas$/)) {
      ctx.exigir("whatsapp:responder");
      const conv = conversaDoUsuario(ctx, m![1]!);
      const lista: unknown[] = Array.isArray(c.etiquetas) ? c.etiquetas : [];
      if (!lista.every((e) => (ETIQUETAS_CONVERSA as readonly string[]).includes(String(e)))) throw ctx.erro(400, "DADOS_INVALIDOS", "Etiqueta inválida.");
      conv.etiquetas = [...new Set(lista.map(String))];
      return { etiquetas: conv.etiquetas };
    }
    if (metodo === "POST" && r(/^\/api\/whatsapp\/conversas\/([^/]+)\/atribuir$/)) {
      ctx.exigir("whatsapp:responder");
      const conv = conversaDoUsuario(ctx, m![1]!);
      conv.atendenteId = typeof c.usuarioId === "string" ? c.usuarioId : null;
      return { atendenteId: conv.atendenteId };
    }
    if (metodo === "GET" && caminho === "/api/whatsapp/atendentes") {
      ctx.exigir("whatsapp:ver");
      return [{ id: dep.usuarioId(), nome: dep.usuarioNome() }, ...ATENDENTES_DEMO];
    }
    if (metodo === "GET" && caminho === "/api/whatsapp/respostas-rapidas") {
      ctx.exigir("whatsapp:ver");
      return respostas.filter((x) => !q.get("idioma") || x.idioma === q.get("idioma")).sort((a, b) => a.atalho.localeCompare(b.atalho) || a.idioma.localeCompare(b.idioma));
    }
    if (metodo === "POST" && caminho === "/api/whatsapp/respostas-rapidas/sugestoes") {
      ctx.exigir("whatsapp:responder");
      let criadas = 0;
      for (const x of RESPOSTAS_INICIAIS) if (!respostas.some((y) => y.atalho === x.atalho && y.idioma === x.idioma)) { respostas.push({ id: `rp-${seq++}`, ...x, revisada: false }); criadas++; }
      return { criadas };
    }
    if (metodo === "POST" && caminho === "/api/whatsapp/respostas-rapidas") {
      ctx.exigir("whatsapp:responder");
      const atalho = normalizarAtalho(String(c.atalho ?? ""));
      const idioma = String(c.idioma ?? "PT");
      if (!atalho || !(IDIOMAS_RESPOSTA as readonly string[]).includes(idioma) || !String(c.texto ?? "").trim() || !String(c.titulo ?? "").trim()) throw ctx.erro(400, "DADOS_INVALIDOS", "Preencha atalho, título e texto.");
      if (respostas.some((y) => y.atalho === atalho && y.idioma === idioma)) throw ctx.erro(409, "ATALHO_REPETIDO", "Já existe uma resposta com esse atalho nesse idioma.");
      const nova: Resp = { id: `rp-${seq++}`, atalho, titulo: String(c.titulo).trim(), idioma, texto: String(c.texto).trim(), revisada: true };
      respostas.push(nova);
      return nova;
    }
    if (r(/^\/api\/whatsapp\/respostas-rapidas\/([^/]+)$/)) {
      ctx.exigir("whatsapp:responder");
      const x = respostas.find((y) => y.id === m![1]);
      if (!x) throw ctx.erro(404, "NAO_ENCONTRADO", "Resposta não encontrada.");
      if (metodo === "DELETE") { respostas.splice(respostas.indexOf(x), 1); return { ok: true }; }
      if (metodo === "PATCH") {
        for (const k of ["titulo", "texto", "idioma", "revisada"] as const) if (k in c) (x as unknown as Record<string, unknown>)[k] = c[k];
        if ("atalho" in c) x.atalho = normalizarAtalho(String(c.atalho));
        if ("texto" in c && !("revisada" in c)) x.revisada = true;
        return x;
      }
    }
    if (metodo === "POST" && r(/^\/api\/whatsapp\/conversas\/([^/]+)\/aplicar-resposta$/)) {
      ctx.exigir("whatsapp:ver");
      const conv = conversaDoUsuario(ctx, m![1]!);
      const x = respostas.find((y) => y.id === c.respostaId);
      if (!x) throw ctx.erro(404, "NAO_ENCONTRADO", "Resposta não encontrada.");
      return aplicarVariaveis(x.texto, { nome: (conv.nome ?? "").split(" ")[0] });
    }
    return NAO;
  };

  return { rotear, registrarFila, preparar: semear };
}
