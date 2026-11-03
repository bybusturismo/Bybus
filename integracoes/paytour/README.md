# Conector Paytour (API v2) → lista de passageiros

Documentação oficial: https://api-ha.paytour.com.br/apiv2doc · base da API: `https://api.paytour.com.br/v2` · plano Premium (já contratado).

## Como funciona
1. **Login** com as credenciais do aplicativo: `POST /lojas/login?grant_type=application` com `Authorization: Basic base64(app_key:app_secret)` → `access_token` (Bearer). Ao vencer, novo login.
2. **A cada 5 minutos** (`PAYTOUR_SINCRONIZAR_MINUTOS`): `GET /pedidos?includeItems=1&includeObs=1&updatedAtMin=…&updatedAtMax=…` (100 por página), relendo 10 min de margem desde a última execução. Primeira execução: últimos 30 dias (`PAYTOUR_DIAS_INICIAIS`).
3. Cada pedido vira uma reserva por passeio/dia (`packages/core/src/importadores/paytour-api.ts`):
   - passageiros = soma das `quantidade` dos itens, com a categoria pela faixa etária (`produto_faixa_etaria_nome`);
   - nome, documento e **ponto de embarque** vêm do formulário inteligente do item;
   - status cancelado/estornado cancela a reserva; status diferente de aprovado entra com aviso;
   - documento 1111/2222/3333 marca espelho de Viator/Decolar/Civitatis.
4. Importação idempotente pelo código `PAYTOUR-<id do pedido>` (o mesmo do CSV); fora da produção, **anonimizada**.
5. O passeio do sistema é escolhido pelo "padrão de produto" do passeio (ex.: `toda ilha|whole island|floripa city tour`). Produto que não casa entra como ignorado na prévia.

## Ligar
No servidor (variáveis de ambiente — nunca no código, chat ou e-mail):
```
PAYTOUR_APP_KEY=...
PAYTOUR_APP_SECRET=...
```
Crie um aplicativo novo na Paytour (Avançado → Aplicativos → Adicionar Aplicativo), nome "bybus-gestao".

Conferir e forçar: `GET /api/integracoes/paytour` (situação) e `POST /api/integracoes/paytour/sincronizar` (agora; `{"desde":"AAAA-MM-DD"}` relê a partir de uma data). Permissão: `importacoes:executar`.

## Validado com dados reais (03/11/2026, prévia sem gravar)
265 pedidos dos últimos 30 dias → 573 passageiros; status "aprovado"/"cancelado"; 1 item = 1 pessoa; formulário com `nome_completo`, `documento_rg_cpf_passaporte` e `ponto_de_embarque` (tipo "hospedagem"); horário em `produto_disponibilidade_hora_de`; todos os 12 pontos casaram com a tabela oficial; 33 espelhos de Viator reconhecidos. Bruxólico e Oktobertour ficam ignorados até serem cadastrados como passeios.

## A confirmar com dados reais
- Outros status além de aprovado/cancelado (4 pedidos vieram com status diferente).
- Fuso dos filtros `updatedAtMin/Max` (assumido: Brasília).
- Webhooks (`/webhooks`, seção não lida — link do site bloqueado neste ambiente): avisos imediatos de venda/cancelamento; a Paytour espera HTTP 2xx e tenta de novo em 30 s, 5, 10 e 20 min.

## Rodar de um ambiente com proxy (ex.: sessão na nuvem)
O `fetch` do Node só usa o proxy com `NODE_USE_ENV_PROXY=1` (e `NODE_EXTRA_CA_CERTS` apontando para o certificado do proxy).
