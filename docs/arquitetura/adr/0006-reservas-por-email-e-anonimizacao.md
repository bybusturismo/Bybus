# ADR 0006 — Reservas por e-mail (robô do Gmail) e anonimização fora da produção

- **Status:** aceito (22/10/2026)
- **Decisão do dono:** dados reais para teste só **anonimizados**; e-mails de reserva lidos **direto do Gmail**.

## Contexto
A lista de passageiros é prioridade. As confirmações de Tripadvisor/Viator chegam pela Bókun em admbybus@gmail.com e as da Decolar em contatofbyb@gmail.com. A Paytour não tem API documentada (ADR 0001). As regras do projeto proíbem dados pessoais reais fora da produção (LGPD).

## Decisão
1. **Robô em Google Apps Script** dentro de cada caixa (`integracoes/gmail/Codigo.gs`), a cada 5 minutos, envia os e-mails de reserva para `POST /api/integracoes/emails`, autenticado por um segredo (`INTEGRACAO_EMAIL_TOKEN`, comparação em tempo constante, limite de 30 req/min). Marca no Gmail o rótulo `bybus/enviado`.
   - Alternativa descartada: OAuth do Gmail no sistema — escopo restrito exige verificação de segurança paga do Google; em modo de teste o token vence em 7 dias.
   - Alternativa descartada: encaminhar para um endereço próprio — depende de domínio e serviço de recebimento de e-mail.
2. **Importação idempotente** pelo código da reserva no canal (reenvio não duplica; "Cancelled booking" cancela).
3. **Anonimização obrigatória fora da produção** (`AMBIENTE != producao`): nome, documento, telefone, e-mail e observações viram fictícios e determinísticos antes de qualquer gravação ou prévia; mantêm-se canal, códigos, data, produto, ponto de embarque, quantidade e categorias. Documentos fictícios das OTAs (1111/2222/3333) ficam, pois indicam o canal. Não há chave para desligar.

## Consequências
- Viator/Bókun não informa ponto de embarque: essas reservas entram com alerta "sem ponto de embarque" para contato com o cliente.
- Decolar: o robô já envia, mas o sistema responde "sem leitor" e o e-mail fica pendente até o leitor existir (precisa de um e-mail de exemplo).
- O robô só funciona com o sistema publicado em `https://` (depende da escolha de hospedagem).
- Paytour continua por exportação CSV (tela Importar) até haver API.
