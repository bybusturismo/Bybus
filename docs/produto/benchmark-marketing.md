# Pesquisa: ferramentas de marketing e relacionamento (06/11/2026)

Pesquisa feita a pedido do dono para decidir o que incorporar ao Bybus Gestão. Fontes listadas no fim; itens sem fonte forte estão marcados "a confirmar". Não analisa preço.

## Ferramentas pesquisadas (resumo)
- **mLabs:** agendamento (Feed, Stories, Reels, Carrossel, YouTube Shorts), fluxo de aprovação, calendário, relatórios, mLabs Chat (respostas automáticas). Google Meu Negócio/TikTok completos: a confirmar.
- **RD Station Marketing:** landing pages, formulários, teste A/B, segmentação, lead scoring, fluxos de automação e e-mail (fluxos: fonte secundária).
- **RD Station CRM:** funis com etapas, automação de tarefas, priorização com IA; WhatsApp via extensão de terceiro.
- **RD Station Conversas:** inbox WhatsApp + Instagram + chat, chatbot visual e agentes de IA, histórico enviado ao CRM.
- **Reportei / Metricool:** relatórios e painéis automáticos multi-rede, leitura por IA, link na bio (Metricool SmartLinks), análise de concorrentes, aprovação.
- **HubSpot grátis/Starter:** formulários, chat/bot, 2.000 e-mails/mês com marca, caixa de conversas.
- **Kommo:** inbox unificada (WhatsApp, Instagram, TikTok, Messenger, Telegram, e-mail) ligada ao funil; Salesbot sem código.
- **Zenvia / Blip:** disparos e chatbots com IA e transbordo para humano (operação maior).
- **TrustYou / ReviewPro:** caixa de avaliações, respostas com IA, sentimento, pesquisas, benchmark (hotelaria).
- **Regras dos canais:** Viator "Request Reviews" (lembrete após 7 dias; só avalia na Viator quem comprou lá); Google Business Profile permite responder avaliações pela API (acesso a confirmar).

## O que faz sentido para a By Bus (priorizado)
**Evoluir o que já temos**
1. Painel de avaliações e fila diária de pedidos de avaliação por canal (Google, Tripadvisor), com lembrete — esforço baixo.
2. Relatório automático semanal/mensal por canal com comparativo e resumo da IA — baixo a médio.
3. Retorno de campanhas com UTM, cupom e (opcional) custo do Google/Meta Ads — médio a alto.
4. Respostas rápidas e etiquetas nas Conversas (WhatsApp + Instagram), em PT/EN/ES — baixo.
5. Calendário de conteúdo com aprovação e banco de mídias etiquetado — baixo a médio.
6. Legendas e hashtags com IA no calendário — baixo (custo de IA).
7. Link na bio com cliques medidos (Paytour, WhatsApp, Tripadvisor, cupom) — baixo.

**Novo**
8. Avaliações do Google dentro do sistema, resposta sugerida por IA com aprovação, alerta de nota baixa — médio (API do Google a confirmar).
9. Acompanhamento semanal das notas nas OTAs e de 2–3 concorrentes (manual) — baixo.
10. Segmentação e campanhas de reengajamento por WhatsApp, com consentimento (LGPD) — médio (API oficial do WhatsApp).
11. Chatbot de primeiro atendimento com transbordo para humano — médio a alto.
12. Mensagens por gatilho ao longo da reserva (confirmação, véspera, pós-passeio com avaliação e cupom de retorno) — médio.
13. NPS curto pós-passeio (atenção às regras de convite das OTAs: a confirmar) — baixo a médio.
14. Programa de indicação de clientes (código com desconto e crédito) — médio.
15. Página de pedido de orçamento para grupos, escolas e empresas, caindo no sistema com origem — baixo.

## Não vale construir (contratar ou ignorar)
Agendador para todas as redes (manter Instagram/Facebook), e-mail marketing com construtor visual, lead scoring, recuperação de carrinho (o checkout é da Paytour/OTAs), monitoramento de concorrentes por raspagem, inbox para todos os canais além de WhatsApp e Instagram, plataforma de reputação hoteleira, construtor genérico de fluxos arrastar-e-soltar, programa de pontos.

## Decisões que travam vários itens
Provedor oficial de WhatsApp; custo da IA; aprovações de API (Google Business Profile, Google Ads, Meta Ads); política de convites das OTAs.

## Fontes
mlabs.com.br (funcionalidades/agendamento-de-posts, agencias, blog); b2bstack.com.br (mLabs, RD Station, Etus, Blip, Postgrain); rdstation.com (precos, produtos/crm, produtos/conversas); reportei.com; help.metricool.com; hubspot.com/pricing/crm; salesdorado.com (Kommo); zenvia.com; capterra.com (TrustYou); toolradar.com (TrustYou × ReviewPro); operatorresources.viator.com/category/reviews; postproxy.dev (Google Business Profile, terceiro).

## Decisão do dono (06/11/2026)
Aprovados para construir: 1 (avaliações: fila e painel), 2 (relatório automático), 4 (respostas rápidas e etiquetas), 5+6 (aprovação de posts, banco de mídias e legendas com IA), 7 (link na bio com cliques), 3 (retorno de campanhas com UTM e cupom), 15 (orçamento de grupos), 12+13 (mensagens automáticas ao longo da reserva com NPS). Itens que dependem de envio real (WhatsApp oficial, custo da IA, APIs do Google/Meta Ads) são construídos em modo simulado até as decisões.

## O que foi feito (06/11/2026, detalhes em `modulo-marketing.md`, seção "Marketing 2")
- **1 Avaliações** (fila diária no idioma do cliente, link por canal, Viator orientada, pedido/lembrete 7 dias/avaliada, painel e notas por canal e concorrente): feito.
- **2 Relatório automático** (semanal segunda 07h e mensal dia 1, comparativo, histórico, impressão/PDF, resumo da IA só com IA ligada): feito.
- **3 Link na bio** com cliques medidos sem dado pessoal: feito.
- **4 Retorno de campanhas** (links com UTM e QR, atribuição automática por UTM/cupom/afiliado, custo por CSV): feito; APIs do Google/Meta Ads ficam como próxima etapa.
- **5 Orçamento de grupos** (página pública com anti-spam e LGPD, tela em Reservas, aviso na Visão Geral): feito.
- **6+7 Mensagens automáticas e NPS** (fluxos com liga/desliga e texto por idioma, NPS por link com token, casos internos, convite sem "review gating", cupom de retorno): feito.
- **Em modo simulado** até haver provedor de WhatsApp. **Não feitos nesta rodada** (a cargo de outro trabalho): respostas rápidas e etiquetas nas Conversas, calendário com aprovação/banco de mídias/legendas com IA.
