# Módulo Marketing (04/11/2026)

Painéis de vendas por canal e origem dos clientes, campanhas e cupons, calendário de conteúdo, avaliações e afiliados próprios. Referência de ideias: Marketing do APP TOMA (`docs/outros-modulos.md`), adaptado a uma empresa de turismo.

## Permissões
| Permissão | O que libera |
|---|---|
| `marketing:ver` | Ver todos os painéis e listas do módulo. |
| `marketing:gerenciar` | Criar/editar/excluir campanhas, conteúdos e afiliados; lançar resultados; gerar pedidos de avaliação; registrar notas; editar o modelo da mensagem. |

O Administrador recebe as duas pelo código. **Nenhum perfil padrão recebe as permissões automaticamente**: conceda em *Perfis de acesso* (a migração única pode incluí-las nos perfis Supervisor, ver "Pendências").

## Telas (`apps/web/src/paginas/marketing/`)
Menu **Marketing** (substituiu os itens planejados Avaliações, Origem dos clientes, Campanhas e Afiliados).

- **Vendas por canal** (`/marketing/canais`): reservas e passageiros confirmados por **canal real** = `coalesce(reservas.canal_origem, reservas.canal)` (PAYTOUR, VIATOR, DECOLAR, CIVITATIS, BALCAO) com participação em %, e por passeio e mês. Período padrão: 90 dias.
- **Origem dos clientes** (`/marketing/origem`): ranking de `reservas.origem_cliente` (UF ou país), normalizado em maiúsculas; "sem origem informada" separado do ranking.
- **Campanhas** (`/marketing/campanhas`): nome, mídia, praça (ou todas), período, investimento em **centavos**, cupom, UTM, meta de reservas. **Custo × retorno** só aparece quando há resultado lançado.
- **Calendário de conteúdo** (`/marketing/conteudo`): posts por rede (Instagram, Facebook, TikTok, YouTube, Google Meu Negócio, Blog), situação Ideia → Em produção → Agendado → Publicado, data prevista, responsável (usuário que gerencia o marketing), link e legenda.
- **Avaliações** (`/marketing/avaliacoes`): pedidos de avaliação pós-passeio, notas internas, destaque do Tripadvisor e modelo da mensagem.
- **Afiliados e QR codes** (`/marketing/afiliados`): hotéis, pousadas e parceiros próprios com código, comissão e QR code (pacote `qrcode`, já usado na tela de MFA).

## Regras e decisões
- **Só agregados nos painéis.** Vendas, origem e resumo de avaliações devolvem apenas contagens (testado: nenhum nome de cliente na resposta). O telefone do cliente nunca sai pela API do marketing.
- **Escopo por praça** (ADR 0005): painéis filtram pelas praças do usuário (`filtroUnidade`). Itens com praça (campanha, conteúdo, afiliado) só são vistos/alterados por quem tem a praça; item **de todas as praças** é visto por todos, mas só alterado por quem enxerga todas as praças.
- **Campanhas — atribuição (fonte "a confirmar").** A Paytour ainda não entrega cupom/UTM por pedido (a confirmar na API v2). Por isso o retorno é calculado a partir de **resultados lançados à mão por mês** (reservas, passageiros, receita opcional e a fonte do número). Indicadores: custo por reserva, custo por passageiro, retorno (receita ÷ investimento) e atingimento da meta. Sem lançamento, a tela mostra "sem atribuição" (nunca inventa número).
- **Avaliações.** "Gerar pedidos do período" cria **um pedido por reserva confirmada de saída já realizada** (a saída não pode ser cancelada e a reserva precisa ter ao menos um passageiro que não seja "não veio"), no máximo 31 dias por vez, sem duplicar. Estado do pedido: A enviar, Enviada à mão, Sem telefone (a reserva não tem telefone), Ignorada; "Simulada" fica reservada ao futuro envio. O texto sai do **modelo** com só o primeiro nome do cliente; nada é enviado (a tela deixa claro e tem botão **Copiar**). A **nota interna** (1 a 5, a coluna "Pesquisa" da lista em papel) é por reserva e registrada a partir do pedido; o resumo mostra média, distribuição, por guia e por canal.
- **Destaque Tripadvisor.** Pedidos de reservas com canal real Viator ganham a etiqueta "Tripadvisor" e o resumo conta passageiros Viator; o link da página no Tripadvisor é cadastrado em *Modelo da mensagem* (só https). **A confirmar:** o link oficial (não foi inventado).
- **Afiliados.** Código em maiúsculas, números e hífen (3 a 24 caracteres), único. O link do QR é `<endereço da loja>/?ref=<CÓDIGO>`; o endereço padrão é `https://loja.bybusturismo.com.br` (consta em `produtos-e-site.md`) e pode ser trocado em `marketing_config`. Comissão em pontos-base (1500 = 15%), regra **a confirmar** (as comissões de canais, como Viator 25%, Decolar 30% e Civitatis 20%, estão em `produtos-e-site.md`).
- Toda gravação vai para a **auditoria** (sem conteúdo livre sensível).

