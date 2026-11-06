# Integração: Instagram (API oficial da Meta)

- **Tipo:** API (Graph API, "Instagram API com Instagram Login") + webhook. **Autenticação:** token de acesso da conta no cabeçalho `Authorization: Bearer` (variável `INSTAGRAM_TOKEN`; nunca na URL nem no código); webhook por token de verificação (GET) e assinatura HMAC `X-Hub-Signature-256` com o app secret (POST).
- **Limites:** Direct só até 24 h depois da última mensagem do cliente; publicações por dia (a confirmar, citado 100); limite de chamadas da Meta (429 tratado como erro transitório).
- **Mapeamento:** mensagem → `wa_mensagens` (conversa `wa_conversas` com canal INSTAGRAM, `ig:<IGSID>`); comentário → `ig_comentarios`; métricas → `ig_metricas_dia`; posts → `ig_posts`; post agendado → `conteudos` + `conteudo_midias`. Produto/saída/tarifa/reserva/passageiro: não se aplicam (a conversa não é ligada a reservas; sem telefone).
- **Idempotência:** id externo único (mid, id do comentário, id do post); upserts por dia; publicação com reserva atômica e contêiner reaproveitado.
- **Erros:** só o código da Meta é gravado (`META_<código>`); falha de publicação tenta de novo com espera crescente (3 vezes). Testes só com mocks, nunca contra a Meta.
- Detalhes, segurança e itens "a confirmar": `docs/produto/modulo-instagram.md`.
