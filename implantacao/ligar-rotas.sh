#!/usr/bin/env bash
# Liga o cálculo de rota dos orçamentos de grupo (OpenRouteService, plano gratuito: até 2.000 rotas por dia).
# Crie a conta grátis em https://openrouteservice.org/dev/#/signup e copie a chave em "Dashboard > Tokens".
# A chave é pedida SEM aparecer na tela e fica só no .env do servidor.
# Uso: bash /opt/bybus/implantacao/ligar-rotas.sh
set -euo pipefail
ENV="/opt/bybus/implantacao/.env"
[ -f "$ENV" ] || { echo "Não achei $ENV."; exit 1; }
definir() { if grep -q "^$1=" "$ENV"; then sed -i "s|^$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }
echo "Cole a CHAVE do OpenRouteService (não aparece na tela) e aperte Enter:"
read -r -s CHAVE < /dev/tty; echo
CHAVE="$(echo "$CHAVE" | tr -d '[:space:]')"
[ ${#CHAVE} -ge 20 ] || { echo "Isso não parece uma chave do OpenRouteService. Nada foi alterado."; exit 1; }
case "$CHAVE" in *"|"*) echo "Caractere inválido. Nada foi alterado."; exit 1;; esac
definir ORS_CHAVE "$CHAVE"
chmod 600 "$ENV"; unset CHAVE
COMPOSE=(docker compose -f /opt/bybus/implantacao/docker-compose.yml --env-file "$ENV")
grep -q '^WHATSAPP_PROVEDOR=evolution' "$ENV" && COMPOSE+=(--profile whatsapp)
"${COMPOSE[@]}" up -d >/dev/null
echo "PRONTO: rota dos orçamentos ligada."
echo "Teste em https://$(grep '^DOMINIO=' "$ENV" | cut -d= -f2-): Reservas > Orçamento com rota > Calcular rota."
