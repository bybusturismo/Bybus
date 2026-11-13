# Previsão do tempo (13/11/2026)

Pedido do dono: ícone discreto da previsão (sol, nuvem, chuva…) no calendário e nos dias de passeio, "como na TOMA", e uma
**solução definitiva** (sem custo e sem depender de alguém atualizar).

## Como funciona
- **Próximos ~9 dias:** previsão do **MET Norway** (instituto de meteorologia da Noruega; `api.met.no`), gratuita, sem chave e
  com **uso comercial permitido** (licença CC BY 4.0: o crédito aparece na dica do ícone). O servidor consulta a cada **3 horas**,
  só com as coordenadas do centro de cada praça (`unidades.latitude/longitude`), e grava em `tempo_previsoes`.
- **Datas mais distantes:** **média histórica** daquele dia do ano (1991–2020) da **NASA POWER** (gratuita, uso comercial
  permitido), baixada **uma vez** por praça e gravada em `tempo_normais`. O ícone aparece mais claro e a dica diz
  "Média histórica para o dia (ainda sem previsão): 40% de chance de chuva". Nenhum serviço prevê com confiança além de ~2
  semanas; a média mostra o que costuma acontecer.
- **Dias que já passaram** ficam com a última previsão gravada (registro de como estava o tempo).
- Ícone do dia: olha o horário do passeio (7h às 19h, horário de Brasília): trovoada → tempestade; chuva ≥ 5 mm → chuva;
  ≥ 0,5 mm → chuva fraca; senão o céu mais frequente (sol, sol entre nuvens, nublado, neblina). Regras em
  `packages/core/src/clima/tempo.ts`.
- Se um serviço falhar, nada é apagado: fica a última previsão; o erro vai para o registro do servidor.

## Onde aparece
Saídas (Disponibilidade), dia do passeio (cabeçalho da saída), Escala mensal e "Saídas de hoje" na Visão geral. Passando o mouse
(ou tocando) aparece a descrição. Não sai na impressão.

## API
`GET /api/tempo?de&ate[&unidadeId]` (`manifesto:ver`, respeita as praças do usuário) e `POST /api/tempo/atualizar`
(`unidades:gerenciar`, atualiza na hora; o servidor já faz sozinho a cada 3 h).

## Coordenadas das praças
Centro das cidades (dado público), gravado pela migração 0045: Florianópolis, Balneário Camboriú e Blumenau.
