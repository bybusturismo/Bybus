# Módulo Transfer (05/11/2026)

Pedido do dono: "um controle de transfer, que se conecte com a lista de passageiros".

## Como funciona o transfer (respostas do dono)
- Feito por **van da empresa**, com **motorista fixo**, que busca os passageiros **na porta do hotel** e os leva até o **ônibus do city tour**.
- Os "pontos" de transfer da Paytour (Ingleses 6h40, Cachoeira 6h50, Canasvieiras 7h, Jurerê 7h10) são **bairros**: dão a noção do horário.
- **Ordem de busca:** do bairro mais longe do centro para o mais perto: Santinho, Ingleses, Cachoeira do Bom Jesus, Canasvieiras, Jurerê. A ordem completa dos bairros o dono envia depois (os cinco conhecidos ficam cadastrados, editáveis e "a confirmar").
- **Taxa:** **por passageiro e única** (mesmo valor em todos os bairros), entre R$ 35 e R$ 45, **valor a confirmar** (padrão provisório R$ 40,00, marcado "a confirmar"). Hoje é paga à parte, direto ao motorista (PIX ou dinheiro); a empresa passa a cobrar junto com o passeio.
- **Ponto de encontro** da van com o ônibus: **Villa Romana Shopping** (ponto de embarque que já existe no City Tour Toda Ilha). É o padrão do transfer.

## O que o sistema faz
1. **Configuração por passeio** (Passeios e pontos, botão de pontos, seção "Transfer"; permissão `transfer:gerenciar`): taxa única por passageiro, bairros em ordem de busca com horário de referência (marcável "a confirmar") e o ponto de transfer da Paytour a que cada bairro corresponde (Santinho e Ingleses dividem o ponto "Ingleses e Santinho"), minutos entre paradas do mesmo bairro, ponto de encontro, chegada prevista, **motorista, van e lugares padrão** (aplicados a cada novo dia de transfer, como o motorista/veículo padrão da escala). Sem taxa por bairro.
2. **Transfer do dia** (tela `/transfer`, menu Operação): escolher data (padrão amanhã) e passeio. "Montar" cria o transfer a partir das reservas **confirmadas** cujo ponto é de transfer (`ehTransfer`) ou que pediram transfer. Quadro: motorista, veículo, lugares x passageiros, ponto e horário de encontro, buscados. O transfer também é **montado sozinho no fechamento da lista (21h)** se houver reservas de transfer.
3. **Paradas em ordem de busca:** bairro (pelo ponto escolhido; se o ponto reúne dois bairros, o citado no hotel; sem ponto, o bairro citado no texto do hotel), hotel/endereço (começa com o que o cliente informou no link de embarque), horário de busca (horário do bairro; as paradas seguintes do mesmo bairro somam o intervalo), situação (A confirmar, Confirmado com o cliente, Buscado, Não apareceu) e a cobrança.
4. **Ordem:** automática (bairro, depois nome do titular); ajustável com subir/descer ou arrastando (computador). "Recalcular ordem" volta ao automático. Reserva nova entra no grupo do bairro sem desfazer ajustes manuais. Horário, hotel, bairro e valor **digitados à mão** não são sobrescritos pelo recálculo.
5. **Taxa:** valor da reserva = taxa por passageiro x passageiros com assento (**bebê de colo não paga**); editável pela gestão; forma PIX, dinheiro ou **incluída no passeio**; situação a receber/recebido, quem recebeu (motorista) e quando. Totais: a receber, recebido por PIX, em dinheiro e incluído no passeio. Quem não apareceu e não pagou sai do "a receber".
6. **Motorista no celular** (`/transfer/motorista`, "Meu transfer", permissão `transfer:operar`): vê o transfer de hoje e de amanhã em que é o motorista, em ordem, com botões grandes "Buscado", "Não apareceu" (e desfazer) e "Recebi R$ X — PIX/Dinheiro" (o valor tem de ser exatamente o da taxa; recebimento registrado uma vez só). Telefone do cliente só aparece com `manifesto:contatos`.
7. **Ligação com a lista de passageiros:**
   - Lista de passageiros (tela `/saidas/:id`, impressão, texto da central `/listas` e do grupo do WhatsApp): os blocos de transfer mostram "via transfer: embarcam todos no ponto de encontro X às HH:MM" e cada passageiro/titular recebe a marca "via transfer (bairro)". **Ninguém é duplicado**: a lista continua agrupada pelo ponto de embarque da reserva.
   - **Lista do transfer** (texto para o WhatsApp do motorista): horário, bairro, hotel, titular, número de pax, telefone (**só para quem tem `manifesto:contatos`**), "cobrar R$ X" ou "pago". Botão "Copiar texto" na tela. Gerada junto no fechamento (mensagem `TRANSFER_V<n>` ao motorista do transfer se ele tiver telefone; **sem telefones de passageiros**; respeita o modo simulado do WhatsApp).
   - Quando a reserva muda de ponto, passageiros ou status (conferência, link do cliente, edição de reserva, cancelamento), o transfer do dia, **se já montado**, se atualiza. Quem sai do transfer fica inativo (histórico), não é apagado.
