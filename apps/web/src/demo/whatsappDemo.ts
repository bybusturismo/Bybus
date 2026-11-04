/** WhatsApp da demonstração: 6 conversas fictícias (trocas nos dois sentidos, automáticas da fila e resposta em memória). Nada sai de verdade. */
import { textoConfirmacao } from "@bybus/core";
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
}

interface Msg { id: string; direcao: "ENTRADA" | "SAIDA"; texto: string | null; tipo: "TEXTO" | "IMAGEM" | "AUDIO" | "DOCUMENTO" | "OUTRO"; status: string; criadoEm: string; automatica: boolean; tipoFila: string | null; enviadaPor: string | null }
interface Conv { id: string; telefone: string; chave: string; nome: string | null; unidadeId: string | null; naoLidas: number; mensagens: Msg[] }

const UN_FLN = "un-fln";
const LIMITE = 4096;
const MODO = { provedor: "simulado", envioReal: false, simulado: true, avisosLigados: true, conexao: null };

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
    const c: Conv = { id: idConv(), telefone, chave: chaveDe(telefone), nome, unidadeId, naoLidas: 0, mensagens: [] };
    conversas.push(c);
    return c;
  }
  function msg(c: Conv, minutosAtras: number, direcao: Msg["direcao"], texto: string | null, extra: Partial<Msg> = {}) {
    c.mensagens.push({
      id: idMsg(), direcao, texto, tipo: "TEXTO", status: direcao === "ENTRADA" ? "RECEBIDA" : "LIDA",
      criadoEm: new Date(Date.now() - minutosAtras * 60_000).toISOString(), automatica: false, tipoFila: null, enviadaPor: null, ...extra,
    });
  }
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
        .filter((x) => !busca || semAcento(x.nome ?? "").includes(busca) || (dig.length >= 3 && x.telefone.includes(dig)))
        .sort((a, b) => Date.parse(ultima(b)?.criadoEm ?? "0") - Date.parse(ultima(a)?.criadoEm ?? "0"))
        .slice(0, Number(q.get("limite") ?? 100))
        .map((x) => {
          const u = ultima(x);
          return { id: x.id, telefone: x.telefone, nome: x.nome, naoLidas: x.naoLidas, ultimaMensagemEm: u?.criadoEm ?? null, unidadeId: x.unidadeId, unidadeCodigo: x.unidadeId ? "FLN" : null,
            previa: u?.texto?.slice(0, 140) ?? null, previaTipo: u?.tipo ?? null, previaDirecao: u?.direcao ?? null };
        });
      return { modo: MODO, naoLidasTotal: visiveis.reduce((s, x) => s + x.naoLidas, 0), conversas: lista };
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
      return { id: conv.id, telefone: conv.telefone, nome: conv.nome, naoLidas: conv.naoLidas, unidadeId: conv.unidadeId, modo: MODO, reservas };
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
    return NAO;
  };

  return { rotear, registrarFila, preparar: semear };
}
