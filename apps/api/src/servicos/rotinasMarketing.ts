import { relatoriosDevidos } from "@bybus/core";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { gerarRelatorios } from "./relatoriosMarketing.js";
import { rodarMensagensAutomaticas } from "./mensagensAuto.js";
import { horaSp, hojeSp } from "./marketingComum.js";
import { sincronizarSeDevido } from "./avaliacoesOnline.js";
import { Cofre } from "../seguranca/cripto.js";

type Log = { error: (o: unknown, m: string) => void; info: (o: unknown, m: string) => void };

/** Uma passada das rotinas do marketing (separada do relógio para ser testável). Relatórios: segunda 07h (semanal) e dia 1 (mensal), sem repetir. */
export async function rodarRotinasMarketing(db: Db, config: Config, log: Log, agora = new Date()) {
  const r = await rodarMensagensAutomaticas(db, config, agora);
  if (r.compra || r.posPasseio || r.avaliacoesEnviadas || r.pedidosCriados) log.info(r, "Mensagens automáticas do marketing");
  const gerados: string[] = [];
  for (const tipo of relatoriosDevidos(hojeSp(agora), horaSp(agora))) {
    const ids = await gerarRelatorios(db, config, tipo, hojeSp(agora));
    if (ids.length) { gerados.push(tipo); log.info({ tipo, relatorios: ids.length }, "Relatório de marketing gerado"); }
  }
  // Avaliações do Google e do Tripadvisor: uma leitura por dia, a partir das 7h (18/11/2026)
  const avaliacoes = await sincronizarSeDevido(db, config, new Cofre(config.CHAVE_CRIPTOGRAFIA), horaSp(agora)).catch((e) => { log.error({ erro: e instanceof Error ? e.message : e }, "Falha ao ler avaliações"); return null; });
  if (avaliacoes) log.info({ resultados: avaliacoes.resultados.map((x) => ({ canal: x.canal, ok: x.ok, novas: x.novas ?? 0 })) }, "Avaliações do Google/Tripadvisor lidas");
  return { ...r, relatorios: gerados, avaliacoes: !!avaliacoes };
}

/** Relógio do marketing: confere a cada minuto (desligado em testes). Se o servidor ficou fora às 07h, recupera no mesmo dia. */
export function agendarMarketing(db: Db, config: Config, log: Log): () => void {
  if (config.AMBIENTE === "testes") return () => {};
  let rodando = false;
  const rodar = async () => {
    if (rodando) return;
    rodando = true;
    try { await rodarRotinasMarketing(db, config, log); }
    catch (e) { log.error({ erro: e instanceof Error ? e.message : e }, "Falha nas rotinas do marketing"); }
    finally { rodando = false; }
  };
  const intervalo = setInterval(rodar, 60_000);
  return () => clearInterval(intervalo);
}
