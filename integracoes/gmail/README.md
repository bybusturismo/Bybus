# Robô do Gmail → lista de passageiros

Lê as confirmações de reserva que chegam por e-mail e coloca cada passageiro na saída certa do Bybus Gestão, a cada 5 minutos.

| Caixa | O que chega | Leitor no sistema |
|---|---|---|
| admbybus@gmail.com | Bókun "New/Cancelled booking" (Tripadvisor/Viator) | pronto |
| contatofbyb@gmail.com | Decolar (e Tripadvisor) | Decolar: falta um e-mail de exemplo para criar o leitor |

**Por que Apps Script e não "login com Google" no sistema:** o acesso de leitura ao Gmail por app externo exige verificação de segurança paga do Google (escopo restrito), e em modo de teste a autorização vence a cada 7 dias. O Apps Script roda dentro da própria conta, de graça, e só envia ao sistema os e-mails de reserva.

## O que o robô envia
Só e-mails de `bokun.io`, `decolar.com` e `despegar.com` dos últimos 30 dias, ainda sem o rótulo `bybus/enviado`. Depois de processar, aplica esse rótulo. E-mails da Decolar ficam sem rótulo até existir o leitor (aí são processados automaticamente).

## Instalação (uma vez por caixa; ~5 minutos)
Pré-requisito: o sistema publicado em um endereço `https://` com a variável `INTEGRACAO_EMAIL_TOKEN` configurada (segredo de 32+ caracteres; gere com `openssl rand -base64 36`).

1. Entre na conta Gmail (ex.: contatofbyb@gmail.com) e abra https://script.google.com → **Novo projeto**. Nome: "Bybus – reservas".
2. Apague o conteúdo e cole o arquivo `Codigo.gs` desta pasta. Salve.
3. **Configurações do projeto** (engrenagem) → **Propriedades do script** → adicione:
   - `BYBUS_URL` = endereço do sistema (ex.: `https://gestao.bybusturismo.com.br`)
   - `BYBUS_TOKEN` = o mesmo valor de `INTEGRACAO_EMAIL_TOKEN`
4. Volte ao editor, escolha a função `instalar` e clique em **Executar**. Autorize o acesso ao Gmail e a "serviço externo".
5. Pronto. Para conferir: **Execuções** (menu à esquerda) mostra cada rodada; no Gmail, as reservas processadas ganham o rótulo `bybus/enviado`.

Para desligar: **Acionadores** → excluir o acionador `enviarReservas`.

## Segurança e LGPD
- O token fica nas propriedades do script (não no código). Trocar o token no sistema invalida o robô até atualizar a propriedade.
- O sistema só aceita a chamada com o token; responde apenas o resultado por mensagem (sem dados pessoais).
- Fora da produção, nomes, documentos, telefones e e-mails são anonimizados antes de gravar.
