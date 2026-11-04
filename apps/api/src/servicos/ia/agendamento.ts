import { dataSaoPaulo, proximaExecucao } from "@bybus/core";
import type { Config } from "../../config.js";
import type { Db } from "../../db/cliente.js";
import { automaticaDoDia, avaliacaoEmAndamento, iniciarAvaliacao, processarAvaliacao, type Log } from "./avaliacao.js";
import { iaConfigurada } from "./cliente.js";

/** Uma execução da rotina diária (separada do relógio para ser testável). Não repete a automática do mesmo dia. */
export async function rodarAvaliacaoDiaria(db: Db, config: Config, log: Log, agora = new Date()): Promise<string | null> {
  if (!iaConfigurada(config)) return null;
  if (await automaticaDoDia(db, dataSaoPaulo(agora))) return null;
  if (await avaliacaoEmAndamento(db)) return null;
  const id = await iniciarAvaliacao(db, config, "AUTOMATICA", null);
  await processarAvaliacao(db, config, id, log);
  return id;
}

/**
 * Avaliação diária dos gestores de IA às 6h30 (IA_AVALIACAO_HORARIO, America/Sao_Paulo), no mesmo padrão de `agendarPaytour`.
 * Desligada sem chave da IA, com IA_AVALIACAO_DIARIA=false ou em testes. Devolve a função que desliga o relógio.
 * Se o servidor estiver fora do ar no horário, não recupera o dia perdido: use "Rodar agora".
 */
export function agendarAvaliacaoIa(db: Db, config: Config, log: Log): () => void {
  if (config.AMBIENTE === "testes" || !config.IA_AVALIACAO_DIARIA || !config.ANTHROPIC_API_KEY) return () => {};
  let timer: NodeJS.Timeout | undefined;
  let parado = false;
  const agendar = () => {
    if (parado) return;
    const alvo = proximaExecucao(new Date(), config.IA_AVALIACAO_HORARIO);
    // setTimeout aceita no máximo ~24,8 dias; o intervalo aqui é de no máximo 24h.
    timer = setTimeout(async () => {
      try {
        await rodarAvaliacaoDiaria(db, config, log);
      } catch (e) {
        log.error({ erro: e instanceof Error ? e.message : e }, "Falha na rotina diária dos gestores de IA");
      } finally {
        agendar();
      }
    }, Math.max(1000, alvo.getTime() - Date.now()));
    log.info({ proxima: alvo.toISOString() }, "Próxima avaliação dos gestores de IA agendada");
  };
  agendar();
  return () => {
    parado = true;
    if (timer) clearTimeout(timer);
  };
}
