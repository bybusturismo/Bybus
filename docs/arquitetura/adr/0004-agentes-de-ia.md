# ADR 0004 — Agentes de IA de gestão ("diretoria virtual")

- **Status:** aceito e implementado em 04/11/2026 (módulo `ia`, ver `docs/produto/modulo-ia.md`); a **ativação em produção depende da aprovação do custo e da chave pelo dono** (`ANTHROPIC_API_KEY`, `IA_LIMITE_MES_USD`).

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

## Atualização de 04/11/2026 — o que foi implementado e o que mudou

**Implementado:** 8 gestores (comercial, logístico, frotas, administrativo/financeiro, marketing, jurídico, RH, tecnologia) com avaliação diária às 6h30, rodada de debate entre eles e síntese (vulnerabilidades, oportunidades de crescimento, ações sugeridas); assistente de conversa "Turistinha" com ferramentas de consulta somente leitura; limite mensal e registro de uso; permissões `ia:usar` e `ia:gestores`.

**Mudanças em relação à decisão original:**
- **Estrutura de agentes:** em vez de "9 agentes com CEO", são **8 gestores + uma síntese** (a síntese faz o papel do CEO). Experiência do Cliente e Operações foram absorvidos pelo logístico/comercial; Frota e Financeiro viraram "frotas" e "administrativo".
- **Dados por "retrato" agregado, não por ferramentas do modelo:** na avaliação diária, o servidor monta o retrato de cada área a partir do banco e o envia na mensagem (os gestores não consultam o sistema por conta própria). Isso torna o conteúdo enviado **previsível e auditável** (fica gravado na avaliação) e barra dado pessoal antes de sair (trava de LGPD em `packages/core/src/ia/lgpd.ts`). As **ferramentas** ficaram só no assistente de conversa.
- **Sem Tool Runner e sem Message Batches por enquanto:** a avaliação usa chamadas diretas com saída estruturada por ferramenta (`strict: true`; `tool_choice` forçado não é aceito pelos modelos atuais, então a instrução vai no prompt e o servidor valida/refaz uma vez) e o assistente usa laço manual de ferramentas (permite conferir a permissão na execução). Batches reduziria o custo em 50%, mas complica o debate em duas rodadas e a resposta imediata de "Rodar agora"; reavaliar quando o gasto real for conhecido.
- **Custo revisado:** sem Batches, ≈ **US$ 1–2 por dia (US$ 30–60 por mês)**; teto padrão proposto `IA_LIMITE_MES_USD=60`. **A confirmar com uso real.**
- **Modelo:** `claude-opus-5-5` (padrão), com `IA_MODELO_SINTESE` opcional para um modelo mais forte (`claude-fable-5-1`). Raciocínio adaptativo e `effort` por tipo de chamada (`medium` gestores, `high` síntese, `low` assistente). Prompt de sistema estável e com cache; fallback de recusa do servidor habilitado.
- **Ações:** nascem `SUGERIDA`; só viram tarefa/aviso quando uma pessoa aprova (`APROVADA` → `CONCLUIDA`, ou `DESCARTADA`), tudo auditado. Ainda não há módulo de tarefas: a lista "Ações" faz esse papel até lá.
- **Escopo:** os gestores consolidam a empresa inteira e exigem acesso a todas as praças (a confirmar se supervisores de praça devem ver uma versão filtrada).
- **Feedback "útil/não útil"** do painel de Insights: não implementado; hoje mede-se por ações aprovadas × descartadas.
