#!/usr/bin/env bash
# Liga a importação da Paytour no servidor: pede a chave e o segredo do aplicativo da Paytour SEM mostrar na tela,
# grava só no .env do servidor (nunca no chat nem no Git) e reinicia a API. A importação roda sozinha a cada 2 minutos.
# Uso (no servidor, como root):  bash ligar-paytour.sh
set -euo pipefail
ENV="/opt/bybus/implantacao/.env"
[ -f "$ENV" ] || { echo "Não achei $ENV. Rode antes o instalar-servidor.sh."; exit 1; }
definir() { if grep -q "^$1=" "$ENV"; then sed -i "s|^$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }

echo "Cole a CHAVE (App Key) da Paytour e aperte Enter (não aparece na tela):"
read -r -s CHAVE < /dev/tty; echo
echo "Cole o SEGREDO (App Secret) da Paytour e aperte Enter (não aparece na tela):"
read -r -s SEGREDO < /dev/tty; echo
CHAVE="$(echo "$CHAVE" | tr -d '[:space:]')"; SEGREDO="$(echo "$SEGREDO" | tr -d '[:space:]')"
[ ${#CHAVE} -ge 8 ] && [ ${#SEGREDO} -ge 8 ] || { echo "A chave e o segredo precisam ter pelo menos 8 caracteres. Nada foi alterado."; exit 1; }
case "$CHAVE$SEGREDO" in *"|"*) echo "Caractere inválido (|). Nada foi alterado."; exit 1;; esac

definir PAYTOUR_APP_KEY "$CHAVE"
definir PAYTOUR_APP_SECRET "$SEGREDO"
definir PAYTOUR_SINCRONIZAR_MINUTOS 2
# Primeira leitura: pedidos dos últimos 120 dias (passeios já vendidos para as próximas datas entram junto).
definir PAYTOUR_DIAS_INICIAIS 120
chmod 600 "$ENV"
unset CHAVE SEGREDO

COMPOSE=(docker compose -f /opt/bybus/implantacao/docker-compose.yml --env-file "$ENV")
grep -q '^WHATSAPP_PROVEDOR=evolution' "$ENV" && COMPOSE+=(--profile whatsapp)
echo "Reiniciando o sistema com a Paytour ligada…"
"${COMPOSE[@]}" up -d >/dev/null
DOMINIO="$(grep '^DOMINIO=' "$ENV" | cut -d= -f2-)"
for _ in $(seq 1 36); do curl -fsS --max-time 5 "https://$DOMINIO/api/saude" >/dev/null 2>&1 && break; sleep 5; done
echo
echo "PRONTO: Paytour ligada. Em até 2 minutos começa a importação."
echo "Acompanhe no sistema: Configurações > Integrações > Paytour (última execução, resultado e erros)."