## Banco (`apps/api/src/db/esquemas/marketing.ts`)
`campanhas`, `campanha_resultados` (único por campanha e mês), `conteudos`, `avaliacao_pedidos` (único por reserva), `avaliacao_notas` (única por reserva), `afiliados` (código único) e `marketing_config` (chave/valor: `modelo_avaliacao`, `link_tripadvisor`, `url_loja`). Dinheiro em centavos; datas civis em `date`, instantes em UTC.

## API (`apps/api/src/rotas/marketing.ts`)
`GET /api/marketing/painel/canais|origem`, `GET/POST/PATCH/DELETE /api/marketing/campanhas`, `POST|DELETE /api/marketing/campanhas/:id/resultados[/:mes]`, `GET/POST/PATCH/DELETE /api/marketing/conteudos`, `GET /api/marketing/responsaveis`, `GET/PATCH /api/marketing/config`, `GET /api/marketing/avaliacoes/resumo|pedidos|notas`, `POST /api/marketing/avaliacoes/pedidos/gerar`, `PATCH /api/marketing/avaliacoes/pedidos/:id`, `POST /api/marketing/avaliacoes/notas`, `GET/POST/PATCH/DELETE /api/marketing/afiliados`.

Regras puras (canal real, indicadores de campanha, percentuais, código e link de afiliado, modelo da mensagem, média) em `packages/core/src/marketing/marketing.ts`, com testes.

## Pendências e "a confirmar"
1. **Envio por WhatsApp** (pedido de avaliação): depende do provedor (decisão do dono, ver `plano-fase-2.md` seção 4). A API já expõe `envioWhatsapp.ligado = false`; quando ligar, usar a fila `mensagens` do módulo de operação e o status "Simulada/Enviada".
2. **Atribuição por cupom/UTM**: ler na documentação da Paytour v2 se o pedido traz cupom e afiliado; se trouxer, trocar o lançamento manual por cálculo automático (os lançamentos podem continuar como correção).
3. **Ligação com os afiliados da Paytour**: o campo `paytour_afiliado_id` existe, mas ainda não há importação. Pendente: (a) listar os afiliados da Paytour pela API, (b) confirmar se `?ref=` atribui a venda, (c) casar código e afiliado e então mostrar vendas e comissão por afiliado. Os afiliados da Paytour (ex.: "TripAdvisor interno", "Turis Tráfego – Google Ads") não são importados.
4. **Link da página do Tripadvisor**, **regra de comissão dos afiliados** e **meta de reservas** por campanha: valores do dono.
5. **Perfis padrão**: decidir quais perfis recebem `marketing:ver`/`marketing:gerenciar` (sugestão: Supervisor vê; marketing gerencia).
6. **Receita nos painéis de canal**: as reservas não guardam valor; o painel de vendas mostra reservas e passageiros. Receita por canal depende do financeiro/Paytour.
7. **Calendário em grade mensal** (hoje é lista filtrável) e **integração de publicação** nas redes: fora do escopo desta entrega.

