# Plano de ação — Fase 2: operação de Florianópolis ponta a ponta (04/11/2026)

> Pedido do dono (04/11/2026): layout mais limpo com áreas (Passeios, Administrativo, Marketing…), voucher e cadastro de embarque pelo WhatsApp com sugestão do ponto mais próximo, conferência por um colaborador, lista fechada às 21h do dia anterior em ordem de embarque e enviada ao grupo do WhatsApp, guia por escala mensal (com troca por força maior), motorista fixo, confirmação ao passageiro na véspera e link de rastreamento do ônibus pela manhã (rastreador Khronos, depois trocado pelo celular do motorista), estilo Uber/99.

## 1. Fluxo proposto (City Tour Florianópolis)

| # | Momento | O que acontece | Quem | Situação |
|---|---|---|---|---|
| 1 | Venda (Paytour, Civitatis, Viator, Decolar) | Reserva entra sozinha na saída do dia | Sistema | ✅ pronto (integrações) |
| 2 | Logo após a venda | Voucher por e-mail (canal) **e WhatsApp**; se faltar ponto de embarque ou transfer, a mensagem leva o **link de cadastro de embarque** | Sistema | 🟡 mensagens prontas no sistema; envio real depende do provedor de WhatsApp |
| 3 | Passageiro abre o link | Informa onde vai se hospedar (hotel/bairro) ou pede transfer; o sistema **sugere o ponto mais próximo** e ele confirma | Passageiro | ✅ construído (sugestão pela lista de hotéis de cada ponto) |
| 4 | Conferência | Colaborador vê a fila "a conferir" com titular, canal, forma de pagamento, quantidade, ponto/transfer e contato; **confirma ou corrige** | Equipe | ✅ construído |
| 5 | Escala do mês | Guia de cada dia definido na **escala mensal**; motorista padrão; troca por força maior com **motivo registrado** | Supervisão | ✅ construído |
| 6 | Véspera, 21h | **Fechamento automático**: lista em ordem de embarque, com guia/motorista, pronta para o **grupo do WhatsApp** (copiar ou enviar) | Sistema + supervisão | ✅ fechamento e texto prontos; envio ao grupo depende do item 8.1 |
| 7 | Véspera, após o fechamento | Mensagem de **confirmação** ao passageiro (dia, horário e ponto) | Sistema | 🟡 mensagem pronta; envio depende do provedor |
| 8 | Manhã do passeio | Mensagem com **link de rastreamento** (mapa + previsão de chegada ao ponto), enviada quando o motorista inicia o rastreio | Sistema | 🟡 pronto; depende das coordenadas dos pontos e do WhatsApp real |
| 9 | Embarque | Guia marca embarcou/não embarcou no modo embarque | Guia | ✅ pronto (Fase 1) |
| 10 | Pós-passeio | Pedido de avaliação com destaque Tripadvisor | Sistema | ⏳ fase seguinte |

## 2. Nova organização do sistema (menu por áreas)
- **Passeios:** Saídas (lista de vendas por dia), Conferência de embarque, Escala de guias, Fechamento e mensagens, Importar, Integrações, Rastreamento.
- **Cadastros:** Passeios e pontos, Equipe (guias, motoristas, colaboradores, parceiros), Passageiros/clientes*, Afiliados*, Empresas parceiras*.
- **Administrativo:** Contas a pagar*, Contas a receber*, Cartões de crédito*, Frota e manutenção*.
- **Marketing:** Campanhas e avaliações*, Origem dos clientes*, Afiliados e QR codes*.
- **Configurações:** Praças, Usuários, Perfis de acesso, Auditoria, Minha conta.

\* Telas planejadas: aparecem no menu com o escopo e entram nas próximas fases (sem inventar dados).

## 3. Riscos e possíveis falhas (e como tratar)

### 3.1 WhatsApp
- **Grupo do WhatsApp por API:** a API oficial (Meta Cloud API) passou a aceitar grupos, mas com limites fortes segundo fornecedores (cerca de **8 participantes**, entrada só por convite) — **a confirmar na documentação da Meta**. Ferramentas "não oficiais" que mandam para grupos comuns **violam os termos e podem banir o número**. → Recomendação: (a) o sistema gera o texto e um botão "abrir no WhatsApp" para a supervisão colar no grupo (já pronto, custo zero); (b) depois, envio oficial a cada integrante (guia, motorista, supervisão) por mensagem individual ou grupo oficial pequeno.
- **Custo e aprovação:** número dedicado verificado, modelos de mensagem aprovados pela Meta, ~R$ 0,035 por mensagem utilitária (pesquisa de 22/10/2026, a confirmar); limite inicial de 250 destinatários/dia (precisa subir antes da alta temporada).
- **Consentimento (LGPD):** informar na compra que o cliente receberá avisos pelo WhatsApp; guardar o consentimento; mensagens só operacionais.
- **Telefone ausente ou errado:** Viator e Decolar às vezes mascaram ou omitem; o sistema marca "sem WhatsApp" e a reserva aparece na conferência para contato manual.

