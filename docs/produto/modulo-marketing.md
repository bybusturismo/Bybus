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