## Atualização (06/11/2026)
Abas novas **Instagram** e **Banco de mídias**; o Calendário de conteúdo ganhou o fluxo ideia → rascunho (`PRODUCAO`) → em aprovação → aprovado → agendado → publicado, mídia, agendamento no Instagram e sugestão de legenda por IA. Ver `docs/produto/modulo-instagram.md`.

---

# Marketing 2 (06/11/2026): itens aprovados da pesquisa

Construídos com autonomia dada pelo dono em 06/11/2026 (ver `benchmark-marketing.md`). **Envio real só com provedor de WhatsApp contratado e chaves**: até lá tudo roda em **modo simulado** pela fila `mensagens` (`enfileirarMensagem`/`enviarMensagem` em `servicos/fechamento.ts`), que respeita `WHATSAPP_PROVEDOR`/`WHATSAPP_ENVIO_REAL`. Nada sai de verdade; a mensagem fica "Simulada".

## Permissões (nenhuma nova)
- Telas do Marketing: `marketing:ver` (ver) e `marketing:gerenciar` (gravar), como antes.
- **Orçamentos** (área Reservas, `/orcamentos`): `reservas:editar`. Telefone e e-mail do pedido só aparecem com `manifesto:contatos` (mesma regra dos contatos de reserva).
- Configurações que valem para a empresa toda (**link na bio** e **fluxos de mensagem**) só são alteradas por quem enxerga **todas as praças** (mesma regra dos itens "de todas as praças").
- Rotas públicas (`/api/publico/bio`, `/api/publico/orcamento`, `/api/publico/nps/:token`) não têm login.

## Menu
Abas novas no `MarketingLayout`: Retorno e links, Mensagens automáticas, NPS, Relatórios, Link na bio (e Avaliações evoluída). "Orçamentos" entra em Reservas. A Visão Geral mostra um aviso com orçamentos novos e casos de NPS abertos (`GET /api/marketing/avisos`, só contadores).

## 1. Avaliações: fila e painel
- **Fila diária**: reservas confirmadas de saídas já realizadas (que não foram "não veio"), uma por reserva. A rotina do marketing gera a fila de ontem todo dia (e a tela tem "Gerar fila do período").
- **Idioma** pelo core `idiomaDoCliente`: país por extenso em `origem_cliente` (UF = português; "ES" é Espírito Santo, não Espanha) manda; senão o DDI do telefone (sem "+", número de 10 ou 11 dígitos é brasileiro; o DDD 54 não é a Argentina); DDI desconhecido = inglês; sem nada = português. Editável por pedido.
- **Canal e link**: Google da **praça** (cadastrado em Configuração), Tripadvisor (link do dono, **a confirmar**) ou nenhum. Trocar idioma/canal refaz o texto; o texto também pode ser editado à mão.
- **Viator**: quem comprou pela Viator **não recebe link de outro canal**: a mensagem orienta a avaliar na própria Viator ("Request Reviews", e-mail/app da reserva). Só quem comprou na Viator avalia na Viator.
- **Situação**: A enviar → pedido feito (Enviada à mão / Simulada / Enviada) → Lembrada → Avaliada (marcação manual); Sem telefone e Ignorada ficam fora. **Lembrete sugerido** depois de 7 dias do pedido (botão "Lembrar"; nunca automático). Simulada/Enviada só pelo botão de envio (o PATCH recusa).
- **Envio**: "Enviar" (um) e "Enviar a fila" (lote) usam a fila de mensagens; repetir não duplica (uma mensagem por reserva e tipo `AVALIACAO`/`AVALIACAO_LEMBRETE`). Pedidos de quem tem NPS ficam fora do lote (o convite vai pela página do NPS). O fluxo "Convite de avaliação" pode enviar sozinho a fila (desligado por padrão).
- **Painel**: taxa de pedidos (feitos ÷ reservas realizadas), avaliadas, lembretes sugeridos, nota interna, evolução semanal e **notas e quantidade por canal lançadas à mão por semana** (Google, Tripadvisor, Viator…), da By Bus e de concorrentes (nome livre, opcional); um lançamento por semana, canal, alvo e praça (relançar atualiza).
- **Regras das plataformas (documentado)**: pedir a avaliação a todos os clientes, nunca só aos satisfeitos; sem oferecer vantagem em troca; Viator avalia na Viator. Google e Tripadvisor proíbem filtrar quem pode avaliar.