### 3.2 Cadastro de embarque e sugestão do ponto
- Sugestão por **lista de hotéis/bairros de cada ponto** (tirada das descrições oficiais da Paytour) funciona sem custo, mas não cobre todo endereço. Para cobrir qualquer endereço: geolocalização (Google Places pago; OpenStreetMap/Nominatim gratuito com limites) + **coordenadas oficiais dos pontos** — **coordenadas a confirmar** (não foram inventadas).
- O passageiro pode escolher errado → por isso a **conferência humana** (passo 4) é obrigatória antes do fechamento.
- Link público: token aleatório por reserva, expira depois do passeio, não mostra dados de outros passageiros, limite de tentativas.

### 3.3 Fechamento às 21h
- Vendas depois das 21h (última hora) → a lista é **reaberta como adendo** e a supervisão recebe o aviso; o fechamento pode ser refeito.
- Reservas sem ponto ou não conferidas no fechamento → aparecem destacadas no topo da lista.
- Dependência do servidor: o agendamento só roda com o sistema publicado; enquanto isso, botão "Fechar lista agora".

### 3.4 Rastreamento (celular do motorista)
- **Decisão do dono (04/11/2026):** a Khronos não libera API (só pagando caro, recusado). O rastreio será feito pelo **celular do motorista**, conectado ao nosso sistema. Detalhes em `docs/produto/modulo-rastreio.md` e `docs/arquitetura/adr/0007-rastreio-pelo-celular-do-motorista.md`.
- **Previsão de chegada:** estimativa simples (distância em linha reta pelos pontos restantes × 1,3 ÷ velocidade média recente, mínimo 15 km/h, padrão 25 km/h, + 1 min por parada). Sem coordenadas no ponto, sem previsão.
- Mapa: Leaflet + OpenStreetMap (sem chave e sem custo; política de uso justo registrada no documento do módulo).
- **Risco principal:** no navegador do celular o GPS **para com a tela apagada ou com outro app em primeiro plano**. Mitigação atual: tela do motorista com aviso claro, tela mantida acesa (Wake Lock) e celular no carregador. A solução definitiva é o **app Android/iOS com rastreio em segundo plano** (a fazer, depende de contas das lojas).

### 3.5 Escala de guias
- Troca de última hora precisa avisar o novo guia → mensagem para o guia (provedor de WhatsApp) e registro na auditoria.
- Guia sem Cadastur válido no dia → alerta na escala (o cadastro já guarda a validade).

## 4. Decisões que dependem do dono
1. **Provedor de WhatsApp** (BotConversa, que já usam, 360dialog, Twilio, Zenvia) e número dedicado — custo mensal.
2. ~~Khronos~~ **Decidido em 04/11/2026:** sem API (recusada pelo dono); rastreio pelo celular do motorista.
3. **Coordenadas oficiais dos 13 pontos** (ou autorização para levantá-las no mapa e conferir). Já há campos para cadastrá-las em Passeios e pontos; sem elas não há previsão de chegada.
4. **Servidor** (necessário para links públicos, agendamento das 21h e integrações automáticas).
5. Texto oficial das mensagens (voucher, confirmação, rastreamento) e da política de "não há tolerância para atrasos".

## 5. Fases de entrega
| Fase | Entrega | Situação |
|---|---|---|
| 2A | Layout por áreas, escala de guias/motorista, cadastro de embarque com sugestão, conferência, fechamento 21h com texto para o grupo, central de mensagens (simulada) | construído nesta etapa (ver seção 6) |
| 2B | Envio real de WhatsApp (voucher, confirmação, lista aos integrantes) | provedor contratado |
| 2C | Rastreamento com mapa e previsão + mensagem ao iniciar o rastreio | **construído (04/11/2026)** pelo celular do motorista; falta cadastrar coordenadas dos pontos e, depois, o app com rastreio em segundo plano |
| 2D | Administrativo (contas a pagar/receber, cartões, frota) e Marketing | priorizar com o dono |

## 6. O que foi construído nesta etapa (04/11/2026)

Tudo no ambiente de desenvolvimento, com dados fictícios na demonstração; nada enviado de verdade (WhatsApp em modo simulado, IA sem chave).

**Passeios (operação)**
- Menu por áreas (Passeios, Cadastros, Administrativo, Marketing, Biblioteca, Gestão, Configurações); itens planejados aparecem só para o administrador, como "em breve".
- Escala mensal de guias (com motorista e veículo padrão do passeio); depois de publicada, troca só com motivo (força maior), auditada. Veículo indisponível na frota é recusado.
- Link de embarque do passageiro (sem login, token aleatório guardado só como hash, expira no dia seguinte ao passeio, limite de 30 pedidos/min): o cliente informa a hospedagem, recebe a sugestão do ponto mais próximo e escolhe. Vale também depois do fechamento — a escolha entra no adendo.
- Conferência de embarque: fila por reserva com ponto, pagamento, origem, contato e alertas; o colaborador confirma ou corrige.
- Fechamento da lista às 21h da véspera (automático, recupera até as 05h se o servidor estava fora), em ordem de embarque, texto para o grupo do WhatsApp sem documentos nem telefones; adendos numerados; confirmação para cada titular (com o link de embarque para quem não tem ponto). Pede confirmação antes de fechar manualmente.
- Central de mensagens: fila com situação (simulada, enviada, falha, sem telefone) e reenvio. Provedor Evolution pronto, desligado.

