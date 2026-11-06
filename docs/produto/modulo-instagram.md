# Módulo Instagram (06/11/2026)

Pedido do dono: (1) trazer os dados do Instagram para o Marketing, (2) responder mensagens (Direct) e comentários pelo sistema e (3) agendar postagens. Decisão: **API oficial da Meta, "Instagram API com Instagram Login"**, conta profissional da própria By Bus (acesso padrão, **sem App Review**). O sistema ainda não está no ar e não há token: tudo foi construído e testado em **modo simulado** (nenhuma chamada externa nos testes). Nada foi testado contra a Meta de verdade.

## Modos
- **Sem `INSTAGRAM_TOKEN` e `INSTAGRAM_CONTA_ID`:** "Instagram não conectado" (avisos nas telas). Nada é lido nem enviado.
- **Com token, fora da produção:** continua simulado, a menos que `INSTAGRAM_ENVIO_REAL=true` (mesma trava do WhatsApp). Em produção fala de verdade.
- **Simulado:** respostas e comentários ficam registrados como "simulada"; posts agendados viram "publicado (simulado)"; a leitura diária não roda e não inventa números.
- LGPD: mensagens e comentários (texto, autor) ficam só no banco; nunca em log; a auditoria guarda só ids. A leitura real de métricas/posts também só acontece no modo real.

## Passo a passo para o dono
1. Transformar o Instagram da By Bus em **conta profissional** (Configurações > Tipo de conta). Conferir se está ligado a uma Página do Facebook não é necessário neste fluxo (a confirmar na doc).
2. Criar uma **conta de desenvolvedor** em developers.facebook.com.
3. Criar um **app** do tipo **Empresa** e adicionar o caso de uso/produto **Instagram** (API com login do Instagram), com mensagens e conteúdo.
4. Em *API setup with Instagram login*, **adicionar a conta** da By Bus como conta de teste/função do app e fazer o login dela. Como é só a conta da própria empresa, basta o **acesso padrão**.
5. Permissões: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`, `instagram_business_content_publish` (e a de insights conforme a doc; a confirmar o nome exato).
6. **Gerar o token** da conta (o painel entrega um token de longa duração; vale cerca de 60 dias e precisa ser renovado — renovação automática **não implementada**, a confirmar). Anotar também o **id da conta**.
7. Colocar no servidor (arquivo `.env` de `implantacao/`, nunca no código): `INSTAGRAM_TOKEN`, `INSTAGRAM_CONTA_ID`, `INSTAGRAM_APP_SECRET` (segredo do app), `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` (um texto longo que você inventa, 16+ caracteres), `URL_PUBLICA` (https do sistema), opcionais `INSTAGRAM_API_VERSAO` (padrão `v23.0`, a confirmar) e `INSTAGRAM_GRAPH_URL`. Em produção o modo real liga sozinho.
8. **Webhook** no painel da Meta: URL de retorno `https://<endereço do sistema>/api/webhooks/instagram`, token de verificação = `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`; assinar os campos `messages` e `comments`. A Meta faz um GET de verificação; depois manda POST assinado.
9. Conferir na tela **Conversas** (aviso some) e em **Marketing > Instagram** ("Atualizar agora").

## O que faz
- **Marketing > Instagram:** números do período (seguidores com variação, alcance, visualizações, visitas ao perfil, cliques no site, posts, interações), evolução de seguidores e alcance (SVG), ranking de posts por engajamento (curtidas+comentários+salvamentos+compartilhamentos) e melhores dias/horas (America/Sao_Paulo; "melhor combinação" só com 2+ posts). Leitura diária às 05:30 e botão "Atualizar agora".
- **Conversas** (`/conversas`, antiga tela WhatsApp; `/whatsapp` redireciona): canal em cada conversa (ícone), filtro de canal, etiquetas e atendente. Direct do Instagram entra pelo webhook, responde pela tela com **janela de 24 h** (tempo restante visível; fora dela, aviso e caixa bloqueada; a API recusa com 409). Instagram não abre conversa nova (só responde). Aba **Comentários do Instagram**: responder em público (só comentário de primeiro nível; a confirmar) ou ocultar.
- **Calendário de conteúdo:** anexar mídia, legenda, tipo (imagem, carrossel, reels; story "a confirmar"), data e hora; aprovação; agendamento; publicação automática; banco de mídias; sugestão de legenda por IA.

