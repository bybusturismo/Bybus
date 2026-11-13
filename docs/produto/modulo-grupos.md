# Grupos fechados (13/11/2026)

Pedido do dono: um lugar para tudo de cada grupo (escolas, empresas, excursões), com histórico para plano de contato com
quem já fez passeio e para conferir valores e roteiros de anos anteriores. Regras do negócio em `docs/conhecimento/empresa.md`.

## Etapa 1 — cadastro, pagamentos e anexos (pronta)
- Menu **Reservas › Grupos fechados** (`reservas:editar`, como os pedidos de orçamento).
- Campos: nome/instituição, estilo (escola, empresa, excursão, evento, outro), situação (orçamento, confirmado, realizado,
  cancelado), data, horário e local de início, guia, veículo, duração, roteiro descrito, almoço (sim/não e onde), pessoas,
  mínimo contratado, cortesias, valor por pessoa, valor total (vazio = por pessoa × pessoas respeitando o mínimo), sinal (%),
  NF emitida e número, contratante (razão social, CNPJ, endereço), representante (nome, cargo, telefone, e-mail, CPF
  **cifrado**), observações.
- **Pagamentos = contas a receber do financeiro** (uma fonte só): "Gerar cobrança" cria o **sinal** (padrão 50%, vencimento
  escolhido) e o **saldo** (até o dia do passeio) em Financeiro › A receber, categoria "Grupos", origem `GRUPO`,
  `fin_lancamentos.grupo_fechado_id`. Uma vez só; ajustes e baixas no financeiro. A ficha e a lista mostram recebido e o que falta.
- **Anexos:** contrato, comprovantes, lista, NF e outros (PDF, foto, XML, Word/Excel; até 15 MB; cifrados; auditados).
- **Histórico:** a ficha lista os outros passeios do mesmo grupo (mesmo CNPJ ou nome): data, pessoas, valor por pessoa,
  total e roteiro. A lista tem busca por grupo, representante ou roteiro, e filtros de situação, estilo e ano.
- Regras puras no core (`grupos/grupos.ts`): `totalDoGrupo`, `planoDeCobranca`, `valorPorExtenso` (para contrato e recibo).

## Etapa 2 — lista de passageiros (pronta)
- Na ficha do grupo, **Lista de passageiros** em forma de planilha online (nome completo, tipo e número do documento,
  nascimento, função: aluno, professor/monitor, acompanhante, outro), com **importar Excel (.xlsx) ou .csv** (acha o
  cabeçalho sozinho; aponta linhas com problema: CPF inválido, data inválida, nome curto), salvar e **Imprimir lista** (versão
  de papel com documento, para a fiscalização). Documento **cifrado** no banco (`grupos_passageiros`).
- **Link para o representante** (`/lista-grupo/<token>`, 30 dias; gerar de novo invalida o anterior; cancelar): ele vê só o
  nome, data e local do passeio e a lista; preenche ou importa e envia com o **aceite de autorização** (LGPD; auditado).
  Fecha no dia seguinte ao passeio. Sem valores, CNPJ ou dados do representante na página.
- Revisão de segurança da rota pública `GET|PUT /api/publico/lista-grupo/:token`: token aleatório de 24 bytes, só o hash no
  banco, vence, cancelável, 404 igual para inválido/vencido/cancelado/grupo cancelado, 20–30 pedidos por minuto por IP,
  no máximo 500 pessoas, token mascarado no log, aceite obrigatório.

## Etapa 3 — contrato e recibo no papel timbrado (pronta)
- **Contrato (PDF)** na ficha do grupo: modelo do dono (passeio pedagógico, 16 cláusulas) generalizado para escolas e demais
  grupos (`montarContratoGrupo` no core): partes, objeto, data/horário/local e roteiro (uma letra por linha do roteiro),
  valor por pessoa, mínimo e valor mínimo por extenso, cortesias, prazo da lista (3 dias antes), alimentação e terceiros,
  sinal (% e valor por extenso, vencimento da cobrança gerada), saldo até o passeio, responsabilidades, LGPD, chuva e
  reagendamento, alterações, segurança, **cancelamento sem devolução do antecipado (remarcação ou crédito em até 12 meses)**,
  vigência, assinatura eletrônica (MP 2.200-2/2001 e Lei 14.063/2020) e foro. Campos sem dado saem como "____________".
- **Recibo (PDF)** de cada pagamento recebido (só depois da baixa no financeiro), com valor por extenso.
- O timbrado (folha A4 inteira, `apps/api/recursos/timbrado-bybus.jpg`, do arquivo enviado pelo dono) vai ao fundo de todas
  as páginas; texto entre o cabeçalho e o rodapé; numeração "página X de Y".
- **Dados da empresa no contrato** (botão em Grupos): razão social, CNPJ, endereço, cidade do foro e **quem assina** (nome e
  cargo) na tabela `configuracoes` — todos veem, só o administrador altera (auditado). Nenhum nome no código.
- **A confirmar:** texto final revisado pela Diretoria e por advogado; testemunhas (o modelo original previa duas).

## Etapa 4 — assinatura eletrônica (pronta)
- Na ficha do grupo, **Enviar contrato para assinatura**: contratante (representante, já preenchido), contratada (quem assina
  pela By Bus, dos "Dados do contrato") e testemunhas opcionais, com nome, e-mail e CPF opcional (se informado, tem que bater).
  O contrato é **congelado** (PDF cifrado, hash SHA-256, conteúdo guardado) e cada pessoa recebe **link individual por
  e-mail** (os links aparecem uma vez para copiar e mandar também pelo WhatsApp). Acompanhamento: abriu / assinou;
  reenviar (novo link, o anterior deixa de valer); cancelar envio.
- **Quem assina** (`/assinar/<token>`, sem login): lê o PDF, pede o **código de 6 números por e-mail** (10 min, 5 tentativas,
  no máximo 8 envios), confirma **nome completo** (tem que bater com o cadastrado, sem diferenciar acento/maiúscula) e **CPF**
  (válido; igual ao cadastrado, se houver) e aceita. Ficam registrados data/hora, IP e navegador.
- **Quando todos assinam:** PDF final = contrato + **folha de assinaturas** (quem, quando em horário de Brasília, e-mail e
  CPF mascarados, IP, navegador, hash do original, código de verificação), vira anexo "Contrato" do grupo, todos recebem
  e-mail com o código; o link de cada um passa a baixar o documento assinado.
- **Verificação pública** `/verificar/BB-XXXX-XXXX`: título, situação, quem assinou e quando, hashes — sem e-mails, CPFs
  ou conteúdo.
- Base legal citada no contrato e na folha: MP 2.200-2/2001 (art. 10, § 2º) e Lei 14.063/2020 (assinatura eletrônica entre
  particulares). **A confirmar com advogado:** necessidade de testemunhas para título executivo.
- Revisão de segurança das rotas públicas `/api/publico/assinar/:token[/pdf|/codigo|/assinar]` e `/api/publico/verificar/:codigo`:
  token aleatório de 24 bytes (só o hash no banco; reenviar troca), código de 6 dígitos com hash por signatário, comparação
  em tempo constante, limites por minuto e por envio, documento cancelado derruba os links, tokens mascarados no log
  (`/assinar/***`), CPF cifrado. Sem e-mail configurado o envio do código falha com aviso (a equipe manda o link).
