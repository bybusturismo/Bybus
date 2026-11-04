# Módulo Rastreamento (04/11/2026)

Ver o ônibus no mapa e avisar o passageiro quando ele estiver chegando ao ponto, como nos aplicativos de transporte. **Decisão do dono (04/11/2026):** a Khronos não libera API (só pagando caro, recusado); o rastreio é feito pelo **celular do motorista**. Decisão técnica: `docs/arquitetura/adr/0007-rastreio-pelo-celular-do-motorista.md`.

## Como funciona
1. **Motorista** abre o sistema no celular (`/motorista`; quem só tem `rastreio:transmitir` ou `frota:checklist` cai direto aqui), vê as saídas de hoje em que está escalado e toca em **Iniciar rastreio**.
2. O sistema cria uma **sessão**, enfileira para cada reserva confirmada da saída a mensagem **RASTREIO** com o link (`/rastreio/<token>`) e começa a receber a posição do GPS (lotes de até 20 a cada ~15 s; fila local se a internet cair).
3. **Passageiro** abre o link (sem login): mapa com o ônibus, o ponto dele e "chega em ~X min"; atualiza a cada 20 s. Depois do ponto, mostra "o ônibus já passou". Antes de o ônibus sair: "o ônibus ainda não saiu".
4. **Equipe** (menu Passeios > Rastreamento): saídas do dia com situação (Transmitindo, Sem sinal há X min, Encerrado, Não iniciado), mapa com trajeto e rota, e botão para encerrar um rastreio esquecido (`saidas:decidir`).
5. **Encerrar** pelo motorista (ou pela supervisão); sessões esquecidas abertas de dias anteriores são encerradas pela rotina de limpeza.

## Como ligar o motorista ao acesso dele
Em **Guias e equipe**, edite o motorista e escolha o **acesso do motorista** (usuário com perfil que tenha `rastreio:transmitir`). A ligação (`pessoas.usuarioId`) é de um usuário para uma pessoa, só com usuários das praças de quem edita, e é auditada com o valor anterior. Sem essa ligação o motorista não vê saída nenhuma na tela dele. API: `GET /api/pessoas/usuarios-disponiveis` e `usuarioId` em `POST/PATCH /api/pessoas`.

## Permissões e escopo
- `rastreio:transmitir` (nova): motorista. **ADMIN** recebe pelo código. Perfil **MOTORISTA** recebe pela migração (SQL abaixo).
- Só transmite quem é o motorista da saída (pessoa com `usuarioId` = usuário logado), **no dia da saída** (America/Sao_Paulo). Qualquer outro usuário recebe 403.
- Equipe (`manifesto:ver` ou `saidas:decidir`) vê as saídas da própria praça (escopo por unidade); outra praça responde 404.

```sql
-- anexar à migração de implantação (perfil MOTORISTA recebe a permissão nova)
UPDATE perfis SET permissoes = array_append(permissoes, 'rastreio:transmitir')
 WHERE codigo = 'MOTORISTA' AND NOT ('rastreio:transmitir' = ANY(permissoes));
```

## Esquema (resumo)
- `pontos_embarque.latitude`, `longitude` (double precision, nulas). Editáveis em **Passeios e pontos > Pontos** (validação de faixa; as duas juntas ou nenhuma; ajuda "copie do Google Maps"). Alterações são auditadas com o valor anterior.
- `rastreio_sessoes` (saída, motorista, iniciada/encerrada, última posição, último ponto alcançado; **uma aberta por saída**), `rastreio_posicoes` (lat, lng, precisão, velocidade, direção, instante; única por sessão+instante, então reenvio não duplica), `rastreio_links` (reserva, hash SHA-256 do token, expiração).

## API
- Motorista: `GET /api/rastreio/minhas-saidas`; `POST /api/rastreio/saidas/:id/iniciar`; `POST /api/rastreio/sessoes/:id/posicoes` (1 a 20; faixa lat/lng; descarta precisão > 200 m, horário fora do dia da saída ou no futuro; limite de 30 req/min); `POST /api/rastreio/sessoes/:id/encerrar`.
- Equipe: `GET /api/rastreio/saidas?data=` e `GET /api/rastreio/saidas/:id` (situação, última posição, trajeto, pontos).
- Público: `GET /api/publico/rastreio/:token`.
- Auditoria: `RASTREIO_INICIADO`, `RASTREIO_ENCERRADO` e `PONTO_ALTERADO` (cada posição **não** é auditada).

## Revisão da rota pública (`/api/publico/rastreio/:token`)
- **O que expõe:** nome e cidade do passeio, data, situação, nome/horário/coordenadas do ponto **da própria reserva**, posição do ônibus (só com rastreio ligado), pontos da rota (nome e coordenadas, já públicos no site) e a previsão. **Não expõe** motorista, guia, placa/veículo, ids internos, nem outros passageiros ou contatos (há teste automatizado de vazamento).
- **Quem pode chamar:** quem tem o link. Token de 24 bytes aleatórios (base64url, 32 caracteres); só o **hash** fica no banco; token **mascarado** no log (`/rastreio/***`). Limite de 60 requisições por minuto por IP. Token inválido, vencido, reserva ou saída cancelada: mesma resposta 404 "link inválido".
- **Expiração:** fim do dia do passeio em Brasília (00:00). Depois do encerramento o ônibus some do mapa.
- **Só leitura:** a rota não altera nada.
- **Referrer:** o mapa carrega blocos do OpenStreetMap com `referrerPolicy: strict-origin-when-cross-origin`: só o domínio do sistema segue ao OSM, nunca o caminho com o token.