## Dados (migração gerada só para teste, não commitada)
- `wa_conversas` ganha `canal` (WHATSAPP|INSTAGRAM), `idContato` (IGSID), `ultimaEntradaEm` (base da janela de 24 h), `etiquetas text[]` e `atendenteId`; no Instagram `telefone` e `chave` valem `ig:<IGSID>`. `wa_mensagens` é a mesma (id externo único = dedup).
- Novas: `ig_metricas_dia` (dia, seguidores, alcance, visualizações, visitas, cliques), `ig_posts` (id externo, tipo, legenda, link, data, curtidas, comentários, salvamentos, compartilhamentos, alcance, visualizações), `ig_comentarios`, `conteudo_midias` (bytea, como os anexos da Biblioteca), `ig_midia_tokens` (hash do token, expiração), `banco_midias` (com passeio, ponto turístico, temporada) e `respostas_rapidas` (atalho+idioma único).
- `conteudos` ganha: `aprovadoPor/Em`, `tipoPost`, `agendarEm`, `pubStatus` (AGENDADO, PUBLICANDO, PUBLICADO, FALHOU), `pubSimulado`, `pubErro`, `pubContainerId`, `pubIdExterno`, `pubTentativas`, `pubProximaEm`, `pubIniciadaEm`, `pubEm`.

## Segurança do webhook
`GET/POST /api/webhooks/instagram` é público (a Meta vem da internet). GET: devolve o desafio só com o token de verificação certo (comparação em tempo constante). POST: confere `X-Hub-Signature-256` (HMAC-SHA256 do corpo cru com o app secret, tempo constante); ausente/errada = 401; sem segredo configurado = 404; só então processa. Aceita mensagens (inclui eco do que enviamos pelo app e confirmação de leitura) e comentários; ignora mensagens/comentários da própria conta; **dedup** por id externo; nunca registra texto. O token de verificação na URL é mascarado no log. Isenta do cabeçalho CSRF porque quem chama não é navegador.

## Rota pública da mídia agendada (revisão de segurança)
A Meta precisa **buscar** a imagem/vídeo numa URL pública: `GET /api/publico/instagram/midia/<token>`.
- O token tem 32 bytes aleatórios (43 caracteres), **vale para uma única mídia**, só é criado na hora de publicar, **expira em 30 minutos**, e só o **hash** fica no banco.
- Só responde enquanto o post está em "publicando"; ao terminar (sucesso ou falha) os tokens são apagados; a rotina também apaga os vencidos.
- Token desconhecido, malformado, expirado ou de post que não está publicando: **o mesmo 404**, sem dizer o motivo. Limite de 120 requisições/min. Resposta `no-store`, `nosniff`. Expõe somente a mídia que a equipe já decidiu publicar.
- **Exige o sistema no ar, com `URL_PUBLICA` https.** Sem isso a publicação real falha com `URL_PUBLICA_AUSENTE`.

