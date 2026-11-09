# Confirmação da véspera em duas etapas (09/11/2026)

Pedido do gerente (avaliação dos textos, 09/11/2026), aprovado pelo dono ("comece").

## Como funciona
1. **A partir da hora da prévia (padrão 09:00 da véspera)** o sistema confere, a cada minuto, as saídas de amanhã:
   conta as reservas **pagas** e **pendentes** (pendente = "pagar no embarque" ou saldo a pagar; `pagamento = A_PAGAR`).
2. **Pontos de corte** (editáveis em Listas de passageiros › Ajustar; padrão = números do gerente, a validar):
   - corte 1: **10 pagas** → confirma;
   - corte 2: **16 no total com pelo menos 8 pagas** → confirma;
   - contar por reservas (padrão) ou por passageiros (colo não conta); corte com zero fica desligado.
3. **Atingiu um corte:** a saída é confirmada sozinha (`saidas.confirmada_em`, auditoria `SAIDA_CONFIRMADA_AUTOMATICA`) e cada titular recebe a
   **confirmação completa** (horário, ponto, transfer com horário padrão do bairro e "se mudar, avisamos").
4. **Não atingiu:** cada titular recebe uma **prévia** ("estamos montando a lista; ao longo do dia enviaremos a confirmação") e, quem ainda não tem
   ponto, já recebe o **link para informar a hospedagem** (pedido do ponto pela manhã). O sistema reavalia ao longo do dia.
5. **Hora limite (padrão 18:00) sem corte:** a tela mostra **"Equipe decide"**. Nada é cancelado sozinho; a equipe usa **Confirmar saída** (ou cancela pela tela da saída).
6. **Vendas novas** depois da confirmação recebem a confirmação na rodada seguinte. O **fechamento das 21h** continua: fecha a lista, manda ao grupo e ao
   motorista do transfer, confirma a saída se ainda não estava confirmada e só manda confirmação a quem ainda não recebeu.
7. Sem ponto e com prévia já enviada, a confirmação **não gera outro link** (invalidaria o da manhã): pede para usar o link enviado mais cedo.

## Textos (packages/core/src/mensagens.ts) — a confirmar com o dono
- Confirmação: "está confirmado!", "Aguarde no local 10 minutos antes: o ônibus é pontual e não há tolerância para atrasos", aviso de **trânsito intenso**
  para quem está hospedado no continente, norte da ilha ou Lagoa da Conceição e embarca fora da própria região (lista de bairros em `confirmacao.ts`, a confirmar),
  "se o seu hotel não tiver embarque, indicaremos o ponto mais próximo". Transfer: "Aguarde em frente ao hotel 10 minutos antes… Se o horário mudar, avisaremos por aqui."
- Lista do grupo: reenvio sempre **completo**, com o título "LISTA ATUALIZADA (versão N)" (antes "ADENDO").
- Assinatura "— Equipe By Bus".

## Técnico
- Núcleo: `packages/core/src/confirmacao.ts` (`avaliarConfirmacao`, `regiaoComTransito`, regras padrão).
- API: `apps/api/src/servicos/confirmacao.ts` (rotina `rodarConfirmacaoVespera`, chamada pelo agendador do fechamento), rotas em `rotas/fechamento.ts`:
  `PUT /api/confirmacao/regras` e `POST /api/saidas/:id/confirmar` (permissão `saidas:decidir`). Migração 0024.
- Mensagens novas na fila: tipo `PREVIA` (uma por reserva). Modo simulado do WhatsApp continua valendo.

## Pendências
- Validar os números dos cortes e os textos com o dono.
- Foto do ônibus em cada ponto (precisa do provedor de WhatsApp com envio de imagem).
- Envio automático pelo chat da Viator (sem integração conhecida): por enquanto a equipe copia e cola.

## Viator/Tripadvisor sem resposta (09/11/2026)
- Cliente da Viator (canal real) **sem ponto de embarque 4 horas** depois da prévia ou da confirmação aparece na lista do dia como
  "Viator sem resposta"; o botão **Mensagem para a Viator** mostra a referência da reserva e um **texto pronto** no idioma do cliente
  (PT/EN/ES, pelo país ou DDI) para colar no chat da Viator. O texto **não leva link** (um link novo invalidaria o do WhatsApp): pede o
  nome e o endereço do hotel; a equipe cadastra quando o cliente responder. Texto sugerido pelo sistema, liberado pelo dono para ajustar depois.
