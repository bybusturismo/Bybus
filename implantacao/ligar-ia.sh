#!/usr/bin/env bash
# Liga a IA do sistema (Turistinha e gestores de IA) com uma chave da API da Anthropic (Claude).
# Crie a chave em console.anthropic.com > API Keys. A chave é pedida SEM aparecer na tela e fica só no .env do servidor.
# Uso: bash ligar-ia.sh
set -euo pipefail
ENV="/opt/bybus/implantacao/.env"
[ -f "$ENV" ] || { echo "Não achei $ENV."; exit 1; }
definir() { if grep -q "^$1=" "$ENV"; then sed -i "s|^$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }
echo "Cole a CHAVE da API do Claude (começa com sk-ant-; não aparece na tela) e aperte Enter:"
read -r -s CHAVE < /dev/tty; echo
CHAVE="$(echo "$CHAVE" | tr -d '[:space:]')"
[[ "$CHAVE" == sk-ant-* ]] && [ ${#CHAVE} -ge 30 ] || { echo "Isso não parece uma chave do Claude (sk-ant-...). Nada foi alterado."; exit 1; }
case "$CHAVE" in *"|"*) echo "Caractere inválido. Nada foi alterado."; exit 1;; esac
read -r -p "Limite de gasto por mês, em dólares (Enter = 5): " LIMITE < /dev/tty
LIMITE="${LIMITE:-5}"; LIMITE="${LIMITE//,/.}"
[[ "$LIMITE" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "Limite inválido. Nada foi alterado."; exit 1; }
read -r -p "Ligar a avaliação diária automática dos gestores de IA (6h30)? Gasta mais. (s/N): " DIARIA < /dev/tty
case "$DIARIA" in s|S|sim|SIM) DIARIA=true ;; *) DIARIA=false ;; esac
definir ANTHROPIC_API_KEY "$CHAVE"
definir IA_LIMITE_MES_USD "$LIMITE"
definir IA_AVALIACAO_DIARIA "$DIARIA"
chmod 600 "$ENV"; unset CHAVE
COMPOSE=(docker compose -f /opt/bybus/implantacao/docker-compose.yml --env-file "$ENV")
grep -q '^WHATSAPP_PROVEDOR=evolution' "$ENV" && COMPOSE+=(--profile whatsapp)
"${COMPOSE[@]}" up -d >/dev/null
echo "PRONTO: IA ligada (limite US\$ $LIMITE por mês; avaliação diária: $DIARIA)."
echo "Teste em https://$(grep '^DOMINIO=' "$ENV" | cut -d= -f2-): clique na Turistinha e faça uma pergunta."
