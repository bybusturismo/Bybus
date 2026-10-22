# ADR 0001 — Integrar com a Paytour (não substituir por enquanto)

- **Status:** aceito pelo dono da empresa em 22/10/2026
- **Contexto:** a Paytour é hoje o motor de reservas (loja, balcão, afiliados, Civitatis integrada). Tripadvisor/Viator e Decolar são lançados manualmente nela. Substituí-la exigiria checkout, pagamentos e certificação nas OTAs.
- **Decisão:** a Paytour continua vendendo. O Bybus Gestão consome reservas, passageiros, check-ins e pagamentos pela API da Paytour e é a fonte oficial de frota, saídas operacionais, escalas, financeiro e indicadores.
- **Consequências:**
  - Pedir à Paytour documentação da API, sandbox e webhooks; confirmar plano necessário (provável Premium).
  - Sem webhook: sincronização incremental periódica, idempotente.
  - Reavaliar substituição após o sistema estar estável (novo ADR).