8. **Permissões:** leitura com `manifesto:ver`; gestão com `transfer:gerenciar` (montar, editar, reordenar, estornar, configurar); operação com `transfer:operar` (só o motorista do transfer daquele dia, ou a gestão). Escopo por praça em todas as rotas.
9. **Auditoria** (sem hotel, nome ou telefone): `TRANSFER_MONTADO`, `TRANSFER_ATUALIZADO`, `TRANSFER_DIA_ALTERADO`, `TRANSFER_ORDEM_ALTERADA`, `TRANSFER_ORDEM_RECALCULADA`, `TRANSFER_PARADA_ALTERADA`, `TRANSFER_COBRANCA_ALTERADA` (taxa antes/depois, forma e situação), `TRANSFER_SITUACAO_ALTERADA` (antes/depois), `TRANSFER_TAXA_RECEBIDA`, `TRANSFER_TAXA_ESTORNADA`, `TRANSFER_CONFIG_ALTERADA`.

## Esquema (migração `0016_transfer`, ainda não versionada)
`transfer_config` (por passeio), `transfer_bairros`, `transfer_dias` (um por saída), `transfer_reservas` (uma por reserva; `editados` guarda o que foi ajustado à mão). Dinheiro em centavos; horários "HH:MM" locais.

## A confirmar
- Ordem completa dos bairros e horário de Santinho (o dono envia).
- **Valor da taxa** (R$ 35 a 45; provisório R$ 40,00).
- Motorista fixo e van do transfer: cadastrar no sistema (nome do motorista e placa não estão no código nem na demonstração); lugares da van.
- Se o ônibus espera a van no Villa Romana Shopping e o horário previsto de chegada (padrão: horário do ponto, 08:00).
- Intervalo entre paradas do mesmo bairro (padrão 5 min).
- **Cobrança na compra:** a forma `INCLUIDO_NO_PASSEIO` já existe (marcar "taxa cobrada junto do passeio" na parada; nada a receber do motorista). Falta ler o valor do pedido da Paytour quando o produto/opcional de transfer passar a existir lá; hoje o marcador é manual. Importações ainda não atualizam o transfer sozinhas: use "Atualizar com as reservas" ou o fechamento.
- Se o motorista do transfer deve ver o telefone dos clientes (hoje só com `manifesto:contatos`).
- Texto oficial da mensagem ao motorista (provisório).

## Demonstração
Transfer fictício de amanhã (8 reservas em Santinho, Ingleses, Cachoeira, Canasvieiras e Jurerê, hotéis fictícios, taxas a receber, recebidas por PIX, em dinheiro e incluída no passeio). Login `motorista@bybus.test` abre "Meu transfer".

## SQL de permissões (rodar junto da migração)
```sql
UPDATE "perfis" SET "permissoes" = array_append("permissoes", 'transfer:operar') WHERE "codigo" = 'MOTORISTA' AND NOT ('transfer:operar' = ANY("permissoes"));
UPDATE "perfis" SET "permissoes" = array_append("permissoes", 'transfer:gerenciar') WHERE "codigo" = 'SUPERVISOR' AND NOT ('transfer:gerenciar' = ANY("permissoes"));
```
(ADMIN recebe tudo pelo código.)

## Atualização (05/11/2026) — bairros e confirmação das 21h
- Bairros-base do dono, em ordem de busca: **Ingleses 06:40 → Cachoeira do Bom Jesus 06:50 → Canasvieiras 07:00 → Jurerê 07:10**. Santinho deixou de ser bairro próprio (hotéis do Santinho entram em Ingleses).
- Os horários são base. O horário de cada busca é calculado pela ordem (nunca volta no tempo; +5 min entre paradas) e pode ser ajustado à mão até o fechamento.
- No **fechamento das 21h**, a confirmação de cada titular com transfer leva o horário de busca confirmado, o hotel e, se ainda não pagou, a taxa a pagar ao motorista (PIX ou dinheiro). Quem já pagou ou tem a taxa incluída no passeio não recebe a cobrança.
- **Taxa confirmada pelo dono (05/11/2026): R$ 45,00 por passageiro** (migração 0020 ajusta o padrão e as configurações ainda em R$ 40 "a confirmar").

## Ponto mudado no canal (10/11/2026)
Antes, a sincronização mantinha o ponto da primeira importação. Agora, quando a Paytour (ou outro canal) **muda** o ponto de
embarque (ex.: o cliente passou para o transfer de Canasvieiras), a reserva acompanha. O sistema guarda o último ponto informado
pelo canal (`reservas.ponto_canal_id`): se o canal repetir o mesmo ponto, vale o ajuste feito no sistema (atendente ou link de embarque).
