# ADR 0003 — Lista de passageiros (manifesto) do City Tour Toda Ilha

- **Status:** aceito para o ambiente de testes (22/10/2026). Pontos jurídicos marcados "a confirmar".
- **Participantes:** especialista-turismo, juridico, seguranca, arquiteto-software.

## Decisões
1. **Ordem de embarque** = horário do ponto → sequência oficial do Manual do Atendente (desempate de pontos com o mesmo horário) → titular (família junta) → bloco **"A DEFINIR"** no fim. A sequência do transfer (Ingleses/Santinho → Cachoeira → Canasvieiras → Jurerê) é validada pelo sistema e não pode ser invertida.
2. **Documento:** tipo (CPF, RG, passaporte, RNM, DNI Mercosul, certidão, outro) + número + país. CPF validado pelo dígito. Guardado cifrado; a lista mostra só os 4 últimos caracteres. **Documento completo apenas para ADMIN/SUPERVISOR, sempre registrado na auditoria.** Passageiro sem documento gera alerta (não bloqueia) até o jurídico confirmar a exigência.
3. **Categorias:** adulto, sênior, infantil, colo (não ocupa assento), cortesia (ocupa assento, não conta como pagante).
4. **Alertas:** mínimo de pagantes (12 confirma; 10–11 aguarda supervisor; < 10 decisão obrigatória do supervisor), lotação (≥ 90% e excedida), sem ponto, sem nome, sem documento, documento inválido, possível duplicata.
5. **Fontes de reservas** (todas idempotentes por canal + código):
   - **Viator/Tripadvisor → Bókun:** hoje por e-mail "New booking" (colado na tela de importação); depois via **API da Bókun** (documentada) — depende de liberar `api.bokun.io` na rede e gerar chave de API.
   - **Paytour (site, quiosque, Civitatis integrada):** importação do relatório CSV; API quando a Paytour fornecer documentação.
   - **Decolar:** lançamento manual na tela (ou via Paytour como hoje).
   - Reservas espelho (documento 1111/2222/3333 ou afiliado interno) são reconhecidas e cruzadas com o código da OTA; duplicatas são **sugeridas**, nunca juntadas automaticamente.
6. **Embarque:** guia registra EMBARCOU / NO_SHOW pelo celular; auditoria registra quem e quando.
7. **Perfis:** ATENDENTE monta a lista e importa; SUPERVISOR confirma/cancela a saída e vê documentos; GUIA faz check-in; MOTORISTA só visualiza (sem telefones).

## Pendências
- Confirmar com advogado se há exigência municipal de lista com documento e o risco do Decreto 5.651/2008 (vedação de "cobrança individualizada"). Ver `docs/conhecimento/juridico-regulatorio.md`.
- Prazo de retenção/anonimização automática dos manifestos (proposta: 1 ano detalhado; anonimizar documento/telefone depois).
- Formato real do CSV exportado pela Paytour (mapeamento de colunas é configurável).
