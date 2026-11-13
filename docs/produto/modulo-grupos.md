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

## Próximas etapas
2. Lista de passageiros: link para o representante preencher (planilha online) e importação de Excel.
3. Contrato padrão (modelo do dono, 16 cláusulas) e recibo em PDF no papel timbrado.
4. Assinatura eletrônica (link por e-mail, código de confirmação, registro de data/hora/IP, código de verificação).
