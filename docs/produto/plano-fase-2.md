# Plano de ação — Fase 2: operação de Florianópolis ponta a ponta (04/11/2026)

> Pedido do dono (04/11/2026): layout mais limpo com áreas (Passeios, Administrativo, Marketing…), voucher e cadastro de embarque pelo WhatsApp com sugestão do ponto mais próximo, conferência por um colaborador, lista fechada às 21h do dia anterior em ordem de embarque e enviada ao grupo do WhatsApp, guia por escala mensal (com troca por força maior), motorista fixo, confirmação ao passageiro na véspera e link de rastreamento do ônibus pela manhã (rastreador Khronos), estilo Uber/99.

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
| 8 | Manhã do passeio | Mensagem com **link de rastreamento** (mapa + previsão de chegada ao ponto) | Sistema | 🔴 depende da API da Khronos e de coordenadas dos pontos |
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

### 3.4 Rastreamento (Khronos)
- O contrato do rastreador é com o **Grupo Khronos** (Khronos Segurança Privada, (48) 3381-9999), em nome da TOMA Marketing. **Não há API pública** documentada. → Pedir à Khronos: API ou webhook de posição (frequência ≤ 30 s), identificador do veículo, custo e exemplo de resposta.
- Plano B sem custo: celular do motorista com **Traccar Client** (aplicativo gratuito) enviando a posição; ou reconfigurar o equipamento para um servidor Traccar próprio (se o modelo permitir).
- **Previsão de chegada:** precisa de coordenadas dos pontos e do histórico de trechos; começar com "horário previsto + atraso atual" e melhorar com média histórica.
- Mapa: Leaflet + OpenStreetMap (gratuito para baixo volume; respeitar a política de uso dos mapas).

### 3.5 Escala de guias
- Troca de última hora precisa avisar o novo guia → mensagem para o guia (provedor de WhatsApp) e registro na auditoria.
- Guia sem Cadastur válido no dia → alerta na escala (o cadastro já guarda a validade).

## 4. Decisões que dependem do dono
1. **Provedor de WhatsApp** (BotConversa, que já usam, 360dialog, Twilio, Zenvia) e número dedicado — custo mensal.
2. **Khronos:** autorizar o contato pedindo API/webhook (ou testar o plano B com Traccar no celular do motorista).
3. **Coordenadas oficiais dos 13 pontos** (ou autorização para levantá-las no mapa e conferir).
4. **Servidor** (necessário para links públicos, agendamento das 21h e integrações automáticas).
5. Texto oficial das mensagens (voucher, confirmação, rastreamento) e da política de "não há tolerância para atrasos".

## 5. Fases de entrega
| Fase | Entrega | Situação |
|---|---|---|
| 2A | Layout por áreas, escala de guias/motorista, cadastro de embarque com sugestão, conferência, fechamento 21h com texto para o grupo, central de mensagens (simulada) | construído nesta etapa (ver seção 6) |
| 2B | Envio real de WhatsApp (voucher, confirmação, lista aos integrantes) | provedor contratado |
| 2C | Rastreamento com mapa e previsão + mensagem da manhã | API Khronos ou Traccar; coordenadas dos pontos |
| 2D | Administrativo (contas a pagar/receber, cartões, frota) e Marketing | priorizar com o dono |

## 6. O que foi construído nesta etapa
(atualizado ao final do trabalho — ver seção no fim do arquivo)