## Aprovação, agendamento e publicação
- Fluxo: ideia → rascunho → em aprovação → aprovado → agendado → publicado. Aprovar, agendar e devolver exigem `marketing:gerenciar`. Aprovado/agendado/publicado de posts do Instagram só por botão (a edição comum recusa). Alterar legenda, rede ou mídia de post aprovado/agendado **desfaz a aprovação**. Nas outras redes (sem automação) "agendado/publicado" continua manual.
- **O agendamento só aceita post aprovado, e a rotina só publica post aprovado.** Regras: JPEG (imagem) e MP4 (vídeo), tipo conferido pelo conteúdo, imagem até 8 MB e vídeo até 100 MB, carrossel de 2 a 10 itens, legenda até 2.200 caracteres e 30 hashtags, antecedência mínima de 5 min.
- Rotina a cada minuto: reserva o post com UPDATE condicional (dois relógios não publicam o mesmo), cria o contêiner (carrossel: filhos + pai), espera processar, publica (`media_publish`) e guarda id e link. O contêiner criado é reaproveitado na nova tentativa (não duplica). Falha transitória (rede, 429, 5xx): até 3 tentativas com espera de 2, 4, 8… min; erro definitivo: FALHOU com o código (nunca o texto da Meta). Vídeo ainda processando volta à fila sem gastar tentativa. Preso em "publicando" por 45 min vira FALHOU "confira no Instagram" (não republica sozinho, para não duplicar).
- Modo simulado: "publicado (simulado)".
- Permissão para publicar: reaproveita `marketing:gerenciar` (decisão a confirmar: criar permissão própria).

## Conversas: respostas prontas, etiquetas e atendente
- Respostas prontas por idioma (PT/EN/ES), atalho `/` na caixa (Enter escolhe a primeira), variáveis `{nome}`, `{passeio}`, `{data}`, `{ponto}`, `{horario}` preenchidas pela reserva mais próxima do telefone; o que faltar fica entre chaves e **bloqueia o envio** até completar. Botão "Carregar sugestões iniciais" cria 18 textos (ponto, horário, chuva, criança, cancelamento, voucher × 3 idiomas) marcados **"a revisar"**: não afirmam política da empresa (chuva, criança e cancelamento só encaminham); o dono deve conferir cada um. Editar um texto o marca como revisado.
- Etiquetas: dúvida, pós-venda, reclamação, grupo, orçamento (com filtro). Atendente: atribuir/assumir/transferir; "Minhas conversas (n)" e "Sem atendente".
- Permissões: `whatsapp:ver` (ver) e `whatsapp:responder` (responder, etiquetar, atribuir, editar respostas); rótulo agora "Conversas (WhatsApp e Instagram)". Perfis existentes não mudam. Conversas do Instagram não têm praça: aparecem para quem tem `whatsapp:ver`.

## Banco de mídias e IA
- Banco de mídias (aba no Marketing): mesmo armazenamento dos anexos da Biblioteca (bytea, tipo pelo conteúdo, limites), até 500 itens, etiquetas passeio/ponto turístico/temporada, "Usar no post" copia a mídia (só JPEG/MP4 servem ao Instagram).
- **Sugerir legenda:** 3 opções + hashtags, tom da marca (slogan "veja a cidade de camarote"; tom oficial a confirmar), idioma PT/EN/ES, pelos Gestores de IA (mesmo cliente, limite mensal e registro de uso, tipo `LEGENDA`). Sem chave: "IA desligada", sem erro. Só o briefing digitado vai para a IA (nenhum dado de cliente).

## A confirmar na documentação oficial da Meta (marcado no código, `servicos/instagram/cliente.ts`)
Versão da Graph API; nomes atuais das métricas (`reach`, `views`, `profile_views`, `website_clicks`; por post `reach`, `saved`, `shares`, `views`) e o formato `since/until` com `metric_type=total_value`; caminho de envio de Direct (`/{conta}/messages` ou `/me/messages`) e o formato do evento (ms ou s no timestamp); campos do aviso de comentários; resposta só a comentários de primeiro nível; `hide`; story (`media_type=STORIES`) via API; limite diário de publicações (citado como 100 em 24 h; `content_publishing_limit`); limite de hashtags; vídeo/Reels (tamanhos, MOV); busca do nome do contato; renovação do token longo; tag de agente humano (resposta até 7 dias) e resposta privada a comentário — **não implementadas**; Range/HEAD na URL da mídia.

## Pendências
Renovação automática do token; leitura de comentários antigos (só chegam por webhook); histórico de demografia do público; mídia recebida (só o tipo é registrado); permissão própria para publicar; arquivar conversas; envio de story; reordenar mídias do carrossel (hoje remover e reenviar).
