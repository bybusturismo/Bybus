# Implantação em produção (servidor único)

Pacote em `implantacao/`: imagens Docker da API e do site, banco PostgreSQL 16, HTTPS automático (Caddy) e cópia diária do banco. **Testado de ponta a ponta em 04/11/2026** (build das imagens, subida, migrações, 1º administrador, HTTPS, cookie `__Host-` seguro, CSRF, cabeçalhos de segurança e backup).

## 1. O que contratar (decisão do dono — comparar antes)
- **1 servidor (VPS)** Linux com Docker: 2 vCPU, 4 GB de RAM, 40 GB de disco, de preferência no Brasil (LGPD e latência).
- **Um subdomínio**, ex.: `gestao.bybusturismo.com.br`, apontando (registro DNS tipo A) para o IP do servidor.
- **Cópia externa dos backups** (ex.: armazenamento de objetos do próprio provedor ou Google Drive).

## 2. Instalar (uma vez)
**Jeito rápido (08/11/2026):** no servidor novo (Ubuntu 24.04, como root), o `implantacao/instalar-servidor.sh` faz tudo:
atualiza o sistema, liga firewall (22/80/443), fail2ban e atualizações automáticas, instala o Docker, baixa o código em
`/opt/bybus`, gera o `.env` com segredos aleatórios (pergunta só o e-mail do administrador), sobe o sistema, confere o
HTTPS e mostra a senha temporária do 1º acesso uma única vez (e a tira do `.env`). Pode ser rodado de novo para atualizar.
Servidor de produção: Contabo, IP 92.242.191.131, endereço `gestao.bybusturismo.com.br` (Cloudflare, nuvem cinza até o HTTPS sair).

Jeito manual:
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
**Automático (decisão do dono, 09/11/2026):** o servidor confere a cada 10 minutos a área **`producao`** do GitHub
(`implantacao/atualizar-auto.sh`, instalado uma vez com `bash /opt/bybus/implantacao/instalar-atualizador.sh`). Versão nova: cópia do banco
(`backups/antes-atualizacao-*.dump`, 14 dias), monta e liga, confere `/api/saude`; se não voltar, retorna sozinho à versão anterior do código
(a cópia do banco fica para restaurar à mão, se a migração tiver mudado algo). Registro em `/var/log/bybus-atualizacao.log`.
**Publicar = levar a versão testada para a área `producao`**, só quando o dono disser "pode publicar".

Manual (se precisar):
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
- [ ] `AMBIENTE=producao`. Verificação em duas etapas **desligada para todos por decisão do dono (09/11/2026)**, ciente do risco (`EXIGIR_MFA_ADMIN=false`).
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
