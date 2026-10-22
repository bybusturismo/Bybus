# Time de agentes do projeto Bybus Gestão

Cada especialista é um agente definido em `.claude/agents/<nome>.md`. Em qualquer sessão do Claude Code neste repositório, eles podem ser acionados pelo nome (ex.: "use o agente `juridico` para revisar a política de cancelamento").

| Agente | Papel | Quando acionar |
|---|---|---|
| `produto-po` | Product Owner | Requisitos, histórias, priorização, backlog |
| `especialista-turismo` | Turismo receptivo e city tours | Produtos, tarifas, canais, operação de saídas, KPIs do setor |
| `arquiteto-software` | Arquiteto / tech lead | Stack, arquitetura, modelagem de domínio, ADRs |
| `backend` | Engenharia back-end | API, regras de negócio, banco, auditoria |
| `frontend-web` | Engenharia front-end | Painel web (computador) |
| `mobile` | Engenharia mobile | App Android/iOS (motorista, guia, gestor), offline |
| `ux-ui-design` | UX/UI | Jornadas, wireframes, design system, usabilidade |
| `seguranca` | Segurança da informação | Login, senha, MFA, perfis de acesso, OWASP, LGPD técnica |
| `juridico` | Assessoria jurídica | Turismo, transporte, CDC, trabalhista, LGPD, tributário |
| `frota-manutencao` | Frota e manutenção | Preventiva/corretiva, checklists, pneus, combustível, documentos |
| `financeiro-fiscal` | Financeiro e fiscal | Caixa, conciliação por canal, comissões, DRE, NFS-e |
| `integracoes` | Integrações | Paytour, Decolar, Tripadvisor/Viator, Civitatis, pagamentos, WhatsApp, Google |
| `qa-testes` | Qualidade | Estratégia de testes, dados fictícios, validação |
| `devops-infra` | DevOps | Ambientes (dev/testes/produção), CI/CD, backups, monitoramento |
| `dados-bi` | Dados e BI | KPIs, dashboards, migração/limpeza das planilhas |

## Como o time trabalha
1. **PO + Turismo** definem o quê e por quê (histórias + critérios de aceite).
2. **Jurídico + Segurança** revisam requisitos com impacto legal ou de dados pessoais.
3. **Arquiteto** decide o como (ADR); **UX** desenha o fluxo.
4. **Back-end / Front-end / Mobile / Integrações** implementam.
5. **QA** valida no ambiente de testes; **DevOps** publica.
6. Decisões de negócio, custos recorrentes e qualquer ação irreversível → **perguntar ao dono da empresa antes**.
