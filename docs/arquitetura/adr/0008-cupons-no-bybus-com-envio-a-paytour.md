# ADR 0008 — Cupons criados no Bybus Gestão e enviados à Paytour

- **Data:** 04/11/2026
- **Situação:** aceita (decisão do dono)

## Contexto
A Paytour continua sendo a loja e o checkout (ADR 0001). Cupons só têm efeito no checkout, mas o dono quer
administrar os cupons (regras, vínculo com afiliados e parceiros, relatório de uso de todos os canais) no Bybus Gestão.
A API da Paytour v2 tem `GET/POST/PUT/DELETE /cupons` e `POST /cupons/validate`. Existem 118 cupons na Paytour.

## Decisão
- O Bybus Gestão é o lugar de criar e editar cupons; ao salvar, envia a criação ou alteração à Paytour pela API.
- Importação inicial dos cupons existentes (só leitura) e sincronização periódica para detectar mudanças feitas direto na Paytour
  (mostradas como divergência, sem sobrescrever sozinho).
- Gravar na Paytour só com permissão própria (`cupons:gerenciar`), auditado, e só quando a integração estiver configurada
  com chave da Paytour; fora da produção, o envio é simulado salvo liberação explícita (como o WhatsApp).
- O uso dos cupons é lido dos pedidos (`cupom_id`, `desconto`, `desconto_cupom` por item).

## Consequências
- Um erro de regra aqui vale na loja: a tela mostra o que será enviado e pede confirmação; falha da Paytour aparece na tela
  e não deixa o cupom "salvo só aqui" sem aviso.
- Regras que a Paytour não aceitar ficam marcadas como "só no Bybus" (ex.: balcão/quiosque).
