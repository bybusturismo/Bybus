# Módulo WhatsApp: central de conversas (04/11/2026)

Pedido do dono: "o WhatsApp precisa de uma tela que mostre as trocas de mensagens". Modelo: o WhatsApp do APP TOMA (Evolution API), adaptado a reservas e praças.

## O que faz
- Tela **Passeios > WhatsApp** (`/whatsapp`): à esquerda a lista de conversas (nome ou telefone, prévia, hora, contador de não lidas, busca e filtro "não lidas"); à direita o histórico em balões (cliente à esquerda, nós à direita, com hora e situação: simulada, enviada, lida, falhou). Mensagens da fila automática aparecem marcadas "Automática · confirmação/voucher/rastreio". Acima do histórico, as **reservas confirmadas daquele telefone** (link para a saída) ou "Contato sem reserva". Enter envia, Shift+Enter quebra a linha. Atualiza a cada 10 s. No celular, uma coluna (lista, depois conversa, com "voltar").
- Aviso fixo quando o WhatsApp está em **modo simulado** ("nada é enviado de verdade").
- **Nova conversa** por telefone (com primeira mensagem opcional).
- Tudo que a fila automática envia (`enviarMensagem`) também é gravado na conversa do destinatário. Mensagens para grupo (lista das 21h) ficam de fora.
- Mídia (imagem, áudio, documento) registra só o tipo e a legenda; o arquivo não é baixado nesta versão (a confirmar).

## Dados
`wa_conversas` (uma por telefone; `chave` = DDI+DDD+8 últimos dígitos, que une o número com e sem o 9 extra; `jid`, `nome` (pushName ou titular da reserva), `unidadeId`, `ultimaMensagemEm`, `naoLidas`, `arquivada`) e `wa_mensagens` (`direcao` ENTRADA/SAIDA, `texto`, `tipo`, `idExterno` único para deduplicar, `status` ENVIADA/SIMULADA/FALHA/RECEBIDA/LIDA, `enviadaPor`, `mensagemFilaId` único). A conversa recebe a praça da reserva mais próxima de hoje com aquele telefone; sem reserva, fica sem praça. Quando o WhatsApp esconde o número (endereço `@lid`), a conversa usa `lid:<código>` e a resposta vai pelo JID.

## Permissões
- `whatsapp:ver`: ver conversas (telefones e textos). Conversa com praça só para quem tem a praça; sem praça, para quem tem `whatsapp:ver`.
- `whatsapp:responder`: responder e abrir conversa nova (exige também `whatsapp:ver`).
- ADMIN recebe pelo código. Supervisor e atendente: SQL na migração (ver relatório da entrega). Não são permissões "sensíveis" (não forçam MFA): a decidir pelo dono.

## API
`GET /api/whatsapp/conversas?busca=&naoLidas=1`, `GET /api/whatsapp/conversas/:id` (com reservas), `GET .../:id/mensagens?antes=&limite=` (mais recentes primeiro), `POST .../:id/lida`, `POST .../:id/responder` (texto até 4.096; 30 por minuto), `POST /api/whatsapp/conversas` (telefone). Resposta respeita o modo: simulado grava SIMULADA; real envia pela Evolution e grava ENVIADA ou FALHA (a falha fica visível na tela).

## Entrada: aviso (webhook) da Evolution
`POST /api/interno/whatsapp/<WHATSAPP_WEBHOOK_TOKEN>` (variável com 32 caracteres ou mais; sem ela a rota responde 404).
- Chamada só pela rede interna do Docker (`http://api:3333/...`). Recusa (404) quando há `X-Forwarded-For` (tudo que passa pelo Caddy tem), token errado ou ausente (comparação em tempo constante por hash) e o Caddy ainda bloqueia `/api/interno/*` na borda. A rota não aceita o cabeçalho CSRF do navegador porque quem chama não é navegador; o token faz esse papel.
- Aceita só `messages.upsert`, `messages.update` e `connection.update`; ignora grupos (`@g.us`), status, canais, reações e outras instâncias. Mensagens enviadas pelo celular entram como saída. Duplicadas (mesmo `idExterno`) são ignoradas.
- **Log:** o token é mascarado (`/api/interno/whatsapp/***`) e nenhum texto, telefone ou nome vai para log. A auditoria da resposta guarda só o id da conversa.

### Configurar
**Jeito rápido (09/11/2026):** no servidor, `bash /opt/bybus/implantacao/ligar-whatsapp.sh` faz os passos abaixo (gera as chaves que faltam,
liga a Evolution, cria a instância, configura o aviso para o Bybus) e pede o número: mostra um **código de 8 letras** para digitar no celular em
WhatsApp > Aparelhos conectados > Conectar com número de telefone. Testado contra a Evolution 2.3.7 (criar instância, webhook, estado). Decisão do
dono (09/11/2026): **sem provedor pago, igual ao APP TOMA**.

Jeito manual:
1. Gerar `WHATSAPP_WEBHOOK_TOKEN` (`openssl rand -hex 32`) e `EVOLUTION_API_KEY`, `EVOLUTION_DB_PASSWORD` no `.env`; definir `WHATSAPP_PROVEDOR=evolution`, `EVOLUTION_URL=http://evolution:8080`.
2. Subir com `docker compose -f implantacao/docker-compose.yml --env-file implantacao/.env --profile whatsapp up -d` (Evolution v2.3.7 fixa, sem porta pública).
3. Criar a instância `bybus` na Evolution e ler o QR code (WhatsApp > Aparelhos conectados). Fora da produção, o envio real só com `WHATSAPP_ENVIO_REAL=true`.
4. Configurar o webhook da instância (`POST /webhook/set/bybus` com a chave da Evolution): `url` = `http://api:3333/api/interno/whatsapp/<token>`, `enabled` true, `webhook_by_events` false, `webhook_base64` false, `events` = `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`.

## Riscos e decisões (a confirmar com o dono)
- A Evolution **não é oficial** (WhatsApp Web): há risco de bloqueio do número. Usar para conversar e responder; **sem disparo em massa** nem mensagens automáticas para quem nunca escreveu. A fila atual só confirma saídas de quem comprou.
- Se o número conectado for pessoal, definir quem pode ver (o APP TOMA tem "modo pessoal"). Aqui o controle é por permissão e praça.
- LGPD: texto das conversas fica só no banco; sem exportação; leitura de conversa não é auditada (só respostas e nova conversa). Política de retenção: a definir.
- A conexão da Evolution fica só em memória (some ao reiniciar a API até o próximo aviso).
- Pendências: baixar mídia, marcar como lida no WhatsApp do cliente, arquivar conversa (coluna existe, sem botão), tempo real (hoje, atualização a cada 10 s), vincular a conversa a um cliente manualmente.

## Atualização (06/11/2026): central "Conversas"
A tela virou **Conversas** (`/conversas`; `/whatsapp` redireciona) com WhatsApp e Instagram, etiquetas, atendente, respostas prontas e comentários. Ver `docs/produto/modulo-instagram.md`. As rotas continuam em `/api/whatsapp/*` (com `canal` e filtros novos).