## 2. Relatórios automáticos
- **Semanal** (segunda, a partir das 07h, semana de segunda a domingo anterior) e **mensal** (dia 1, mês anterior), em America/Sao_Paulo, pelo relógio do marketing (`agendarMarketing`, confere a cada minuto, desligado em `AMBIENTE=testes`; se o servidor estava fora às 07h recupera no mesmo dia; não repete).
- Conteúdo: vendas por canal (reservas, passageiros, receita), origem, campanhas (venda atribuída), avaliações, NPS, orçamentos e bio (estes dois só no consolidado), **sempre comparando com o período anterior**. Vendas e origem contam reservas confirmadas com passeio no período; campanhas contam pela data da compra.
- Um relatório **consolidado** (visível a quem enxerga todas as praças) e um **por praça ativa** (visível a quem tem a praça).
- **Só agregados** (LGPD): testado que nenhum nome/telefone entra. Histórico em Marketing › Relatórios; abrir um relatório dá **link interno** (`/marketing/relatorios/<id>`) e botão **Imprimir ou salvar em PDF** (pelo navegador, CSS de impressão).
- **Resumo escrito pela IA** quando a IA está ligada (`servicos/ia`, uso registrado como `RELATORIO`, respeita o limite mensal); a IA recebe só o JSON agregado. Falha ou IA desligada: fica o resumo só com números. Alteração mínima em `servicos/ia/cliente.ts`: chamada sem ferramentas não envia `tools`/`tool_choice`.

## 3. Link na bio (`/bio`)
- Página pública leve (uma coluna, botões grandes), logo e cores configuráveis, cupom em destaque com botão de copiar; botões configuráveis (Paytour, WhatsApp, Tripadvisor, passeios, site, outro), só `https://`, até 20.
- **Cliques medidos** por botão, dia e origem (`?utm_source=`), tabela `bio_cliques` com contagem; **sem IP, sem cookie, sem dado pessoal** (testado). Tela com visitas, cliques, taxa por visita, por botão, por origem e por dia.
- **Revisão de segurança da rota pública**: GET devolve só rótulo, URL, tipo e destaque dos botões ativos; POST de visita/clique aceita só `botaoId` (uuid de botão ativo) e `origem` (normalizada para `[a-z0-9_-]`, 40 caracteres); limite de 60 requisições por minuto por IP; a URL do botão é validada no cadastro (https) e de novo na página; links com `rel="noopener noreferrer"`; a página não grava nada além de contagens. Exposição: só o que a empresa já divulga na bio. Cuidado de implantação: o servidor web precisa devolver o app para `/bio`, `/orcamento` e `/nps/*` (mesmo ajuste do `/embarque/*`).

## 4. Retorno de campanhas
- **Gerador de links** com UTM e **QR code** (por campanha, por afiliado ou livre): `utm_source/medium/campaign` normalizados; afiliado leva `?ref=CÓDIGO` e UTM `afiliado-<código>`. "Salvar o UTM na campanha" grava o UTM para a atribuição funcionar.
- **Atribuição automática** (core `atribuirVenda`, serviço `atribuicao.ts`) pelos campos da Paytour já importados em `vendas`: 1º `utm_campaign` igual ao UTM da campanha; 2º `cupom_id` igual ao cupom da campanha (sem diferenciar maiúsculas); só vale com a compra dentro do período da campanha; afiliado pelo `afiliado_id` da ficha (`paytour_afiliado_id`) ou pelo UTM do QR. Conta só reservas confirmadas; receita = soma de `reservas.valor_centavos`. **A confirmar:** se o `cupom_id` da Paytour é o código digitado na campanha (hoje se compara com o texto do campo "Cupom").
- **Substitui o retorno digitado**: na lista de Campanhas, com pedido atribuído vale o automático (etiqueta "automática"); sem pedido vale o lançamento manual (que continua guardado).
- **Custo**: o investimento lançado na campanha, ou o **custo importado por CSV** do Google Ads/Meta Ads (por dia; colunas Dia e Custo/Valor gasto; ; ou , ou tab; números BR ou US; linha de total ignorada; reimportar atualiza o dia). **As APIs do Google Ads e do Meta Ads ficam como próxima etapa** (dependem de aprovação das plataformas).
- Tela: reservas, receita, custo por reserva e retorno (×) por campanha e por afiliado, mais pedidos com UTM/cupom sem campanha.

