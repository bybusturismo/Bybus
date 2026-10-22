# ADR 0005 — Unidades (praças/franquias), linhas de negócio e acessos configuráveis

- **Status:** proposto (22/10/2026).

## Decisão
1. **Organização → Unidade (praça).** Toda informação operacional e financeira pertence a uma **unidade** (Florianópolis, Balneário Camboriú; no futuro, franqueados). A franqueadora vê o consolidado; cada franqueado vê só a sua unidade. Implementado como coluna `unidade_id` + filtro obrigatório no back-end (não bancos separados), com possibilidade de isolamento maior se a franquia exigir.
2. **Linha de negócio** em produtos, saídas, contratos e lançamentos financeiros: `CITY_TOUR`, `FRETAMENTO`, `PUBLICIDADE`, `RECREATIVO`. Cada linha tem seus fluxos (ingresso online × contrato × venda na hora).
3. **Acessos configuráveis:** perfis passam a ser cadastráveis pelo administrador (nome + conjunto de permissões + escopo de unidades). Os perfis atuais (Admin, Supervisor, Atendente, Guia, Motorista) viram modelos padrão. Regras sensíveis (documento completo, MFA obrigatório) continuam forçadas pelo sistema.
4. **Pessoas** (colaboradores, guias, motoristas, parceiros) num cadastro único com papéis; usuário do sistema é opcional para cada pessoa.

## Consequências
- Migração dos dados atuais para a unidade "Florianópolis" e linha "City Tour".
- Deve ser feito **antes** de Financeiro, Escalas e Frota para não retrabalhar.
