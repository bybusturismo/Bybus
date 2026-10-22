# ADR 0004 — Agentes de IA de gestão ("diretoria virtual")

- **Status:** proposto (22/10/2026) — depende de aprovação de custo pelo dono.

## Contexto
O dono quer agentes de IA por área (CEO, Frota, RH, Jurídico, Marketing, Comercial, Financeiro, Operações, Experiência do Cliente) que analisem continuamente os dados do sistema e apontem oportunidades e riscos, além de responder perguntas.

## Decisão
- **Provedor:** Claude API (Anthropic) via SDK oficial `@anthropic-ai/sdk` no back-end (TypeScript). Chave em cofre/variável de ambiente; nunca no front.
- **Modelo:** `claude-opus-5-5` (padrão atual; US$ 4 / US$ 20 por milhão de tokens de entrada/saída; contexto 1M). Thinking adaptativo; `effort` ajustado por rota (ex.: `medium` para insights diários, `high` para análises do CEO). Fallback de recusa habilitado (`fallbacks: "default"`).
- **Arquitetura:** cada agente = prompt de sistema estável (papel, regras da empresa, glossário) + **ferramentas somente leitura** que consultam a API interna (ex.: `ocupacao_por_saida`, `receita_por_canal`, `custos_por_veiculo`, `documentos_vencendo`, `escala_motoristas`, `avaliacoes`). Loop com o **Tool Runner** do SDK. Os agentes **não alteram dados**: propõem ações que um humano aprova.
- **Rotina constante:** relatórios diários/semanais gerados em lote pela **Message Batches API** (50% mais barata), gravados como "Insights" (área, prioridade, evidências com links para os dados, ação sugerida, status: novo/aceito/descartado). O CEO consolida os insights das áreas.
- **Sob demanda:** chat por área dentro do sistema, com o mesmo conjunto de ferramentas, respeitando as permissões de quem pergunta.
- **Custo:** prompt caching no prompt de sistema e nas definições de ferramentas; dados agregados (não linhas brutas).
- **LGPD:** ferramentas devolvem **dados agregados ou pseudonimizados** — nada de CPF, telefone ou nome de passageiro para o modelo, salvo quando estritamente necessário e autorizado. Registro de cada execução (quem pediu, ferramentas chamadas, tokens, custo).

## Estimativa de custo (a confirmar em teste)
~9 agentes × 1 relatório/dia em lote, ~30 mil tokens de entrada (boa parte em cache) + ~3 mil de saída → **~US$ 20–40/mês**; chat sob demanda adiciona conforme uso (limite mensal configurável).

## Consequências
- O valor depende de dados completos (financeiro, frota, reservas, avaliações): os agentes entram **depois** que esses módulos estiverem alimentados.
- Criar painel de "Insights" com feedback (útil/não útil) para medir qualidade e ajustar prompts.