**Administrativo**
- Financeiro: contas a pagar e a receber (parcelas, recorrência, baixa com juros/multa/desconto), importação de extrato OFX/CSV com conciliação sugerida (nada concilia sozinho), cartões com fatura por ciclo, transferências, fluxo de caixa semanal e DRE gerencial. Dinheiro em centavos. Ver `modulo-financeiro.md`.
- Frota: veículos, documentos com alerta de 30 dias, manutenção preventiva por km/tempo, ordens, abastecimento com consumo e alerta, checklist do motorista no celular (item de segurança reprovado imobiliza o veículo). Ver `modulo-frota.md`.

**Marketing e Biblioteca**
- Vendas por canal e por passeio, origem dos clientes, campanhas (retorno lançado à mão), calendário de conteúdo, pedidos de avaliação (copiar e colar), afiliados com QR code. Ver `modulo-marketing.md`.
- Biblioteca de manuais em árvore, com busca e páginas restritas; 7 manuais iniciais tirados de `docs/conhecimento`. Ver `modulo-biblioteca.md`.

**Gestão (IA)**
- Oito gestores de IA (comercial, logístico, frotas, administrativo, marketing, jurídico, RH, tecnologia) avaliam todo dia às 6h30, leem os achados uns dos outros e entregam uma síntese com vulnerabilidades, oportunidades e ações; ação só vale com aprovação de uma pessoa. Assistente Turistinha para consultas. Só dados agregados vão para a IA (LGPD). Teto mensal de gasto. Desligado até o dono aprovar o custo e configurar a chave. Ver `modulo-ia.md`.

**Revisão de código (04/11)**
Três revisões (servidor inteiro, telas e as integrações) encontraram e corrigiram, entre outros: sinais e valores errados na leitura de extratos (OFX ×1000, "R$-10,00" positivo, colunas trocadas), saldo contando em dobro, desfazer conciliação apagando baixa manual; reserva Paytour duplicada quando o pedido ganha itens ou muda de canal, data mudada no canal ignorada, reserva cancelada pela equipe voltando sozinha, sincronização perdendo páginas ou rodando em dobro; link de embarque invalidado pelo adendo e recusado depois do fechamento; escala que não limpava guia removido e desfazia ajuste feito na saída; km que podia diminuir; token do link de embarque nos logs. Consultas repetidas foram juntadas (menos idas ao banco) e funções duplicadas viraram uma só.

**Pendências conhecidas**
- Rastreamento: construído pelo celular do motorista (sem Khronos). Falta cadastrar as coordenadas dos pontos, ligar o perfil MOTORISTA à permissão nova pela migração e, para rastrear com a tela apagada, o app Android/iOS. Voucher automático após a compra: depende do dono (texto oficial e provedor de WhatsApp).
- Pedido Paytour que perde um item ou muda a data de um dos itens (pedido com vários passeios): a reserva antiga não é cancelada sozinha — aparece para conferência.
- Telas de Saídas e Escala ainda usam placa em texto (a lista de veículos da frota já existe na API).

### Lista de passageiros: pagamento no embarque (pedido do dono, 10/11/2026)
A lista (tela, impressão, CSV) e a tela de embarque mostram o pagamento de cada reserva: **Cobrar no embarque: R$ X** (o valor
aparece só na primeira linha da reserva; as outras dizem "mesma reserva"), **Pago**, **Cortesia** ou **Não informado**. No topo,
o resumo "Cobrar no embarque: N reservas (nº …) · total R$ …". O valor é o do pedido no canal (já com desconto).
Ajustes do dono no mesmo dia: a lista não mostra mais o código da reserva, o titular nem a coluna "Aguardando" (o embarque fica
no checkbox da impressão e na etiqueta quando já marcado); mostra o **telefone** de contato e o **documento completo** por padrão
(exigência da fiscalização de trânsito do turismo). O perfil padrão GUIA ganhou "Ver documentos completos" (migração 0036);
cada visualização com documento completo continua registrada na auditoria.

### Check-in pelo QR Code do voucher (pedido do dono, 11/11/2026)
O QR Code do voucher da Paytour contém só o número do **Ticket** (conferido num voucher de teste). No **Modo embarque**, o botão
"Ler QR Code do voucher" abre a câmera (BarcodeDetector quando existe; jsQR 1.4.0 no iPhone) ou aceita o número digitado. O
sistema marca "Embarcou" os passageiros daquele voucher (com quantidade > 1, o voucher é do grupo), avisa se é preciso cobrar e
recusa voucher de outra saída (mostra passeio e data). Cada passageiro guarda o seu voucher (`passageiros.voucher`); as reservas
antigas ganham o voucher na próxima leitura da Paytour ("Reler a partir da data"). O voucher da reserva (referências) também vale.
A gravação do check-in na própria Paytour (ADR 0009) segue pendente da API.
