# ADR 0002 — Stack tecnológica

- **Status:** aceito (22/10/2026), revisado pelo time (arquitetura, segurança)
- **Contexto:** equipe pequena, sistema web + app, dados pessoais (LGPD), integrações com Paytour/Bókun/OTAs, orçamento enxuto. Precisamos de uma stack única, popular e fácil de manter.

## Decisão
| Camada | Escolha | Por quê |
|---|---|---|
| Linguagem | **TypeScript** de ponta a ponta | Regras e tipos compartilhados entre API, web e app |
| Monorepo | **pnpm workspaces** (`packages/core`, `apps/api`, `apps/web`, futuro `apps/mobile`) | Um repositório, versões consistentes |
| Regras de negócio | `@bybus/core` — TypeScript puro, sem dependências | Testável, reaproveitado no app offline |
| API | **Fastify 5** + **Zod** | Rápido, validação forte, ótimo suporte a plugins de segurança |
| Banco | **PostgreSQL 16** + **Drizzle ORM** (migrações SQL versionadas) | Relacional, gerenciado em qualquer provedor; Drizzle sem binários nativos |
| Autenticação | Sessão server-side em cookie httpOnly/SameSite=Strict, **Argon2id**, **TOTP (MFA)**, cabeçalho anti-CSRF | Revogação imediata, padrão OWASP |
| Dados sensíveis | Documento cifrado **AES-256-GCM** com chave em variável de ambiente/cofre | Vazamento do banco não expõe CPF |
| Web | **React 18 + Vite** | Padrão de mercado |
| App (fase seguinte) | **React Native (Expo)** reaproveitando `@bybus/core`; até lá, o modo embarque web é responsivo | Uma base para Android e iOS |
| Testes | **Vitest** (unidade + integração com PostgreSQL real) | Rápido, mesmo runner em tudo |
| CI | **GitHub Actions** (typecheck, testes, build) | Já no GitHub |

## Consequências
- Hospedagem: qualquer provedor com Node 22 + PostgreSQL gerenciado (escolha pendente — comparação de custos antes de contratar).
- A chave de criptografia vira ativo crítico: guardar em cofre e ter cópia segura; sem ela os documentos não podem ser lidos.
