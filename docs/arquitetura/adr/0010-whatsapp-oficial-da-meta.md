# ADR 0010 — WhatsApp oficial da Meta (Cloud API)

- **Data:** 09/11/2026
- **Status:** aprovado pelo dono, inclusive o custo por mensagem ("SIM", 09/11/2026). Ligação pendente da verificação da empresa
  (Floripa by Bus, resposta da Meta em até 48 h) e da escolha do número.
- **Contexto:** o sistema já tinha o modo simulado e a Evolution (WhatsApp Web, não oficial, igual ao APP TOMA). O dono preferiu o
  WhatsApp oficial: sem risco de bloqueio do número, com selo da empresa.
- **Decisão:** novo provedor `WHATSAPP_PROVEDOR=meta` (Cloud API da Meta). A Evolution fica como reserva, desligada.
- **Consequências:**
  1. **Custo por mensagem** iniciada pela empresa (modelo); respostas dentro de 24 h da última mensagem do cliente são grátis.
     Estimativa apresentada ao dono: ~R$ 0,04–0,05 por mensagem de serviço, ~R$ 300/mês com 50 reservas/dia (a confirmar no painel da Meta).
  2. **Modelos aprovados**: fora da janela de 24 h só saem modelos (`packages/core/src/whatsappMeta.ts`: prévia, confirmação, rastreio,
     lista da equipe). Cada mensagem da fila guarda o modelo (`mensagens.modelo`); dentro da janela vai o texto livre. Envio para aprovação
     pela tela Integrações. Voucher, NPS e pedido de avaliação ainda **sem modelo** (só saem dentro da janela) — próximos modelos.
  3. **Sem grupos**: a lista das 21h vai à guia e ao motorista, um a um (cadastro em Guias e equipe, com telefone); fora da janela, o modelo
     leva o link da lista no sistema (login obrigatório).
  4. **Aviso público** `/api/webhooks/whatsapp` (mensagens dos clientes e status de entrega), protegido pela assinatura HMAC do segredo do app
     e pela palavra de verificação; só aceita o número configurado; nada de texto ou telefone em registros.
  5. Segredos (`META_WA_TOKEN`, `META_APP_SECRET`) só no `.env` do servidor.
