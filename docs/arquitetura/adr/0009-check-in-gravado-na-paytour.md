# ADR 0009 — Check-in da guia gravado na Paytour

- **Data:** 09/11/2026
- **Status:** aprovado pelo dono ("aprovo gravar o check-in na Paytour", 09/11/2026); implementação pendente da confirmação técnica da API.
- **Contexto:** o gerente pediu que a presença marcada pela guia no tablet (conferência de embarque do Bybus) vire o check-in da Paytour, para
  saber quem realmente fez o passeio (base do pós-passeio e da avaliação). Pelo ADR 0001 a Paytour só era lida; gravar exige autorização do dono.
- **Decisão:** o Bybus passa a **gravar o check-in** do item do pedido na Paytour quando a guia marca o passageiro como embarcado. É a única escrita
  autorizada na Paytour até agora (cupons, ADR 0008, seguem a mesma linha).
- **Regras:**
  1. Só grava check-in de reservas que vieram da Paytour (com o código do pedido/item); OTAs que não passam pela Paytour ficam só no Bybus.
  2. Erro humano: a guia pode desfazer a marcação na hora; o desfazer também é enviado à Paytour se a API permitir (a confirmar), senão gera
     uma pendência para a supervisão corrigir no painel da Paytour. Toda marcação e correção fica na auditoria.
  3. Falha de rede não perde nada: a gravação entra numa fila e é repetida; a tela mostra o que ainda não foi para a Paytour.
  4. A chave da Paytour fica só no servidor (`PAYTOUR_APP_KEY`/`PAYTOUR_APP_SECRET`), nunca no chat nem no Git.
- **A confirmar:** o endpoint exato de check-in da API v2 (a documentação lida em 04/11 cita "check-in de atividade"; o site da documentação
  não abriu desta sessão em 09/11) e se existe desfazer.
