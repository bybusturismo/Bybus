# Canais de venda e integrações

> Pesquisa de 22/10/2026 feita a partir de trechos de buscadores (as páginas inteiras foram bloqueadas pela rede do ambiente). Itens marcados **[NÃO CONFIRMADO]** precisam de validação.

## Canais atuais da Bybus (informado pelo dono)
Site/loja própria · **Paytour** (a "Peitur") · **Decolar** · **Tripadvisor** · **Civitatis** · quiosque Villa Romana Shopping · WhatsApp. Também aparece em Wotif/Expedia.

## Paytour (paytour.com.br)
- Sistema brasileiro de reservas para receptivos: loja/motor de reservas com controle de vagas, venda de balcão, afiliados com comissão, POS, Pix/cartão/"Pix parcelado"/sinal/pagamento no dia, app de check-in com baixa de voucher, relatórios.
- Integração **nativa com Civitatis** (reservas da Civitatis entram na Paytour).
- Planos (podem estar desatualizados): Controle R$ 89/mês · Performance R$ 249/mês + taxa (inclui Civitatis) · **Premium R$ 379/mês — único com "acesso a API"**.
- **API sem documentação pública.** Endpoints, autenticação e webhooks [NÃO CONFIRMADO]. → Pedir à Paytour documentação + sandbox.
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
