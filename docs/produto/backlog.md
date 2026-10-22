# Backlog — Bybus Gestão

## Entregue no ambiente de testes (22/10/2026)
- Login, senha forte (Argon2id), bloqueio progressivo, MFA (TOTP) obrigatório para ADMIN/SUPERVISOR, troca de senha no 1º acesso, sessões revogáveis e com expiração por inatividade.
- Perfis e permissões (ADMIN, SUPERVISOR, ATENDENTE, GUIA, MOTORISTA); auditoria imutável.
- Lista de passageiros do City Tour Toda Ilha em ordem de embarque, alertas, CSV, impressão, check-in de embarque.
- Importação idempotente: e-mails Bókun (Viator/Tripadvisor) e CSV da Paytour; detecção de duplicatas entre canais.

## Próximos (prioridade)
1. **Sincronização automática Bókun via API** (depende de chave de API + liberar `api.bokun.io`).
2. **Leitura automática do Gmail** (e-mails "New booking"/"Cancelled booking") — alternativa enquanto a API não é liberada.
3. **API da Paytour** (depende de documentação/credenciais da Paytour); ajustar importador CSV ao formato real.
4. **App mobile (Expo)** para a guia — modo embarque offline.
5. **Módulo Frota** (MVP Acesso + Frota): veículos, documentos com vencimento, manutenção preventiva, abastecimento, checklist do motorista.

## Segurança — pendências registradas pela revisão (22/10/2026)
- Escopo por **unidade** (Florianópolis × Balneário Camboriú) e GUIA/MOTORISTA limitados às saídas em que estão escalados.
- **Recuperação de senha** por link de uso único (precisa de serviço de e-mail transacional).
- **Retenção/anonimização LGPD** automática dos manifestos (prazo a confirmar com o advogado) e limpeza de sessões expiradas.
- Reautenticação para ações sensíveis (redefinir MFA, ver documentos completos).
- AES-GCM com AAD (id do passageiro) e versionamento de chave (`v1:`).
- Rate limit compartilhado (Redis) quando houver mais de uma instância.
- Verificação de senha contra lista de senhas vazadas.
- `REVOKE UPDATE, DELETE ON auditoria` no papel da aplicação em produção (além do trigger já criado).
