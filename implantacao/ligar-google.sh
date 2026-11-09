#!/usr/bin/env bash
# Liga a importação da planilha do financeiro pelo link do Google (conta de serviço, só leitura).
# Uso (no servidor): bash /opt/bybus/implantacao/ligar-google.sh  → cole o conteúdo do arquivo .json da chave e aperte Enter
# (o comando termina sozinho na última linha, a que tem só "}"). A chave fica só no .env do servidor.
set -euo pipefail
ENV="/opt/bybus/implantacao/.env"
[ -f "$ENV" ] || { echo "Não achei $ENV."; exit 1; }
echo "Cole aqui o conteúdo do arquivo .json da chave da conta de serviço (abra o arquivo no Bloco de Notas, Ctrl+A, Ctrl+C) e aperte Enter:"
JSON=""
while IFS= read -r linha < /dev/tty; do
  JSON+="$linha"$'\n'
  [ "$(echo "$linha" | tr -d '[:space:]')" = "}" ] && break
done
EMAIL="$(printf '%s' "$JSON" | grep -o '"client_email": *"[^"]*"' | cut -d'"' -f4 || true)"
printf '%s' "$JSON" | grep -q '"private_key"' && [ -n "$EMAIL" ] || { echo "Não parece a chave de uma conta de serviço (faltam client_email/private_key). Nada foi alterado."; exit 1; }
B64="$(printf '%s' "$JSON" | base64 -w0)"
if grep -q '^GOOGLE_CONTA_SERVICO=' "$ENV"; then sed -i "s|^GOOGLE_CONTA_SERVICO=.*|GOOGLE_CONTA_SERVICO=$B64|" "$ENV"; else echo "GOOGLE_CONTA_SERVICO=$B64" >> "$ENV"; fi
chmod 600 "$ENV"; unset JSON B64
COMPOSE=(docker compose -f /opt/bybus/implantacao/docker-compose.yml --env-file "$ENV")
grep -q '^WHATSAPP_PROVEDOR=evolution' "$ENV" && COMPOSE+=(--profile whatsapp)
"${COMPOSE[@]}" up -d >/dev/null
echo
echo "PRONTO: leitura pelo link do Google ligada."
echo "Agora compartilhe a planilha (Compartilhar > Leitor) com: $EMAIL"
