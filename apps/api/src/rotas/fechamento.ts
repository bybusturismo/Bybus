import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../app.js";
import { mensagens, reservas } from "../db/schema.js";
import { filtroUnidade, garantirSaida } from "../seguranca/escopo.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { agoraSp, enviarMensagem, fecharLista, situacaoFechamento, textoListaGrupo } from "../servicos/fechamento.js";
import { carregarManifesto } from "../servicos/manifesto.js";
import { envioReal } from "../servicos/whatsapp.js";

const uuid = z.string().uuid();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function rotasFechamento(app: FastifyInstance, { db, config, cofre }: Contexto) {
  const decidir = { preHandler: exigir(config, "saidas:decidir") };

  /** Saídas de uma data (padrão: amanhã) com a situação da lista e das mensagens. */
  app.get("/api/fechamento", decidir, async (req) => {
    const q = z.object({ data: dataIso.optional() }).parse(req.query);
    const data = q.data ?? agoraSp().amanha;
    return {
      data,
      horaFechamento: config.FECHAMENTO_HORA,
      automatico: config.FECHAMENTO_AUTOMATICO,
      whatsapp: { provedor: config.WHATSAPP_PROVEDOR, envioReal: envioReal(config), grupoConfigurado: !!config.WHATSAPP_GRUPO_LISTA },
      saidas: await situacaoFechamento(db, data, filtroUnidade(req.usuario!)),
    };
  });

  /** Fecha agora (ou gera um adendo) e devolve o texto para o grupo. */
  app.post("/api/saidas/:id/fechar", { ...decidir, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await garantirSaida(db, req.usuario!, id);
    return fecharLista(db, cofre, config, id, { usuarioId: req.usuario!.id, automatico: false });
  });

  /** Texto atual da lista (mesmo formato do grupo), sem fechar. */
  app.get("/api/saidas/:id/texto-lista", { preHandler: exigir(config, "manifesto:ver") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await garantirSaida(db, req.usuario!, id);
    const { saida, passeio, manifesto } = await carregarManifesto(db, cofre, id, { documentosCompletos: false, mostrarContatos: false });
    const rs = await db.select({ id: reservas.id, pagamento: reservas.pagamento, origemCliente: reservas.origemCliente }).from(reservas).where(eq(reservas.saidaId, id));
    return { texto: textoListaGrupo(manifesto, { passeio: passeio.nome, data: saida.data, guia: saida.guia, motorista: saida.motorista, veiculo: saida.veiculo, versao: Math.max(1, saida.listaVersao) }, new Map(rs.map((r) => [r.id, r]))) };
  });

  /** Central de mensagens de uma saída (o texto só para quem vê contatos). */
  app.get("/api/mensagens", decidir, async (req) => {
    const q = z.object({ saidaId: uuid }).parse(req.query);
    await garantirSaida(db, req.usuario!, q.saidaId);
    const verContatos = pode(req.usuario!, "manifesto:contatos");
    const lista = await db.select({ m: mensagens, titular: reservas.contatoNome }).from(mensagens).leftJoin(reservas, eq(reservas.id, mensagens.reservaId))
      .where(eq(mensagens.saidaId, q.saidaId)).orderBy(desc(mensagens.criadoEm)).limit(500);
    return lista.map(({ m, titular }) => ({
      id: m.id, tipo: m.tipo, status: m.status, provedor: m.provedor, erro: m.erro, criadoEm: m.criadoEm, enviadaEm: m.enviadaEm,
      titular: titular ?? (m.tipo.startsWith("LISTA_GRUPO") ? "Grupo da lista" : null),
      destino: verContatos ? m.destino : m.destino ? `…${m.destino.slice(-4)}` : null,
      texto: verContatos ? m.texto : null,
    }));
  });

  app.post("/api/mensagens/:id/reenviar", decidir, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [m] = await db.select({ saidaId: mensagens.saidaId, status: mensagens.status }).from(mensagens).where(eq(mensagens.id, id));
    if (!m?.saidaId) throw new ErroHttp(404, "NAO_ENCONTRADO", "Mensagem não encontrada.");
    await garantirSaida(db, req.usuario!, m.saidaId);
    if (m.status === "ENVIADA") throw new ErroHttp(409, "JA_ENVIADA", "Esta mensagem já foi enviada.");
    await db.update(mensagens).set({ status: "PENDENTE", erro: null }).where(eq(mensagens.id, id));
    await enviarMensagem(db, config, id);
    return { ok: true };
  });
}