## 5. Orçamento de grupos (`/orcamento`)
- Formulário público curto (nome, organização, tipo, contato, data, nº de pessoas, serviço, cidade, mensagem) com **consentimento LGPD explícito** (guarda instante e versão do texto) e UTM/origem.
- **Anti-spam**: campo isca (preenchido = finge sucesso e não grava), **tempo mínimo de 4 s** (e máximo de 2 h) validado por token assinado (HMAC, sem estado no servidor), **5 envios por hora por IP** e teto global de 100 pedidos por hora.
- Tela **Orçamentos** (Reservas): status Novo → Em contato → Proposta enviada → Fechado/Perdido, responsável, anotações, **anonimizar** (LGPD: apaga dados pessoais). Contador de novos na Visão Geral e no título da tela. A auditoria do recebimento não guarda IP nem dado pessoal.
- **Retenção/atendimento do titular**: a tela anonimiza a pedido; prazo de retenção **a confirmar** com o dono.

## 6. Mensagens automáticas e NPS
- Fluxos (Marketing › Mensagens automáticas), cada um liga/desliga e tem texto por idioma (PT/EN/ES): **Confirmação da compra** (reservas de até 48 h, passeio futuro e lista ainda aberta; segue `MENSAGEM_VOUCHER_AUTOMATICA` até alguém ligar/desligar pela tela), **Véspera** (já existe no fechamento das 21h: aqui só informativa, não duplica), **Convite de avaliação** (fila diária), **Pós-passeio com NPS** e **Cupom de retorno** (opcional, aparece no agradecimento).
- **Pós-passeio**: no dia seguinte (a partir das 09h; recupera até 3 dias) cria a pesquisa, com **link público curto com token** (`/nps/<token>`, só o hash no banco, 30 dias) e manda pela fila (simulada). Página: nota 0–10 e comentário, no idioma do cliente.
- **NPS não decide quem recebe o convite (sem "review gating")**: o convite de avaliação pública vai para **todos que concordarem**, qualquer nota (função `conviteDeAvaliacaoPublica`, testada para as 11 notas). Quem comprou pela Viator é orientado a avaliar na Viator. Nota **0–6** abre um **caso interno** (alerta na Visão Geral e na tela, status, anotações), sem tirar nada do cliente.
- **Painel**: NPS geral, por mês, passeio e guia, taxa de resposta e aceite do convite. Só agregados; o caso mostra só o primeiro nome e o comentário (o contato fica na reserva).
- **Revisão de segurança da rota pública do NPS**: token aleatório de 24 bytes (192 bits) validado por hash, expira em 30 dias, responde 404 igual para inexistente e expirado; a página devolve só passeio, data, primeiro nome, idioma e "já respondeu"; limite de 20 requisições por minuto por IP; resposta única (a segunda é 409, mesmo simultânea); token mascarado nos logs (`/nps/***`); auditoria sem IP e sem texto do cliente.

## Esquema (migração `marketing2`, **não commitada**: gerada só para testar)
Alterada: `avaliacao_pedidos` (+ `idioma`, `canal_avaliacao`, `link`, `pedido_em`, `lembrete_em`, `avaliado_em`).
Novas: `avaliacao_externas` (semana, canal, alvo, praça, nota×100, quantidade), `campanha_custos` (campanha, dia, custo em centavos, cliques, impressões; único por campanha e dia), `relatorios_marketing` (tipo, período, praça, `dados` jsonb, resumos), `bio_botoes`, `bio_cliques` (dia, chave, origem, contagem; único), `orcamentos_grupo`, `fluxos_mensagem` (código, ligado, textos pt/en/es, extra), `nps_respostas` (reserva única, hash do token, nota, comentário, classe, aceite do convite, caso interno). Arquivos: `db/esquemas/marketing2.ts` e `marketing.ts`.

