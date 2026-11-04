# Implantação em produção (servidor único)

Pacote em `implantacao/`: imagens Docker da API e do site, banco PostgreSQL 16, HTTPS automático (Caddy) e cópia diária do banco. **Testado de ponta a ponta em 04/11/2026** (build das imagens, subida, migrações, 1º administrador, HTTPS, cookie `__Host-` seguro, CSRF, cabeçalhos de segurança e backup).

## 1. O que contratar (decisão do dono — comparar antes)
- **1 servidor (VPS)** Linux com Docker: 2 vCPU, 4 GB de RAM, 40 GB de disco, de preferência no Brasil (LGPD e latência).
- **Um subdomínio**, ex.: `gestao.bybusturismo.com.br`, apontando (registro DNS tipo A) para o IP do servidor.
- **Cópia externa dos backups** (ex.: armazenamento de objetos do próprio provedor ou Google Drive).

## 2. Instalar (uma vez)
```bash
# no servidor, com Docker e Git instalados
git clone https://github.com/bybusturismo/Bybus.git && cd Bybus
cp implantacao/producao.env.exemplo implantacao/.env
nano implantacao/.env          # preencher (segredos: openssl rand -base64 32)
docker compose -f implantacao/docker-compose.yml --env-file implantacao/.env up -d --build
```
Em 1–2 minutos o sistema responde em `https://<DOMINIO>`. Entre com `ADMIN_EMAIL`/`ADMIN_SENHA_INICIAL`: o sistema exige trocar a senha e configurar o MFA. Depois, **apague as linhas ADMIN_*** do `.env`.

## 3. Ligar as integrações
| Integração | O que fazer |
|---|---|
| Paytour (site, quiosque, afiliados, **Civitatis**) | `PAYTOUR_APP_KEY` e `PAYTOUR_APP_SECRET` no `.env` (painel Paytour → Avançado → Aplicativos). A 1ª sincronização lê os últimos `PAYTOUR_DIAS_INICIAIS` dias. |
| Tripadvisor/Viator (avisos da Bókun) e Decolar | `INTEGRACAO_EMAIL_TOKEN` no `.env` e o robô do Gmail em admbybus@ e contatofbyb@ (`integracoes/gmail/README.md`). |

Conferir em **Integrações** no menu do sistema (última execução, resultado, erros, "Sincronizar agora").

## 4. Atualizar para uma nova versão
```bash
cd Bybus && git pull
docker compose -f implantacao/docker-compose.yml --env-file implantacao/.env up -d --build
```
As migrações do banco rodam sozinhas na subida da API.

## 5. Backup e restauração
- Automático: 1 cópia por dia em `implantacao/backups/` (guarda 14 dias). **Copie a pasta para fora do servidor** (ex.: `rclone` para o Drive, diariamente).
- Restaurar uma cópia:
```bash
docker compose -f implantacao/docker-compose.yml --env-file implantacao/.env exec -T db \
  pg_restore -U bybus -d bybus --clean --if-exists < implantacao/backups/bybus-AAAAMMDD-HHMM.dump
```
- Teste a restauração uma vez por mês num ambiente de testes.

## 6. Checklist de segurança antes de abrir para a equipe
- [ ] `AMBIENTE=producao` e `EXIGIR_MFA_ADMIN=true` (a API recusa subir com MFA desligado em produção).
- [ ] Segredos fortes e só no `.env` do servidor; `.env` nunca no Git.
- [ ] Firewall do servidor: só portas 22 (SSH com chave), 80 e 443.
- [ ] Atualizações automáticas de segurança do sistema operacional ligadas.
- [ ] Backup externo funcionando e uma restauração testada.
- [ ] Linhas `ADMIN_*` removidas do `.env` após o 1º acesso.

## Comandos úteis
```bash
docker compose -f implantacao/docker-compose.yml --env-file implantacao/.env ps        # situação
docker compose -f implantacao/docker-compose.yml --env-file implantacao/.env logs -f api # registros da API
```
