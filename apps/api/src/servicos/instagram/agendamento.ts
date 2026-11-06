import { proximaExecucao } from "@bybus/core";
import type { Config } from "../../config.js";
import type { Db } from "../../db/cliente.js";
import { sincronizarInstagram } from "./dados.js";
import { publicarPendentes } from "./publicacao.js";

type Log = { error: (o: unknown, m: string) => void; info: (o: unknown, m: string) => void };
export const HORA_SINCRONIZACAO_INSTAGRAM = "05:30";

/**
 * Relógios do Instagram: (1) a cada minuto publica os posts agendados que venceram; (2) uma vez por dia (05:30, America/Sao_Paulo)
 * lê métricas e posts. Desligados em testes (os testes chamam as funções direto). Devolve a função que desliga os relógios.
 */
export function agendarInstagram(db: Db, config: Config, log: Log): () => void {
  if (config.AMBIENTE === "testes") return () => {};
  let rodando = false;
  const publicar = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const r = await publicarPendentes(db, config);
      if (r.simuladas || r.publicadas || r.falhas || r.interrompidas) log.info(r, "Publicações do Instagram");
    } catch (e) {
      log.error({ erro: e instanceof Error ? e.name : "erro" }, "Falha na rotina de publicação do Instagram");
    } finally { rodando = false; }
  };
  const intervalo = setInterval(() => { void publicar(); }, 60_000);
  let timer: NodeJS.Timeout | undefined;
  let parado = false;
  const agendarDiaria = () => {
    if (parado) return;
    const alvo = proximaExecucao(new Date(), HORA_SINCRONIZACAO_INSTAGRAM);
    timer = setTimeout(async () => {
      try {
        const r = await sincronizarInstagram(db, config);
        if (r.executou) log.info({ dias: r.dias, posts: r.posts, falhas: r.falhas.length }, "Dados do Instagram atualizados");
      } catch (e) {
        log.error({ erro: e instanceof Error ? e.name : "erro" }, "Falha na leitura diária do Instagram");
      } finally { agendarDiaria(); }
    }, Math.max(1000, alvo.getTime() - Date.now()));
  };
  agendarDiaria();
  return () => { parado = true; clearInterval(intervalo); if (timer) clearTimeout(timer); };
}