## Auditoria
`AVALIACAO_PEDIDO_ENVIADO/LEMBRETE_ENVIADO/PEDIDOS_ENVIADOS_EM_LOTE`, `AVALIACAO_EXTERNA_LANCADA`, `CAMPANHA_CUSTOS_IMPORTADOS`, `RELATORIO_MARKETING_GERADO`, `BIO_*`, `ORCAMENTO_RECEBIDO/ATUALIZADO/ANONIMIZADO` (com status antes e depois), `FLUXO_MENSAGEM_EDITADO` (ligado antes e depois), `MENSAGENS_AUTOMATICAS_RODADAS`, `NPS_RESPONDIDO`, `NPS_CASO_ATUALIZADO`.

## Simulado e dependências
- **Simulado**: todo envio de mensagem (avaliação, lembrete, confirmação, NPS) até haver provedor de WhatsApp e chaves.
- **A confirmar / depende do dono**: links do Google por praça e do Tripadvisor; texto oficial das mensagens (os padrões são sugestões); se `cupom_id` da Paytour casa com o código da campanha; prazo de retenção dos orçamentos; se a IA fica ligada para os resumos (custo); aprovação das APIs do Google Ads/Meta Ads.
- **Dados reais**: o relógio só cria linhas e mensagens simuladas; com `DADOS_REAIS_AUTORIZADOS` só números agregados aparecem nas respostas.

## Comissões de afiliados (13/11/2026)
Regras do dono em `docs/conhecimento/canais-e-integracoes.md`. Tela **Marketing › Comissões de afiliados** (`marketing:ver`).
- **Valor:** o da Paytour (`vendas.afiliado_comissao_centavos`), rateado entre as reservas do pedido pelo valor de cada uma
  (`ratearComissao` no core). A porcentagem de cada afiliado continua configurada na Paytour (decisão do dono).
- **Cadastro:** cada afiliado da Paytour que aparece nas vendas ganha cadastro sozinho na sincronização (código `PT-<id>`,
  `afiliados.paytour_afiliado_id` único). O nome pode ser editado em "Afiliados e QR codes".
- **Situação** (calculada na hora, acompanha mudanças da reserva): Prevista (passeio não realizado), A pagar (realizado),
  Cancelada (reserva cancelada ou todos os passageiros "não veio"), Paga (conta a pagar baixada no financeiro).
- **Pagamento quinzenal:** dia 01 (passeios de 16 ao fim do mês anterior) e 16 (01 a 15). "Gerar contas a pagar"
  (`financeiro:gerenciar`, só depois do fim do período) cria **uma conta a pagar por afiliado e praça** (categoria
  Afiliados, vencimento no dia do pagamento, origem `AFILIADOS`) e congela os valores (`afiliado_pagamentos` e
  `afiliado_pagamento_itens`, uma reserva em um pagamento só). Comissões esquecidas de quinzenas anteriores entram junto.
  **Desfazer** apaga a conta enquanto não foi paga nem conciliada; se a conta for excluída no financeiro, as comissões
  voltam a ficar a pagar.
- **Corte do histórico:** antes do primeiro pagamento, informar "comissões já pagas até o passeio de" (data); as de antes
  contam como pagas fora do sistema (chave `comissoes_pagas_ate` em `marketing_config`, `PUT /api/afiliados/corte`,
  auditado). Sem o corte, gerar pagamento é bloqueado — evita pagar o histórico duas vezes.
- Relatório pela data do **passeio** ou da **venda**, filtro por afiliado e **ranking** (reservas, valor vendido e comissão).
- API: `GET /api/afiliados/comissoes?de&ate&por&afiliadoId`, `GET|POST /api/afiliados/pagamentos`, `DELETE /api/afiliados/pagamentos/:id`.
- Próximo passo: **portal do afiliado** (login próprio: comissões, dados bancários, link e QR code).