## Previsão de chegada (estimativa simples)
`tempo = (soma das distâncias em linha reta: ônibus → pontos restantes → ponto do cliente) × 1,3 ÷ velocidade média recente + 1 min por parada intermediária`.
- Velocidade média das últimas 5 posições (GPS), **mínimo 15 km/h**, **padrão 25 km/h** sem dados.
- "Pontos restantes" = pontos depois do último em que o ônibus esteve a até 150 m (passar por um ponto adiante conta os anteriores). Dentro de 150 m do ponto do cliente: "no seu ponto".
- Não considera trânsito, semáforos, obras nem ordem real das ruas. Ponto sem coordenadas no trecho: **sem previsão** (o cliente ainda vê o ônibus no mapa). Pressupõe que o ônibus siga os pontos ativos na ordem de embarque.
- Código: `packages/core/src/rastreio/previsao.ts` (testes em `packages/core/test/rastreio.test.ts`).

## Mensagem RASTREIO
Enfileirada ao iniciar o rastreio, **uma por reserva confirmada** (índice único reserva+tipo), pelo mesmo caminho do fechamento (`enfileirarMensagem`), respeitando o modo simulado (hoje WhatsApp **simulado**). Sem `URL_PUBLICA` configurada não há como montar o link e nada é enfileirado (a resposta traz `semUrlPublica`). Reiniciar no mesmo dia mantém o link e não reenvia. Texto: `textoRastreio` em `packages/core/src/mensagens.ts` — **a confirmar** o texto oficial com o dono.

## LGPD
- A localização do motorista só existe **dentro de uma sessão** e só é aceita no dia da saída.
- Posições com mais de **30 dias** são apagadas por rotina automática (de hora em hora; também fecha sessões esquecidas e links vencidos).
- Sem posição do motorista para o público depois que o rastreio é encerrado. Nenhum dado de passageiro entra na tela do motorista.
- Dados fictícios em todos os testes e na demonstração.

## Limitações conhecidas
- **GPS no navegador para com a tela apagada ou outro app em primeiro plano.** Por isso a tela do motorista mostra sempre: "Mantenha esta tela aberta e o celular no carregador; se a tela apagar ou outro app abrir, o rastreio para." e usa Wake Lock (nem todo navegador oferece). A equipe vê "sem sinal há X min". **O definitivo é o app Android/iOS com rastreio em segundo plano — a fazer.**
- **Bateria e dados:** GPS de alta precisão com a tela acesa gasta bateria (carregador no carro); o envio é pequeno (algumas centenas de bytes por posição, 1 lote a cada 15 s).
- **Coordenadas dos pontos a cadastrar** (a confirmar com o dono; ver `docs/produto/plano-fase-2.md`). Sem elas não há previsão nem pontos no mapa.
- A rota é a ordem dos pontos de embarque; saídas com roteiro diferente da ordem cadastrada terão previsão imprecisa.
- Uma sessão aberta por saída; trocar de motorista no meio do dia exige a supervisão encerrar a sessão anterior.

## Mapa: OpenStreetMap
- Leaflet **1.9.4** (versão fixa, lançada em 05/2023) e `@types/leaflet` 1.9.12; blocos `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, com atribuição "© OpenStreetMap". Sem chave, sem custo.
- **Política de uso justo do OSM:** os servidores de blocos são voluntários e não são para uso intenso; exigem atribuição, identificação do site (Referer) e cache. O volume esperado (dezenas de acessos por saída) é pequeno. **Com muito volume, trocar de provedor** (blocos próprios ou serviço pago) — **a confirmar** com o dono, junto com o custo.
- Caddy: `img-src` ganha só `https://tile.openstreetmap.org`; `Permissions-Policy` passa a `geolocation=(self)`.

## Demonstração
`apps/web/src/demo/rastreioDemo.ts`: um ônibus **fictício** anda entre 6 pontos fictícios de Florianópolis em simulação acelerada (108 km/h). Nas três telas: Rastreamento (equipe), "Rastreio do motorista" (GPS simulado, sem usar o GPS real) e "Ver como o cliente vê" (página pública, só na demonstração, já que ela não tem endereços próprios).

## Pendências / a confirmar
- Coordenadas oficiais dos pontos de embarque.
- Texto oficial da mensagem RASTREIO e provedor real de WhatsApp.
- App Android/iOS com rastreio em segundo plano.
- Provedor de mapas se o volume crescer; avisos de 10 e 5 minutos e "o ônibus está no ponto" (ideia original; precisa de WhatsApp real).
