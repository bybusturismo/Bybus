# Avisos no WhatsApp + localização do ônibus — pesquisa (22/10/2026)

> Pesquisa por trechos de buscador; valores "a confirmar" com os fornecedores. Nenhum serviço contratado.

## WhatsApp (API oficial da Meta)
- Mensagem iniciada pela empresa exige **modelo (template) aprovado**, categoria *utility*.
- Preço Brasil (tabela BRL desde 01/10/2026): **~R$ 0,035 por mensagem utility** (marketing ~R$ 0,32). Desde 01/10/2026 a janela de 24h **não é mais gratuita** para templates.
- **Opt-in obrigatório** (informar na compra que receberá avisos no WhatsApp).
- **Limite inicial: 250 destinatários únicos/24h** por portfólio — com 150 passageiros/dia é preciso escalar o limite antes de produção.

## Provedores (BSP)
| Opção | Custo | Observação |
|---|---|---|
| **BotConversa PRO** (já usado) | ~R$ 199/mês | Coexistência com API oficial e API/webhook — **confirmar com o suporte se dispara template pela API** |
| 360dialog | €49–99/número/mês + tarifa Meta | API simples, suporte em inglês |
| Twilio | ~US$ 0,005/msg + tarifa Meta | Melhor documentação, sandbox, cobra em dólar |
| Zenvia | a partir de R$ 100/mês + R$ 649 ativação | Suporte BR, custo por mensagem alto |
Volume: 4.500–18.000 msgs/mês → tarifa Meta **R$ 160–630/mês**. Um aviso **por reserva** (titular) reduz ~60%.

## Posição do ônibus
- Rastreadores brasileiros (Cobli, Pósitron, Sascar, Omnilink, Getrak): API em geral **contratual** (REST com token). → Identificar o fornecedor e pedir API, frequência (≤ 30 s) e custo.
- Alternativa: redirecionar o equipamento para **Traccar** próprio (código aberto, 200+ protocolos, envia posições/geocercas em JSON).
- **Celular da guia** (web): funciona com tela ligada; com tela bloqueada iOS/Android pausam o GPS → só reserva até haver o app nativo.

## Previsão de chegada (ETA)
- Recomendado: **geocercas** (50–80 m) nos 13 pontos + **média histórica de cada trecho** (por dia da semana/horário), ajustada pela distância percorrida. Gatilhos: ETA ≤ 10 min, ≤ 5 min, entrada na geocerca. Cada aviso **uma única vez** por reserva.
- Nas primeiras semanas, Google Routes como semente (10 mil consultas grátis/mês; ~US$ 20/mês) e depois desligar.

## Arquitetura proposta
Rastreador (ou Traccar; celular da guia como reserva) → API Bybus (fila → geocerca/ETA → fila de envio com retentativa) → BSP WhatsApp → passageiro. Página "ver no mapa" (Leaflet + OpenStreetMap) com token por reserva, sem login, expira no fim do passeio. Registro de cada mensagem e status (entregue/lida/falhou).

**Custo total estimado: ~R$ 200–1.100/mês** (Meta R$ 160–630; BSP R$ 0–300; rastreador a confirmar; ETA R$ 0–120; Traccar R$ 30–60).

## Riscos
1. Template reprovado/reclassificado como marketing (~9× mais caro) → texto puramente operacional; versões PT/EN/ES.
2. Número com qualidade baixa/banido → opt-in claro, botão "parar avisos", só no dia do passeio; **não usar conexão por QR Code** (não oficial).
3. Estrangeiros: telefone em formato internacional; OTAs às vezes mascaram o telefone → pedir WhatsApp em link de pré-check-in.
4. LGPD: aviso operacional = execução de contrato; atualizar política de privacidade; contrato de operador com o BSP.

## Decisões pendentes do dono
- Qual rastreador (empresa) e se ele libera API.
- Qual provedor de WhatsApp (perguntar ao BotConversa se dispara template via API).
- Onde coletar o opt-in (checkout Paytour, pré-check-in, quiosque).
