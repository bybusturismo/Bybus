# Canais de venda e integrações

> Pesquisa de 22/10/2026 feita a partir de trechos de buscadores (as páginas inteiras foram bloqueadas pela rede do ambiente). Itens marcados **[NÃO CONFIRMADO]** precisam de validação.

## Canais atuais da Bybus (informado pelo dono)
Site/loja própria · **Paytour** (a "Peitur") · **Decolar** · **Tripadvisor** · **Civitatis** · quiosque Villa Romana Shopping · WhatsApp. Também aparece em Wotif/Expedia.

## Paytour (paytour.com.br)
- Sistema brasileiro de reservas para receptivos: loja/motor de reservas com controle de vagas, venda de balcão, afiliados com comissão, POS, Pix/cartão/"Pix parcelado"/sinal/pagamento no dia, app de check-in com baixa de voucher, relatórios.
- Integração **nativa com Civitatis** (reservas da Civitatis entram na Paytour).
- Planos (podem estar desatualizados): Controle R$ 89/mês · Performance R$ 249/mês + taxa (inclui Civitatis) · **Premium R$ 379/mês — único com "acesso a API"**.
- **API sem documentação pública.** Endpoints, autenticação e webhooks [NÃO CONFIRMADO]. → Pedir à Paytour documentação + sandbox.
- **Confirmado (03/11/2026):** o painel da By Bus tem **Avançado → Aplicativos**, onde se criam aplicativos com **App Key + App Secret** (credenciais de API). Existe um aplicativo "traqueamento" (25/05/2026) usado por outra ferramenta — a confirmar qual. Resposta do suporte Paytour (ticket, 23/10/2026): **a By Bus está no plano Premium, que inclui a API**; documentação em https://api-ha.paytour.com.br/apiv2doc (artigo de apoio: https://atendimento.paytour.com.br/kb/pt-br/article/223758/api); dados do pedido no endpoint "pedidos – detalhando pedido (GET)"; **webhooks** disponíveis (seção "webhooks" da documentação). Regra do webhook: a Paytour espera resposta HTTP 200–299; se falhar, tenta de novo após 30 s, 5 min, 10 min e 20 min — depois de 5 tentativas sem sucesso, desiste. Campos e autenticação: a confirmar ao ler a documentação. Credenciais só em variáveis de ambiente do servidor, nunca no repositório ou em chat.
- Fontes: [recursos](https://www.paytour.com.br/recursos/), [planos](https://www.paytour.com.br/planos/), [Civitatis](https://www.paytour.com.br/funcionalidades/civitatis/), [PagBank](https://developer.pagbank.com.br/docs/paytour-processo-de-integracao).

## Viator / Tripadvisor
- Integração é feita pelo **sistema de reservas do fornecedor** via Viator Supplier API (disponibilidade em tempo real, reserva; cancelar/alterar/redeem opcionais). Na prática, via channel managers (Bókun, Rezdy, Ventrata…). Produto na Viator aparece com botão de reserva no Tripadvisor.
- Comissão típica 20–30% [NÃO CONFIRMADO oficialmente].
- Fontes: [docs.viator.com](https://docs.viator.com/supplier-api/technical), [help Viator](https://help.supplier.viator.com/en/articles/104).

## GetYourGuide
- Supplier Connectivity API via Integrator Portal (usado por sistemas de reserva/channel managers). Comissão 20–30% ([GYG](https://www.getyourguide.supply/join/how-much-does-getyourguide-charge)).

## Civitatis
- Extranet do fornecedor **ou** conexão via sistema de reservas (FareHarbor, Rezdy, Bókun, Ventrata, **Paytour**). Comissão negociada, não pública.
- **Jun/2026: aliança Decolar + Civitatis** — catálogo da Civitatis passa a aparecer na Decolar ([Panrotas](https://www.panrotas.com.br/mercado/operadoras/2026/06/civitatis-e-decolar-anunciam-alianca-estrategica-global-para-tours-e-atividades_229463.html)).

## Decolar
- Sem processo público para fornecedor de passeios; provável acordo comercial ou via Civitatis.

## Padrão OCTO
- Padrão aberto de conectividade para passeios (130+ implementações). Considerar se o sistema próprio for expor disponibilidade.

## Recomendação de arquitetura de integração (proposta — decisão do dono)
1. **Não reconstruir o motor de vendas no primeiro momento.** Paytour continua vendendo; o sistema gerencial **consome** reservas/passageiros/check-ins/pagamentos via API Paytour (provável plano Premium).
2. Civitatis via Paytour (nativo). Viator/GYG: confirmar se a Paytour conecta; senão, channel manager certificado (ex.: Bókun). Evitar integração direta nas Supplier APIs (exige certificação e duplicaria estoque).
3. Decolar: via Civitatis ou manual.
4. NFS-e: **Emissor Nacional** (Florianópolis desde 01/12/2025; Balneário Camboriú desde 01/01/2026) — uma API para as duas cidades, já preparada para CBS/IBS.
5. Telemetria/cartão combustível via API se a frota já usar esses serviços.

## Referências de mercado
Bókun (grupo Tripadvisor, US$ 49/mês + 1–1,5%), Rezdy, Checkfront, FareHarbor. Funções que o sistema deve cobrir ou integrar: inventário por saída com anti-overbooking entre canais, tarifas por categoria, voucher QR + check-in offline, manifesto por saída/veículo, comissões, cancelamento/reembolso, Pix/cartão, relatórios de ocupação e receita por canal, avaliações.

## Entrada de reservas por e-mail (22/10/2026)
- **Bókun → admbybus@gmail.com:** "New booking"/"Cancelled booking" com código VIA-…, produto, data/hora, quantidade e categoria (ex.: "1 Senior"), nome, telefone e e-mail mascarado do Tripadvisor. **Não traz ponto de embarque.**
- **Decolar → contatofbyb@gmail.com:** formato ainda não visto (a confirmar).
- Automação: robô do Gmail (Apps Script) → `/api/integracoes/emails` — ver `integracoes/gmail/README.md` e ADR 0006.

## Paytour API v2 (lida em 03/11/2026, via HTML salvo no Drive)
- Base `https://api.paytour.com.br/v2`; login por credenciais de aplicativo (Basic app_key:app_secret → token Bearer; refresh_token válido 15 dias).
- `GET /pedidos` paginado (máx. 100), filtros por criação e **atualização**; `includeItems=1` traz os itens com data/hora do passeio, faixa etária, quantidade, voucher, `utilizado` (check-in) e **formulário** (nome, documento etc.).
- Existem endpoints de check-in de atividade, afiliados, reagendamento e **webhooks** (listar/registrar/apagar) — webhooks a ler.
- Conector implementado: `integracoes/paytour/README.md`.

## Vendas por canal na Paytour (120 dias até 03/11/2026, pedidos aprovados)
- ~465 vendas diretas (site/quiosque, sem afiliado); **86 pelo afiliado "TripAdvisor interno"** (cópias manuais das reservas Viator/Bókun — **sem o código VIA-** na observação, então o sistema só detecta duplicidade por nome+data+categorias); 13 pelo afiliado "Turis Tráfego – Google Ads"; o restante por afiliados de hotéis/parceiros.
- **Nenhuma venda da Decolar** no período (nem afiliado, nem documento 2222, nem e-mail no admbybus@). A confirmar se a Decolar ainda vende e por onde (desde jun/2026 a Decolar revende o catálogo da Civitatis).

## Viator — acesso (04/11/2026)
- A equipe acessa a Viator pelo **portal de fornecedor** (supplier.viator.com, conta "BY BUS TURIS…" nº 165696); **não tem login na Bókun**, embora os avisos de reserva cheguem da Bókun (bybusturismo1.bokun.io) no admbybus@ — a confirmar quem criou/administra essa conta Bókun (provavelmente criada pela própria Viator).
- Decisão do dono: depois da integração, **parar as cópias manuais** na Paytour; antes disso, resolver o bloqueio de vagas na Paytour (proposta: o sistema registra o pedido-espelho automaticamente via API da Paytour).
- Decolar continua vendendo; confirmações chegam em contatofbyb@gmail.com (exemplo a enviar).

## Canais identificados nos pedidos da Paytour (12 meses até 03/11/2026)
- **Civitatis:** ~136 pedidos pela **integração nativa** (tipo de pagamento "civitatis", método "integracao_parceiro") — vendas originais, entram automaticamente pelo conector da Paytour.
- **Tripadvisor/Viator:** cópias manuais com o e-mail de retransmissão do Tripadvisor no cadastro do cliente e/ou afiliado "TripAdvisor interno".
- **Decolar:** 3 pedidos (e-mail da Decolar no cadastro) — cópias manuais; as confirmações originais chegam em contatofbyb@.
- Últimos 120 dias, reservas confirmadas: Paytour 465 (976 passageiros), Viator 123 (234), Civitatis 14 (29), Decolar 0.

## Decolar — formato do e-mail (visto em 04/11/2026)
- Enviado a contatofbyb@gmail.com pelo sistema **PAM** da Decolar/Despegar: "Informamos que foi gerada uma nova reserva." Campos: titular, telefone, passageiros (Adultos | Crianças | Infantes), Service id, data da reserva, **Código de reserva PAM**, **ID Compra Decolar**, lugar de compra (ex.: Chile), canal (ex.: Despegar), produto ("Descubra Floripa a bordo do Floripa by Bus Tour: Toda ilha"), temporada e **data de excursão**. Sem horário nem ponto de embarque.
- **Confirmado (e-mail real encaminhado):** remetente "Despegar Argentina <noreply@decolar.com>", assunto "Decolar - Nova reserva ID: <ID Compra>"; no texto puro os rótulos vêm entre asteriscos e linhas longas quebram (o leitor junta).
- **Cancelamento/alteração na Decolar não tem aviso automático** (visto em 04/11/2026): são conversas por e-mail entre a equipe e a Decolar (ex.: "Precisamos da sua ajuda com a reserva …" de as-viagens@decolar.com pedindo mudança de data; "Cancelamento de reserva" com o atendimento/financeiro). O sistema marca esses e-mails como "pedem resposta da equipe"; o cancelamento da reserva é feito manualmente na saída.

## Rastreador Khronos (decisão de 04/11/2026)
- A frota tem rastreador do **Grupo Khronos** (contrato em nome da TOMA Marketing). A Khronos **não libera API** de posição; só pagando um plano caro, que o dono **recusou em 04/11/2026**.
- Decisão: **rastreio próprio pelo celular do motorista** (GPS do navegador, enviado ao sistema). O rastreador da Khronos continua para a segurança da frota, sem integração com o Bybus.
- Limitação conhecida: no navegador o GPS para com a tela apagada; o definitivo é o app Android/iOS (a fazer). Ver `docs/produto/modulo-rastreio.md` e ADR 0007.
- Mapa: OpenStreetMap (blocos gratuitos, sem chave; política de uso justo; com muito volume trocar de provedor — a confirmar).
## WhatsApp: central de conversas (04/11/2026)
Escolha do dono (igual ao APP TOMA): Evolution API (WhatsApp Web, **não oficial**, risco de bloqueio do número; usar para conversar e responder, sem disparo em massa). A tela WhatsApp mostra o que chega (aviso interno `/api/interno/whatsapp/<token>`), o que a fila automática envia e as respostas da equipe, ligando o telefone às reservas. Modo simulado por padrão. Detalhes, segurança e configuração em `docs/produto/modulo-whatsapp.md`. A confirmar: número que será conectado (pessoal ou da empresa), política de retenção das conversas.

## Instagram (decisão do dono, 06/11/2026)
Integração pela **API oficial da Meta**, "Instagram API com Instagram Login" (conta profissional da própria empresa: acesso padrão, sem revisão de aplicativo). Três usos: dados da conta no Marketing, responder Direct e comentários pela tela **Conversas** (junto do WhatsApp) e agendar posts no Calendário de conteúdo. Regra da Meta: Direct só pode ser respondido até 24 horas depois da última mensagem do cliente. Tudo nasce em **modo simulado** (sem token, nada sai); só fala com a Meta em produção ou com `INSTAGRAM_ENVIO_REAL=true`. Passo a passo, segurança e itens "a confirmar" em `docs/produto/modulo-instagram.md`.

## WhatsApp: decisão final (dono, 09/11/2026)
- **WhatsApp oficial da Meta** (Cloud API), com custo por mensagem aprovado pelo dono; a Evolution fica como reserva. ADR 0010.
- Portfólio da Meta: **Floripa by Bus** (há também o BC by Bus); aplicativo "Bybus Gestão" criado; verificação da empresa enviada (resposta em até 48 h).
- Número do WhatsApp: a decidir pelo dono.
- Tripadvisor por praça: Floripa by Bus (g303576-d2362697) e BC by Bus (g680306-d10686390) — links cadastrados no sistema.
