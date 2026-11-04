# ADR 0007 — Rastreio do ônibus pelo celular do motorista

- **Status:** aceito (04/11/2026)
- **Decisão do dono:** a Khronos não libera API (só pagando caro, recusado). O rastreamento será feito pelo **celular do motorista**, conectado ao nosso sistema.

## Contexto
O pedido do dono é um link, enviado aos passageiros, com o ônibus no mapa e "chega em ~X min" ao ponto de embarque, como nos aplicativos de transporte. O plano inicial dependia da API do rastreador da Khronos; sem ela, a posição precisa vir de outra fonte. A frota é pequena e todo motorista já usa celular com GPS.

## Decisão
1. **Fonte da posição:** GPS do navegador do celular do motorista (`navigator.geolocation.watchPosition`, alta precisão), numa tela própria (`/motorista`), com envio em lotes de até 20 posições a cada ~15 s, fila local se faltar internet e Wake Lock para manter a tela acesa.
2. **Quem transmite:** só o motorista escalado na saída (pessoa ligada ao usuário), no dia do passeio (America/Sao_Paulo), com a permissão nova `rastreio:transmitir`. A regra é toda no servidor.
3. **Dados:** `rastreio_sessoes` (uma aberta por saída), `rastreio_posicoes` (só dentro de uma sessão) e `rastreio_links` (token por reserva, só o hash no banco). Pontos de embarque ganham `latitude` e `longitude` opcionais.
4. **Link público** no padrão do link de embarque: token aleatório de 24 bytes, só o hash no banco, expira no fim do dia do passeio, limite de requisições, token mascarado no log. Mostra apenas passeio, ponto da própria reserva, posição do ônibus (só em serviço), pontos da rota e previsão. Nunca motorista, placa, guia nem outros passageiros.
5. **Previsão de chegada:** função pura no `@bybus/core`: distância em linha reta pelos pontos restantes × 1,3 ÷ velocidade média recente (mínimo 15 km/h, padrão 25 km/h) + 1 min por parada intermediária. É uma **estimativa simples**, sem trânsito; sem coordenadas, sem previsão.
6. **Mensagem RASTREIO:** ao iniciar o rastreio, uma por reserva confirmada, pela fila de mensagens existente (respeita o modo simulado). Reiniciar no mesmo dia não reenvia.
7. **Mapa:** Leaflet 1.9.4 (versão fixa) com blocos do OpenStreetMap, sem chave e sem custo. A política de segurança (CSP) do Caddy libera só `img-src https://tile.openstreetmap.org`; a permissão de localização passa de bloqueada para `geolocation=(self)`.
8. **LGPD:** a localização do motorista só existe em sessão de rastreio; posições com mais de 30 dias são apagadas; auditam-se início e fim (não cada posição); posições com precisão pior que 200 m são descartadas.

## Alternativas descartadas
- **API da Khronos:** cobrada em plano caro; recusada pelo dono.
- **Traccar Client (app de terceiros) + servidor Traccar:** mais uma peça para manter e sem integração com a escala/saída; pode voltar como alternativa se o app próprio demorar.
- **Mapa pago (Google Maps, Mapbox):** custo recorrente e chave; decisão de custo é do dono.

## Consequências
- **Limitação do navegador:** com a tela apagada ou outro app em primeiro plano, o GPS do navegador para. O aviso fica sempre visível na tela do motorista; a equipe vê "sem sinal há X min". O definitivo é o **app Android/iOS com rastreio em segundo plano** (a fazer; depende de contas das lojas).
- Consumo de bateria e de dados do celular do motorista; recomendar carregador.
- A previsão depende das coordenadas dos pontos, ainda a cadastrar (a confirmar com o dono).
- Os blocos do OpenStreetMap têm política de uso justo: com muito volume (muitos links abertos ao mesmo tempo), trocar de provedor (a confirmar).
- O perfil MOTORISTA precisa receber `rastreio:transmitir` (UPDATE na migração de implantação); o ADMIN já recebe pelo código.
