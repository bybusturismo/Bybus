import { dataSaoPaulo } from "@bybus/core";
import type { Config } from "../../config.js";
import type { Db } from "../../db/cliente.js";
import type { UsuarioSessao } from "../../seguranca/sessao.js";
import { ErroIA, obterClienteIA, type BlocoIA, type MensagemIA } from "./cliente.js";
import { consultasDoUsuario, executarConsulta } from "./consultas.js";
import { garantirOrcamento, registrarUso, textoDe } from "./orcamento.js";
import { sistemaAssistente } from "./prompts.js";

export interface TurnoConversa {
  papel: "usuario" | "assistente";
  texto: string;
}

const MAX_VOLTAS = 6;

/**
 * Turistinha: conversa com ferramentas de CONSULTA (somente leitura) que respeitam as permissões de quem pergunta.
 * O histórico é só texto (vem do navegador); as chamadas de ferramenta valem apenas dentro desta resposta.
 * Registra o uso (tokens, custo, nomes das ferramentas), nunca o texto da conversa.
 */
export async function conversar(db: Db, config: Config, usuario: UsuarioSessao, historico: TurnoConversa[], log?: { error: (o: unknown, m: string) => void }) {
  const cliente = obterClienteIA(config);
  const ferramentas = consultasDoUsuario(usuario);
  const hoje = dataSaoPaulo(new Date());
  const mensagens: MensagemIA[] = historico.map((t, i) => ({
    role: t.papel === "usuario" ? ("user" as const) : ("assistant" as const),
    // A data do dia vai na última pergunta (não no prompt de sistema, que fica estável para o cache).
    content: i === historico.length - 1 && t.papel === "usuario" ? `[Hoje é ${hoje}]\n${t.texto}` : t.texto,
  }));
  const usadas: string[] = [];
  let custo = 0;
  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    await garantirOrcamento(db, config);
    const r = await cliente.enviar({ modelo: config.IA_MODELO, esforco: config.IA_ESFORCO_ASSISTENTE, sistema: sistemaAssistente(), ferramentas: ferramentas.map((f) => f.def), mensagens, maxTokens: 4000 });
    const chamadas = r.content.filter((b) => b.type === "tool_use");
    custo += await registrarUso(db, config.IA_MODELO, r, { tipo: "ASSISTENTE", usuarioId: usuario.id, ferramentas: chamadas.map((c) => String(c.name)) });
    if (chamadas.length === 0) {
      const texto = textoDe(r.content);
      return { resposta: texto || "Não consegui responder agora. Pode reformular?", ferramentas: usadas, custoUsd: custo / 1_000_000 };
    }
    // O conteúdo do assistente volta intacto (inclui os blocos de raciocínio), seguido dos resultados em UMA mensagem.
    mensagens.push({ role: "assistant", content: r.content });
    const resultados: BlocoIA[] = [];
    for (const c of chamadas) {
      const nome = String(c.name);
      usadas.push(nome);
      const res = await executarConsulta({ db, config, usuario }, nome, c.input);
      if (!res.ok) log?.error({ ferramenta: nome, erro: res.erro }, "Consulta do assistente recusada");
      resultados.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(res.ok ? res.dados : { erro: res.erro }), ...(res.ok ? {} : { is_error: true }) });
    }
    mensagens.push({ role: "user", content: resultados });
  }
  throw new ErroIA("IA_ERRO", "A consulta ficou longa demais. Tente uma pergunta mais específica.");
}
